// Shared mocks for the protection tests. No Discord client, no token, no
// network: every "Discord object" here is a plain object shaped like the
// discord.js one the code reads, plus real PermissionsBitField instances so
// permission checks behave exactly as in production.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { PermissionsBitField } = require('discord.js');

const P = PermissionsBitField.Flags;

// Must be called BEFORE requiring lib/store (it reads DATABASE_PATH on load).
function useTempDb(tag) {
  const file = path.join(os.tmpdir(), `spamtrap-test-${tag}-${process.pid}-${Date.now()}.json`);
  process.env.DATABASE_PATH = file;
  return () => { try { fs.unlinkSync(file); } catch (_) {} };
}

// Injectable clock
function clock(start = 1_700_000_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; return t; };
  now.set = (v) => { t = v; return t; };
  return now;
}

function perms(...flags) {
  return new PermissionsBitField(flags.reduce((a, f) => a | f, 0n));
}

function mockRole({ id, name = id, flags = [], editable = true, managed = false }) {
  return { id, name, permissions: perms(...flags), editable, managed };
}

function mockLogChannel() {
  const ch = { id: 'log', sends: [], failFirst: null };
  ch.send = async (payload) => {
    if (ch.failFirst) { const e = ch.failFirst; ch.failFirst = null; throw e; }
    ch.sends.push(payload);
    return { id: 'm' + ch.sends.length };
  };
  return ch;
}

function mockGuild({ id = 'g1', ownerId = 'owner', botId = 'bot', botFlags = [P.ManageMessages, P.ModerateMembers, P.ViewAuditLog, P.ManageRoles], roles = [] } = {}) {
  const rolesMap = new Map([[id, mockRole({ id, name: '@everyone' })]]);
  for (const r of roles) rolesMap.set(r.id, r);
  const members = new Map();
  const log = mockLogChannel();
  const guild = {
    id,
    name: 'Test ' + id,
    ownerId,
    roles: { cache: rolesMap },
    members: {
      me: { id: botId, permissions: perms(...botFlags) },
      fetch: async (uid) => {
        const m = members.get(uid);
        if (!m) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return m;
      },
      _map: members,
    },
    channels: { fetch: async (cid) => (cid === 'log' ? log : null) },
    log,
  };
  return guild;
}

function mockMember({ id, guild, roleIds = [], flags = [], joinedTimestamp = null, communicationDisabledUntilTimestamp = null, moderatable = true, timeoutError = null }) {
  const cache = new Map();
  for (const rid of roleIds) {
    const r = guild.roles.cache.get(rid);
    if (r) cache.set(rid, r);
  }
  const member = {
    id,
    guild,
    user: { id, bot: false },
    roles: {
      cache,
      removed: [],
      remove: async (ids) => { member.roles.removed.push(...[].concat(ids)); for (const i of [].concat(ids)) cache.delete(i); },
    },
    permissions: perms(...flags),
    joinedTimestamp,
    communicationDisabledUntilTimestamp,
    moderatable,
    timeouts: [],
    timeout: async (ms, reason) => {
      if (timeoutError) throw timeoutError;
      member.timeouts.push({ ms, reason });
      member.communicationDisabledUntilTimestamp = Date.now() + ms;
    },
  };
  guild.members._map.set(id, member);
  return member;
}

let msgSeq = 0;
function mockMessage({ guild, author, member = null, content = '', channelId = 'c1', users = 0, roles = 0, everyone = false, attachments = 0, webhookId = null, id = null, deletable = true, deleteError = null, bot = false }) {
  const m = {
    id: id || `msg${++msgSeq}`,
    guild,
    author: { id: author, bot: bot || !!webhookId },
    member,
    content,
    channel: { id: channelId },
    mentions: { users: { size: users }, roles: { size: roles }, everyone },
    attachments: { size: attachments },
    webhookId,
    deletable,
    deleted: false,
    delete: async () => {
      if (deleteError) throw deleteError;
      m.deleted = true;
    },
  };
  return m;
}

function mockInteraction({ guild, userId, flags = [], sub, strings = {}, booleans = {}, integers = {}, role = null }) {
  const replies = [];
  return {
    guild,
    user: { id: userId },
    memberPermissions: perms(...flags),
    options: {
      getSubcommand: () => sub,
      getString: (k) => (k in strings ? strings[k] : null),
      getBoolean: (k) => (k in booleans ? booleans[k] : null),
      getInteger: (k) => (k in integers ? integers[k] : null),
      getRole: () => role,
    },
    replies,
    reply: async (payload) => { replies.push(payload); },
  };
}

function discordError(code, message = 'Discord API error') {
  return Object.assign(new Error(message), { code });
}

module.exports = { P, useTempDb, clock, perms, mockRole, mockGuild, mockMember, mockMessage, mockInteraction, mockLogChannel, discordError };
