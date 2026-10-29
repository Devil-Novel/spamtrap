// Incident records + moderator alerts for the protection features.
//
// Records: the latest 20 per server plus a running count, stored in db.json
// next to the server's other settings. They hold ids, a reason label and the
// action outcome - never message content.
//
// Alerts: posted to the server's existing moderator log channel (the same one
// /spamtrap log sets), with every mention disabled so a log line can never
// ping anyone, and rate-limited per server so an attack can't flood the
// channel. Suppressed alerts are counted and mentioned when the window clears.
const { EmbedBuilder } = require('discord.js');
const store = require('../store');
const { updateProtection, INCIDENTS_MAX } = require('./config');

const ALERTS_PER_MINUTE = 6;

const FEATURE_LABELS = {
  scam: 'Scam links',
  raid: 'Raid protection',
  mentions: 'Mass mentions',
  repeats: 'Repeated messages',
  newcomers: 'New member restrictions',
  webhooks: 'Webhook spam',
  antinuke: 'Anti-nuke',
};

let seq = 0;
function makeIncident({ feature, subjectId, subjectType = 'user', reason, action, outcome, channelId = null, now = Date.now() }) {
  seq = (seq + 1) % 1000;
  return {
    id: `${now.toString(36)}${seq.toString(36).padStart(2, '0')}`,
    ts: now,
    feature,
    subjectType, // user | webhook | server
    subjectId: subjectId ? String(subjectId) : null,
    channelId: channelId ? String(channelId) : null,
    reason: String(reason || '').slice(0, 200),
    action: String(action || 'alert'),
    outcome: String(outcome || '').slice(0, 300),
  };
}

function record(guildId, incident) {
  return updateProtection(guildId, (p) => {
    p.incidents.unshift(incident);
    if (p.incidents.length > INCIDENTS_MAX) p.incidents.length = INCIDENTS_MAX;
    p.incidentCount = (p.incidentCount || 0) + 1;
  });
}

// true if the alert may be sent now; false if it must be suppressed.
function allowAlert(state, guildId) {
  const g = state.guild(guildId);
  const now = state.now();
  g.alerts.times = g.alerts.times.filter((t) => t > now - 60 * 1000);
  if (g.alerts.times.length >= ALERTS_PER_MINUTE) {
    g.alerts.suppressed += 1;
    return false;
  }
  g.alerts.times.push(now);
  return true;
}
function takeSuppressed(state, guildId) {
  const g = state.guild(guildId);
  const n = g.alerts.suppressed;
  g.alerts.suppressed = 0;
  return n;
}

function describeOutcomeError(err) {
  const code = err && err.code;
  if (code === 50013) return 'failed: missing permissions (check the bot role\'s permissions and this channel\'s overrides)';
  if (code === 50001) return 'failed: missing access to that channel';
  if (code === 10008) return 'skipped: message was already gone';
  if (code === 10007 || code === 10013) return 'skipped: member/user no longer exists';
  if (/hierarchy|above|higher/i.test(String(err && err.message))) return 'failed: role hierarchy (the bot\'s role must be above the member\'s highest role)';
  return `failed: ${String((err && err.message) || err).slice(0, 120)}`;
}

function buildAlertEmbed(incidents, { suppressed = 0 } = {}) {
  const first = incidents[0];
  const embed = new EmbedBuilder()
    .setColor(first.feature === 'antinuke' ? 0xe83535 : 0xf5a623)
    .setTitle(`Protection: ${FEATURE_LABELS[first.feature] || first.feature}`)
    .setTimestamp(new Date(first.ts));
  const who =
    first.subjectType === 'webhook' ? `Webhook \`${first.subjectId}\``
      : first.subjectType === 'server' ? 'Server-wide'
        : `<@${first.subjectId}> (\`${first.subjectId}\`)`; // allowedMentions blocks the ping; the mention still renders as a name
  embed.addFields({ name: first.subjectType === 'webhook' ? 'Webhook' : first.subjectType === 'server' ? 'Scope' : 'Account', value: who, inline: true });
  if (first.channelId) embed.addFields({ name: 'Channel', value: `<#${first.channelId}>`, inline: true });
  embed.addFields(
    { name: incidents.length > 1 ? 'Reasons' : 'Reason', value: incidents.map((i) => `• ${i.reason}`).join('\n').slice(0, 1024) },
    { name: 'Action', value: first.action, inline: true },
    { name: 'Outcome', value: first.outcome || '—', inline: true }
  );
  if (suppressed > 0) embed.setFooter({ text: `${suppressed} earlier alert(s) were suppressed by the rate limit.` });
  return embed;
}

function embedToPlainText(embed) {
  const d = embed.data || {};
  const lines = [];
  if (d.title) lines.push(`**${d.title}**`);
  for (const f of d.fields || []) lines.push(`**${f.name}:** ${f.value}`);
  if (d.footer && d.footer.text) lines.push(d.footer.text);
  return lines.join('\n');
}

// Post to the server's configured log channel. Never throws.
async function sendAlert(guild, state, incidents) {
  try {
    const cfg = store.getGuild(guild.id);
    if (!cfg.logChannel) return { sent: false, why: 'no log channel configured' };
    if (!allowAlert(state, guild.id)) return { sent: false, why: 'rate limited' };
    const suppressed = takeSuppressed(state, guild.id);
    const channel = await guild.channels.fetch(cfg.logChannel).catch(() => null);
    if (!channel) return { sent: false, why: 'log channel not found' };
    const embed = buildAlertEmbed(incidents, { suppressed });
    const noPings = { parse: [] };
    try {
      await channel.send({ embeds: [embed], allowedMentions: noPings });
    } catch (err) {
      if (err && (err.code === 50013 || err.code === 50001)) {
        await channel.send({ content: embedToPlainText(embed), allowedMentions: noPings }).catch(() => {});
      }
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, why: String((err && err.message) || err) };
  }
}

module.exports = { FEATURE_LABELS, ALERTS_PER_MINUTE, makeIncident, record, allowAlert, takeSuppressed, describeOutcomeError, buildAlertEmbed, sendAlert };
