// Raid detection: an unusually large burst of joins. Needs guildMemberAdd
// events, which only arrive when the Server Members Intent is enabled AND the
// operator has set ENABLE_MEMBER_EVENTS=true (see index.js). With the flag
// off this module is never called and the feature simply stays inactive.
//
// What a raid does: it starts a timed "raid mode" and remembers who arrived
// in the burst (the cohort). Nobody is banned, kicked or timed out for
// joining, and the server is never locked down. If the operator has turned
// on the raid filter (limit raidFilter = 1), messages from cohort members are
// subject to the configured message action while raid mode lasts - delete at
// most, never timeout (see messages.js).
const { getProtection } = require('./config');
const incidents = require('./incidents');

async function handleJoin(member, ctx) {
  try {
    const guild = member && member.guild;
    if (!guild || !member.id) return null;
    const cfg = getProtection(guild.id);
    if (!cfg.features.raid) return null;
    const { state, now } = ctx;
    state.sweep();
    const t = now();
    const g = state.guild(guild.id);
    const L = cfg.limits;

    g.joins.push({ ts: t, userId: member.id });
    const cutoff = t - L.joinWindowSeconds * 1000;
    while (g.joins.length && g.joins[0].ts < cutoff) g.joins.shift();
    if (g.joins.length > 500) g.joins.splice(0, g.joins.length - 500);

    if (state.isRaidActive(guild.id)) {
      state.addToCohort(guild.id, member.id);
      return { active: true, started: false };
    }
    if (g.joins.length < L.joinLimit) return { active: false, started: false, joinsInWindow: g.joins.length };

    g.raidUntil = t + L.raidMinutes * 60 * 1000;
    for (const j of g.joins) state.addToCohort(guild.id, j.userId);
    const inc = incidents.makeIncident({
      feature: 'raid',
      subjectType: 'server',
      subjectId: null,
      reason: `${g.joins.length} joins within ${L.joinWindowSeconds}s (limit ${L.joinLimit}); raid mode active for ${L.raidMinutes} min`,
      action: L.raidFilter ? `alert + filter cohort messages (${cfg.messageAction === 'alert' ? 'alert' : 'delete'})` : 'alert',
      outcome: 'raid mode started. Nobody was banned or timed out for joining; the server was not locked down.',
      now: t,
    });
    incidents.record(guild.id, inc);
    await incidents.sendAlert(guild, state, [inc]);
    return { active: true, started: true, incident: inc };
  } catch (err) {
    console.error('[PROTECTION] raid handler error:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { handleJoin };
