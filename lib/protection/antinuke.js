// Anti-nuke: watches fresh audit-log entries for a burst of destructive admin
// actions by one executor. Needs the bot to have View Audit Log (Discord only
// delivers guildAuditLogEntryCreate to bots that have it) - the Guild
// Moderation intent the bot already uses covers the event itself.
//
// Honest limits: this reacts *after* actions happen. It cannot undo deleted
// channels or roles, and it cannot act on an account whose highest role is
// above the bot's. Default is alert-only; "strip_roles" containment must be
// turned on explicitly and only removes dangerous roles the bot is allowed to
// edit, leaving every other role alone. The server owner and the bot itself
// are always exempt; trusted roles can be exempted explicitly; Administrators
// are deliberately NOT exempt (an admin account is exactly what gets
// compromised). Nobody is ever banned by this module.
const { AuditLogEvent } = require('discord.js');
const { getProtection } = require('./config');
const { roleIsDangerous, hasTrustedRole, DANGEROUS_PERMS } = require('./permissions');
const incidents = require('./incidents');

const DIRECT = {
  [AuditLogEvent.ChannelDelete]: 'channel deleted',
  [AuditLogEvent.RoleDelete]: 'role deleted',
  [AuditLogEvent.MemberKick]: 'member kicked',
  [AuditLogEvent.MemberBanAdd]: 'member banned',
};

const DANGEROUS_BITS = DANGEROUS_PERMS.reduce((a, b) => a | BigInt(b), 0n);
function toBig(v) {
  try {
    if (typeof v === 'bigint') return v;
    if (v && typeof v.bitfield !== 'undefined') return BigInt(v.bitfield);
    return BigInt(String(v || 0));
  } catch (_) {
    return 0n;
  }
}

// Returns a short label for dangerous entries, null for everything else.
function classifyEntry(entry, guild) {
  if (!entry) return null;
  const direct = DIRECT[entry.action];
  if (direct) return direct;
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (entry.action === AuditLogEvent.MemberRoleUpdate) {
    const added = changes.find((c) => c.key === '$add');
    const roles = (added && (added.new || added.new_value)) || [];
    for (const r of roles) {
      const role = guild && guild.roles && guild.roles.cache ? guild.roles.cache.get(r.id) : null;
      if (roleIsDangerous(role)) return `dangerous role granted (${role.name})`;
    }
    return null;
  }
  if (entry.action === AuditLogEvent.RoleUpdate) {
    const perm = changes.find((c) => c.key === 'permissions');
    if (!perm) return null;
    const before = toBig(perm.old ?? perm.old_value);
    const after = toBig(perm.new ?? perm.new_value);
    const gained = after & ~before & DANGEROUS_BITS;
    if (gained !== 0n) return 'dangerous permissions added to a role';
    return null;
  }
  return null;
}

async function containExecutor(guild, member) {
  if (!member) return 'strip_roles failed: could not fetch the member (left the server?)';
  if (member.id === guild.ownerId) return 'skipped: the server owner is always exempt';
  const roles = [...member.roles.cache.values()].filter((r) => r.id !== guild.id);
  const dangerous = roles.filter(roleIsDangerous);
  const unrelated = roles.length - dangerous.length;
  if (!dangerous.length) return `no dangerous roles to remove (${unrelated} unrelated role(s) kept)`;
  const removable = dangerous.filter((r) => r.editable !== false && !r.managed);
  const blocked = dangerous.filter((r) => !(r.editable !== false && !r.managed));
  const parts = [];
  if (removable.length) {
    try {
      await member.roles.remove(removable.map((r) => r.id), 'Spam Trap anti-nuke containment');
      parts.push(`removed ${removable.map((r) => r.name).join(', ')}`);
    } catch (err) {
      parts.push(`strip_roles ${incidents.describeOutcomeError(err)}`);
    }
  }
  if (blocked.length) {
    parts.push(`could NOT remove ${blocked.map((r) => `${r.name} (${r.managed ? 'managed by an integration' : 'at or above the bot\'s role'})`).join(', ')}`);
  }
  parts.push(`${unrelated} unrelated role(s) kept`);
  return parts.join('; ');
}

// Returns a small result object (tests assert on it). Never throws.
async function handleAuditEntry(entry, guild, ctx) {
  try {
    if (!entry || !guild) return null;
    const cfg = getProtection(guild.id);
    if (!cfg.features.antinuke) return null;
    const { state, now, startedAt, botId } = ctx;
    state.sweep();
    if (!entry.id || !state.markAuditSeen(guild.id, entry.id)) return { ignored: 'duplicate' };
    const t = now();
    const created = typeof entry.createdTimestamp === 'number' ? entry.createdTimestamp : t;
    const staleMs = Math.max(cfg.limits.nukeWindowSeconds * 2 * 1000, 60 * 1000);
    if (created < startedAt || created < t - staleMs) return { ignored: 'stale' };
    const executorId = entry.executorId ? String(entry.executorId) : null;
    if (!executorId) return { ignored: 'no executor' };
    if (executorId === guild.ownerId || executorId === botId) return { ignored: 'exempt' };
    const label = classifyEntry(entry, guild);
    if (!label) return { ignored: 'not dangerous' };

    const g = state.guild(guild.id);
    state.pushEntry(g.audit, executorId, { ts: created, type: label });
    const win = state.window(g.audit, executorId, cfg.limits.nukeWindowSeconds * 1000);
    if (win.length < cfg.limits.nukeLimit) return { counted: win.length };

    const key = `nuke:${executorId}`;
    if (state.onCooldown(guild.id, key) || !state.tryLock(guild.id, key)) return { ignored: 'already handled' };
    try {
      let member = null;
      try { member = await guild.members.fetch(executorId); } catch (_) { member = null; }
      if (member && hasTrustedRole(member, cfg.trustedRoles)) {
        state.setCooldown(guild.id, key, cfg.limits.nukeWindowSeconds * 1000);
        g.audit.delete(executorId);
        return { ignored: 'trusted role' };
      }
      const counts = {};
      for (const e of win) counts[e.type] = (counts[e.type] || 0) + 1;
      const summary = Object.entries(counts).map(([k, v]) => `${v}× ${k}`).join(', ');
      const outcome = cfg.nukeAction === 'strip_roles'
        ? await containExecutor(guild, member)
        : 'alert only (no roles were changed). Deleted channels/roles cannot be restored by the bot.';
      const inc = incidents.makeIncident({
        feature: 'antinuke',
        subjectId: executorId,
        reason: `${win.length} administrative actions within ${cfg.limits.nukeWindowSeconds}s (limit ${cfg.limits.nukeLimit}): ${summary}`,
        action: cfg.nukeAction,
        outcome,
        now: t,
      });
      incidents.record(guild.id, inc);
      await incidents.sendAlert(guild, state, [inc]);
      state.setCooldown(guild.id, key, cfg.limits.nukeWindowSeconds * 1000);
      g.audit.delete(executorId);
      return { triggered: true, incident: inc };
    } finally {
      state.unlock(guild.id, key);
    }
  } catch (err) {
    console.error('[PROTECTION] anti-nuke handler error:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { handleAuditEntry, classifyEntry, containExecutor };
