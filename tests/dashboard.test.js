const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionsBitField, ChannelType } = require('discord.js');
const { useTempDb, perms, P } = require('./helpers');
const cleanup = useTempDb('dashboard');
const store = require('../lib/store');
const { createDashboard, validateDashboardEnvironment } = require('../web/server');
const { canManageTrap } = require('../lib/access');
const { validateMessages } = require('../web/validation');
const { serverSessions } = require('../web/sessions');
const express = require('express');
const fetchHttp = global.fetch;
const guildId = '123456789012345678';
const userId = '234567890123456789';
const member = { id: userId, permissions: perms(P.BanMembers, P.ManageGuild), roles: { cache: new Collection() } };
const guild = { id: guildId, ownerId: 'owner', name: 'Test', members: { fetch: async () => member, me: { permissions: perms(P.BanMembers, P.ManageChannels) } }, channels: { cache: new Collection() }, roles: { cache: new Collection() }, iconURL: () => null };
const client = { user: { id: '999' }, guilds: { cache: new Collection([[guildId, guild]]) }, isReady: () => true, commandsReady: true };
process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'http://localhost:3000';
process.env.SESSION_SECRET = 'test-secret-with-at-least-32-characters';
const app = createDashboard(client);
let server;
let base;
const jar = new Map();
function saveCookies(response, target = jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const entry = cookie.split(';')[0]; const eq = entry.indexOf('=');
    target.set(entry.slice(0,eq),entry.slice(eq+1));
  }
}
function cookieHeader(target = jar) { return [...target].map(([k,v]) => k+'='+v).join('; '); }
async function request(url, options = {}) {
  const response = await fetchHttp(base+url, { ...options, redirect: 'manual', headers: { Cookie: cookieHeader(), ...options.headers } });
  saveCookies(response);
  return response;
}
async function login() {
  const start = await request('/auth/discord');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const result = await request('/auth/callback?code=test-code&state='+state);
  assert.equal(result.status,302);
  assert.equal(result.headers.get('location'),'/');
}
after(async () => { global.fetch = fetchHttp; app.locals.close(); if (server) await new Promise(r => server.close(r)); cleanup(); });

test('dashboard authentication, authorization, validation, concurrency and health', async t => {
  global.fetch = async url => {
    if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'private-test-oauth-token', expires_in: 3600 });
    if (String(url).endsWith('/users/@me')) return Response.json({ id: userId, username: 'tester', global_name: 'Test User' });
    if (String(url).includes('/users/@me/guilds')) return Response.json([{ id: guildId, name: 'Test', permissions: '8', owner: false }]);
    throw new Error('Unexpected external request');
  };
  server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  base = 'http://127.0.0.1:'+server.address().port;
  store.getGuild(guildId);
  await t.test('unauthenticated access is rejected; OAuth state must match', async () => {
    assert.equal((await request('/api/guild/'+guildId+'/messages')).status,401);
    const bad = await request('/auth/callback?code=bad&state=bad');
    assert.equal(bad.headers.get('location'),'/?error=invalid_state');
  });
  await login();
  await t.test('tokens are absent from cookies and session API; logout revokes replay', async () => {
    const cookie = decodeURIComponent(jar.get('spamtrap'));
    const decoded = Buffer.from(cookie,'base64').toString();
    assert.deepEqual(Object.keys(JSON.parse(decoded)),['sid']);
    assert.ok(!decoded.includes('private-test'));
    const me = await (await request('/api/me')).json();
    assert.equal(me.loggedIn,true); assert.equal(me.accessToken,undefined);
    const replay = cookieHeader();
    await request('/auth/logout');
    const replayResult = await fetchHttp(base+'/api/me',{ headers: {Cookie: replay} });
    assert.equal((await replayResult.json()).loggedIn,false);
    await login();
  });
  await t.test('guild discovery and reads follow allowed roles, administrators and owner rules', async () => {
    member.permissions=perms(P.ManageGuild);
    assert.equal((await request('/api/guild/'+guildId+'/messages')).status,403);
    assert.deepEqual(await (await request('/api/guilds')).json(),[]);
    member.permissions=perms(P.Administrator);
    assert.equal((await (await request('/api/guilds')).json()).length,1);
    store.updateGuild(guildId,g => { g.allowedRoles=['allowed']; });
    assert.equal((await request('/api/guild/'+guildId+'/messages')).status,403);
    member.roles.cache.set('allowed',{});
    assert.equal((await request('/api/guild/'+guildId+'/messages')).status,200);
    assert.equal(canManageTrap({ownerId:userId},member,{allowedRoles:['other']}),true);
    member.roles.cache.clear(); store.updateGuild(guildId,g=>{g.allowedRoles=[];});
    member.permissions=perms(P.BanMembers,P.ManageGuild);
  });
  await t.test('rejects invalid messages, roles, channels, cross-origin writes and oversized requests', async () => {
    const post = (route,data,headers={}) => request('/api/guild/'+guildId+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    assert.equal((await post('/messages',{warning:{bad:true}})).status,400);
    assert.equal((await post('/messages',{dm:'x'.repeat(1501)})).status,400);
    assert.equal((await post('/roles',{allowedRoles:[guildId]})).status,400);
    guild.channels.cache.set('voice',{id:'voice',type:ChannelType.GuildVoice});
    assert.equal((await post('/channels',{trapChannels:['voice']})).status,400);
    assert.equal((await post('/log',{logChannel:'voice'})).status,400);
    assert.equal((await post('/messages',{warning:'ok'},{Origin:'https://other.example'})).status,403);
    assert.equal((await post('/messages',{warning:'x'.repeat(40000)})).status,413);
    assert.equal((await post('/messages',{warning:'ok',dm:'',log:null})).status,200);
    assert.equal(store.getGuild(guildId).customMessages.warning,'ok');
  });
  await t.test('concurrent creation respects the five trap limit and preserves both selections', async () => {
    let sequence=0;
    guild.channels.create=async () => {
      await new Promise(r=>setTimeout(r,10));
      const channel={id:'new'+(++sequence),name:'trap'+sequence,type:ChannelType.GuildText,
        send:async()=>({id:'message'+sequence,pin:async()=>{}}),
        messages:{fetch:async()=>({edit:async()=>{}})}};
      guild.channels.cache.set(channel.id,channel); return channel;
    };
    store.updateGuild(guildId,g=>{g.experiments.manyTraps=true;g.trapChannels=['a','b','c'];});
    const create=()=>request('/api/guild/'+guildId+'/create-channel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const responses=await Promise.all([create(),create(),create()]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,400]);
    assert.equal(sequence,2); assert.equal(store.getGuild(guildId).trapChannels.length,5);
  });
  await t.test('health checks readiness, CSP is present and assets are served', async () => {
    assert.equal((await request('/health')).status,200);
    client.commandsReady=false; assert.equal((await request('/health')).status,503); client.commandsReady=true;
    const homepage=await request('/'); assert.ok(homepage.headers.get('content-security-policy').includes("object-src 'none'"));
    assert.equal((await request('/dashboard.js?v=4.0.1')).status,200);
    assert.equal((await request('/missing-page')).status,404);
  });
});

test('production configuration requires a strong secret and HTTPS origin', () => {
  const before={...process.env};
  try {
    process.env.NODE_ENV='production';process.env.SESSION_SECRET='short';
    assert.throws(validateDashboardEnvironment,/SESSION_SECRET/);
    process.env.SESSION_SECRET='x'.repeat(64);process.env.CLIENT_SECRET='test';
    assert.throws(validateDashboardEnvironment,/BASE_URL/);
    process.env.BASE_URL='https://spamtrap.help';assert.doesNotThrow(validateDashboardEnvironment);
  } finally { process.env.NODE_ENV=before.NODE_ENV;process.env.SESSION_SECRET=before.SESSION_SECRET;process.env.BASE_URL=before.BASE_URL; if(before.CLIENT_SECRET)process.env.CLIENT_SECRET=before.CLIENT_SECRET;else delete process.env.CLIENT_SECRET; }
});

test('session expiry is enforced on the server even when the cookie is replayed', async () => {
  let now=1000;
  const sessions=serverSessions({secret:'testing-secret',secure:false,now:()=>now,maxAge:100});
  const a=express();a.use(sessions);a.get('/login',(req,res)=>{req.session.user={id:'test'};res.json({ok:true});});a.get('/me',(req,res)=>res.json({user:req.session.user||null}));
  const srv=a.listen(0,'127.0.0.1');await new Promise(r=>srv.once('listening',r));const url='http://127.0.0.1:'+srv.address().port;
  try {
    const response=await fetchHttp(url+'/login');const cookies=new Map();saveCookies(response,cookies);const cookie=cookieHeader(cookies);
    now+=101;
    const expired=await fetchHttp(url+'/me',{headers:{Cookie:cookie}});assert.equal((await expired.json()).user,null);
  } finally {sessions.close();await new Promise(r=>srv.close(r));}
});

test('message validation accepts defaults and rejects non-text payloads',()=>{
  assert.equal(validateMessages({warning:null,dm:'',log:'ok'}),null);
  assert.match(validateMessages({warning:['bad']}),/warning/);
});
