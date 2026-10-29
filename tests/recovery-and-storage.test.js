const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { useTempDb, perms } = require('./helpers');
const cleanup = useTempDb('recovery');
const store = require('../lib/store');
const { createSoftbanRecovery } = require('../lib/softban');
const { createCatchHandler } = require('../lib/catch');
after(cleanup);

function fixture(id) {
  const g = store.getGuild(id);
  const bans=new Map(), logs=[], dms=[];
  let failUnban=false, invites=0;
  const guild={id,name:'Test',ownerId:'owner',channels:{fetch:async()=>null},
    bans:{fetch:async uid=>{if(!bans.has(uid))throw Object.assign(new Error('Unknown ban'),{code:10026});return bans.get(uid);}},
    members:{ban:async(uid,options)=>bans.set(uid,{reason:options.reason}),unban:async uid=>{if(failUnban)throw new Error('Missing permission');bans.delete(uid);}}};
  const client={guilds:{cache:new Map([[id,guild]])},isReady:()=>true};
  const message={guild,member:{id:'user',permissions:perms(),bannable:true,send:async payload=>dms.push(payload)},channel:{id:'trap',createInvite:async()=>{invites++;return {url:'https://discord.gg/test'};}},deletable:true,delete:async()=>{}};
  return {g,guild,client,message,bans,logs,dms,get invites(){return invites;},set fail(value){failUnban=value;}};
}

test('softban failure is truthful, survives restart and is eventually recovered',async()=>{
  const f=fixture('recovery');let time=1000;
  const recovery=createSoftbanRecovery(f.client,{now:()=>time});
  const handler=createCatchHandler({softbanRecovery:recovery,logToChannel:async(...args)=>f.logs.push(args)});
  f.fail=true;
  await handler(f.message,f.g);
  assert.equal(f.bans.has('user'),true);
  assert.equal(store.getGuild('recovery').pendingUnbans.length,1);
  assert.match(store.getGuild('recovery').recentActions[0].action,/unban pending/);
  assert.ok(f.logs.some(args=>String(args[2]).includes('Recovery is queued')));
  assert.equal(f.invites,0);
  assert.ok(!f.dms[0].content.includes('welcome to rejoin'));
  f.fail=false;time+=3600000;
  const restarted=createSoftbanRecovery(f.client,{now:()=>time});
  await restarted.sweep();
  assert.equal(f.bans.has('user'),false);
  assert.equal(store.getGuild('recovery').pendingUnbans.length,0);
  assert.match(store.getGuild('recovery').recentActions[0].action,/unban recovered/);
});

test('successful softban creates a rejoin invite; permanent ban does not',async()=>{
  for(const action of ['softban','ban']){
    const f=fixture('action-'+action);f.g.action=action;
    const recovery=createSoftbanRecovery(f.client);
    await createCatchHandler({softbanRecovery:recovery,logToChannel:async()=>{}})(f.message,f.g);
    assert.equal(f.invites,action==='softban'?1:0);
    assert.equal(f.bans.has('user'),action==='ban');
    assert.equal((store.getGuild(f.guild.id).pendingUnbans||[]).length,0);
  }
});

test('recovery leaves unrelated moderator bans alone',async()=>{
  const f=fixture('manual-ban');let time=1000;
  const recovery=createSoftbanRecovery(f.client,{now:()=>time});
  const job=recovery.prepare(f.guild.id,'user');recovery.release(job);
  f.bans.set('user',{reason:'Moderator permanent ban'});time+=60001;
  await recovery.sweep();
  assert.equal(f.bans.has('user'),true);
  assert.equal(store.getGuild(f.guild.id).pendingUnbans.length,0);
});

test('uncertain ban failure never unbans an unrelated account; absent bans clear pending jobs',async()=>{
  const f=fixture('missing-ban');let time=1000;
  const recovery=createSoftbanRecovery(f.client,{now:()=>time});
  const job=recovery.prepare(f.guild.id,'user');recovery.release(job);time+=60001;
  await recovery.sweep();
  assert.equal(store.getGuild(f.guild.id).pendingUnbans.length,0);
});

test('atomic database recovery preserves a valid snapshot; deletion scrubs backup',()=>{
  const file=process.env.DATABASE_PATH;
  store.getGuild('keep');store.updateGuild('keep',g=>{g.catchCount=19;});store.updateGuild('keep',g=>{g.catchCount=20;});
  fs.writeFileSync(file,'{partial');
  assert.equal(store.getGuild('keep').catchCount,19);
  assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(file,'utf8')));
  store.deleteGuild('keep');
  assert.equal(JSON.parse(fs.readFileSync(file+'.bak','utf8')).guilds.keep,undefined);
});

test('write failure leaves the primary database intact',()=>{
  const before=fs.readFileSync(process.env.DATABASE_PATH,'utf8');
  const rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===process.env.DATABASE_PATH)throw new Error('simulated interrupted commit');return rename(from,to);};
  try { assert.throws(()=>store.updateGuild('recovery',g=>{g.catchCount=999;}),/interrupted commit/); }
  finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(process.env.DATABASE_PATH,'utf8'),before);
});
