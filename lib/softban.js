const crypto = require('crypto');
const store = require('./store');

// Persist the recovery intent BEFORE banning. The unique audit reason prevents
// a later, unrelated moderator ban from being undone by a queued recovery.
function createSoftbanRecovery(client, { now = Date.now } = {}) {
  const active = new Set();
  let timer;
  let sweeping = false;
  function prepare(guildId, userId) {
    const id = crypto.randomBytes(12).toString('hex');
    const job = { id, guildId, userId, reason: `Spam Trap: softban recovery ${id}`, attempts: 0, nextAttempt: now() + 60000 };
    store.updateGuild(guildId, g => { (g.pendingUnbans ||= []).push(job); });
    active.add(id);
    return job;
  }
  function release(job) { if (job) active.delete(job.id); }
  function remove(job) {
    store.updateGuild(job.guildId, g => { g.pendingUnbans = (g.pendingUnbans || []).filter(x => x.id !== job.id); });
  }
  async function attempt(job, background = false) {
    const guild = client.guilds.cache.get(job.guildId);
    if (!guild) { release(job); return false; }
    active.add(job.id);
    try {
      let ban;
      try { ban = await guild.bans.fetch(job.userId); }
      catch (err) { if (err.code === 10026) { remove(job); return true; } throw err; }
      if (ban.reason !== job.reason) {
        job.cancelled = true;
        remove(job);
        console.warn(`[SOFTBAN] Left unrelated ban unchanged for ${job.userId} in ${job.guildId}`);
        return false;
      }
      await guild.members.unban(job.userId, 'Spam Trap: finish recorded softban');
      remove(job);
      if (background) {
        store.updateGuild(job.guildId, g => {
          const action = (g.recentActions || []).find(a => a.userId === job.userId && a.action.includes('unban pending'));
          if (action) action.action = 'soft-banned (unban recovered; can rejoin)';
        });
        await notify(guild, job, 'Queued softban unban completed; the user can rejoin.');
      }
      return true;
    } catch (err) {
      store.updateGuild(job.guildId, g => {
        const saved = (g.pendingUnbans || []).find(x => x.id === job.id);
        if (saved) {
          saved.attempts += 1;
          saved.nextAttempt = now() + Math.min(3600000, 60000 * 2 ** Math.min(saved.attempts, 6));
        }
      });
      console.error(`[SOFTBAN] Unban pending for ${job.userId} in ${job.guildId}: ${err.message}`);
      if (background && (job.attempts === 0 || job.attempts === 5)) await notify(guild, job, 'Softban unban is still pending. Check bot permissions and manually review the ban list.');
      return false;
    } finally { release(job); }
  }
  async function notify(guild, job, text) {
    try {
      const config = store.getGuild(guild.id);
      if (!config.logChannel) return;
      const channel = await guild.channels.fetch(config.logChannel);
      if (channel?.send) await channel.send({ content: `Spam Trap: user ${job.userId}. ${text}`, allowedMentions: { parse: [] } });
    } catch (err) { console.error('[SOFTBAN] Recovery log failed:', err.message); }
  }
  async function sweep() {
    if (sweeping || !client.isReady()) return;
    sweeping = true;
    try {
      for (const [guildId, config] of Object.entries(store.readDb().guilds)) {
        for (const job of config.pendingUnbans || []) {
          if (!active.has(job.id) && job.nextAttempt <= now() && client.guilds.cache.has(guildId)) await attempt(job, true);
        }
      }
    } catch (err) { console.error('[SOFTBAN] Recovery sweep failed:', err.message); }
    finally { sweeping = false; }
  }
  function start() { if (!timer) { timer = setInterval(sweep, 30000); timer.unref(); sweep(); } }
  return { prepare, attempt, release, sweep, start, stop: () => { clearInterval(timer); timer = null; } };
}
module.exports = { createSoftbanRecovery };
