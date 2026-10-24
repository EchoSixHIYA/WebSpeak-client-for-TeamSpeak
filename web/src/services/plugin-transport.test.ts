import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginTransport } from './plugin-transport.js';

test('plugin requests correlate replies, reset pending work and release subscribers independently',async () => {
  const sent:any[]=[];const socket={readyState:1,send:(v:string)=>sent.push(JSON.parse(v))} as unknown as WebSocket;
  const transport=createPluginTransport(()=>socket,()=>true);
  const result=transport.request('list');assert.equal(sent[0].type,'pluginRequest');
  transport.receive({type:'pluginReply',requestId:sent[0].requestId,ok:true,result:[{id:'a'}]});
  assert.deepEqual(await result,[{id:'a'}]);
  const events:any[]=[];const off=transport.subscribe(m=>events.push(m));
  transport.receive({type:'pluginEvent',pluginId:'a',snapshot:null});assert.equal(events.length,1);
  const pending=transport.request('open',{pluginId:'a'});transport.reset();await assert.rejects(pending,/PLUGIN_NOT_CONNECTED/);
  transport.receive({type:'pluginReply',requestId:sent[1].requestId,ok:true,result:{old:true}});assert.equal(events.at(-1).type,'pluginReset');
  off();transport.reset();assert.equal(events.length,2);
});
test('server errors, disconnected sockets and request quotas do not leak promises',async () => {
  const sent:any[]=[];let connected=false;const socket={readyState:1,send:(v:string)=>sent.push(JSON.parse(v))} as unknown as WebSocket;
  const transport=createPluginTransport(()=>socket,()=>connected);
  await assert.rejects(transport.request('list'),/PLUGIN_NOT_CONNECTED/);connected=true;
  const failed=transport.request('snapshot',{pluginId:'a'});
  transport.receive({type:'pluginReply',requestId:sent[0].requestId,ok:false,code:'PLUGIN_NOT_OPEN'});await assert.rejects(failed,/PLUGIN_NOT_OPEN/);
  const pending=Array.from({length:16},()=>transport.request('list').catch(e=>e.message));
  await assert.rejects(transport.request('list'),/PLUGIN_RATE_LIMITED/);transport.reset();
  assert.ok((await Promise.all(pending)).every(v=>v==='PLUGIN_NOT_CONNECTED'));
});
