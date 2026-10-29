// Server protection - factory that wires the detectors to a client.
//
//   const protection = createProtection({ client, memberEvents });
//   client.on('messageCreate', (m) => protection.onMessage(m));           // after the trap check
//   client.on('messageUpdate', (o, n) => protection.onMessageUpdate(o, n));
//   client.on('guildMemberAdd', (m) => protection.onMemberAdd(m));        // only with ENABLE_MEMBER_EVENTS
//   client.on('guildAuditLogEntryCreate', (e, g) => protection.onAuditEntry(e, g));
//   client.on('guildDelete', (g) => protection.onGuildDelete(g));
//
// Every handler catches its own errors and returns normally, so a bug or an
// API failure in a protection never reaches the trap-channel handler.
const { ProtectionState } = require('./state');
const messages = require('./messages');
const raid = require('./raid');
const antinuke = require('./antinuke');
const commands = require('./commands');
const config = require('./config');

function createProtection({ client = null, now = () => Date.now(), memberEvents = false, sweepIntervalMs = 60 * 1000 } = {}) {
  const state = new ProtectionState({ now });
  const ctx = {
    state,
    now,
    startedAt: now(),
    memberEvents: !!memberEvents,
    client,
    get botId() {
      return client && client.user ? client.user.id : null;
    },
  };

  let timer = null;
  if (client && sweepIntervalMs > 0) {
    timer = setInterval(() => state.sweep(true), sweepIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function onMessageUpdate(oldMessage, newMessage) {
    let m = newMessage;
    if (!m) return [];
    if (m.partial && typeof m.fetch === 'function') {
      try { m = await m.fetch(); } catch (_) { return []; }
    }
    if (!m || !m.guild || !m.author) return [];
    return messages.handleMessage(m, ctx, { edited: true });
  }

  return {
    state,
    ctx,
    config,
    onMessage: (m) => messages.handleMessage(m, ctx),
    onMessageUpdate,
    onMemberAdd: (member) => raid.handleJoin(member, ctx),
    onAuditEntry: (entry, guild) => antinuke.handleAuditEntry(entry, guild, ctx),
    onGuildDelete: (guild) => { if (guild && guild.id) state.clearGuild(guild.id); },
    command: (interaction) => commands.handle(interaction, ctx),
    stop: () => { if (timer) clearInterval(timer); },
  };
}

module.exports = { createProtection };
