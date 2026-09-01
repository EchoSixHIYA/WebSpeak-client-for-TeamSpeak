import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "node_modules", "@honeybbq", "teamspeak-client");
const marker = "webspeak-directory-snapshot-v2";
const whisperMarker = "webspeak-team-whisper-v1";

const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "0.2.2") {
  throw new Error(`Unsupported @honeybbq/teamspeak-client version: ${packageJson.version}`);
}

const cjsPath = path.join(packageRoot, "dist", "index.cjs");
const mjsPath = path.join(packageRoot, "dist", "index.mjs");
const handlerCjsPath = path.join(packageRoot, "dist", "handler-CqCD93f0.cjs");
const handlerMjsPath = path.join(packageRoot, "dist", "handler-C_JhqGTd.js");
const [cjs, mjs, handlerCjs, handlerMjs] = await Promise.all([
  readFile(cjsPath, "utf8"),
  readFile(mjsPath, "utf8"),
  readFile(handlerCjsPath, "utf8"),
  readFile(handlerMjsPath, "utf8"),
]);

const patchedCjs = patchWhisperClient(patchCjs(cjs), "cjs");
const patchedMjs = patchWhisperClient(patchMjs(mjs), "mjs");
const patchedHandlerCjs = patchWhisperHandler(handlerCjs, "cjs");
const patchedHandlerMjs = patchWhisperHandler(handlerMjs, "mjs");
await Promise.all([
  writeFile(cjsPath, patchedCjs, "utf8"),
  writeFile(mjsPath, patchedMjs, "utf8"),
  writeFile(handlerCjsPath, patchedHandlerCjs, "utf8"),
  writeFile(handlerMjsPath, patchedHandlerMjs, "utf8"),
]);

function patchWhisperClient(source, format) {
  if (source.includes(whisperMarker)) return source;
  if (format === "cjs") {
    const needle = "sendVoice(e,t){this.handler.sendVoicePacket(e,t)}";
    if (!source.includes(needle)) throw new Error("Could not patch CJS SDK client whisper method");
    return source.replace(needle, `${needle}sendWhisper(e,t,n){this.handler.sendWhisperPacket(e,t,n)}`) + `/* ${whisperMarker} */`;
  }
  const needle = "\tsendVoice(e, t) {\n\t\tthis.handler.sendVoicePacket(e, t);\n\t}\n";
  if (!source.includes(needle)) throw new Error("Could not patch MJS SDK client whisper method");
  return source.replace(needle, `${needle}\tsendWhisper(e, t, n) {\n\t\tthis.handler.sendWhisperPacket(e, t, n);\n\t}\n`) + `/* ${whisperMarker} */`;
}

function patchWhisperHandler(source, format) {
  if (source.includes(whisperMarker)) return source;
  if (format === "cjs") {
    const needle = "this.#b(u)}close(){";
    if (!source.includes(needle)) throw new Error("Could not patch CJS SDK whisper packet handler");
    const method = `/* ${whisperMarker} */sendWhisperPacket(e,t,n){if(t.length>32)throw new Error(\`too many whisper targets\`);let a=this.#c[r.VoiceWhisper],o=this.#l[r.VoiceWhisper];this.#c[r.VoiceWhisper]=a+1&65535,this.#c[r.VoiceWhisper]===0&&this.#l[r.VoiceWhisper]++;let s=5+2*t.length+e.length,l=new Uint8Array(s),u=new DataView(l.buffer);u.setUint16(0,a,!1),l[2]=n,l[3]=0,l[4]=t.length;for(let n=0;n<t.length;n++)u.setUint16(5+2*n,t[n],!1);l.set(e,5+2*t.length);let c0=c({typeFlagged:r.VoiceWhisper|i.Unencrypted,id:a,clientID:this.#r,generationID:o,data:l,receivedAt:0}),d=new Uint8Array(x+b+s);d.set(this.#e.fakeSignature,0),d.set(c0,x),d.set(l,x+b),this.#b(d)}`;
    return source.replace(needle, `this.#b(u)}${method}close(){`);
  }
  const needle = "this.#b(u);\n\t}\n\tclose() {";
  if (!source.includes(needle)) throw new Error("Could not patch MJS SDK whisper packet handler");
  const method = `\t/* ${whisperMarker} */\n\tsendWhisperPacket(e, t, n) {\n\t\tif (t.length > 32) throw new Error("too many whisper targets");\n\t\tlet a = this.#c[r.VoiceWhisper], o = this.#l[r.VoiceWhisper];\n\t\tthis.#c[r.VoiceWhisper] = a + 1 & 65535;\n\t\tif (this.#c[r.VoiceWhisper] === 0) this.#l[r.VoiceWhisper]++;\n\t\tconst s = 5 + 2 * t.length + e.length, l = new Uint8Array(s), u = new DataView(l.buffer);\n\t\tu.setUint16(0, a, false);\n\t\tl[2] = n;\n\t\tl[3] = 0;\n\t\tl[4] = t.length;\n\t\tfor (let n = 0; n < t.length; n++) u.setUint16(5 + 2 * n, t[n], false);\n\t\tl.set(e, 5 + 2 * t.length);\n\t\tconst c0 = c({ typeFlagged: r.VoiceWhisper | i.Unencrypted, id: a, clientID: this.#r, generationID: o, data: l, receivedAt: 0 });\n\t\tconst d = new Uint8Array(x + b + s);\n\t\td.set(this.#e.fakeSignature, 0);\n\t\td.set(c0, x);\n\t\td.set(l, x + b);\n\t\tthis.#b(d);\n\t}\n\tclose() {`;
  return source.replace(needle, `this.#b(u);\n\t}\n${method}`);
}

function patchCjs(source) {
  if (source.includes(marker) || source.includes("webspeak-directory-snapshot")) return source;

  const helper = `/* ${marker} */
function webSpeakDirectoryBigInt(value){try{return BigInt(value??"0")}catch{return 0n}}
function webSpeakDirectoryChannel(params,decode){const id=webSpeakDirectoryBigInt(params.cid);if(id===0n)return null;return{id,parentID:webSpeakDirectoryBigInt(params.pid??params.cpid??"0"),name:decode(params.channel_name??""),description:decode(params.channel_topic??params.channel_description??"")}}
function webSpeakDirectoryClient(params,decode){const id=parseInt(params.clid??"0",10);if(!Number.isInteger(id)||id<=0)return null;const groups=params.client_servergroups??"";return{id,nickname:decode(params.client_nickname??""),uid:params.client_unique_identifier??"",channelID:webSpeakDirectoryBigInt(params.cid),type:parseInt(params.client_type??"0",10),serverGroups:groups?groups.split(","):[],away:params.client_away==="1",awayMessage:decode(params.client_away_message??""),inputMuted:params.client_input_muted==="1",outputMuted:params.client_output_muted==="1",channelCommander:params.client_is_channel_commander==="1"}}
function webSpeakDirectoryChannelNotification(name,params,decode,channels){const id=webSpeakDirectoryBigInt(params.cid);if(id===0n)return false;switch(name){case"notifychannelcreated":{const channel=webSpeakDirectoryChannel(params,decode);if(!channel)return false;channels.set(id,channel);return true}case"notifychanneledited":{const current=channels.get(id);if(!current)return false;const next={...current};if(params.channel_name!==undefined)next.name=decode(params.channel_name);if(params.channel_topic!==undefined)next.description=decode(params.channel_topic);if(params.cpid!==undefined||params.pid!==undefined)next.parentID=webSpeakDirectoryBigInt(params.cpid??params.pid);channels.set(id,next);return true}case"notifychannelmoved":{const current=channels.get(id);if(!current)return false;channels.set(id,{...current,parentID:webSpeakDirectoryBigInt(params.cpid??params.pid)});return true}case"notifychanneldeleted":return channels.delete(id);default:return false}}
`;
  source = source.replace("var K=class", `${helper}var K=class`);

  // TS6 reports a client that moved out of our current view as
  // notifyclientleftview with a non-zero ctid. Preserve that client and apply
  // the target channel; ctid=0 is the actual server leave case.
  const replacements = [
    [
      "function L(e,t,n){let r=j(e.params.clid??``),i=M(e.params.reasonid??``),a=r===t;return r!==0&&n.delete(r),{kind:`clientLeave`,event:{id:r,reasonID:i,reasonMsg:e.params.reasonmsg??``,targetID:j(e.params.targetid??``)},isSelf:a}}",
      "function L(e,t,n){let r=j(e.params.clid??``),i=M(e.params.reasonid??``),a=r===t,o=A(e.params.ctid??``),s=o!==0n;if(r!==0)if(s){let e=n.get(r);e&&n.set(r,{...e,channelID:o})}else n.delete(r);return s?{kind:`clientMoved`,event:{id:r,targetChannelID:o,reasonID:i,invokerID:j(e.params.invokerid??``),invokerName:e.params.invokername??``,invokerUID:e.params.invokeruid??``}}:{kind:`clientLeave`,event:{id:r,reasonID:i,reasonMsg:e.params.reasonmsg??``,targetID:j(e.params.targetid??``)},isSelf:a}}",
    ],
    [
      "var K=class{crypt;handler;logger;nickname;clid=0;#e;#t;#n;#r;#i=e.t.Disconnected;#a=new W;#o=new d;#s=new m;#c=new Map;#l=[];#u=[];#d=[];#f=[];#p=[];#m=[];#h=[];#g=[];#_=[];#v=[];#y=[];#b=[];#x;#S;constructor",
      "var K=class{crypt;handler;logger;nickname;clid=0;#e;#t;#n;#r;#i=e.t.Disconnected;#a=new W;#o=new d;#s=new m;#c=new Map;#q=new Map;#R=[];#L=!1;#l=[];#u=[];#d=[];#f=[];#p=[];#m=[];#h=[];#g=[];#_=[];#v=[];#y=[];#b=[];#x;#S;constructor",
    ],
    [
      "case`voiceData`:this.#h.push(t);break;case`connected`:",
      "case`voiceData`:this.#h.push(t);break;case`directorySnapshot`:this.#R.push(t);break;case`connected`:",
    ],
    [
      "this.#o.reset(),this.#s.reset(),this.#c.clear(),this.clid=0",
      "this.#o.reset(),this.#s.reset(),this.#q.clear(),this.#c.clear(),this.#L=!1,this.clid=0",
    ],
    [
      "case`initserver`:w(this,t.params);break;case`error`:this.#A(t.params);break;default:{",
      "case`initserver`:w(this,t.params);break;case`channellist`:{let e=webSpeakDirectoryChannel(t.params,a.i);e&&this.#q.set(e.id,e),this.#Y();break}case`channelclientlist`:{let e=webSpeakDirectoryClient(t.params,a.i);e&&this.#c.set(e.id,e),this.#Y();break}case`error`:this.#A(t.params);break;default:{",
    ],
    [
      "if(t.name.startsWith(`notify`)){let e=F(t,this.clid,this.#c,this.nickname);this.#j(e,t.params);return}",
      "if(t.name.startsWith(`notify`)){let e=webSpeakDirectoryChannelNotification(t.name,t.params,a.i,this.#q),n=F(t,this.clid,this.#c,this.nickname);this.#j(n,t.params),e&&this.#Y();return}",
    ],
    [
      "case`clientEnter`:{let t=e.info;t.id!==0&&N(this.nickname,t.nickname)&&(this.clid=t.id,this.handler.setClientID(t.id),this.#o.signalWelcomeComplete()),this.#M(`clientEnter`,t);break}",
      "case`clientEnter`:{let t=e.info,r=webSpeakDirectoryBigInt(arguments[1]?.cid??arguments[1]?.ctid??\"0\");r!==0n&&(t={...t,channelID:r},this.#c.set(t.id,t));let n=this.#c.get(t.id);n&&t.channelID===0n&&n.channelID!==0n&&(t={...t,channelID:n.channelID},this.#c.set(t.id,t));let i=t.id!==0&&N(this.nickname,t.nickname);i&&(this.clid=t.id,this.handler.setClientID(t.id),this.#o.signalWelcomeComplete(),this.#Y()),this.#M(`clientEnter`,t),!i&&this.#i===2&&this.#Y();break}",
    ],
    [
      "case`clientLeave`:if(this.#M(`clientLeave`,e.event),e.isSelf&&(e.event.reasonID===4||e.event.reasonID===5)){let t=e.event.reasonMsg;for(let e of this.#v)setImmediate(()=>e(t))}break;case`clientMoved`:this.#M(`clientMoved`,e.event);break;",
      "case`clientLeave`:if(this.#M(`clientLeave`,e.event),this.#i===2&&this.#Y(),e.isSelf&&(e.event.reasonID===4||e.event.reasonID===5)){let t=e.event.reasonMsg;for(let e of this.#v)setImmediate(()=>e(t))}break;case`clientMoved`:this.#M(`clientMoved`,e.event),this.#i===2&&this.#Y();break;",
    ],
    [
      "#M(e,t){this.#S(t)}#N(e,t){",
      "#Y(){if(this.#L)return;this.#L=!0,setImmediate(()=>{this.#L=!1;const e={channels:Array.from(this.#q.values()).map(e=>({...e})),clients:Array.from(this.#c.values()).map(e=>({...e,serverGroups:[...(e.serverGroups??[])]}))};for(const t of this.#R)setImmediate(()=>t(e))})}#M(e,t){this.#S(t)}#N(e,t){",
    ],
  ];

  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`Could not patch CJS SDK segment: ${before.slice(0, 80)}`);
    source = source.replace(before, after);
  }
  return source;
}

function patchMjs(source) {
  if (source.includes(marker) || source.includes("webspeak-directory-snapshot")) return source;

  const helper = `/* ${marker} */
function webSpeakDirectoryBigInt(value){try{return BigInt(value??"0")}catch{return 0n}}
function webSpeakDirectoryChannel(params,decode){const id=webSpeakDirectoryBigInt(params.cid);if(id===0n)return null;return{id,parentID:webSpeakDirectoryBigInt(params.pid??params.cpid??"0"),name:decode(params.channel_name??""),description:decode(params.channel_topic??params.channel_description??"")}}
function webSpeakDirectoryClient(params,decode){const id=parseInt(params.clid??"0",10);if(!Number.isInteger(id)||id<=0)return null;const groups=params.client_servergroups??"";return{id,nickname:decode(params.client_nickname??""),uid:params.client_unique_identifier??"",channelID:webSpeakDirectoryBigInt(params.cid),type:parseInt(params.client_type??"0",10),serverGroups:groups?groups.split(","):[],away:params.client_away==="1",awayMessage:decode(params.client_away_message??""),inputMuted:params.client_input_muted==="1",outputMuted:params.client_output_muted==="1",channelCommander:params.client_is_channel_commander==="1"}}
function webSpeakDirectoryChannelNotification(name,params,decode,channels){const id=webSpeakDirectoryBigInt(params.cid);if(id===0n)return false;switch(name){case"notifychannelcreated":{const channel=webSpeakDirectoryChannel(params,decode);if(!channel)return false;channels.set(id,channel);return true}case"notifychanneledited":{const current=channels.get(id);if(!current)return false;const next={...current};if(params.channel_name!==undefined)next.name=decode(params.channel_name);if(params.channel_topic!==undefined)next.description=decode(params.channel_topic);if(params.cpid!==undefined||params.pid!==undefined)next.parentID=webSpeakDirectoryBigInt(params.cpid??params.pid);channels.set(id,next);return true}case"notifychannelmoved":{const current=channels.get(id);if(!current)return false;channels.set(id,{...current,parentID:webSpeakDirectoryBigInt(params.cpid??params.pid)});return true}case"notifychanneldeleted":return channels.delete(id);default:return false}}
`;
  source = source.replace("var k = class", `${helper}var k = class`);

  // Keep the readable ESM build behavior identical to the minified CJS build.
  const replacements = [
    [
      "function ie(e, t, n) {\n\tlet r = Y(e.params.clid ?? \"\"), i = X(e.params.reasonid ?? \"\"), a = r === t;\n\treturn r !== 0 && n.delete(r), {\n\t\tkind: \"clientLeave\",\n\t\tevent: {\n\t\t\tid: r,\n\t\t\treasonID: i,\n\t\t\treasonMsg: e.params.reasonmsg ?? \"\",\n\t\t\ttargetID: Y(e.params.targetid ?? \"\")\n\t\t},\n\t\tisSelf: a\n\t};\n}",
      "function ie(e, t, n) {\n\tlet r = Y(e.params.clid ?? \"\"), i = X(e.params.reasonid ?? \"\"), a = r === t, targetChannelID = J(e.params.ctid ?? \"\"), moved = targetChannelID !== 0n;\n\tif (r !== 0) {\n\t\tif (moved) {\n\t\t\tconst current = n.get(r);\n\t\t\tif (current) n.set(r, { ...current, channelID: targetChannelID });\n\t\t} else {\n\t\t\tn.delete(r);\n\t\t}\n\t}\n\treturn moved ? {\n\t\tkind: \"clientMoved\",\n\t\tevent: {\n\t\t\tid: r,\n\t\t\ttargetChannelID,\n\t\t\treasonID: i,\n\t\t\tinvokerID: Y(e.params.invokerid ?? \"\"),\n\t\t\tinvokerName: e.params.invokername ?? \"\",\n\t\t\tinvokerUID: e.params.invokeruid ?? \"\"\n\t\t}\n\t} : {\n\t\tkind: \"clientLeave\",\n\t\tevent: {\n\t\t\tid: r,\n\t\t\treasonID: i,\n\t\t\treasonMsg: e.params.reasonmsg ?? \"\",\n\t\t\ttargetID: Y(e.params.targetid ?? \"\")\n\t\t},\n\t\tisSelf: a\n\t};\n}",
    ],
    [
      "\t#c = /* @__PURE__ */ new Map();\n\t#l = [];",
      "\t#c = /* @__PURE__ */ new Map();\n\t#q = /* @__PURE__ */ new Map();\n\t#R = [];\n\t#L = false;\n\t#l = [];",
    ],
    [
      "\t\t\tcase \"voiceData\":\n\t\t\t\tthis.#h.push(t);\n\t\t\t\tbreak;\n\t\t\tcase \"connected\":",
      "\t\t\tcase \"voiceData\":\n\t\t\t\tthis.#h.push(t);\n\t\t\t\tbreak;\n\t\t\tcase \"directorySnapshot\":\n\t\t\t\tthis.#R.push(t);\n\t\t\t\tbreak;\n\t\t\tcase \"connected\":",
    ],
    [
      "this.#o.reset(), this.#s.reset(), this.#c.clear(), this.clid = 0",
      "this.#o.reset(), this.#s.reset(), this.#q.clear(), this.#c.clear(), this.#L = false, this.clid = 0",
    ],
    [
      "\t\t\t\tcase \"initserver\":\n\t\t\t\t\tH(this, t.params);\n\t\t\t\t\tbreak;\n\t\t\t\tcase \"error\":",
      "\t\t\t\tcase \"initserver\":\n\t\t\t\t\tH(this, t.params);\n\t\t\t\t\tbreak;\n\t\t\t\tcase \"channellist\": {\n\t\t\t\t\tconst e = webSpeakDirectoryChannel(t.params, S);\n\t\t\t\t\tif (e) this.#q.set(e.id, e);\n\t\t\t\t\tthis.#Y();\n\t\t\t\t\tbreak;\n\t\t\t\t}\n\t\t\t\tcase \"channelclientlist\": {\n\t\t\t\t\tconst e = webSpeakDirectoryClient(t.params, S);\n\t\t\t\t\tif (e) this.#c.set(e.id, e);\n\t\t\t\t\tthis.#Y();\n\t\t\t\t\tbreak;\n\t\t\t\t}\n\t\t\t\tcase \"error\":",
    ],
    [
      "\t\t\tif (t.name.startsWith(\"notify\")) {\n\t\t\t\tlet e = ne(t, this.clid, this.#c, this.nickname);\n\t\t\t\tthis.#j(e, t.params);\n\t\t\t\treturn;\n\t\t\t}",
      "\t\t\tif (t.name.startsWith(\"notify\")) {\n\t\t\t\tconst directoryChanged = webSpeakDirectoryChannelNotification(t.name, t.params, S, this.#q);\n\t\t\t\tlet e = ne(t, this.clid, this.#c, this.nickname);\n\t\t\t\tthis.#j(e, t.params);\n\t\t\t\tif (directoryChanged) this.#Y();\n\t\t\t\treturn;\n\t\t\t}",
    ],
    [
      "\t\t\tcase \"clientEnter\": {\n\t\t\t\tlet t = e.info;\n\t\t\t\tt.id !== 0 && Z(this.nickname, t.nickname) && (this.clid = t.id, this.handler.setClientID(t.id), this.#o.signalWelcomeComplete()), this.#M(\"clientEnter\", t);\n\t\t\t\tbreak;\n\t\t\t}",
      "\t\t\tcase \"clientEnter\": {\n\t\t\t\tlet t = e.info;\n\t\t\t\tconst rawChannelID = webSpeakDirectoryBigInt(arguments[1]?.cid ?? arguments[1]?.ctid ?? \"0\");\n\t\t\t\tif (rawChannelID !== 0n) {\n\t\t\t\t\tt = { ...t, channelID: rawChannelID };\n\t\t\t\t\tthis.#c.set(t.id, t);\n\t\t\t\t}\n\t\t\t\tconst cached = this.#c.get(t.id);\n\t\t\t\tif (cached && t.channelID === 0n && cached.channelID !== 0n) {\n\t\t\t\t\tt = { ...t, channelID: cached.channelID };\n\t\t\t\t\tthis.#c.set(t.id, t);\n\t\t\t\t}\n\t\t\t\tconst own = t.id !== 0 && Z(this.nickname, t.nickname);\n\t\t\t\tif (own) {\n\t\t\t\t\tthis.clid = t.id;\n\t\t\t\t\tthis.handler.setClientID(t.id);\n\t\t\t\t\tthis.#o.signalWelcomeComplete();\n\t\t\t\t\tthis.#Y();\n\t\t\t\t}\n\t\t\t\tthis.#M(\"clientEnter\", t);\n\t\t\t\tif (!own && this.#i === n.Connected) this.#Y();\n\t\t\t\tbreak;\n\t\t\t}",
    ],
    [
      "\t\t\tcase \"clientLeave\":\n\t\t\t\tif (this.#M(\"clientLeave\", e.event), e.isSelf && (e.event.reasonID === 4 || e.event.reasonID === 5)) {",
      "\t\t\tcase \"clientLeave\":\n\t\t\t\tif (this.#M(\"clientLeave\", e.event), this.#i === n.Connected && this.#Y(), e.isSelf && (e.event.reasonID === 4 || e.event.reasonID === 5)) {",
    ],
    [
      "\t\t\tcase \"clientMoved\":\n\t\t\t\tthis.#M(\"clientMoved\", e.event);\n\t\t\t\tbreak;",
      "\t\t\tcase \"clientMoved\":\n\t\t\t\tthis.#M(\"clientMoved\", e.event);\n\t\t\t\tif (this.#i === n.Connected) this.#Y();\n\t\t\t\tbreak;",
    ],
    [
      "\t#M(e, t) {\n\t\tthis.#S(t);\n\t}\n\t#N(e, t) {",
      "\t#Y() {\n\t\tif (this.#L) return;\n\t\tthis.#L = true;\n\t\tsetImmediate(() => {\n\t\t\tthis.#L = false;\n\t\t\tconst e = {\n\t\t\t\tchannels: Array.from(this.#q.values()).map((item) => ({ ...item })),\n\t\t\t\tclients: Array.from(this.#c.values()).map((item) => ({ ...item, serverGroups: [...(item.serverGroups ?? [])] })),\n\t\t\t};\n\t\t\tfor (const handler of this.#R) setImmediate(() => handler(e));\n\t\t});\n\t}\n\t#M(e, t) {\n\t\tthis.#S(t);\n\t}\n\t#N(e, t) {",
    ],
  ];

  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`Could not patch MJS SDK segment: ${before.slice(0, 80)}`);
    source = source.replace(before, after);
  }
  return source;
}
