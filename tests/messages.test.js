const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const cleanup = H.useTempDb('messages');
after(cleanup);

const store = require('../lib/store');
const cfg = require('../lib/protection/config');
const { createProtection } = require('../lib/protection');

let now, prot;
function fresh() {
  store.writeDb({ guilds: {}, global: { totalCatches: 0 } }); // each test starts from an empty database
  now = H.clock();
  prot = createProtection({ now });
}
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
const zw = String.fromCodePoint(0x200b);

describe('message protections', () => {
  beforeEach(fresh);

  test('nothing fires for a server whose record predates the protections', async () => {
    const guild = guildWithLog('legacy');
    store.getGuild('legacy');
    const msg = H.mockMessage({ guild, author: 'u1', member: H.mockMember({ id: 'u1', guild }), content: 'free nitro https://dlscord.gift', users: 30, everyone: true });
    const r = await prot.onMessage(msg);
    assert.deepEqual(r, []);
    assert.equal(msg.deleted, false);
  });

  test('alert mode records an incident but never deletes or times out', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions']);
    const member = H.mockMember({ id: 'u1', guild });
    const msg = H.mockMessage({ guild, author: 'u1', member, users: 7, everyone: true });
    const r = await prot.onMessage(msg);
    assert.equal(r.length, 1);
    assert.equal(r[0].feature, 'mentions');
    assert.match(r[0].outcome, /alert only/);
    assert.equal(msg.deleted, false);
    assert.equal(member.timeouts.length, 0);
    assert.equal(guild.log.sends.length, 1, 'one moderator alert');
    assert.deepEqual(guild.log.sends[0].allowedMentions, { parse: [] }, 'alerts never ping');
    assert.equal(cfg.getProtection('g1').incidentCount, 1);
    assert.equal(JSON.stringify(cfg.getProtection('g1').incidents).includes('content'), false, 'no message content stored');
  });

  test('repeated messages are counted across channels, ignoring case, whitespace and invisible characters', async () => {
    const guild = guildWithLog();
    enable('g1', ['repeats']);
    const member = H.mockMember({ id: 'u1', guild });
    const variants = ['Join my server now!!', 'join  my SERVER now', `join my${zw} server now.`, 'JOIN MY SERVER NOW'];
    let last;
    for (let i = 0; i < variants.length; i++) {
      last = await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, content: variants[i], channelId: 'c' + i }));
      now.advance(1000);
    }
    assert.equal(last.length, 1);
    assert.equal(last[0].feature, 'repeats');
    assert.match(last[0].reason, /4 times/);
  });

  test('counters expire with the detection window', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions']);
    const member = H.mockMember({ id: 'u1', guild });
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, users: 4 }))).length, 0);
    now.advance(16 * 1000); // past the 15s window
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, users: 4 }))).length, 0, 'old mentions must have expired');
    now.advance(1000);
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, users: 4 }))).length, 1, '4 + 4 inside the window reaches 8');
  });

  test('state is isolated per server and per sender', async () => {
    const g1 = guildWithLog('g1');
    const g2 = guildWithLog('g2');
    enable('g1', ['mentions']);
    enable('g2', ['mentions']);
    const a1 = H.mockMember({ id: 'u1', guild: g1 });
    const a2 = H.mockMember({ id: 'u1', guild: g2 });
    const b1 = H.mockMember({ id: 'u2', guild: g1 });
    await prot.onMessage(H.mockMessage({ guild: g1, author: 'u1', member: a1, users: 5 }));
    await prot.onMessage(H.mockMessage({ guild: g2, author: 'u1', member: a2, users: 5 }));
    await prot.onMessage(H.mockMessage({ guild: g1, author: 'u2', member: b1, users: 5 }));
    const r = await prot.onMessage(H.mockMessage({ guild: g1, author: 'u1', member: a1, users: 2 }));
    assert.equal(r.length, 0, 'u1 in g1 has 7, the other server / other sender must not count');
  });

  test('trusted roles, staff and the owner are exempt from message protections', async () => {
    const trusted = H.mockRole({ id: 'r-trusted', name: 'Trusted' });
    const guild = guildWithLog('g1', { roles: [trusted] });
    enable('g1', ['mentions', 'repeats', 'scam'], { top: { trustedRoles: ['r-trusted'] } });
    const spam = { content: 'free nitro https://dlscord.gift', users: 20, everyone: true };
    const tm = H.mockMember({ id: 'u1', guild, roleIds: ['r-trusted'] });
    assert.deepEqual(await prot.onMessage(H.mockMessage({ guild, author: 'u1', member: tm, ...spam })), []);
    const staff = H.mockMember({ id: 'u2', guild, flags: [H.P.ManageMessages] });
    assert.deepEqual(await prot.onMessage(H.mockMessage({ guild, author: 'u2', member: staff, ...spam })), []);
    const owner = H.mockMember({ id: 'owner', guild });
    assert.deepEqual(await prot.onMessage(H.mockMessage({ guild, author: 'owner', member: owner, ...spam })), []);
    const normal = H.mockMember({ id: 'u3', guild });
    assert.ok((await prot.onMessage(H.mockMessage({ guild, author: 'u3', member: normal, ...spam }))).length >= 2, 'an ordinary member still trips it');
  });

  test('newcomer restrictions use the join timestamp from the message member', async () => {
    const guild = guildWithLog();
    enable('g1', ['newcomers']);
    const fresh = H.mockMember({ id: 'n1', guild, joinedTimestamp: now() - 2 * 60 * 1000 });
    const old = H.mockMember({ id: 'o1', guild, joinedTimestamp: now() - 30 * 60 * 1000 });
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'n1', member: fresh, content: 'look https://example.org' }))).length, 1, 'link within 10 min');
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'n1', member: fresh, attachments: 1 }))).length, 1, 'attachment within 10 min');
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'n1', member: fresh, content: 'hello everyone' }))).length, 0, 'plain text is fine');
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'o1', member: old, content: 'https://example.org' }))).length, 0, 'older member unaffected');
    const unknown = H.mockMember({ id: 'x1', guild, joinedTimestamp: null });
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'x1', member: unknown, content: 'https://example.org' }))).length, 0, 'no join timestamp -> no restriction');
  });

  test('webhook floods are handled with member == null, never timed out, and trusted ids are skipped', async () => {
    const guild = guildWithLog();
    enable('g1', ['webhooks'], { top: { messageAction: 'timeout', trustedWebhooks: ['999999999999999999'] } });
    let last;
    for (let i = 0; i < 8; i++) {
      last = await prot.onMessage(H.mockMessage({ guild, author: 'wh-user', member: null, webhookId: '111111111111111111', content: 'hi ' + i }));
    }
    assert.equal(last.length, 1);
    assert.equal(last[0].subjectType, 'webhook');
    assert.equal(last[0].subjectId, '111111111111111111');
    assert.match(last[0].action, /^delete/);
    assert.match(last[0].outcome, /message deleted/);
    for (let i = 0; i < 20; i++) {
      assert.deepEqual(await prot.onMessage(H.mockMessage({ guild, author: 'wh-user', member: null, webhookId: '999999999999999999', content: 'x' })), []);
    }
  });

  test('permission failures and API errors are reported in the outcome, and the handler never throws', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions'], { top: { messageAction: 'timeout' } });
    const member = H.mockMember({ id: 'u1', guild, timeoutError: H.discordError(50013, 'Missing Permissions') });
    const msg = H.mockMessage({ guild, author: 'u1', member, users: 9, deleteError: H.discordError(50013, 'Missing Permissions') });
    const r = await prot.onMessage(msg);
    assert.match(r[0].outcome, /delete failed: missing permissions/);
    assert.match(r[0].outcome, /timeout failed: missing permissions/);
    // alert channel refuses embeds -> falls back to plain text, still no pings
    guild.log.failFirst = H.discordError(50013);
    const m2 = H.mockMember({ id: 'u2', guild });
    await prot.onMessage(H.mockMessage({ guild, author: 'u2', member: m2, users: 9 }));
    const fallback = guild.log.sends.at(-1);
    assert.ok(fallback.content && !fallback.embeds, 'plain-text fallback used');
    assert.deepEqual(fallback.allowedMentions, { parse: [] });
    // a handler bug must not propagate
    const broken = H.mockMessage({ guild, author: 'u3', member: H.mockMember({ id: 'u3', guild }), users: 9 });
    broken.mentions = null;
    assert.deepEqual(await prot.onMessage(broken), []);
  });

  test('a concurrent burst produces exactly one timeout; later messages are still deleted', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions'], { top: { messageAction: 'timeout' } });
    const member = H.mockMember({ id: 'u1', guild });
    const msgs = Array.from({ length: 6 }, () => H.mockMessage({ guild, author: 'u1', member, users: 9 }));
    const results = await Promise.all(msgs.map((m) => prot.onMessage(m)));
    assert.equal(member.timeouts.length, 1, 'one timeout for the whole burst');
    assert.equal(msgs.filter((m) => m.deleted).length, 6, 'every violating message deleted');
    const outcomes = results.flat().map((r) => r.outcome);
    assert.equal(outcomes.filter((o) => /timed out for 10 min/.test(o)).length, 1);
    assert.ok(outcomes.filter((o) => /already (in progress|applied)/.test(o)).length >= 5);
  });

  test('an existing longer timeout is never shortened', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions'], { top: { messageAction: 'timeout' } });
    const member = H.mockMember({ id: 'u1', guild, communicationDisabledUntilTimestamp: now() + 60 * 60 * 1000 });
    const r = await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, users: 9 }));
    assert.equal(member.timeouts.length, 0);
    assert.match(r[0].outcome, /existing longer timeout kept/);
  });

  test('edited messages replace their earlier contribution instead of being counted again', async () => {
    const guild = guildWithLog();
    enable('g1', ['mentions', 'repeats']);
    const member = H.mockMember({ id: 'u1', guild });
    const m1 = H.mockMessage({ guild, author: 'u1', member, users: 5, id: 'same-id' });
    assert.equal((await prot.onMessage(m1)).length, 0);
    const edit1 = H.mockMessage({ guild, author: 'u1', member, users: 5, id: 'same-id' });
    assert.equal((await prot.onMessageUpdate(null, edit1)).length, 0, 'same 5 mentions re-sent as an edit must not become 10');
    const edit2 = H.mockMessage({ guild, author: 'u1', member, users: 9, id: 'same-id' });
    assert.equal((await prot.onMessageUpdate(null, edit2)).length, 1, 'edit raising it to 9 trips the limit');
    // repeats: editing one message to new text moves its hash, it doesn't add a second copy
    const texts = ['spam text one', 'spam text one', 'spam text one'];
    for (const [i, t] of texts.entries()) await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, content: t, id: 'rep' + i }));
    const edited = H.mockMessage({ guild, author: 'u1', member, content: 'totally different text', id: 'rep2' });
    assert.equal((await prot.onMessageUpdate(null, edited)).length, 0);
    assert.equal((await prot.onMessage(H.mockMessage({ guild, author: 'u1', member, content: 'spam text one', id: 'rep9' }))).length, 0, 'only 3 copies remain after the edit');
  });

  test('alert rate limiting: at most 6 alerts per minute per server, suppressed count reported', async () => {
    const guild = guildWithLog();
    enable('g1', ['scam']);
    for (let i = 0; i < 10; i++) {
      await prot.onMessage(H.mockMessage({ guild, author: 'u' + i, member: H.mockMember({ id: 'u' + i, guild }), content: 'https://dlscord.gift/' + i }));
    }
    assert.equal(guild.log.sends.length, 6);
    assert.equal(cfg.getProtection('g1').incidentCount, 10, 'incidents are still recorded');
    now.advance(61 * 1000);
    await prot.onMessage(H.mockMessage({ guild, author: 'z', member: H.mockMember({ id: 'z', guild }), content: 'https://dlscord.gift/z' }));
    const last = guild.log.sends.at(-1).embeds[0].data;
    assert.match(last.footer.text, /4 earlier alert/);
  });
});
