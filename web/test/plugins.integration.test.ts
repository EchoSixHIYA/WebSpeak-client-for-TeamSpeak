import assert from 'node:assert/strict';
import test from 'node:test';
import { once, EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { WebSocket } from 'ws';
import pino from 'pino';
import { PluginRegistry } from '../../src/plugins/registry.js';
import { PluginStore } from '../../src/plugins/store.js';
import { parsePluginPackage, PLUGIN_STORE_INDEX } from '../../src/shared/plugins.js';
import { createHash } from 'node:crypto';
import { createAdminRouter } from '../../src/admin/admin-router.js';
import { AdminSessionStore } from '../../src/admin/admin-session.js';
import type { AdminService } from '../../src/admin/admin-service.js';
import { createAdminApi } from '../src/services/admin-api.js';
import { JoinTicketStore } from '../../src/server/join-ticket.js';
import { VoiceBridge } from '../../src/server/voice-bridge.js';
import type { TSClient } from '../../src/server/ts-client.js';

test('actual administrator routes support store install, CAS configuration, import and removal with authentication/CSRF',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'webspeak-plugin-http-'));
  t.after(async()=>{assert.equal(path.dirname(directory),tmpdir());await rm(directory,{recursive:true,force:true});});
  const registry=new PluginRegistry(directory);await registry.initialize();
  const pack=parsePluginPackage(JSON.parse(await readFile(new URL('../../docs/examples/watch-together.wplugin',import.meta.url),'utf8')));
  const bytes=JSON.stringify(pack),sha=createHash('sha256').update(bytes).digest('hex');
  const store=new PluginStore(async url=>String(url)===PLUGIN_STORE_INDEX?Response.json({schemaVersion:1,plugins:[{id:pack.manifest.id,repository:'https://github.com/Huddle-Up-Forge/webspeak-plugin'}]}):String(url).endsWith('/plugin.json')?Response.json({manifest:pack.manifest,package:{ref:'main',path:'watch-together.wplugin',sha256:sha}}):new Response(bytes));
  const audits:string[]=[];
  const service={isInitialized:()=>true,isPasswordChangeRequired:()=>false,verifyPassword:async()=>true,database:{addAudit:(name:string)=>audits.push(name)}} as unknown as AdminService;
  const app=express();app.use(express.json({limit:'600kb'}));
  app.use('/api/admin',createAdminRouter({service,sessions:new AdminSessionStore(),logger:pino({enabled:false}),getActiveSessions:()=>0,getPeakSessions:()=>0,startedAt:Date.now(),pluginRegistry:registry,pluginStore:store}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
  const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
  let cookie='',csrf='';const api=createAdminApi({csrfToken:()=>csrf,fetch:async(url,init)=>{const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);const response=await fetch(origin+url,{...init,headers});const c=response.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return response;}});
  await assert.rejects(api.plugins(),(e:any)=>e.status===401);csrf=(await api.login('admin','test-password')).csrfToken;
  for(const [method,url,body] of [['POST','/plugins/upload',{package:pack,installedRevision:null}],['PUT','/plugins/a/settings',{}],['DELETE','/plugins/a',{}],['POST','/plugins/store/install',{}]] as const){
    const denied=await fetch(origin+'/api/admin'+url,{method,headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(denied.status,403);
  }
  const entry=(await api.pluginStore()).entries[0];const outcomes=await Promise.allSettled([api.installPlugin({id:entry.id,revision:entry.revision,installedRevision:null}),api.installPlugin({id:entry.id,revision:entry.revision,installedRevision:null})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  let installed=(await api.plugins()).plugins[0];assert.equal(installed.settings.enabled,false);
  const configured=await api.configurePlugin(installed.manifest.id,installed.revision,{enabled:true,scope:'instance',targets:[],config:{example:1}});assert.equal(configured.plugin.settings.enabled,true);
  await assert.rejects(api.configurePlugin(installed.manifest.id,installed.revision,installed.settings),(e:any)=>e.code==='PLUGIN_CHANGED');
  const imported=await api.uploadPlugin(pack,configured.plugin.revision);assert.equal(imported.plugin.settings.enabled,false);
  await api.removePlugin(pack.manifest.id,imported.plugin.revision);assert.equal((await api.plugins()).plugins.length,0);
  assert.ok(audits.includes('ADMIN_PLUGIN_INSTALLED')&&audits.includes('ADMIN_PLUGIN_CONFIGURED')&&audits.includes('ADMIN_PLUGIN_REMOVED'));
});

class TeamSpeakStub extends EventEmitter {
  async connect(){this.emit('directorySnapshot',{channels:[],clients:[]});}
  async disconnect(){} getClientId(){return 1;} getChannelId(){return 1n;} isConnected(){return true;}
  async getServerInfo(){return {name:'Plugin wire test',iconId:null};}async getServerPresentation(){return {bannerUrl:null,welcomeMessage:''};}async getServerIcon(){return null;}
  async getClientAvatar(){return null;}async sendProtocolCommand(){}async setAccompanimentActive(){}
}
test('two real voice WebSockets exchange generic plugin state and leaving removes a participant', {timeout:10000},async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'webspeak-plugin-ws-'));
  const registry=new PluginRegistry(directory);await registry.initialize();const pack=parsePluginPackage(JSON.parse(await readFile(new URL('../../docs/examples/watch-together.wplugin',import.meta.url),'utf8')));
  const installed=await registry.install(pack,null);await registry.configure(pack.manifest.id,{enabled:true,scope:'server',targets:['voice.example:9987'],config:{}},installed.revision);
  const tickets=new JoinTicketStore(),bridge=new VoiceBridge({joinTickets:tickets,pluginRegistry:registry},pino({enabled:false}),undefined,{createTeamSpeakClient:()=>new TeamSpeakStub() as unknown as TSClient,createEncoder:()=>({encode:()=>Buffer.alloc(0),dispose(){}})});
  const server=createServer();bridge.attach(server);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const sockets:WebSocket[]=[];
  t.after(async()=>{for(const ws of sockets)ws.terminate();await bridge.shutdown();await new Promise<void>(r=>server.close(()=>r()));assert.equal(path.dirname(directory),tmpdir());await rm(directory,{recursive:true,force:true});});
  async function client(nickname:string){const ticket=tickets.create({target:{host:'voice.example',port:9987},nickname,serverPassword:''});const ws=new WebSocket(`ws://127.0.0.1:${address.port}/ws/voice?ticket=${ticket}`);sockets.push(ws);
    await new Promise<void>(resolve=>ws.on('message',data=>{if(JSON.parse(data.toString()).type==='connected')resolve();}));return ws;}
  const a=await client('Alice'),b=await client('Bob');let seq=0;
  function send(ws:WebSocket,action:string,fields={}){const requestId=`r-${++seq}`;return new Promise<any>(resolve=>{const listener=(data:Buffer)=>{const m=JSON.parse(data.toString());if(m.type==='pluginReply'&&m.requestId===requestId){ws.off('message',listener);resolve(m);}};ws.on('message',listener);ws.send(JSON.stringify({type:'pluginRequest',requestId,action,pluginId:pack.manifest.id,...fields}));});}
  assert.equal((await send(a,'list')).result.length,1);const first=await send(a,'open'),second=await send(b,'open');assert.equal(first.result.snapshot.roomId,second.result.snapshot.roomId);
  const state={url:'https://video.example/test.mp4',playing:true,position:42,updatedAt:Date.now()};assert.equal((await send(a,'update',{revision:0,state})).ok,true);
  assert.deepEqual((await send(b,'snapshot')).result.state,state);assert.equal((await send(b,'snapshot')).result.participants.length,2);
  await send(a,'close');assert.equal((await send(b,'snapshot')).result.participants.length,1);
});
