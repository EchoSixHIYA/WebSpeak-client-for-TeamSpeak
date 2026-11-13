import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer, type ServerOptions } from "node:https";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import type { Socket } from "node:net";
import type { Logger } from "../logger.js";
import { PluginRegistry } from "./registry.js";
import { PluginProcess } from "./process.js";
import { PluginError, pluginAssert, pluginPath, pluginRecord, type InstalledPlugin, type PluginAppContext, type PluginAppLaunch, type PluginParticipant, type PluginRequestContext, type PluginRuntimeStatus } from "../shared/plugins.js";

interface ApplicationEntry { policy: InstalledPlugin; directory: string; assets: Set<string>; process?: PluginProcess; status: PluginRuntimeStatus; stale: boolean }
interface AppSession {
  id: string; publicId: string; participantId: string; openKey: string; pluginId: string; revision: string; voiceToken: string; scopeKey: string;
  theme: "light" | "dark"; language: PluginAppContext["language"]; origin: string; lastActivity: number; lastContext: string;
  streams: Set<ServerResponse>; connections: Set<() => void>;
}
interface RuntimeOptions {
  registry: PluginRegistry; participant(token: string): PluginParticipant | null; logger: Logger;
  port?: number; host?: string; publicOrigin?: string; tls?: ServerOptions; maxWorkers?: number;
}
const contentTypes: Record<string, string> = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".gif":"image/gif", ".ico":"image/x-icon", ".woff":"font/woff", ".woff2":"font/woff2", ".wasm":"application/wasm", ".mp4":"video/mp4", ".webm":"video/webm" };

/** App traffic uses its own HTTP origin and child processes, never the voice WebSocket. */
export class PluginRuntime {
  private readonly entries = new Map<string, ApplicationEntry>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sessions = new Map<string, AppSession>();
  private readonly openings = new Map<string, {cancelled:boolean; expires:number; appId?:string}>();
  private readonly server: Server | ReturnType<typeof createHttpsServer>;
  private readonly sockets = new Set<Socket>();
  private timer?: ReturnType<typeof setInterval>;
  private origin = "";
  private listening = false;
  private closed = false;
  private configQueue: Promise<unknown> = Promise.resolve();
  private readonly changed = (id: string) => {
    this.revokePlugin(id, "PLUGIN_CHANGED");
    const entry = this.entries.get(id); if (entry) { entry.stale = true; void entry.process?.close(); }
    void this.synchronize(id).catch(() => undefined);
  };
  constructor(private readonly options: RuntimeOptions) {
    this.server = options.tls ? createHttpsServer(options.tls, (req,res) => void this.handle(req,res)) : createServer((req,res) => void this.handle(req,res));
    this.server.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); });
    this.server.on("upgrade", (req,socket,head) => void this.upgrade(req,socket as Socket,head));
    options.registry.listeners.add(this.changed);
  }
  get port(): number { const address=this.server.address(); return address&&typeof address!=="string"?address.port:0; }
  settings() { return { publicOrigin:this.origin, port:this.port, available:this.listening, revision:createHash("sha256").update(this.origin).digest("hex") }; }
  async configureOrigin(input: unknown, revision: unknown): Promise<ReturnType<PluginRuntime["settings"]>> {
    const next=this.configQueue.then(async()=>{
      pluginAssert(typeof input==="string"&&input.length<=300&&typeof revision==="string");
      pluginAssert(revision===this.settings().revision,"PLUGIN_CHANGED");
      const origin=normalizeOrigin(input);
      const directory=this.options.registry.directory, temporary=path.join(directory,`.runtime-${randomUUID()}.tmp`);
      await writeFile(temporary,JSON.stringify({publicOrigin:origin}),{flag:"wx",mode:0o600}); await rename(temporary,path.join(directory,"runtime.json"));
      this.origin=origin;for(const app of [...this.sessions.values()])this.closeApp(app.id,"PLUGIN_CHANGED");return this.settings();
    });this.configQueue=next.catch(()=>undefined);return next;
  }
  async start(): Promise<void> {
    try { const value=JSON.parse(await readFile(path.join(this.options.registry.directory,"runtime.json"),"utf8"));this.origin=normalizeOrigin(value.publicOrigin); }
    catch { this.origin=normalizeOrigin(this.options.publicOrigin??""); }
    await new Promise<void>((resolve,reject)=>{
      const failed=(error:Error)=>{this.server.off("listening",ready);reject(error);};
      const ready=()=>{this.server.off("error",failed);this.listening=true;resolve();};
      this.server.once("error",failed);this.server.once("listening",ready);this.server.listen(this.options.port??3042,this.options.host??"0.0.0.0");
    });
    this.timer=setInterval(()=>this.reconcileSessions(),1000);
    // Applications may provide background integrations even without an open browser panel.
    await Promise.allSettled(this.options.registry.list().filter(p=>p.settings.enabled).map(p=>this.synchronize(p.manifest.id)));
  }
  status(id: string): PluginRuntimeStatus {
    const policy=this.options.registry.policy(id);if(!policy?.settings.enabled)return {state:"disabled"};
    return this.entries.get(id)?.status??{state:policy.manifest.server?"stopped":"client"};
  }
  private async stopEntry(entry: ApplicationEntry): Promise<void> {
    await entry.process?.close();if(entry.directory){await this.options.registry.releaseCode(entry.directory);entry.directory="";}
  }
  synchronize(id: string): Promise<void> {
    const next=(this.queues.get(id)??Promise.resolve()).then(async()=>{
      const policy=this.options.registry.policy(id),previous=this.entries.get(id);
      if(previous&&!previous.stale&&previous.policy.revision===policy?.revision)return;
      if(previous){await this.stopEntry(previous);this.entries.delete(id);}
      if(this.closed||!policy?.settings.enabled||!policy.settings.trusted)return;
      const entry:ApplicationEntry={policy,directory:"",assets:new Set(),status:{state:"starting"},stale:false};this.entries.set(id,entry);
      try {
        if(policy.manifest.server)pluginAssert([...this.entries.values()].filter(p=>p.policy.manifest.server&&["starting","running"].includes(p.status.state)).length<=(this.options.maxWorkers??8),"PLUGIN_WORKER_LIMIT");
        entry.assets=new Set(Object.keys((await this.options.registry.getPackage(id)).files).filter(name=>name.startsWith("client/")));
        entry.directory=await this.options.registry.materialize(id,policy.revision);
        pluginAssert(!this.closed&&this.options.registry.policy(id)?.revision===policy.revision,"PLUGIN_CHANGED");
        if(policy.manifest.server){
          entry.process=new PluginProcess({entry:path.join(entry.directory,policy.manifest.server.entry),codeDirectory:entry.directory,dataDirectory:await this.options.registry.dataDirectory(id),config:this.options.registry.serverConfig(id),publicConfig:policy.settings.config,logger:this.options.logger.child({pluginId:id}),onExit:()=>{
            if(this.entries.get(id)===entry&&!entry.stale&&!this.closed){entry.status={state:"failed",error:"PLUGIN_PROCESS_EXITED"};this.revokePlugin(id,"PLUGIN_PROCESS_EXITED");}
          }});await entry.process.ready;
        }
        pluginAssert(!this.closed&&this.options.registry.policy(id)?.revision===policy.revision,"PLUGIN_CHANGED");
        entry.status={state:policy.manifest.server?"running":"client"};
      } catch(error) {
        entry.status={state:"failed",error:error instanceof PluginError?error.code:"PLUGIN_START_FAILED"};
        await this.stopEntry(entry);this.options.logger.warn({pluginId:id,code:entry.status.error},"Plugin application failed to start");
      }
    });this.queues.set(id,next.catch(()=>undefined));return next;
  }
  async restart(id:string):Promise<void>{this.revokePlugin(id,"PLUGIN_RESTARTED");const entry=this.entries.get(id);if(entry)entry.stale=true;await this.synchronize(id);}
  directory(voiceToken:string) {
    const participant=this.options.participant(voiceToken);pluginAssert(participant,"PLUGIN_NOT_CONNECTED");
      return this.options.registry.list().filter(policy=>{try{this.scopeKey(policy,participant);return true;}catch{return false;}}).map(policy=>({manifest:policy.manifest,scope:policy.settings.scope,toolbarPinned:policy.settings.toolbarPinned,runtime:this.status(policy.manifest.id)}));
  }
  private scopeKey(policy:InstalledPlugin,participant:PluginParticipant):string{
    pluginAssert(policy.settings.enabled&&policy.settings.trusted,"PLUGIN_DISABLED");
    if(policy.settings.scope==="instance")return "instance";
    pluginAssert(policy.settings.targets.includes(participant.target),"PLUGIN_NOT_ALLOWED");return `${participant.target}#${participant.channelId}`;
  }
  private appOrigin(mainOrigin:string):string{
    pluginAssert(this.listening,"PLUGIN_RUNTIME_UNAVAILABLE");
    if(this.origin){pluginAssert(this.origin!==new URL(mainOrigin).origin,"PLUGIN_SEPARATE_ORIGIN_REQUIRED");return this.origin;}
    const source=new URL(mainOrigin);pluginAssert(["127.0.0.1","localhost","[::1]"].includes(source.hostname),"PLUGIN_PUBLIC_ORIGIN_REQUIRED");
    source.hostname=source.hostname==="localhost"?"127.0.0.1":"localhost";source.port=String(this.port);source.protocol=this.options.tls?"https:":"http:";return source.origin;
  }
  async open(voiceToken:string,id:string,input:unknown,mainOrigin:string):Promise<PluginAppLaunch>{
    const participant=this.options.participant(voiceToken),policy=this.options.registry.policy(id);pluginAssert(participant,"PLUGIN_NOT_CONNECTED");pluginAssert(policy,"PLUGIN_NOT_FOUND");
    const preferences=pluginRecord(input)?input:{},openId=preferences.openId??randomUUID();
    pluginAssert(typeof openId==="string"&&/^[a-zA-Z0-9-]{8,80}$/.test(openId));const openKey=voiceToken+":"+openId,previous=this.openings.get(openKey);
    if(previous?.appId){const app=this.sessions.get(previous.appId);if(app&&this.validate(app)){pluginAssert(app.pluginId===id,"PLUGIN_OPEN_CONFLICT");return {id:app.id,url:`${app.origin}/apps/${app.id}/${policy.manifest.client.entry}`,manifest:policy.manifest};}}
    pluginAssert(!previous,previous?.cancelled?"PLUGIN_CANCELLED":"PLUGIN_OPEN_PENDING");
    pluginAssert([...this.openings.keys()].filter(key=>key.startsWith(voiceToken+":")).length<64&&this.openings.size<8192,"PLUGIN_LIMIT");
    const operation={cancelled:false,expires:Date.now()+90000,appId:undefined as string|undefined};this.openings.set(openKey,operation);
    const scopeKey=this.scopeKey(policy,participant),origin=this.appOrigin(mainOrigin);
    pluginAssert([...this.sessions.values()].filter(app=>app.voiceToken===voiceToken).length<8&&this.sessions.size<800,"PLUGIN_LIMIT");
    await this.synchronize(id);const entry=this.entries.get(id);pluginAssert(entry&&["running","client"].includes(entry.status.state),entry?.status.error??"PLUGIN_RUNTIME_UNAVAILABLE");
    pluginAssert(!operation.cancelled,"PLUGIN_CANCELLED");
    const current=this.options.participant(voiceToken);pluginAssert(current&&this.options.registry.policy(id)?.revision===policy.revision&&this.scopeKey(policy,current)===scopeKey,"PLUGIN_CONTEXT_CHANGED");
    pluginAssert([...this.sessions.values()].filter(app=>app.voiceToken===voiceToken).length<8&&this.sessions.size<800,"PLUGIN_LIMIT");
    const app:AppSession={id:randomBytes(32).toString("base64url"),publicId:randomUUID(),participantId:current.id,openKey,pluginId:id,revision:policy.revision,voiceToken,scopeKey,origin,theme:preferences.theme==="dark"?"dark":"light",language:["zh","en","de","ru","ja"].includes(String(preferences.language))?preferences.language as PluginAppContext["language"]:"en",lastActivity:Date.now(),lastContext:"",streams:new Set(),connections:new Set()};
    operation.appId=app.id;
    this.sessions.set(app.id,app);entry.process?.event("participantJoined",this.requestContext(app,current));
    return {id:app.id,url:`${origin}/apps/${app.id}/${policy.manifest.client.entry}`,manifest:policy.manifest};
  }
  authorizeApp(id:string,voiceToken:string):boolean{return this.sessions.get(id)?.voiceToken===voiceToken;}
  cancelOpen(voiceToken:string,openId:string):void{
    pluginAssert(/^[a-zA-Z0-9-]{8,80}$/.test(openId));const key=voiceToken+":"+openId,operation=this.openings.get(key);
    if(operation){operation.cancelled=true;if(operation.appId)this.closeApp(operation.appId);return;}
    pluginAssert(this.options.participant(voiceToken),"PLUGIN_NOT_CONNECTED");
    pluginAssert([...this.openings.keys()].filter(item=>item.startsWith(voiceToken+":")).length<64&&this.openings.size<8192,"PLUGIN_LIMIT");
    this.openings.set(key,{cancelled:true,expires:Date.now()+90000});
  }
  appearance(id:string,voiceToken:string,input:unknown):void{
    pluginAssert(this.authorizeApp(id,voiceToken)&&pluginRecord(input),"PLUGIN_NOT_OPEN");const app=this.sessions.get(id)!;
    if(input.theme==="light"||input.theme==="dark")app.theme=input.theme;
    if(["zh","en","de","ru","ja"].includes(String(input.language)))app.language=input.language as PluginAppContext["language"];
    this.publishContext(app);
  }
  closeApp(id:string,code="PLUGIN_CLOSED"):void{
    const app=this.sessions.get(id);if(!app)return;this.sessions.delete(id);
    const opening=this.openings.get(app.openKey);if(opening){opening.cancelled=true;opening.appId=undefined;opening.expires=Date.now()+90000;}
    for(const response of app.streams){if(!response.destroyed)response.end(`event: closed\ndata: ${JSON.stringify({code})}\n\n`);}
    for(const close of app.connections){try{close();}catch{}}
    this.entries.get(app.pluginId)?.process?.event("participantLeft",{appId:app.publicId,selfId:app.participantId,scopeKey:app.scopeKey});
  }
  private revokePlugin(id:string,code:string):void{for(const app of [...this.sessions.values()])if(app.pluginId===id)this.closeApp(app.id,code);}
  private context(app:AppSession,participant:PluginParticipant):PluginAppContext{
    const policy=this.options.registry.policy(app.pluginId)!;
    const base=`${app.origin}/apps/${app.id}`;
    return {...this.requestContext(app,participant),plugin:policy.manifest,connection:{target:participant.target,channelId:participant.channelId,members:participant.members},config:policy.settings.config,theme:app.theme,language:app.language,
      serverUrl:policy.manifest.server?`${base}/server`:null,socketUrl:policy.manifest.server?`${base.replace(/^http/,"ws")}/server`:null,contextUrl:`${base}/_runtime/context`};
  }
  private requestContext(app:AppSession,participant:PluginParticipant):PluginRequestContext{
    return {apiVersion:2,appId:app.publicId,self:{id:participant.id,nickname:participant.nickname,...(participant.uid?{uid:participant.uid}:{})},connection:{target:participant.target,channelId:participant.channelId},scope:{type:this.options.registry.policy(app.pluginId)!.settings.scope,key:app.scopeKey}};
  }
  private validate(app:AppSession):PluginParticipant|null{
    const policy=this.options.registry.policy(app.pluginId),participant=this.options.participant(app.voiceToken);
    try{return policy&&policy.revision===app.revision&&participant&&this.scopeKey(policy,participant)===app.scopeKey?participant:null;}catch{return null;}
  }
  private publishContext(app:AppSession):void{
    const participant=this.validate(app);if(!participant){this.closeApp(app.id,"PLUGIN_CONTEXT_CHANGED");return;}
    const context=this.context(app,participant),json=JSON.stringify(context);
    if(json!==app.lastContext){app.lastContext=json;for(const response of app.streams)if(!response.destroyed)response.write(`event: context\ndata: ${json}\n\n`);this.entries.get(app.pluginId)?.process?.event("contextChanged",{...this.requestContext(app,participant),connection:context.connection});}
  }
  private reconcileSessions():void{
    for(const [key,operation]of this.openings)if(!operation.appId&&operation.expires<Date.now())this.openings.delete(key);
    for(const app of [...this.sessions.values()]){
      if(!this.validate(app)||(!app.streams.size&&Date.now()-app.lastActivity>90000)){this.closeApp(app.id,"PLUGIN_CONTEXT_CHANGED");continue;}
      this.publishContext(app);for(const response of app.streams){if(response.destroyed)app.streams.delete(response);else if(response.writableLength>256*1024){response.destroy();app.streams.delete(response);}else response.write(": keepalive\n\n");}
    }
  }
  private locate(request:IncomingMessage):{app:AppSession;route:string;query:string;participant:PluginParticipant}{
    const url=new URL(request.url??"/","http://runtime.invalid"),match=/^\/apps\/([A-Za-z0-9_-]{43})\/(.*)$/.exec(url.pathname);
    pluginAssert(match,"PLUGIN_NOT_OPEN");const app=this.sessions.get(match[1]);pluginAssert(app,"PLUGIN_NOT_OPEN");
    const participant=this.validate(app);pluginAssert(participant,"PLUGIN_CONTEXT_CHANGED");app.lastActivity=Date.now();
    return {app,route:decodeURIComponent(match[2]),query:url.search,participant};
  }
  private async handle(request:IncomingMessage,response:ServerResponse):Promise<void>{
    response.setHeader("referrer-policy","no-referrer");response.setHeader("x-content-type-options","nosniff");response.setHeader("cache-control","no-store");
    try{
      const {app,route,query,participant}=this.locate(request),entry=this.entries.get(app.pluginId);pluginAssert(entry?.directory,"PLUGIN_RUNTIME_UNAVAILABLE");
      if(route.startsWith("server/")||route==="server"){this.proxy(request,response,app,participant,"/"+route.slice(7)+query);return;}
      pluginAssert(request.method==="GET"||request.method==="HEAD","PLUGIN_METHOD_NOT_ALLOWED");
      if(route==="_runtime/context"){response.setHeader("content-type","application/json");response.end(JSON.stringify(this.context(app,participant)));return;}
      if(route==="_runtime/events"){
        pluginAssert(app.streams.size<4,"PLUGIN_LIMIT");response.writeHead(200,{"content-type":"text/event-stream","x-accel-buffering":"no"});response.flushHeaders();app.streams.add(response);
        response.write(`event: context\ndata: ${JSON.stringify(this.context(app,participant))}\n\n`);response.once("close",()=>app.streams.delete(response));return;
      }
      if(route==="_runtime/sdk.js"){response.setHeader("content-type","text/javascript; charset=utf-8");response.end(applicationSdk(this.context(app,participant),`${app.origin}/apps/${app.id}/_runtime/events`,app.id));return;}
      pluginAssert(route.startsWith("client/")&&pluginPath(route),"PLUGIN_ASSET_NOT_FOUND");
      pluginAssert(this.validate(app)&&entry.assets.has(route),"PLUGIN_ASSET_NOT_FOUND");
      const file=path.resolve(entry.directory,route);pluginAssert(file.startsWith(entry.directory+path.sep),"PLUGIN_ASSET_NOT_FOUND");
      response.setHeader("content-type",contentTypes[path.extname(route)]??"application/octet-stream");
      if(route===entry.policy.manifest.client.entry){
        let html=await readFile(file,"utf8");pluginAssert(this.validate(app),"PLUGIN_CONTEXT_CHANGED");
        const script=`<script src="/apps/${app.id}/_runtime/sdk.js"></script>`;
        if(/<head(?:\s[^>]*)?>/i.test(html))html=html.replace(/<head(?:\s[^>]*)?>/i,head=>head+script);
        else if(/<!doctype[^>]*>/i.test(html))html=html.replace(/<!doctype[^>]*>/i,doctype=>doctype+script);
        else html=script+html;
        response.end(request.method==="HEAD"?undefined:html);return;
      }
      if(request.method==="HEAD"){response.end();return;}
      const stream=createReadStream(file);stream.once("error",()=>{if(!response.headersSent)response.writeHead(404);response.end();});response.once("close",()=>stream.destroy());stream.pipe(response);
    }catch(error){if(!response.headersSent)response.writeHead(error instanceof PluginError&&error.code==="PLUGIN_ASSET_NOT_FOUND"?404:403,{"content-type":"application/json"});response.end(JSON.stringify({error:error instanceof PluginError?error.code:"PLUGIN_RUNTIME_FAILED"}));}
  }
  private headers(request:IncomingMessage,app:AppSession,participant:PluginParticipant):Record<string,string|string[]>{
    const worker=this.entries.get(app.pluginId)?.process;pluginAssert(worker?.port,"PLUGIN_BACKEND_UNAVAILABLE");
    const headers:Record<string,string|string[]>={};
    for(const [key,value]of Object.entries(request.headers))if(value!==undefined&&!['cookie','authorization','host','connection','proxy-authorization'].includes(key)&&!key.startsWith('x-webspeak-'))headers[key]=value;
    const context=this.requestContext(app,participant);
    headers['x-webspeak-runtime']=worker.token;headers['x-webspeak-context']=Buffer.from(JSON.stringify(context),'utf8').toString('base64url');return headers;
  }
  private proxy(request:IncomingMessage,response:ServerResponse,app:AppSession,participant:PluginParticipant,route:string):void{
    const worker=this.entries.get(app.pluginId)?.process;pluginAssert(worker?.port,"PLUGIN_BACKEND_UNAVAILABLE");pluginAssert(app.connections.size<32,"PLUGIN_BUSY");
    const upstream=httpRequest({hostname:"127.0.0.1",port:worker.port,path:route,method:request.method,headers:this.headers(request,app,participant)},incoming=>{
      if(response.destroyed||!this.sessions.has(app.id)){incoming.destroy();return;}
      const headers={...incoming.headers};delete headers['set-cookie'];response.writeHead(incoming.statusCode??502,headers);incoming.once('error',()=>response.destroy());incoming.pipe(response);
    });
    const close=()=>{upstream.destroy();if(!response.writableFinished)response.destroy();};app.connections.add(close);
    upstream.setTimeout(120000,()=>upstream.destroy());upstream.once('error',()=>{if(!response.headersSent)response.writeHead(502,{'content-type':'application/json'});response.end('{"error":"PLUGIN_BACKEND_UNAVAILABLE"}');});
    response.once('close',()=>{app.connections.delete(close);upstream.destroy();});request.once('aborted',close);request.pipe(upstream);
  }
  private async upgrade(request:IncomingMessage,socket:Socket,head:Buffer):Promise<void>{
    try{
      const {app,route,query,participant}=this.locate(request);pluginAssert(route==='server'||route.startsWith('server/'),"PLUGIN_NOT_ALLOWED");
      const worker=this.entries.get(app.pluginId)?.process;pluginAssert(worker?.port&&app.connections.size<32,"PLUGIN_BACKEND_UNAVAILABLE");
      const headers=this.headers(request,app,participant);headers.connection='Upgrade';headers.upgrade=String(request.headers.upgrade??'websocket');
      const upstream=httpRequest({hostname:'127.0.0.1',port:worker.port,path:'/'+route.slice(7)+query,headers});
      const close=()=>{upstream.destroy();socket.destroy();};app.connections.add(close);socket.once('close',()=>{app.connections.delete(close);upstream.destroy();});
      upstream.once('upgrade',(response,peer,upstreamHead)=>{
        socket.write(`HTTP/1.1 ${response.statusCode??101} Switching Protocols\r\n`);for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&key!=='set-cookie')socket.write(`${key}: ${Array.isArray(value)?value.join(', '):value}\r\n`);socket.write('\r\n');
        if(head.length)peer.write(head);if(upstreamHead.length)socket.write(upstreamHead);peer.pipe(socket);socket.pipe(peer);peer.once('error',()=>socket.destroy());socket.once('error',()=>peer.destroy());
        app.connections.delete(close);const closePeer=()=>{peer.destroy();socket.destroy();};app.connections.add(closePeer);socket.once('close',()=>{app.connections.delete(closePeer);peer.destroy();});peer.once('close',()=>socket.destroy());
      });
      upstream.once('error',close);upstream.once('response',()=>close());upstream.end();
    }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;this.listening=false;clearInterval(this.timer);this.options.registry.listeners.delete(this.changed);
    for(const app of [...this.sessions.values()])this.closeApp(app.id);
    this.openings.clear();
    await Promise.allSettled([...this.entries.values()].map(entry=>entry.process?.close()));
    await Promise.allSettled(this.queues.values());await Promise.allSettled([...this.entries.values()].map(entry=>this.stopEntry(entry)));this.entries.clear();
    for(const socket of this.sockets)socket.destroy();await new Promise<void>(resolve=>this.server.close(()=>resolve()));
  }
}
function normalizeOrigin(value:unknown):string{
  pluginAssert(typeof value==='string'&&value.length<=300);if(!value.trim())return '';
  const url=new URL(value.trim());pluginAssert(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/');
  pluginAssert(url.protocol==='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname),'PLUGIN_HTTPS_REQUIRED');return url.origin;
}
function applicationSdk(context:PluginAppContext,eventsUrl:string,id:string):string{
  // No expression evaluator, business RPC, shared rooms, dependency loader, or network allowlist.
  return `(()=>{let context=${JSON.stringify(context).replace(/</g,'\\u003c')};const listeners=new Set(),closed=new AbortController();document.documentElement.dataset.theme=context.theme;document.documentElement.lang=context.language;
const events=new EventSource(${JSON.stringify(eventsUrl)});events.addEventListener('context',event=>{try{context=JSON.parse(event.data);document.documentElement.dataset.theme=context.theme;document.documentElement.lang=context.language;for(const fn of listeners){try{fn(context)}catch{}}}catch{}});
events.addEventListener('closed',()=>{closed.abort();events.close();parent.postMessage({type:'webspeak-app-closed',id:${JSON.stringify(id)}},'*')});
window.webspeak=Object.freeze({apiVersion:2,ready:Promise.resolve(context),getContext:()=>context,onContextChange(fn){listeners.add(fn);return()=>listeners.delete(fn)},signal:closed.signal});
addEventListener('pagehide',()=>{closed.abort();events.close();listeners.clear()},{once:true});})();`;
}
