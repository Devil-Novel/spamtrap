// Message-based protections: scam links, mass mentions, repeated messages,
// new-member restrictions, webhook spam, and the optional raid-cohort filter.
//
// Runs for ordinary (non-trap) channels only - index.js routes trap-channel
// messages to the original catch handler first and never calls this for them,
// so the trap behaviour is unchanged whatever these settings are.
//
// Enforcement model: the configured message action is alert / delete /
// timeout. "alert" never touches the message or the member. Timeouts are
// guarded by a per-account lock + cooldown so a burst of 30 messages can't
// produce 30 overlapping timeouts, and an existing longer timeout is never
// shortened. Webhooks can only ever be deleted, never timed out, and the
// webhook itself is never removed.
const crypto = require('crypto');
const { getProtection, anyFeatureEnabled } = require('./config');
const scam = require('./scam');
const perms = require('./permissions');
const incidents = require('./incidents');

// Zero-width / invisible characters commonly used to make identical spam look
// different: ZWSP, ZWNJ, ZWJ, LRM/RLM, word joiner, BOM, soft hyphen, separators.
const INVISIBLE_CODES = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0x00ad, 0x2028, 0x2029, 0x180e];
const INVISIBLE_RE = new RegExp('[' + INVISIBLE_CODES.map((c) => String.fromCodePoint(c)).join('') + ']', 'g');
const MIN_REPEAT_LENGTH = 6; // "gg" x4 is normal chat, not spam

function normalizeText(s) {
  return String(s || '')
    .replace(INVISIBLE_RE, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?,;:]+$/g, '')
    .trim();
}
function hashText(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function countMentions(message) {
  const m = message.mentions || {};
  const users = m.users && typeof m.users.size === 'number' ? m.users.size : 0;
  const roles = m.roles && typeof m.roles.size === 'number' ? m.roles.size : 0;
  const everyone = m.everyone ? 1 : 0;
  return users + roles + everyone;
}

function isExemptSender(message, cfg) {
  const guild = message.guild;
  const userId = message.author.id;
  const member = message.member;
  return perms.isOwner(guild, userId) || perms.hasTrustedRole(member, cfg.trustedRoles) || perms.isStaff(member);
}

// Upsert a per-message entry so an edited message replaces its own earlier
// contribution instead of being counted twice.
function upsertEntry(state, map, key, msgId, make, patch) {
  const list = map.get(key);
  const existing = list && list.find((e) => e.msgId === msgId);
  if (existing) {
    patch(existing);
    return list;
  }
  return state.pushEntry(map, key, make());
}

// Main entry point. Returns the incident records created (empty when nothing
// fired), which is what the tests assert on. Never throws.
async function handleMessage(message, ctx, opts = {}) {
  try {
    return await evaluate(message, ctx, opts);
  } catch (err) {
    console.error('[PROTECTION] message handler error:', err && err.message ? err.message : err);
    return [];
  }
}

async function evaluate(message, ctx, opts) {
  const { state, now } = ctx;
  if (!message || !message.guild || !message.author) return [];
  const guild = message.guild;
  const guildId = guild.id;
  const isWebhook = !!message.webhookId;
  if (message.author.bot && !isWebhook) return []; // other bots are not policed; webhooks are
  const cfg = getProtection(guildId);
  if (!anyFeatureEnabled(cfg)) return [];
  state.sweep();
  const t = now();
  const content = message.content || '';
  const f = cfg.features;
  const L = cfg.limits;
  const winMs = L.messageWindowSeconds * 1000;
  const edited = !!opts.edited;
  const findings = [];
  const g = state.guild(guildId);

  if (isWebhook) {
    const wid = String(message.webhookId);
    const trusted = cfg.trustedWebhooks.includes(wid);
    if (!trusted) {
      if (f.webhooks && !edited) {
        state.pushEntry(g.webhooks, wid, { ts: t });
        const win = state.window(g.webhooks, wid, winMs);
        if (win.length >= L.webhookLimit) {
          findings.push({ feature: 'webhooks', reason: `${win.length} messages from the same webhook within ${L.messageWindowSeconds}s (limit ${L.webhookLimit})` });
        }
      }
      if (f.scam) {
        for (const c of scam.classifyText(content, cfg)) findings.push({ feature: 'scam', reason: `${c.reason}: ${c.host}` });
      }
    }
    return enforce(message, cfg, findings, ctx, { isWebhook: true, subjectId: wid });
  }

  const userId = message.author.id;
  const member = message.member || null;
  if (isExemptSender(message, cfg)) return [];

  if (f.scam) {
    for (const c of scam.classifyText(content, cfg)) findings.push({ feature: 'scam', reason: `${c.reason}: ${c.host}` });
  }

  if (f.mentions) {
    const count = countMentions(message);
    if (count > 0 || edited) {
      upsertEntry(state, g.mentions, userId, message.id, () => ({ ts: t, msgId: message.id, count }), (e) => { e.count = count; });
      const win = state.window(g.mentions, userId, winMs);
      const total = win.reduce((a, e) => a + e.count, 0);
      if (count > 0 && total >= L.mentionLimit) {
        findings.push({ feature: 'mentions', reason: `${total} mentions within ${L.messageWindowSeconds}s across channels (limit ${L.mentionLimit})` });
      }
    }
  }

  if (f.repeats) {
    const norm = normalizeText(content);
    if (norm.length >= MIN_REPEAT_LENGTH) {
      const h = hashText(norm);
      upsertEntry(state, g.repeats, userId, message.id, () => ({ ts: t, msgId: message.id, hash: h }), (e) => { e.hash = h; });
      const win = state.window(g.repeats, userId, winMs);
      const same = win.filter((e) => e.hash === h).length;
      if (same >= L.repeatLimit) {
        findings.push({ feature: 'repeats', reason: `the same message posted ${same} times within ${L.messageWindowSeconds}s, counted across every channel (limit ${L.repeatLimit})` });
      }
    }
  }

  if (f.newcomers && member && member.joinedTimestamp) {
    const ageMs = t - member.joinedTimestamp;
    if (ageMs >= 0 && ageMs < L.newcomerMinutes * 60 * 1000) {
      const hasAttachment = !!(message.attachments && message.attachments.size > 0);
      const link = scam.hasLink(content);
      if (link || hasAttachment) {
        const mins = Math.max(1, Math.round(ageMs / 60000));
        findings.push({ feature: 'newcomers', reason: `${link ? 'link' : 'attachment'} posted ${mins} min after joining (new members can't post links/attachments for ${L.newcomerMinutes} min)` });
      }
    }
  }

  if (f.raid && L.raidFilter && !edited && state.isRaidActive(guildId) && state.inCohort(guildId, userId)) {
    findings.push({ feature: 'raid', reason: 'message from an account that joined during an active raid (raid filter is on)', deleteOnly: true });
  }

  return enforce(message, cfg, findings, ctx, { isWebhook: false, subjectId: userId });
}

async function enforce(message, cfg, findings, ctx, { isWebhook, subjectId }) {
  if (!findings.length) return [];
  const { state, now } = ctx;
  const guild = message.guild;
  const guildId = guild.id;
  const g = state.guild(guildId);

  let action = cfg.messageAction;
  let note = '';
  if (action === 'timeout' && isWebhook) {
    action = 'delete';
    note = ' (a webhook can\'t be timed out, so the message is deleted instead)';
  } else if (action === 'timeout' && findings.every((x) => x.deleteOnly)) {
    action = 'delete';
    note = ' (the raid filter only deletes; nobody is timed out for joining)';
  }

  let outcome = 'alert only (nothing was deleted or timed out)';
  if (action === 'delete' || action === 'timeout') {
    try {
      if (message.deletable === false) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      await message.delete();
      outcome = 'message deleted';
    } catch (err) {
      outcome = `delete ${incidents.describeOutcomeError(err)}`;
    }
    if (action === 'timeout') outcome += '; ' + (await applyTimeout(message, cfg, findings, ctx));
  }

  // The counter that fired is reset so the same burst doesn't re-fire on every
  // following message; a fresh burst is needed to trigger again.
  for (const x of findings) {
    if (x.feature === 'mentions') g.mentions.delete(subjectId);
    if (x.feature === 'repeats') g.repeats.delete(subjectId);
    if (x.feature === 'webhooks') g.webhooks.delete(subjectId);
  }

  const t = now();
  const recs = findings.map((x) =>
    incidents.makeIncident({
      feature: x.feature,
      subjectId,
      subjectType: isWebhook ? 'webhook' : 'user',
      reason: x.reason,
      action: action + note,
      outcome,
      channelId: message.channel && message.channel.id,
      now: t,
    })
  );
  for (const r of recs) incidents.record(guildId, r);
  await incidents.sendAlert(guild, state, recs);
  return recs;
}

async function applyTimeout(message, cfg, findings, ctx) {
  const { state, now } = ctx;
  const guild = message.guild;
  const member = message.member;
  if (!member) return 'timeout skipped: member not available on this message';
  const key = `timeout:${member.id}`;
  if (state.onCooldown(guild.id, key)) return 'timeout already applied moments ago';
  if (!state.tryLock(guild.id, key)) return 'timeout already in progress';
  try {
    const ms = cfg.limits.timeoutMinutes * 60 * 1000;
    const until = now() + ms;
    const existing = member.communicationDisabledUntilTimestamp || 0;
    if (existing > until) {
      state.setCooldown(guild.id, key, Math.min(existing - now(), 5 * 60 * 1000));
      return `existing longer timeout kept (ends <t:${Math.floor(existing / 1000)}:R>)`;
    }
    if (member.moderatable === false) {
      return 'timeout failed: role hierarchy (the bot\'s role must be above the member\'s highest role) or missing Moderate Members';
    }
    await member.timeout(ms, `Spam Trap protection: ${findings.map((x) => x.feature).join(', ')}`);
    state.setCooldown(guild.id, key, Math.min(ms, 5 * 60 * 1000));
    return `timed out for ${cfg.limits.timeoutMinutes} min`;
  } catch (err) {
    return `timeout ${incidents.describeOutcomeError(err)}`;
  } finally {
    state.unlock(guild.id, key);
  }
}

module.exports = { handleMessage, normalizeText, hashText, countMentions, MIN_REPEAT_LENGTH };
