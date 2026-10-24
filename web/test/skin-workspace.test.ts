import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { parseSkinWorkspacePolicy } from "../../src/shared/skin-workspace.js";
import { parseSkinPluginDocument, parseSkinPluginRuntimeAction } from "../../src/shared/skin-plugin.js";
import { importSkinPack } from "../src/services/skin-pack.js";
import { validateSkinArchive } from "../../src/admin/skin-registry.js";
const base = {schemaVersion:3,packageType:'open-skin',id:'sample.workspace',name:'Workspace',version:'1.0.0',author:'Fixture',license:'MIT',minAppVersion:'0.2.8',entry:'skin.css'};
const archive = (workspace:unknown,schemaVersion=3) => zipSync({'manifest.json':strToU8(JSON.stringify({...base,schemaVersion,...(schemaVersion===1?{packageType:undefined}:{}),workspace})), 'skin.css':strToU8(':root { --skin-sample-color: #123456; }')});
test('the same workspace policy is preserved by browser and server importers',async()=>{
 const bytes=archive({apiVersion:1,mode:'persistent'});
 const browser=await importSkinPack(new File([bytes.buffer as ArrayBuffer],'workspace.wskin'));
 const server=validateSkinArchive(Buffer.from(bytes));
 assert.deepEqual(browser.workspace,{apiVersion:1,mode:'persistent'});
 assert.deepEqual(server.manifest.workspace,browser.workspace);
});
test('unknown workspace versions, extra fields, executable values and legacy manifests are rejected by both importers',async()=>{
 for(const value of [null,true,'persistent',{apiVersion:2,mode:'persistent'},{apiVersion:1,mode:'automatic'},{apiVersion:1,mode:'persistent',autoConnect:true}]){
  const bytes=archive(value);
  await assert.rejects(importSkinPack(new File([bytes.buffer as ArrayBuffer],'bad.wskin')));
  assert.throws(()=>validateSkinArchive(Buffer.from(bytes)));
 }
 const legacy=archive({apiVersion:1,mode:'persistent'},1);
 await assert.rejects(importSkinPack(new File([legacy.buffer as ArrayBuffer],'legacy.wskin')));
 assert.throws(()=>validateSkinArchive(Buffer.from(legacy)));
 assert.equal(parseSkinWorkspacePolicy(undefined,1),undefined);
});
test('connecting uses an explicit dedicated permission and accepts no target or credential arguments',()=>{
 const component={id:'connect-ui',name:'Connection',accessibleName:'Connection',page:'voice',permissions:['session.status.read','voice.connect'],actions:{connect:{type:'voice.connect',args:{}}},root:{widget:'voice.connection-status'}};
 assert.doesNotThrow(()=>parseSkinPluginDocument({schemaVersion:3,components:[component]}));
 assert.throws(()=>parseSkinPluginDocument({schemaVersion:3,components:[{...component,permissions:['session.status.read']}]}));
 const action = parseSkinPluginRuntimeAction({type:'voice.connect',args:{}},['voice.connect']);
 assert.equal(action.type, 'voice.connect');
 assert.deepEqual(Object.keys(action.args), []);
 assert.throws(()=>parseSkinPluginRuntimeAction({type:'voice.connect',args:{target:'127.0.0.1'}},['voice.connect']));
 assert.throws(()=>parseSkinPluginRuntimeAction({type:'voice.connect',args:{}},[]));
});
