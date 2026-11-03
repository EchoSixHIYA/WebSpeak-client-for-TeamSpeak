import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginRegistry } from './registry.js';
import { PluginProcess } from './process.js';
import { parsePluginPackage, parsePluginJson, pluginPath, pluginFileBytes, type PluginPackage, type PluginAppContext } from '../shared/plugins.js';
import { createLogger } from '../logger.js';

export const fixturePackage = (server?:string):PluginPackage => parsePluginPackage({manifest:{apiVersion:2,id:'test.application',name:'Application',version:'1.0.0',author:'Tests',license:'MIT',description:'Independent application fixture',scopes:['server','instance'],client:{entry:'client/index.html'},...(server?{server:{entry:'server/main.mjs'}}:{})},files:{'client/index.html':{encoding:'utf8',data:'<!doctype html><html><head></head><body><script type="module" src="./app.js"></script></body></html>'},'client/app.js':{encoding:'utf8',data:'document.body.dataset.ready="yes"'},...(server?{'server/main.mjs':{encoding:'utf8',data:server}}:{})}});
async function registry(t:test.TestContext){const directory=await mkdtemp(path.join(tmpdir(),'webspeak-app-v2-'));const cleanup:Array<()=>Promise<unknown>>=[];t.after(async()=>{for(const dispose of cleanup)await dispose();assert.equal(path.dirname(directory),tmpdir());await rm(directory,{recursive:true,force:true});});const value=new PluginRegistry(directory,Buffer.alloc(32,7));await value.initialize();return {value,directory,cleanup};}

test('v2 accepts ordinary application assets and rejects the obsolete room protocol',()=>{
 const pack=fixturePackage();assert.equal(pack.manifest.apiVersion,2);assert.ok(pack.files['client/app.js']);
 assert.throws(()=>parsePluginPackage({manifest:{...pack.manifest,apiVersion:1},html:'x',script:'x',styles:{light:'x',dark:'x'}}),/PLUGIN_API_UNSUPPORTED/);
 assert.throws(()=>parsePluginPackage({...pack,manifest:{...pack.manifest,permissions:['room.read']}}),/PLUGIN_API_UNSUPPORTED/);
 const binary=parsePluginPackage({...pack,files:{...pack.files,'client/asset.bin':{encoding:'base64',data:'AAEC/w=='}}});assert.deepEqual([...pluginFileBytes(binary.files['client/asset.bin'])],[0,1,2,255]);
 assert.throws(()=>parsePluginPackage({...pack,files:{...pack.files,'client/asset.bin':{encoding:'base64',data:'!notbase64'}}}));
});
test('package paths reject traversal, Windows special names, case collisions and file-directory aliases',()=>{
 for(const name of ['../a','client/../a','client/a\\b','client/CON.txt','client/aux','client/a.','/client/a'])assert.equal(pluginPath(name),false,name);
 const pack=fixturePackage();
 for(const files of [{...pack.files,'client/APP.js':{encoding:'utf8',data:'x'}},{...pack.files,'client/folder':{encoding:'utf8',data:'x'},'client/folder/file.js':{encoding:'utf8',data:'x'}}])assert.throws(()=>parsePluginPackage({...pack,files}));
 assert.throws(()=>parsePluginJson(JSON.parse('{"__proto__":{"value":1}}')));assert.throws(()=>parsePluginJson({n:Infinity}));
});
test('install and update require explicit trust, encrypt private config and preserve CAS/persistence',async t=>{
 const {value:r,directory}=await registry(t),pack=fixturePackage();const first=await r.install(pack,null);
 assert.equal(first.settings.enabled,false);assert.equal(first.settings.trusted,false);
 await assert.rejects(r.configure(pack.manifest.id,{enabled:true,trusted:false,scope:'instance',targets:[],config:{}},first.revision),/PLUGIN_TRUST_REQUIRED/);
 const enabled=await r.configure(pack.manifest.id,{enabled:true,trusted:true,scope:'server',targets:['EXAMPLE.com#9987'],config:{public:'value'},serverConfigAction:'replace',serverConfig:{secret:'private-fixture-value'}},first.revision);
 assert.deepEqual(enabled.settings.targets,['example.com:9987']);assert.equal(enabled.settings.hasServerConfig,true);assert.equal(JSON.stringify(enabled).includes('private-fixture-value'),false);
 const record=await readFile(path.join(directory,'installed',pack.manifest.id+'.json'),'utf8');assert.equal(record.includes('private-fixture-value'),false);assert.deepEqual(r.serverConfig(pack.manifest.id),{secret:'private-fixture-value'});
 await assert.rejects(r.configure(pack.manifest.id,enabled.settings,first.revision),/PLUGIN_CHANGED/);
 const reloaded=new PluginRegistry(directory,Buffer.alloc(32,7));await reloaded.initialize();assert.deepEqual(reloaded.list(),r.list());assert.deepEqual(reloaded.serverConfig(pack.manifest.id),{secret:'private-fixture-value'});
 const update=await r.install({...pack,manifest:{...pack.manifest,version:'1.1.0'}},enabled.revision);assert.equal(update.settings.enabled,false);assert.equal(update.settings.trusted,false);assert.equal(update.settings.hasServerConfig,true);
 const cleared=await r.configure(pack.manifest.id,{...update.settings,serverConfigAction:'remove'},update.revision);assert.equal(cleared.settings.hasServerConfig,false);
 await r.remove(pack.manifest.id,cleared.revision);assert.equal(r.list().length,0);
});
test('materialized applications contain their own files and package integrity is checked',async t=>{
 const {value:r}=await registry(t),pack=fixturePackage();const installed=await r.install(pack,null);const directory=await r.materialize(pack.manifest.id,installed.revision);
 assert.match(await readFile(path.join(directory,'client/index.html'),'utf8'),/type="module"/);
 await assert.rejects(r.releaseCode(path.resolve(directory,'../../../../unrelated')),/PLUGIN_INVALID/);
 await r.releaseCode(directory);await assert.rejects(readFile(path.join(directory,'client/index.html')));
});

test('a backend runs native Node filesystem and arbitrary HTTP handlers in an independent process',async t=>{
 const {value:r,cleanup}=await registry(t);
 const source=`import {writeFile,readFile} from 'node:fs/promises';import path from 'node:path';export default async ({dataDir,config})=>{let count=Number(await readFile(path.join(dataDir,'counter.txt'),'utf8').catch(()=>0));return {handle:async(req,res)=>{count++;await writeFile(path.join(dataDir,'counter.txt'),String(count));res.setHeader('content-type','application/json');res.end(JSON.stringify({path:req.url,user:req.webspeak.self.id,configured:config.secret==='private',count,pid:process.pid}));}};};`;
 const pack=fixturePackage(source),installed=await r.install(pack,null),code=await r.materialize(pack.manifest.id,installed.revision),data=await r.dataDirectory(pack.manifest.id);
 const processes:PluginProcess[]=[];cleanup.push(async()=>{await Promise.all(processes.map(p=>p.close()));});
 const run=()=>{const child=new PluginProcess({entry:path.join(code,'server/main.mjs'),codeDirectory:code,dataDirectory:data,config:{secret:'private'},publicConfig:{},logger:createLogger(),onExit:()=>{}});processes.push(child);return child;};
 const child=run();await child.ready;assert.ok(child.child.pid&&child.child.pid!==process.pid);
 const context={apiVersion:2,self:{id:'participant-a'},scope:{key:'instance'}} as PluginAppContext;
 const request=()=>fetch(`http://127.0.0.1:${child.port}/author-defined/path`,{headers:{'x-webspeak-runtime':child.token,'x-webspeak-context':Buffer.from(JSON.stringify(context),'utf8').toString('base64url')}});
 assert.equal((await fetch(`http://127.0.0.1:${child.port}/author-defined/path`)).status,403);
 const value=await(await request()).json();assert.equal(value.path,'/author-defined/path');assert.equal(value.user,'participant-a');assert.equal(value.configured,true);assert.equal(value.count,1);
 await child.close();const replacement=run();await replacement.ready;
 const next=await fetch(`http://127.0.0.1:${replacement.port}/another-route`,{headers:{'x-webspeak-runtime':replacement.token,'x-webspeak-context':Buffer.from(JSON.stringify(context),'utf8').toString('base64url')}});assert.equal((await next.json()).count,2);
});
test('a failed or hung plugin activation is bounded and does not execute in the gateway process',async t=>{
 const {value:r,cleanup}=await registry(t),pack=fixturePackage('export default async()=>new Promise(()=>{});'),installed=await r.install(pack,null),code=await r.materialize(pack.manifest.id,installed.revision);
 const child=new PluginProcess({entry:path.join(code,'server/main.mjs'),codeDirectory:code,dataDirectory:await r.dataDirectory(pack.manifest.id),config:{},publicConfig:{},logger:createLogger(),onExit:()=>{},startupMs:1000});
 cleanup.push(()=>child.close());await assert.rejects(child.ready,/PLUGIN_START_TIMEOUT/);await child.close();assert.notEqual(child.child.exitCode,null);
});
