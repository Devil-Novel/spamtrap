const { PermissionsBitField } = require('discord.js');

// One policy for Discord commands and dashboard reads/writes.
function canManageTrap(guild, member, config, permissions = member?.permissions) {
  if (!guild || !member) return false;
  if (guild.ownerId === member.id || guild.ownerId === member.user?.id) return true;
  const allowed = config.allowedRoles || [];
  if (allowed.length) return allowed.some((id) => member.roles?.cache?.has(id));
  const P = PermissionsBitField.Flags;
  return !!permissions?.has([P.BanMembers, P.ManageGuild]);
}
module.exports = { canManageTrap };
