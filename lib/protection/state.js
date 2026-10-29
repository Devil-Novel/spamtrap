// In-memory detection state. Nothing here is persisted and nothing here
// contains message content - only timestamps, counts, short hashes and ids.
//
// Isolation: one bucket per guild, and inside it one entry per account /
// webhook / executor. Bounds: every map is capped (oldest entries evicted
// first - Maps keep insertion order) and a periodic sweep drops anything
// older than the longest configurable window, so memory can't grow without
// limit during a long attack or across many servers.

const MAX_KEYS_PER_MAP = 2000; // per guild, per map
const MAX_LIST = 200; // timestamps kept per key
const MAX_COHORT = 1000; // raid cohort members remembered per guild
const MAX_AUDIT_SEEN = 5000; // audit entry ids remembered per guild
const SWEEP_EVERY_MS = 60 * 1000;
// Longest window any feature can be configured to (see config.LIMITS) plus
// slack; anything older than this is garbage for every detector.
const MAX_RETENTION_MS = 300 * 1000 * 2;

function pruneList(list, cutoff) {
  // lists are append-only, oldest first
  let i = 0;
  while (i < list.length && list[i].ts < cutoff) i++;
  if (i) list.splice(0, i);
  if (list.length > MAX_LIST) list.splice(0, list.length - MAX_LIST);
  return list;
}

function capMap(map, max = MAX_KEYS_PER_MAP) {
  while (map.size > max) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

class ProtectionState {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.guilds = new Map();
    this.lastSweep = now();
  }

  guild(guildId) {
    let g = this.guilds.get(guildId);
    if (!g) {
      g = {
        mentions: new Map(), // userId -> [{ ts, msgId, count }]
        repeats: new Map(), // userId -> [{ ts, msgId, hash }]
        webhooks: new Map(), // webhookId -> [{ ts }]
        joins: [], // [{ ts, userId }]
        cohort: new Map(), // userId -> joinTs (members who arrived during the raid window)
        raidUntil: 0,
        raidAlertedAt: 0,
        locks: new Map(), // key -> ts (in-flight enforcement)
        cooldowns: new Map(), // key -> untilTs
        auditSeen: new Map(), // entryId -> ts
        audit: new Map(), // executorId -> [{ ts, type }]
        alerts: { times: [], suppressed: 0 },
      };
      this.guilds.set(guildId, g);
      capMap(this.guilds, 5000);
    }
    return g;
  }

  // ---- generic helpers -----------------------------------------------------

  pushEntry(map, key, entry, max = MAX_KEYS_PER_MAP) {
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
      capMap(map, max);
    }
    list.push(entry);
    if (list.length > MAX_LIST) list.splice(0, list.length - MAX_LIST);
    return list;
  }

  window(map, key, windowMs) {
    const list = map.get(key);
    if (!list) return [];
    pruneList(list, this.now() - windowMs);
    if (!list.length) map.delete(key);
    return list;
  }

  // Try to take an in-flight lock. Returns false if someone else holds it.
  tryLock(guildId, key, ttlMs = 15000) {
    const g = this.guild(guildId);
    const now = this.now();
    const held = g.locks.get(key);
    if (held && held > now) return false;
    g.locks.set(key, now + ttlMs);
    capMap(g.locks);
    return true;
  }
  unlock(guildId, key) {
    this.guild(guildId).locks.delete(key);
  }

  onCooldown(guildId, key) {
    const g = this.guild(guildId);
    const until = g.cooldowns.get(key);
    return !!until && until > this.now();
  }
  setCooldown(guildId, key, ms) {
    const g = this.guild(guildId);
    g.cooldowns.set(key, this.now() + ms);
    capMap(g.cooldowns);
  }

  // Audit-log dedupe: true the first time an entry id is seen.
  markAuditSeen(guildId, entryId) {
    const g = this.guild(guildId);
    if (g.auditSeen.has(entryId)) return false;
    g.auditSeen.set(entryId, this.now());
    capMap(g.auditSeen, MAX_AUDIT_SEEN);
    return true;
  }

  addToCohort(guildId, userId) {
    const g = this.guild(guildId);
    g.cohort.set(userId, this.now());
    capMap(g.cohort, MAX_COHORT);
  }
  inCohort(guildId, userId) {
    return this.guild(guildId).cohort.has(userId);
  }
  isRaidActive(guildId) {
    const g = this.guilds.get(guildId);
    return !!g && g.raidUntil > this.now();
  }

  clearGuild(guildId) {
    this.guilds.delete(guildId);
  }

  // Drop expired data everywhere. Cheap enough to run every minute.
  sweep(force = false) {
    const now = this.now();
    if (!force && now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    const cutoff = now - MAX_RETENTION_MS;
    for (const [guildId, g] of this.guilds) {
      for (const map of [g.mentions, g.repeats, g.webhooks, g.audit]) {
        for (const [k, list] of map) {
          pruneList(list, cutoff);
          if (!list.length) map.delete(k);
        }
      }
      pruneList(g.joins, cutoff);
      for (const [k, until] of g.locks) if (until <= now) g.locks.delete(k);
      for (const [k, until] of g.cooldowns) if (until <= now) g.cooldowns.delete(k);
      for (const [k, ts] of g.auditSeen) if (ts < cutoff) g.auditSeen.delete(k);
      if (g.raidUntil && g.raidUntil <= now) {
        g.raidUntil = 0;
        g.cohort.clear();
      } else if (!g.raidUntil) {
        for (const [k, ts] of g.cohort) if (ts < cutoff) g.cohort.delete(k);
      }
      g.alerts.times = g.alerts.times.filter((ts) => ts >= now - 60 * 1000);
      // A pending "N alerts were suppressed" note must survive until it has
      // been reported, so it counts as live data here.
      const empty =
        !g.mentions.size && !g.repeats.size && !g.webhooks.size && !g.audit.size && !g.joins.length &&
        !g.cohort.size && !g.locks.size && !g.cooldowns.size && !g.auditSeen.size && !g.raidUntil &&
        !g.alerts.times.length && !g.alerts.suppressed;
      if (empty) this.guilds.delete(guildId);
    }
  }
}

module.exports = { ProtectionState, MAX_KEYS_PER_MAP, MAX_LIST, MAX_COHORT, MAX_AUDIT_SEEN };
