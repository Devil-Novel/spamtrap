const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./helpers');
const cleanup = useTempDb('config');
after(cleanup);

const store = require('../lib/store');
const cfg = require('../lib/protection/config');
const scam = require('../lib/protection/scam');

describe('configuration defaults and persistence', () => {
  test('an existing server record (no protection key) reads as everything disabled, alert-only, documented defaults', () => {
    store.getGuild('old-server'); // creates the pre-protection record shape
    assert.equal(store.getGuild('old-server').protection, undefined, 'old records have no protection key');
    const p = cfg.getProtection('old-server');
    for (const f of cfg.FEATURES) assert.equal(p.features[f], false, `${f} must start disabled`);
    assert.equal(p.messageAction, 'alert');
    assert.equal(p.nukeAction, 'alert');
    assert.deepEqual(p.limits, {
      mentionLimit: 8, repeatLimit: 4, messageWindowSeconds: 15, webhookLimit: 8, joinLimit: 8, joinWindowSeconds: 15,
      raidMinutes: 5, raidFilter: 0, newcomerMinutes: 10, timeoutMinutes: 10, nukeLimit: 4, nukeWindowSeconds: 20,
    });
    assert.equal(store.getGuild('old-server').protection, undefined, 'reading must not write defaults into the record');
  });

  test('updates persist and merge with defaults; unrelated fields are kept', () => {
    store.getGuild('s2');
    store.updateGuild('s2', (g) => { g.catchCount = 7; });
    cfg.updateProtection('s2', (p) => { p.features.scam = true; p.limits.mentionLimit = 12; });
    const again = cfg.getProtection('s2');
    assert.equal(again.features.scam, true);
    assert.equal(again.features.raid, false);
    assert.equal(again.limits.mentionLimit, 12);
    assert.equal(again.limits.repeatLimit, 4);
    assert.equal(store.getGuild('s2').catchCount, 7, 'protection writes must not clobber other settings');
  });

  test('corrupt values normalize to safe defaults', () => {
    store.getGuild('s3');
    store.updateGuild('s3', (g) => { g.protection = { messageAction: 'ban', nukeAction: 'kick', trustedRoles: 'nope', incidentCount: -5 }; });
    const p = cfg.getProtection('s3');
    assert.equal(p.messageAction, 'alert');
    assert.equal(p.nukeAction, 'alert');
    assert.deepEqual(p.trustedRoles, []);
    assert.equal(p.incidentCount, 0);
  });
});

describe('validation', () => {
  test('limits: range, integer, unknown', () => {
    assert.equal(cfg.validateLimit('mentionLimit', 8).ok, true);
    assert.equal(cfg.validateLimit('mentionLimit', 1).ok, false);
    assert.equal(cfg.validateLimit('mentionLimit', 51).ok, false);
    assert.equal(cfg.validateLimit('mentionLimit', 7.5).ok, false);
    assert.equal(cfg.validateLimit('timeoutMinutes', 40321).ok, false, 'above Discord max of 28 days');
    assert.equal(cfg.validateLimit('raidFilter', 2).ok, false);
    assert.equal(cfg.validateLimit('bogus', 3).ok, false);
  });
  test('actions: incompatible combinations are rejected', () => {
    assert.equal(cfg.validateAction('messages', 'alert').ok, true);
    assert.equal(cfg.validateAction('messages', 'timeout').ok, true);
    assert.equal(cfg.validateAction('messages', 'strip_roles').ok, false);
    assert.equal(cfg.validateAction('antinuke', 'strip_roles').ok, true);
    assert.equal(cfg.validateAction('antinuke', 'delete').ok, false);
    assert.equal(cfg.validateAction('antinuke', 'timeout').ok, false);
    assert.equal(cfg.validateAction('other', 'alert').ok, false);
  });
  test('domain normalization', () => {
    assert.equal(cfg.normalizeDomain('Example.COM.'), 'example.com');
    assert.equal(cfg.normalizeDomain('https://www.Sub.Example.com/path?x=1'), 'sub.example.com');
    assert.equal(cfg.normalizeDomain('*.example.com'), null);
    assert.equal(cfg.normalizeDomain('localhost'), null);
    assert.equal(cfg.normalizeDomain('bad_host.com'), null);
    assert.equal(cfg.normalizeDomain(''), null);
  });
  test('webhook ids must be snowflakes, never URLs/tokens', () => {
    assert.equal(cfg.validateSnowflake('123456789012345678'), true);
    assert.equal(cfg.validateSnowflake('https://discord.com/api/webhooks/1/abc'), false);
    assert.equal(cfg.validateSnowflake('abc'), false);
  });
});

describe('scam link checks (local only)', () => {
  const base = cfg.defaults();
  test('domain boundary: subdomains match, lookalike suffixes do not', () => {
    assert.equal(scam.domainMatches('a.example.com', 'example.com'), true);
    assert.equal(scam.domainMatches('example.com', 'example.com'), true);
    assert.equal(scam.domainMatches('notexample.com', 'example.com'), false);
    assert.equal(scam.domainMatches('example.com.evil.ru', 'example.com'), false);
  });
  test('block list wins over allow list; allow list suppresses heuristics', () => {
    const c = { ...base, blockedDomains: ['bad.example'], allowedDomains: ['bad.example', 'nitro-deals.example'] };
    const f = scam.classifyText('go to https://x.bad.example/now and free nitro at https://nitro-deals.example', c);
    assert.deepEqual(f.map((x) => [x.host, x.kind]), [['x.bad.example', 'blocked']]);
  });
  test('official Discord domains are never flagged', () => {
    const f = scam.classifyText('https://discord.gg/abc https://discord.com/nitro https://cdn.discordapp.com/x.png free nitro!', base);
    assert.deepEqual(f, []);
  });
  test('impersonation and fake-nitro heuristics are reported as suspected', () => {
    const f = scam.classifyText('claim your free nitro https://dlscord-gifts.ru/claim and also https://nitro-free.xyz', base);
    const kinds = f.map((x) => x.kind);
    assert.ok(kinds.every((k) => k === 'suspected'));
    assert.ok(f.some((x) => x.host === 'dlscord-gifts.ru' && /impersonation/.test(x.reason)));
    assert.ok(f.some((x) => x.host === 'nitro-free.xyz' && /Nitro/.test(x.reason)));
  });
  test('bare lookalike hosts without a scheme are still noticed; plain text is not', () => {
    assert.equal(scam.classifyText('join discrod.gift now', base).length, 1);
    assert.equal(scam.classifyText('discord is great, nitro is nice', base).length, 0);
    assert.equal(scam.hasLink('see https://example.org'), true);
    assert.equal(scam.hasLink('no links here'), false);
  });
});
