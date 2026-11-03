import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginAppClient } from './plugin-app-client.js';
const token='a'.repeat(43),id='b'.repeat(43);
const manifest={apiVersion:2,id:'test.app',name:'Test',version:'1.0.0',author:'Test',license:'MIT',description:'App',scopes:['instance'],client:{entry:'client/index.html'}};
test('plugin control uses the connected gateway origin and never sends its voice query or cookies',async()=>{
 const seen:Array<{url:string;init:RequestInit|undefined}>=[];
 const client=createPluginAppClient('wss://relay.example/voice?credential=private',token,async(url,init)=>{seen.push({url:String(url),init});return Response.json({plugins:[{manifest,scope:'instance',runtime:{state:'client'}}]});});
 assert.equal((await client.list())[0].manifest.id,'test.app');assert.equal(seen[0].url,'https://relay.example/api/plugins');assert.equal(seen[0].init?.credentials,'omit');assert.equal(new Headers(seen[0].init?.headers).get('authorization'),'Bearer '+token);
 assert.throws(()=>createPluginAppClient('https://x','invalid'));assert.throws(()=>createPluginAppClient('https://user:secret@example.com',token));
});
test('launch validation rejects mismatched IDs, unsafe URLs and invalid runtime responses',async()=>{
 for(const value of [{id,url:`https://apps.example/apps/${id}/client/index.html`,manifest:{...manifest,id:'another.app'}},{id,url:`https://user:secret@apps.example/apps/${id}/client/index.html`,manifest},{id,url:'javascript:alert(1)',manifest},{id,url:`https://apps.example/apps/${id}/client/index.html?ticket=x`,manifest}]){
  const client=createPluginAppClient('http://localhost:3040',token,async()=>Response.json(value));await assert.rejects(client.open('test.app',{openId:'operation-123',theme:'light',language:'en'}));
 }
 const client=createPluginAppClient('http://localhost:3040',token,async()=>Response.json({plugins:[{manifest,scope:'anything',runtime:{state:'unknown'}}]}));await assert.rejects(client.list());
});
test('control requests time out through response body parsing and support caller cancellation',async()=>{
 const slow:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))));
 const client=createPluginAppClient('http://localhost:3040',token,slow,15);await assert.rejects(client.list(),/PLUGIN_TIMEOUT/);
 const controller=new AbortController(),request=client.list(controller.signal);controller.abort();await assert.rejects(request,/PLUGIN_REQUEST_CANCELLED/);
 const body:typeof fetch=async(_url,init)=>({ok:true,json:()=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))))}) as Response;
 await assert.rejects(createPluginAppClient('http://localhost:3040',token,body,15).list(),/PLUGIN_TIMEOUT/);
});
test('pending open cancellation remains a separate operation and status errors are bounded codes',async()=>{
 const requests:string[]=[];const client=createPluginAppClient('http://localhost:3040',token,async(url,init)=>{requests.push(`${init?.method} ${url}`);return Response.json({ok:true});});
 await client.cancelOpen('operation-123');assert.match(requests[0],/^DELETE .*\/opening\/operation-123$/);
 await assert.rejects(createPluginAppClient('http://localhost:3040',token,async()=>Response.json({code:'<secret error body>'},{status:500})).list(),/PLUGIN_RUNTIME_FAILED/);
});
