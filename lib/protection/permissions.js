// Permission / exemption helpers shared by the detectors and /protection status.
const { PermissionsBitField } = require('discord.js');

const P = PermissionsBitField.Flags;

// Permissions that make a role "dangerous" for anti-nuke purposes: holding
// any of these lets an account do the kind of damage anti-nuke watches for.
const DANGEROUS_PERMS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];

function hasAnyPerm(permissions, flags) {
  if (!permissions || typeof permissions.has !== 'function') return false;
  return flags.some((f) => permissions.has(f));
}

function roleIsDangerous(role) {
  return !!role && hasAnyPerm(role.permissions, DANGEROUS_PERMS);
}

// Staff are exempt from the *message* protections (not from anti-nuke).
function isStaff(member) {
  if (!member || !member.permissions) return false;
  return hasAnyPerm(member.permissions, [P.Administrator, P.ManageGuild, P.ManageMessages, P.ModerateMembers]);
}

function hasTrustedRole(member, trustedRoles) {
  if (!member || !member.roles || !member.roles.cache || !trustedRoles || !trustedRoles.length) return false;
  return trustedRoles.some((id) => member.roles.cache.has(id));
}

function isOwner(guild, userId) {
  return !!guild && guild.ownerId === userId;
}

// What the bot would need for each enabled feature/action, and what it lacks.
// Channel-level overrides can still block an action even when these pass.
function missingPermissions(guild, cfg) {
  const me = guild && guild.members && guild.members.me;
  const have = me && me.permissions;
  const needs = [];
  const f = cfg.features;
  const anyMsg = f.scam || f.mentions || f.repeats || f.newcomers || f.webhooks || (f.raid && cfg.limits.raidFilter);
  if (anyMsg && cfg.messageAction !== 'alert') needs.push({ perm: 'Manage Messages', flag: P.ManageMessages, why: 'delete flagged messages' });
  if (anyMsg && cfg.messageAction === 'timeout') needs.push({ perm: 'Moderate Members', flag: P.ModerateMembers, why: 'time out senders' });
  if (f.antinuke) needs.push({ perm: 'View Audit Log', flag: P.ViewAuditLog, why: 'receive audit-log events for anti-nuke' });
  if (f.antinuke && cfg.nukeAction === 'strip_roles') needs.push({ perm: 'Manage Roles', flag: P.ManageRoles, why: 'remove dangerous roles during containment' });
  return needs.filter((n) => !(have && have.has(n.flag)));
}

module.exports = { DANGEROUS_PERMS, roleIsDangerous, isStaff, hasTrustedRole, isOwner, missingPermissions, hasAnyPerm };
