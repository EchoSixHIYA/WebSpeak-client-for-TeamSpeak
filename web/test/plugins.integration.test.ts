import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { WebSocket } from 'ws';
import { PluginRegistry } from '../../src/plugins/registry.js';
import { PluginRuntime } from '../../src/plugins/runtime.js';
import { createPluginRuntimeRouter } from '../../src/plugins/runtime-router.js';
import { parsePluginPackage, type PluginPackage, type PluginParticipant } from '../../src/shared/plugins.js';
import { createLogger } from '../../src/logger.js';

const require=createRequire(import.meta.url);
const serverSource=`import {WebSocketServer} from 'ws';import {writeFile,readFile} from 'node:fs/promises';import path from 'node:path';export default async({dataDir,config,events})=>{let joins=0;events.on('participantJoined',()=>joins++);const wss=new WebSocketServer({noServer:true});wss.on('connection',(socket,request)=>socket.on('message',data=>socket.send(JSON.stringify({echo:data.toString(),route:request.url,user:request.webspeak.self.nickname,scope:request.webspeak.scope.key}))));return {handle:async(request,response)=>{let count=Number(await readFile(path.join(dataDir,'value.txt'),'utf8').catch(()=>0));if(request.method==='POST'){count++;await writeFile(path.join(dataDir,'value.txt'),String(count));}response.setHeader('content-type','application/json');response.end(JSON.stringify({route:request.url,user:request.webspeak.self.nickname,scope:request.webspeak.scope.key,cookie:request.headers.cookie??null,authorization:request.headers.authorization??null,configured:config?.secret==='private',count,joins}));},upgrade:(request,socket,head)=>wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request)),stop:()=>{for(const client of wss.clients)client.terminate();wss.close();}};};`;
async function application(server=false):Promise<PluginPackage>{
 const pack:any={manifest:{apiVersion:2,id:'test.runtime-app',name:'Runtime application',version:'1.0.0',author:'Test',license:'MIT',description:'HTTP and WebSocket runtime fixture',scopes:['server','instance'],client:{entry:'client/index.html'},...(server?{server:{entry:'server/main.mjs'}}:{})},files:{'client/index.html':{encoding:'utf8',data:'<!doctype html><html><head><title>App</title><script type="module" src="./main.js"></script></head><body>Application</body></html>'},'client/main.js':{encoding:'utf8',data:'const context=await webspeak.ready;document.body.textContent=context.self.nickname;'},'client/theme.css':{encoding:'utf8',data:'body{color:#123}'}}};
 if(server){pack.files['server/main.mjs']={encoding:'utf8',data:serverSource};const base=path.dirname(require.resolve('ws/package.json'));
  async function collect(dir:string,relative=''){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Unexpected test dependency link');const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await collect(path.join(dir,entry.name),name);else pack.files['server/node_modules/ws/'+name]={encoding:'utf8',data:await readFile(path.join(dir,entry.name),'utf8')};}}
  await collect(base);
 }
 return parsePluginPackage(pack);
}
async function environment(t:test.TestContext){
 const cleanup:Array<()=>Promise<unknown>|void>=[];
 const directory=await mkdtemp(path.join(tmpdir(),'webspeak-runtime-http-')),registry=new PluginRegistry(directory,Buffer.alloc(32,3));await registry.initialize();
 const participants=new Map<string,PluginParticipant>([['a'.repeat(43),{id:'alice',nickname:'测试参与者甲',uid:'public-a',target:'one.example:9987',channelId:'1',members:[]}],['b'.repeat(43),{id:'bob',nickname:'Bob',target:'two.example:9987',channelId:'2',members:[]}]]);
 const runtime=new PluginRuntime({registry,participant:token=>participants.get(token)??null,logger:createLogger(),port:0,host:'127.0.0.1'});await runtime.start();
 const app=express();app.use(express.json());app.use('/api/plugins',createPluginRuntimeRouter(runtime));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 t.after(async()=>{for(const dispose of cleanup)await dispose();await runtime.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));assert.equal(path.dirname(directory),tmpdir());await rm(directory,{recursive:true,force:true});});
 const call=(route:string,method='GET',body?:unknown,token='a'.repeat(43))=>fetch(base+'/api/plugins'+route,{method,headers:{authorization:'Bearer '+token,origin:base,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function install(backend=false,scope:'server'|'instance'='instance'){
  const pack=await application(backend),first=await registry.install(pack,null);
  const enabled=await registry.configure(pack.manifest.id,{enabled:true,trusted:true,scope,targets:scope==='server'?['one.example:9987']:[],config:{public:'setting'},serverConfigAction:'replace',serverConfig:{secret:'private'}},first.revision);await runtime.synchronize(pack.manifest.id);return enabled;
 }
 const launch=async(id='test.runtime-app',token='a'.repeat(43))=>{const response=await call('/'+id+'/open','POST',{theme:'dark',language:'zh'},token);assert.equal(response.status,201,await response.clone().text());return response.json() as Promise<{id:string;url:string}>;};
 return {directory,registry,runtime,participants,base,call,install,launch,cleanup};
}

test('application control authenticates users and serves real modules on a separate origin without server source',async t=>{
 const env=await environment(t);assert.equal((await env.call('/','GET',undefined,'wrong')).status,401);await env.install();
 const directory=await(await env.call('/')).json();assert.equal(directory.plugins[0].manifest.apiVersion,2);assert.equal(directory.plugins[0].manifest.permissions,undefined);
 const launch=await env.launch(),url=new URL(launch.url);assert.notEqual(url.origin,env.base);
 const html=await(await fetch(url)).text();assert.match(html,/_runtime\/sdk.js/);assert.match(html,/type="module"/);assert.match(html,/Application/);
 assert.match(await(await fetch(new URL('./main.js',url))).text(),/webspeak.ready/);
 const root=url.origin+'/apps/'+launch.id;const context=await(await fetch(root+'/_runtime/context')).json();assert.equal(context.self.nickname,'测试参与者甲');assert.equal(context.apiVersion,2);assert.equal(context.theme,'dark');assert.equal(context.config.public,'setting');assert.equal(JSON.stringify(context).includes('private'),false);
 assert.equal((await fetch(root+'/server/main.mjs')).status,403);assert.equal((await fetch(root+'/client/missing.js')).status,404);
 assert.equal((await env.call('/apps/'+launch.id,'DELETE',undefined,'b'.repeat(43))).status,403);
 assert.equal((await env.call('/apps/'+launch.id,'DELETE')).status,200);assert.equal((await fetch(launch.url)).status,403);
});

test('arbitrary backend HTTP and bidirectional WebSocket routes receive authenticated context and no host credentials',async t=>{
 const env=await environment(t);await env.install(true);const launch=await env.launch(),origin=new URL(launch.url).origin,base=origin+'/apps/'+launch.id+'/server';
 const response=await fetch(base+'/custom/route?x=1',{method:'POST',headers:{cookie:'webspeak_admin_session=never-forward',authorization:'Bearer never-forward','x-webspeak-context':'spoofed'}});
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.route,'/custom/route?x=1');assert.equal(value.user,'测试参与者甲');assert.equal(value.cookie,null);assert.equal(value.authorization,null);assert.equal(value.configured,true);assert.equal(value.count,1);assert.equal(value.joins,1);
 const socket=new WebSocket(base.replace(/^http/,'ws')+'/custom/socket');await once(socket,'open');const reply=once(socket,'message');socket.send('author-defined-message');const [bytes]=await reply;const message=JSON.parse(String(bytes));assert.equal(message.echo,'author-defined-message');assert.equal(message.route,'/custom/socket');assert.equal(message.user,'测试参与者甲');
 const close=once(socket,'close');await env.call('/apps/'+launch.id,'DELETE');await close;
});

test('server scope is enforced from the actual participant and channel changes invalidate apps',async t=>{
 const env=await environment(t);await env.install(false,'server');assert.equal((await(await env.call('/','GET',undefined,'b'.repeat(43))).json()).plugins.length,0);
 assert.equal((await env.call('/test.runtime-app/open','POST',{target:'one.example:9987'},'b'.repeat(43))).status,403);
 const launch=await env.launch();env.participants.get('a'.repeat(43))!.channelId='3';assert.equal((await fetch(launch.url)).status,403);
});

test('instance apps retain scope across channel changes and runtime context events carry updates',async t=>{
 const env=await environment(t);await env.install();const launch=await env.launch(),base=new URL(launch.url).origin+'/apps/'+launch.id;
 const controller=new AbortController(),events=await fetch(base+'/_runtime/events',{signal:controller.signal});assert.equal(events.status,200);const reader=events.body!.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: context/);assert.match(first,/测试参与者甲/);
 env.participants.get('a'.repeat(43))!.channelId='3';const updated=await(await fetch(base+'/_runtime/context')).json();assert.equal(updated.connection.channelId,'3');assert.equal(updated.scope.key,'instance');
 controller.abort();await reader.cancel().catch(()=>undefined);
 await env.call('/apps/'+launch.id,'PATCH',{theme:'light',language:'en'});const appearance=await(await fetch(base+'/_runtime/context')).json();assert.equal(appearance.theme,'light');assert.equal(appearance.language,'en');
});

test('disable, update and disconnect revoke existing app authorities and preserve backend data',async t=>{
 const env=await environment(t),installed=await env.install(true),launch=await env.launch(),origin=new URL(launch.url).origin;
 await fetch(origin+'/apps/'+launch.id+'/server/save',{method:'POST'});
 const disabled=await env.registry.configure(installed.manifest.id,{...installed.settings,enabled:false},installed.revision);assert.equal((await fetch(launch.url)).status,403);await env.runtime.synchronize(installed.manifest.id);assert.equal(env.runtime.status(installed.manifest.id).state,'disabled');
 const enabled=await env.registry.configure(installed.manifest.id,{...disabled.settings,enabled:true},disabled.revision);await env.runtime.synchronize(enabled.manifest.id);const replacement=await env.launch();const count=await(await fetch(new URL(replacement.url).origin+'/apps/'+replacement.id+'/server/read')).json();assert.equal(count.count,1);
 env.participants.delete('a'.repeat(43));assert.equal((await fetch(replacement.url)).status,403);
 const update=await env.registry.install({...await application(true),manifest:{...(await application(true)).manifest,version:'1.1.0'}},enabled.revision);assert.equal(update.settings.enabled,false);assert.equal(update.settings.trusted,false);
});

test('public runtime origin changes use revision checks and cannot collapse into the host origin',async t=>{
 const env=await environment(t);await env.install();const settings=env.runtime.settings();await env.runtime.configureOrigin('https://plugins.example.com',settings.revision);
 await assert.rejects(env.runtime.configureOrigin('',settings.revision),/PLUGIN_CHANGED/);
 const launch=await env.launch();assert.equal(new URL(launch.url).origin,'https://plugins.example.com');
 await env.runtime.configureOrigin(env.base,env.runtime.settings().revision);assert.equal((await env.call('/test.runtime-app/open','POST',{})).status,403);
 await assert.rejects(env.runtime.configureOrigin('https://user:password@example.com',env.runtime.settings().revision));
});

test('public origins require HTTPS while loopback development permits HTTP',async t=>{const env=await environment(t);await assert.rejects(env.runtime.configureOrigin('http://apps.example.com',env.runtime.settings().revision),/PLUGIN_HTTPS_REQUIRED/);assert.equal((await env.runtime.configureOrigin('http://localhost:3042',env.runtime.settings().revision)).publicOrigin,'http://localhost:3042');});

test('open operations are idempotent, bound to one app and cancellable before and during startup',async t=>{
 const env=await environment(t);await env.install();
 const options={openId:'idempotent-operation',theme:'light',language:'en'};
 const first=await env.runtime.open('a'.repeat(43),'test.runtime-app',options,env.base),second=await env.runtime.open('a'.repeat(43),'test.runtime-app',options,env.base);assert.equal(second.id,first.id);
 const pack=await application(),other=await env.registry.install({...pack,manifest:{...pack.manifest,id:'test.other-app'}},null);await env.registry.configure(other.manifest.id,{...other.settings,scope:'instance',enabled:true,trusted:true},other.revision);
 await assert.rejects(env.runtime.open('a'.repeat(43),'test.other-app',options,env.base),/PLUGIN_OPEN_CONFLICT/);
 env.runtime.cancelOpen('a'.repeat(43),'cancelled-operation');await assert.rejects(env.runtime.open('a'.repeat(43),'test.runtime-app',{openId:'cancelled-operation'},env.base),/PLUGIN_CANCELLED/);
 const original=env.runtime.synchronize.bind(env.runtime);let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>entered=resolve),barrier=new Promise<void>(resolve=>release=resolve);
 env.runtime.synchronize=async id=>{entered();await barrier;return original(id);};
 const pending=env.runtime.open('a'.repeat(43),'test.runtime-app',{openId:'pending-operation'},env.base);await waiting;env.runtime.cancelOpen('a'.repeat(43),'pending-operation');release();await assert.rejects(pending,/PLUGIN_CANCELLED/);env.runtime.synchronize=original;
 env.runtime.cancelOpen('a'.repeat(43),options.openId);assert.equal((await fetch(first.url)).status,403);
});
import { WebSpeakDatabase } from '../../src/persistence/database.js';
import { AdminService } from '../../src/admin/admin-service.js';
import { AdminSessionStore } from '../../src/admin/admin-session.js';
import { createAdminRouter } from '../../src/admin/admin-router.js';
import { createAdminApi } from '../src/services/admin-api.js';
import { PluginStore } from '../../src/plugins/store.js';
import { createHash } from 'node:crypto';

test('v2 admin HTTP requires authentication, origin, CSRF and renewed trust; secrets remain private',async t=>{
 const env=await environment(t),database=new WebSpeakDatabase(path.join(env.directory,'admin.db')),logger=createLogger();
 env.cleanup.push(()=>database.close());
 const service=new AdminService(database,Buffer.alloc(32,7),logger,path.join(env.directory,'absent.json'),undefined,'test');await service.initialize();await service.changePassword('runtime-test-password');
 const pack=await application(true),bytes=JSON.stringify(pack),digest=createHash('sha256').update(bytes).digest('hex');
 let packageBytes=bytes;
 const store=new PluginStore(async(url)=>{
  const address=String(url);if(address.endsWith('/index.json'))return Response.json({schemaVersion:2,plugins:[{id:pack.manifest.id,repository:'https://github.com/example/app'}]});
  if(address.endsWith('/plugin.json'))return Response.json({manifest:pack.manifest,package:{ref:'fixed-commit',path:'packages/app.wplugin',sha256:digest}});
  return new Response(packageBytes);
 });
 const app=express();app.use((req,res,next)=>req.path.startsWith('/api/admin/plugins')?next():express.json()(req,res,next));
 app.use('/api/admin',createAdminRouter({service,sessions:new AdminSessionStore(),logger,getActiveSessions:()=>0,getPeakSessions:()=>0,startedAt:Date.now(),version:'test',pluginRegistry:env.registry,pluginRuntime:env.runtime,pluginStore:store}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 env.cleanup.unshift(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 let cookie='',csrf='';const api=createAdminApi({csrfToken:()=>csrf,fetch:async(url,init)=>{const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);const response=await fetch(origin+url,{...init,headers});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return response;}});
 assert.equal((await fetch(origin+'/api/admin/plugins')).status,401);
 assert.equal((await fetch(origin+'/api/admin/plugins/upload',{method:'POST',headers:{'content-type':'application/json'},body:'invalid-json'})).status,401,'bundle parsing must follow authentication');
 csrf=(await api.login('admin','runtime-test-password')).csrfToken;
 const write=(headers:Record<string,string>)=>fetch(origin+'/api/admin/plugins/upload',{method:'POST',headers:{cookie,'content-type':'application/json',...headers},body:JSON.stringify({package:pack,installedRevision:null})});
 assert.equal((await write({origin})).status,403);assert.equal((await write({origin:'https://other.example','x-csrf-token':csrf})).status,403);
 const catalog=await api.pluginStore();assert.equal(catalog.entries[0].manifest?.apiVersion,2);
 packageBytes='tampered';await assert.rejects(api.installPlugin({id:pack.manifest.id,revision:catalog.entries[0].revision,installedRevision:null}),/PLUGIN_CHECKSUM/);packageBytes=bytes;
 const installed=(await api.installPlugin({id:pack.manifest.id,revision:catalog.entries[0].revision,installedRevision:null})).plugin;assert.equal(installed.settings.trusted,false);
 await assert.rejects(api.configurePlugin(pack.manifest.id,installed.revision,{...installed.settings,enabled:true}),/PLUGIN_TRUST_REQUIRED/);
 const enabled=(await api.configurePlugin(pack.manifest.id,installed.revision,{...installed.settings,enabled:true,trusted:true,scope:'instance',serverConfigAction:'replace',serverConfig:{secret:'private-test-value'}})).plugin;
 assert.equal(enabled.runtime?.state,'running');assert.equal((await api.restartPlugin(pack.manifest.id,enabled.revision)).plugin.runtime?.state,'running');
 const list=await api.plugins();assert.equal(list.plugins[0].settings.hasServerConfig,true);assert.equal(JSON.stringify(list).includes('private-test-value'),false);
 const settings=(await api.pluginRuntime()).runtime,saved=(await api.configurePluginRuntime('https://apps.example.com',settings.revision)).runtime;assert.equal(saved.publicOrigin,'https://apps.example.com');await assert.rejects(api.configurePluginRuntime('',settings.revision),/PLUGIN_CHANGED/);
 const updated=(await api.uploadPlugin({...pack,manifest:{...pack.manifest,version:'1.1.0'}},enabled.revision)).plugin;assert.equal(updated.settings.enabled,false);assert.equal(updated.settings.trusted,false);assert.equal(updated.settings.hasServerConfig,true);
 await assert.rejects(api.removePlugin(pack.manifest.id,enabled.revision),/PLUGIN_CHANGED/);await api.removePlugin(pack.manifest.id,updated.revision);assert.equal((await api.plugins()).plugins.length,0);
});
