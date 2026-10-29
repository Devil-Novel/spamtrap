const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const cleanup = H.useTempDb('commands');
after(cleanup);

const store = require('../lib/store');
const cfg = require('../lib/protection/config');
const incidents = require('../lib/protection/incidents');
const { createProtection } = require('../lib/protection');
const { commands } = require('../commands');

let prot, now;
beforeEach(() => { now = H.clock(); prot = createProtection({ now, memberEvents: false }); });
const last = (i) => i.replies.at(-1);

describe('/protection authorization', () => {
  test('only the server owner or an Administrator may configure; replies are ephemeral and never ping', async () => {
    const guild = H.mockGuild({ id: 'a1' });
    const mod = H.mockInteraction({ guild, userId: 'mod', flags: [H.P.BanMembers, H.P.ManageGuild], sub: 'feature', strings: { name: 'scam' }, booleans: { enabled: true } });
    await prot.command(mod);
    assert.match(last(mod).content, /Only the server owner or an Administrator/);
    assert.equal(cfg.getProtection('a1').features.scam, false, 'nothing changed');
    const admin = H.mockInteraction({ guild, userId: 'adm', flags: [H.P.Administrator], sub: 'feature', strings: { name: 'scam' }, booleans: { enabled: true } });
    await prot.command(admin);
    assert.equal(cfg.getProtection('a1').features.scam, true);
    const owner = H.mockInteraction({ guild, userId: 'owner', sub: 'feature', strings: { name: 'scam' }, booleans: { enabled: false } });
    await prot.command(owner);
    assert.equal(cfg.getProtection('a1').features.scam, false);
    for (const i of [mod, admin, owner]) {
      assert.equal(last(i).flags, 64, 'ephemeral');
      assert.deepEqual(last(i).allowedMentions, { parse: [] });
    }
  });
});

describe('/protection validation and lists', () => {
  const ADMIN = [H.P.Administrator];
  function run(guild, sub, opts) {
    const i = H.mockInteraction({ guild, userId: 'adm', flags: ADMIN, sub, ...opts });
    return prot.command(i).then(() => i);
  }

  test('limits are range-checked; incompatible actions are rejected', async () => {
    const guild = H.mockGuild({ id: 'v1' });
    let i = await run(guild, 'limit', { strings: { name: 'mentionLimit' }, integers: { value: 500 } });
    assert.match(last(i).content, /between 2 and 50/);
    assert.equal(cfg.getProtection('v1').limits.mentionLimit, 8);
    i = await run(guild, 'limit', { strings: { name: 'mentionLimit' }, integers: { value: 12 } });
    assert.equal(cfg.getProtection('v1').limits.mentionLimit, 12);
    i = await run(guild, 'action', { strings: { target: 'messages', type: 'strip_roles' } });
    assert.match(last(i).content, /not a message action/);
    i = await run(guild, 'action', { strings: { target: 'antinuke', type: 'timeout' } });
    assert.match(last(i).content, /not an anti-nuke action/);
    assert.equal(cfg.getProtection('v1').messageAction, 'alert');
    assert.equal(cfg.getProtection('v1').nukeAction, 'alert');
    i = await run(guild, 'action', { strings: { target: 'antinuke', type: 'strip_roles' } });
    assert.equal(cfg.getProtection('v1').nukeAction, 'strip_roles');
  });

  test('@everyone cannot be trusted; lists are capped at 50; webhook ids and domains are validated', async () => {
    const guild = H.mockGuild({ id: 'v2' });
    let i = await run(guild, 'trust', { role: { id: 'v2', name: '@everyone' }, booleans: { trusted: true } });
    assert.match(last(i).content, /@everyone role cannot be trusted/);
    assert.deepEqual(cfg.getProtection('v2').trustedRoles, []);
    i = await run(guild, 'trust', { role: { id: 'r1', name: 'Mods' }, booleans: { trusted: true } });
    assert.deepEqual(cfg.getProtection('v2').trustedRoles, ['r1']);
    cfg.updateProtection('v2', (p) => { p.trustedRoles = Array.from({ length: 50 }, (_, k) => 'role' + k); });
    i = await run(guild, 'trust', { role: { id: 'r-extra', name: 'Extra' }, booleans: { trusted: true } });
    assert.match(last(i).content, /list is full/);
    assert.equal(cfg.getProtection('v2').trustedRoles.length, 50);
    i = await run(guild, 'webhook', { strings: { id: 'https://discord.com/api/webhooks/1/token' }, booleans: { trusted: true } });
    assert.match(last(i).content, /not a webhook ID/);
    i = await run(guild, 'webhook', { strings: { id: '123456789012345678' }, booleans: { trusted: true } });
    assert.deepEqual(cfg.getProtection('v2').trustedWebhooks, ['123456789012345678']);
    i = await run(guild, 'domain', { strings: { list: 'blockedDomains', operation: 'add', host: 'not a domain' } });
    assert.match(last(i).content, /does not look like a domain/);
    i = await run(guild, 'domain', { strings: { list: 'blockedDomains', operation: 'add', host: 'https://Bad.Example/x' } });
    assert.deepEqual(cfg.getProtection('v2').blockedDomains, ['bad.example']);
    i = await run(guild, 'domain', { strings: { list: 'allowedDomains', operation: 'add', host: 'bad.example' } });
    assert.match(last(i).content, /Explicit blocks always take precedence/);
    i = await run(guild, 'domain', { strings: { list: 'blockedDomains', operation: 'remove', host: 'bad.example' } });
    assert.deepEqual(cfg.getProtection('v2').blockedDomains, []);
  });

  test('enabling raid without member events warns that it is inactive; status shows the flag and missing permissions', async () => {
    const guild = H.mockGuild({ id: 'v3', botFlags: [] }); // bot has no permissions at all
    let i = await run(guild, 'feature', { strings: { name: 'raid' }, booleans: { enabled: true } });
    assert.match(last(i).content, /ENABLE_MEMBER_EVENTS=true/);
    await run(guild, 'feature', { strings: { name: 'antinuke' }, booleans: { enabled: true } });
    await run(guild, 'action', { strings: { target: 'messages', type: 'timeout' } });
    await run(guild, 'feature', { strings: { name: 'mentions' }, booleans: { enabled: true } });
    i = await run(guild, 'status', {});
    const embed = last(i).embeds[0].data;
    const text = JSON.stringify(embed);
    assert.match(text, /ENABLE_MEMBER_EVENTS=false/);
    assert.match(text, /inactive/);
    assert.match(text, /Manage Messages/);
    assert.match(text, /Moderate Members/);
    assert.match(text, /View Audit Log/);
    assert.match(text, /Channel overrides and role hierarchy/);
    assert.match(text, /spamtrap disable.*trap channels only/);
  });
});

describe('incident retention and persistence', () => {
  test('keeps only the latest 20, counts all, newest first, survives re-read, stores no content', () => {
    for (let k = 1; k <= 25; k++) {
      incidents.record('ret1', incidents.makeIncident({ feature: 'repeats', subjectId: 'u' + k, reason: 'r' + k, action: 'alert', outcome: 'ok', now: 1000 + k }));
    }
    const p = cfg.getProtection('ret1');
    assert.equal(p.incidents.length, 20);
    assert.equal(p.incidentCount, 25);
    assert.equal(p.incidents[0].reason, 'r25');
    assert.equal(p.incidents[19].reason, 'r6');
    // re-read straight from disk
    const raw = JSON.parse(require('fs').readFileSync(process.env.DATABASE_PATH, 'utf8'));
    assert.equal(raw.guilds.ret1.protection.incidents.length, 20);
    assert.equal(raw.guilds.ret1.protection.incidentCount, 25);
    for (const inc of p.incidents) {
      assert.deepEqual(Object.keys(inc).sort(), ['action', 'channelId', 'feature', 'id', 'outcome', 'reason', 'subjectId', 'subjectType', 'ts']);
    }
  });

  test('/protection recent lists incidents; removing the bot clears everything for that server', async () => {
    const guild = H.mockGuild({ id: 'ret2' });
    incidents.record('ret2', incidents.makeIncident({ feature: 'scam', subjectId: 'u1', reason: 'suspected', action: 'alert', outcome: 'alert only', now: now() }));
    const i = H.mockInteraction({ guild, userId: 'owner', sub: 'recent' });
    await prot.command(i);
    assert.match(last(i).embeds[0].data.description, /Scam links/);
    prot.state.guild('ret2').raidUntil = now() + 1000;
    store.deleteGuild('ret2');
    prot.onGuildDelete(guild);
    assert.equal(store.readDb().guilds.ret2, undefined);
    assert.equal(prot.state.guilds.has('ret2'), false);
    assert.equal(cfg.getProtection('ret2').incidentCount, 0, 'fresh record after removal');
  });
});

describe('slash-command schema', () => {
  test('/protection is registered with the required subcommands, options and choices, and passes discord.js validation', () => {
    const p = commands.find((c) => c.name === 'protection');
    assert.ok(p, 'protection command exists');
    assert.equal(p.default_member_permissions, String(H.P.Administrator));
    const subs = Object.fromEntries(p.options.map((o) => [o.name, o]));
    assert.deepEqual(Object.keys(subs).sort(), ['action', 'domain', 'feature', 'limit', 'recent', 'status', 'trust', 'webhook']);
    const choices = (sub, opt) => subs[sub].options.find((o) => o.name === opt).choices.map((c) => c.value);
    assert.deepEqual(choices('feature', 'name'), ['scam', 'raid', 'mentions', 'repeats', 'newcomers', 'webhooks', 'antinuke']);
    assert.deepEqual(choices('limit', 'name').sort(), Object.keys(cfg.LIMITS).sort());
    assert.deepEqual(choices('action', 'target'), ['messages', 'antinuke']);
    assert.deepEqual(choices('action', 'type'), ['alert', 'delete', 'timeout', 'strip_roles']);
    assert.deepEqual(choices('domain', 'list'), ['blockedDomains', 'allowedDomains']);
    assert.deepEqual(choices('domain', 'operation'), ['add', 'remove']);
    for (const c of commands) {
      assert.ok(/^[a-z0-9-]{1,32}$/.test(c.name));
      assert.ok(c.description.length <= 100);
      for (const o of c.options || []) {
        assert.ok(o.description.length <= 100, `${c.name}/${o.name} description`);
        for (const oo of o.options || []) assert.ok(oo.description.length <= 100, `${c.name}/${o.name}/${oo.name}`);
      }
    }
    // the original commands are still there, unchanged in name
    assert.deepEqual(commands.map((c) => c.name), ['spamtrap', 'spamtrap-messages', 'protection']);
  });
});
