const { ChannelType, PermissionsBitField } = require('discord.js');
const MESSAGE_LIMIT = 1500; // Leaves room for expanded variables and recovery text.
function validateMessages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Expected a JSON object';
  for (const key of ['warning', 'dm', 'log']) {
    const value = body[key];
    if (value != null && (typeof value !== 'string' || value.length > MESSAGE_LIMIT)) {
      return `${key} must be text of at most ${MESSAGE_LIMIT} characters, or null`;
    }
  }
  return null;
}
function usableChannel(guild, id) {
  const channel = typeof id === 'string' && guild.channels.cache.get(id);
  if (!channel || channel.type !== ChannelType.GuildText) return false;
  const P = PermissionsBitField.Flags;
  return !!channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory]);
}
module.exports = { validateMessages, usableChannel, MESSAGE_LIMIT };
