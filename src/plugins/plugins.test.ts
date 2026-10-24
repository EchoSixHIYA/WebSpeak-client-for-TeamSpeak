import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PluginRegistry } from './registry.js';
import { PluginCoordinator, type PluginParticipant } from './coordinator.js';
import { PluginStore } from './store.js';
import { parsePluginPackage, parsePluginJson, parsePluginRequest, PLUGIN_STORE_INDEX, type PluginMessage } from '../shared/plugins.js';

const example = () => readFile(new URL('../../docs/examples/watch-together.wplugin',import.meta.url),'utf8').then(t => parsePluginPackage(JSON.parse(t)));
async function registry(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(),'webspeak-plugins-'));
  t.after(async () => { assert.equal(path.dirname(directory), tmpdir()); await rm(directory,{recursive:true,force:true}); });
  const value = new PluginRegistry(directory); await value.initialize(); return { value, directory };
}
function participant(id: string, host='one.example', channel=1n): PluginParticipant {
  return {id,nickname:id,target:{host,port:9987},session:{state:'connected'},tsClient:{getChannelId:()=>channel,isConnected:()=>true}};
}
test('package and state validators reject unsupported APIs, capabilities, prototype keys and excessive nesting',async () => {
  const pack = await example(); assert.equal(pack.manifest.apiVersion,1);
  assert.throws(()=>parsePluginPackage({...pack,manifest:{...pack.manifest,apiVersion:2}}));
  assert.throws(()=>parsePluginPackage({...pack,manifest:{...pack.manifest,permissions:['admin.query']}}));
  assert.throws(()=>parsePluginPackage({...pack,styles:{light:'x',dark:''}}));
  assert.throws(()=>parsePluginJson(JSON.parse('{"__proto__":{"x":1}}')));
  assert.throws(()=>parsePluginJson(Array.from({length:5000},()=>1)));
  assert.throws(()=>parsePluginJson({number:Infinity}));
  assert.throws(()=>parsePluginRequest({type:'pluginRequest',requestId:'a',action:'update',pluginId:'a',revision:-1,state:null}));
});
test('atomic persistence retains settings, requires CAS and disables code updates until reviewed',async t => {
  const {value:r,directory} = await registry(t); const pack=await example();
  const first=await r.install(pack,null); assert.equal(first.settings.enabled,false);
  const enabled=await r.configure(pack.manifest.id,{enabled:true,scope:'server',targets:['ONE.example#9987'],config:{title:'Public'}},first.revision);
  assert.deepEqual(enabled.settings.targets,['one.example:9987']);
  await assert.rejects(r.configure(pack.manifest.id,enabled.settings,first.revision),/PLUGIN_CHANGED/);
  const reload=new PluginRegistry(directory); await reload.initialize(); assert.deepEqual(reload.list(),r.list());
  const updated=await r.install({...pack,script:'throw new Error("must never run on server")'},enabled.revision);
  assert.equal(updated.settings.enabled,false); assert.deepEqual(updated.settings.config,{title:'Public'});
  await assert.rejects(r.remove(pack.manifest.id,enabled.revision),/PLUGIN_CHANGED/);
  await r.remove(pack.manifest.id,updated.revision); assert.equal(r.list().length,0);
  await assert.rejects(r.install({...pack,manifest:{...pack.manifest,id:'../../escape'}},null));
});
test('server rooms synchronize state with CAS, isolate target/channel, expire on moves and revoke on disable',async t => {
  const {value:r}=await registry(t), pack=await example(), p=await r.install(pack,null);
  const enabled=await r.configure(pack.manifest.id,{enabled:true,scope:'server',targets:['one.example:9987','two.example:9987'],config:{}},p.revision);
  const entries=new Map([participant('a'),participant('b'),participant('c','one.example',2n),participant('d','two.example')].map(e=>[e.id,e]));
  const messages:{id:string;message:PluginMessage}[]=[];
  const c=new PluginCoordinator(r,entries,(id,message)=>messages.push({id,message})); t.after(()=>c.dispose());
  let seq=0; const send=(id:string,action:string,fields={})=>{c.handle(entries.get(id)!,{type:'pluginRequest',requestId:`r-${++seq}`,action,pluginId:pack.manifest.id,...fields}); return messages.filter(v=>v.id===id&&v.message.type==='pluginReply').at(-1)!.message as Extract<PluginMessage,{type:'pluginReply'}>;};
  const a=send('a','open').result as any, b=send('b','open').result as any;
  assert.equal(a.snapshot.roomId,b.snapshot.roomId); assert.notEqual((send('c','open').result as any).snapshot.roomId,a.snapshot.roomId);
  assert.notEqual((send('d','open').result as any).snapshot.roomId,a.snapshot.roomId);
  const state={url:'https://video.example/a.mp4',position:5,playing:true,updatedAt:Date.now()};
  assert.equal(send('a','update',{revision:0,state}).ok,true);
  assert.equal(send('b','update',{revision:0,state:{position:9}}).code,'PLUGIN_REVISION_CONFLICT');
  assert.deepEqual((send('b','snapshot').result as any).state,state);
  assert.equal(messages.some(v=>v.id==='c'&&v.message.type==='pluginEvent'&&v.message.snapshot?.state && (v.message.snapshot.state as any).url),false);
  entries.get('a')!.tsClient.getChannelId=()=>2n; c.reconcile(entries.get('a')!);
  assert.equal(send('a','snapshot').code,'PLUGIN_NOT_OPEN');
  assert.equal((send('b','snapshot').result as any).participants.length,1);
  await r.configure(pack.manifest.id,{...enabled.settings,enabled:false},enabled.revision);
  assert.equal(send('b','open').code,'PLUGIN_DISABLED');
  assert.ok(messages.some(v=>v.id==='b'&&v.message.type==='pluginEvent'&&v.message.snapshot===null));
});
test('instance rooms span targets but session readiness, write permission, quotas and teardown are enforced',async t => {
  const {value:r}=await registry(t), pack=await example(), p=await r.install(pack,null);
  const enabled=await r.configure(pack.manifest.id,{enabled:true,scope:'instance',targets:[],config:{}},p.revision);
  const a=participant('a'),b=participant('b','another.example',5n), entries=new Map([[a.id,a],[b.id,b]]);
  const messages:PluginMessage[]=[];const c=new PluginCoordinator(r,entries,(_id,m)=>messages.push(m));t.after(()=>c.dispose());
  let sequence=0;function send(e:PluginParticipant,action:string,fields={}){c.handle(e,{type:'pluginRequest',requestId:`r-${++sequence}`,pluginId:pack.manifest.id,action,...fields});return messages.filter(m=>m.type==='pluginReply').at(-1) as Extract<PluginMessage,{type:'pluginReply'}>;}
  const first=send(a,'open').result as any;assert.equal((send(b,'open').result as any).snapshot.roomId,first.snapshot.roomId);
  send(a,'update',{revision:0,state:{progress:30}});c.remove(a.id);
  assert.deepEqual((send(b,'snapshot').result as any).state,{progress:30}); c.remove(b.id);
  assert.equal((send(a,'open').result as any).snapshot.state,null);
  a.session.state='reconnecting';assert.equal(send(a,'update',{revision:0,state:0}).code,'PLUGIN_NOT_CONNECTED');a.session.state='connected';
  const next=await r.install({...pack,manifest:{...pack.manifest,permissions:['room.read']}},enabled.revision);
  await r.configure(pack.manifest.id,{...next.settings,enabled:true},next.revision);send(a,'open');assert.equal(send(a,'update',{revision:0,state:0}).code,'PLUGIN_PERMISSION_DENIED');
  for(let i=0;i<30;i++)send(a,'list');assert.equal((messages.filter(m=>m.type==='pluginReply').at(-1) as any).code,'PLUGIN_RATE_LIMITED');
});
test('GitHub distribution checks package hashes and reviewed metadata; redirects/arbitrary sources are rejected',async t => {
  const {value:r}=await registry(t), pack=await example(), bytes=Buffer.from(JSON.stringify(pack));
  const repository='https://github.com/Huddle-Up-Forge/webspeak-plugin';let corrupt=false;
  const metadata={manifest:pack.manifest,package:{ref:'main',path:'watch-together.wplugin',sha256:createHash('sha256').update(bytes).digest('hex')}};
  const visited:string[]=[];
  const store=new PluginStore(async(input,init)=>{
    const url=String(input);visited.push(url);assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');
    if(url===PLUGIN_STORE_INDEX)return Response.json({schemaVersion:1,plugins:[{id:pack.manifest.id,repository}]});
    if(url.endsWith('/HEAD/plugin.json'))return Response.json(metadata);
    return new Response(corrupt?'{}':bytes);
  });
  const entry=(await store.list()).entries[0];assert.equal(entry.error,null);
  const installed=await store.install(r,{id:entry.id,revision:entry.revision,installedRevision:null});assert.equal(installed.settings.enabled,false);
  corrupt=true;await assert.rejects(store.install(r,{id:entry.id,revision:entry.revision,installedRevision:installed.revision}),/PLUGIN_CHECKSUM/);
  await assert.rejects(store.install(r,{id:entry.id,revision:'a'.repeat(64),installedRevision:installed.revision}),/PLUGIN_CHANGED/);
  const bad=new PluginStore(async()=>Response.json({schemaVersion:1,plugins:[{id:'evil',repository:'http://127.0.0.1:3040'}]}));
  await assert.rejects(bad.list(),/PLUGIN_INVALID/);assert.ok(visited.every(u=>u.startsWith('https://raw.githubusercontent.com/')));
});

test('a UI-only plugin opens without shared data access, and read snapshots never broadcast to others',async t=>{
  const {value:r}=await registry(t),examplePack=await example();
  const pack={...examplePack,manifest:{...examplePack.manifest,permissions:[]}};
  const p=await r.install(pack,null);await r.configure(pack.manifest.id,{enabled:true,scope:'instance',targets:[],config:{}},p.revision);
  const a=participant('a'),b=participant('b'),entries=new Map([[a.id,a],[b.id,b]]);const messages:{id:string;message:PluginMessage}[]=[];
  const c=new PluginCoordinator(r,entries,(id,message)=>messages.push({id,message}));t.after(()=>c.dispose());
  let seq=0;const send=(id:string,action:string,fields={})=>{c.handle(entries.get(id)!,{type:'pluginRequest',requestId:`r-${++seq}`,pluginId:pack.manifest.id,action,...fields});return messages.filter(m=>m.id===id&&m.message.type==='pluginReply').at(-1)!.message as Extract<PluginMessage,{type:'pluginReply'}>;};
  const open=send('a','open');assert.equal(open.ok,true);assert.deepEqual((open.result as any).snapshot.participants,[]);
  assert.equal(send('a','snapshot').code,'PLUGIN_PERMISSION_DENIED');assert.equal(send('a','update',{revision:0,state:1}).code,'PLUGIN_PERMISSION_DENIED');
  const updated=await r.install(examplePack,r.list()[0].revision);await r.configure(pack.manifest.id,{...updated.settings,enabled:true},updated.revision);
  send('a','open');send('b','open');const before=messages.length;send('a','snapshot');assert.equal(messages.length,before+1);
  for(let revision=0;revision<10;revision++)assert.equal(send('a','update',{revision,state:revision}).ok,true);
  assert.equal(send('b','update',{revision:10,state:11}).code,'PLUGIN_RATE_LIMITED');
  for(let i=0;i<20;i++)send('a','list');assert.equal(send('a','close').ok,true);
  assert.equal((send('b','snapshot').result as any).participants.length,1);
});
