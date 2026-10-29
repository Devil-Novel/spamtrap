const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const H = require('./helpers');
const cleanup = H.useTempDb('raid-antinuke');
after(cleanup);

const store = require('../lib/store');
const cfg = require('../lib/protection/config');
const { createProtection } = require('../lib/protection');

let now, prot;
beforeEach(() => {
  store.writeDb({ guilds: {}, global: { totalCatches: 0 } }); // each test starts from an empty database
  now = H.clock();
  prot = createProtection({ now, memberEvents: true, client: null });
});
function guildWithLog(id = 'g1', opts = {}) {
  const guild = H.mockGuild({ id, ...opts });
  store.getGuild(id);
  store.updateGuild(id, (g) => { g.logChannel = 'log'; });
  return guild;
}
function enable(guildId, features, extra = {}) {
  cfg.updateProtection(guildId, (p) => {
    for (const f of features) p.features[f] = true;
    Object.assign(p, extra.top || {});
    Object.assign(p.limits, extra.limits || {});
  });
}
let seq = 0;
function entry({ action, executorId, createdTimestamp, changes = [], id }) {
  return { id: id || 'e' + ++seq, action, executorId, createdTimestamp: createdTimestamp ?? now(), changes };
}

describe('raid protection', () => {
  test('a join burst starts raid mode with alert only; nobody is punished; it expires', async () => {
    const guild = guildWithLog();
    enable('g1', ['raid']);
    let res;
    for (let i = 0; i < 8; i++) {
      res = await prot.onMemberAdd(H.mockMember({ id: 'j' + i, guild, joinedTimestamp: now() }));
      now.advance(500);
    }
    assert.equal(res.started, true);
    assert.equal(prot.state.isRaidActive('g1'), true);
    assert.match(res.incident.outcome, /Nobody was banned or timed out/);
    assert.equal(guild.log.sends.length, 1);
    for (const m of guild.members._map.values()) assert.equal(m.timeouts.length, 0);
    // later joiners during the raid are added to the cohort, no new alert
    const late = await prot.onMemberAdd(H.mockMember({ id: 'late', guild }));
    assert.equal(late.started, false);
    assert.equal(prot.state.inCohort('g1', 'late'), true);
    assert.equal(guild.log.sends.length, 1);
    // expiry
    now.advance(5 * 60 * 1000 + 1);
    assert.equal(prot.state.isRaidActive('g1'), false);
    prot.state.sweep(true);
    assert.equal(prot.state.inCohort('g1', 'late'), false, 'cohort cleared after the raid ends');
  });

  test('joins spread over a longer period than the window do not trigger', async () => {
    const guild = guildWithLog('g2');
    enable('g2', ['raid']);
    for (let i = 0; i < 12; i++) {
      await prot.onMemberAdd(H.mockMember({ id: 'k' + i, guild }));
      now.advance(3000); // 12 joins over 36s, window is 15s -> never 8 inside one window
    }
    assert.equal(prot.state.isRaidActive('g2'), false);
  });

  test('raid filter deletes cohort messages during the raid (delete at most, never timeout) and stops after expiry', async () => {
    const guild = guildWithLog('g3');
    enable('g3', ['raid'], { top: { messageAction: 'timeout' }, limits: { raidFilter: 1 } });
    for (let i = 0; i < 8; i++) await prot.onMemberAdd(H.mockMember({ id: 'c' + i, guild, joinedTimestamp: now() }));
    const m = guild.members._map.get('c3');
    const msg = H.mockMessage({ guild, author: 'c3', member: m, content: 'hello' });
    const r = await prot.onMessage(msg);
    assert.equal(r.length, 1);
    assert.equal(r[0].feature, 'raid');
    assert.equal(msg.deleted, true);
    assert.equal(m.timeouts.length, 0, 'raid filter never times out');
    assert.match(r[0].action, /raid filter only deletes/);
    now.advance(6 * 60 * 1000);
    prot.state.sweep(true);
    const msg2 = H.mockMessage({ guild, author: 'c3', member: m, content: 'hello again' });
    assert.deepEqual(await prot.onMessage(msg2), []);
    assert.equal(msg2.deleted, false);
  });
});

describe('anti-nuke', () => {
  const P = PermissionsBitField.Flags;
  function nukeGuild(id, roles = []) {
    return guildWithLog(id, { roles });
  }

  test('duplicate audit entries and stale events are rejected; owner and bot are exempt', async () => {
    const guild = nukeGuild('n1');
    enable('n1', ['antinuke']);
    const e = entry({ action: AuditLogEvent.ChannelDelete, executorId: 'mod1' });
    assert.deepEqual(await prot.onAuditEntry(e, guild), { counted: 1 });
    assert.deepEqual(await prot.onAuditEntry(e, guild), { ignored: 'duplicate' });
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'mod1', createdTimestamp: now() - 10 * 60 * 1000 }), guild), { ignored: 'stale' });
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'mod1', createdTimestamp: prot.ctx.startedAt - 1 }), guild), { ignored: 'stale' });
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'owner' }), guild), { ignored: 'exempt' });
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelUpdate, executorId: 'mod1' }), guild), { ignored: 'not dangerous' });
  });

  test('a burst of destructive actions triggers an alert-only incident by default; Administrators are not exempt', async () => {
    const adminRole = H.mockRole({ id: 'r-admin', name: 'Admin', flags: [P.Administrator] });
    const guild = nukeGuild('n2', [adminRole]);
    enable('n2', ['antinuke']);
    const exec = H.mockMember({ id: 'exec', guild, roleIds: ['r-admin'], flags: [P.Administrator] });
    let res;
    const actions = [AuditLogEvent.ChannelDelete, AuditLogEvent.RoleDelete, AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd];
    for (const a of actions) res = await prot.onAuditEntry(entry({ action: a, executorId: 'exec' }), guild);
    assert.equal(res.triggered, true);
    assert.equal(res.incident.action, 'alert');
    assert.match(res.incident.outcome, /alert only/);
    assert.match(res.incident.reason, /channel deleted/);
    assert.equal(exec.roles.removed.length, 0, 'alert mode never touches roles');
    assert.equal(guild.log.sends.length, 1);
    // the same executor's next action right after is covered by the cooldown - no alert storm
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'exec' }), guild), { counted: 1 });
  });

  test('dangerous role grants and dangerous permission additions count; harmless role changes do not', async () => {
    const danger = H.mockRole({ id: 'r-danger', name: 'Danger', flags: [P.ManageRoles] });
    const harmless = H.mockRole({ id: 'r-ok', name: 'Member' });
    const guild = nukeGuild('n3', [danger, harmless]);
    enable('n3', ['antinuke'], { limits: { nukeLimit: 2 } });
    const grantHarmless = entry({ action: AuditLogEvent.MemberRoleUpdate, executorId: 'x', changes: [{ key: '$add', new: [{ id: 'r-ok' }] }] });
    assert.deepEqual(await prot.onAuditEntry(grantHarmless, guild), { ignored: 'not dangerous' });
    const grantDanger = entry({ action: AuditLogEvent.MemberRoleUpdate, executorId: 'x', changes: [{ key: '$add', new: [{ id: 'r-danger' }] }] });
    assert.deepEqual(await prot.onAuditEntry(grantDanger, guild), { counted: 1 });
    const permAdd = entry({ action: AuditLogEvent.RoleUpdate, executorId: 'x', changes: [{ key: 'permissions', old: '0', new: String(P.Administrator) }] });
    const res = await prot.onAuditEntry(permAdd, guild);
    assert.equal(res.triggered, true);
    assert.match(res.incident.reason, /dangerous permissions added/);
  });

  test('trusted roles are exempt from anti-nuke', async () => {
    const trusted = H.mockRole({ id: 'r-trusted', name: 'Trusted' });
    const guild = nukeGuild('n4', [trusted]);
    enable('n4', ['antinuke'], { top: { trustedRoles: ['r-trusted'] }, limits: { nukeLimit: 2 } });
    H.mockMember({ id: 'tm', guild, roleIds: ['r-trusted'] });
    await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'tm' }), guild);
    const res = await prot.onAuditEntry(entry({ action: AuditLogEvent.ChannelDelete, executorId: 'tm' }), guild);
    assert.deepEqual(res, { ignored: 'trusted role' });
    assert.equal(guild.log.sends.length, 0);
  });

  test('strip_roles removes only dangerous, editable, unmanaged roles and reports the rest', async () => {
    const roles = [
      H.mockRole({ id: 'r-edit', name: 'Mod', flags: [P.BanMembers] }),
      H.mockRole({ id: 'r-managed', name: 'BotRole', flags: [P.Administrator], managed: true }),
      H.mockRole({ id: 'r-above', name: 'Owner-ish', flags: [P.ManageGuild], editable: false }),
      H.mockRole({ id: 'r-color', name: 'Blue' }),
      H.mockRole({ id: 'r-vip', name: 'VIP' }),
    ];
    const guild = nukeGuild('n5', roles);
    enable('n5', ['antinuke'], { top: { nukeAction: 'strip_roles' }, limits: { nukeLimit: 2 } });
    const exec = H.mockMember({ id: 'exec', guild, roleIds: roles.map((r) => r.id) });
    await prot.onAuditEntry(entry({ action: AuditLogEvent.MemberKick, executorId: 'exec' }), guild);
    const res = await prot.onAuditEntry(entry({ action: AuditLogEvent.MemberKick, executorId: 'exec' }), guild);
    assert.equal(res.triggered, true);
    assert.deepEqual(exec.roles.removed, ['r-edit']);
    assert.ok(exec.roles.cache.has('r-color') && exec.roles.cache.has('r-vip'), 'unrelated roles preserved');
    assert.match(res.incident.outcome, /removed Mod/);
    assert.match(res.incident.outcome, /could NOT remove BotRole \(managed/);
    assert.match(res.incident.outcome, /Owner-ish \(at or above/);
    assert.match(res.incident.outcome, /2 unrelated role\(s\) kept/);
  });

  test('strip_roles never acts on the server owner and reports API failures', async () => {
    const roles = [H.mockRole({ id: 'r-edit', name: 'Mod', flags: [P.BanMembers] })];
    const guild = nukeGuild('n6', roles);
    enable('n6', ['antinuke'], { top: { nukeAction: 'strip_roles' }, limits: { nukeLimit: 2 } });
    const exec = H.mockMember({ id: 'exec', guild, roleIds: ['r-edit'] });
    exec.roles.remove = async () => { throw H.discordError(50013, 'Missing Permissions'); };
    await prot.onAuditEntry(entry({ action: AuditLogEvent.MemberKick, executorId: 'exec' }), guild);
    const res = await prot.onAuditEntry(entry({ action: AuditLogEvent.MemberKick, executorId: 'exec' }), guild);
    assert.match(res.incident.outcome, /strip_roles failed: missing permissions/);
    assert.deepEqual(await prot.onAuditEntry(entry({ action: AuditLogEvent.MemberKick, executorId: 'owner' }), guild), { ignored: 'exempt' });
  });
});
