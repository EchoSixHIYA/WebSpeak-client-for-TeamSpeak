import { mkdir, readFile, readdir, writeFile, rename, unlink, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseTeamSpeakTarget, teamSpeakTargetKey } from "../domain/teamspeak-target.js";
import { encryptSecret, decryptSecret } from "../security/secret-crypto.js";
import { loadOrCreateMasterSecret } from "../security/master-secret.js";
import { parsePluginPackage, parsePluginManifest, parsePluginJson, pluginAssert, pluginId, pluginRecord, pluginFileBytes, PluginError, PLUGIN_LIMIT_BYTES,
  type InstalledPlugin, type PluginPackage, type PluginSettings, type JsonValue } from "../shared/plugins.js";

interface StoredPlugin extends InstalledPlugin { schemaVersion: 2; packageDigest: string; serverConfigCiphertext: string }
export class PluginRegistry {
  private readonly records = new Map<string, StoredPlugin>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly masterKey: Buffer;
  readonly listeners = new Set<(id: string) => void>();
  readonly directory: string;
  constructor(directory: string, masterKey?: Buffer) {
    this.directory = path.resolve(directory);
    this.masterKey = masterKey ?? loadOrCreateMasterSecret(path.join(this.directory,"master.key"));
  }
  async initialize(): Promise<void> {
    await mkdir(path.join(this.directory,"installed"),{recursive:true});
    for (const file of await readdir(path.join(this.directory,"installed"))) {
      if (!file.endsWith('.json')) continue;
      try {
        const bytes=await readFile(path.join(this.directory,"installed",file)); pluginAssert(bytes.length<=256*1024);
        const v:unknown=JSON.parse(bytes.toString('utf8'));pluginAssert(pluginRecord(v)&&v.schemaVersion===2);
        const manifest=parsePluginManifest(v.manifest);pluginAssert(file===`${manifest.id}.json`&&typeof v.packageDigest==='string'&&/^[a-f0-9]{64}$/.test(v.packageDigest)&&typeof v.serverConfigCiphertext==='string'&&typeof v.installedAt==='number'&&Number.isFinite(v.installedAt));
        const settings=this.settings(v.settings,manifest,!!v.serverConfigCiphertext);
        const record={schemaVersion:2 as const,manifest,settings,packageDigest:v.packageDigest,serverConfigCiphertext:v.serverConfigCiphertext,installedAt:v.installedAt,revision:''};
        this.readSecret(record);
        if (pluginRecord(v.settings) && v.settings.toolbarPinned === undefined) {
          const legacyHash=createHash("sha256").update(JSON.stringify({manifest,settings:v.settings,packageDigest:v.packageDigest,serverConfigCiphertext:v.serverConfigCiphertext,installedAt:v.installedAt})).digest("hex");
          pluginAssert(legacyHash===v.revision);
          record.revision="";
          this.records.set(manifest.id,record);
          try { await this.commit(record); }
          catch { /* keep the migrated record usable in memory if disk replacement fails */ }
        } else {
          record.revision=this.hash(record);pluginAssert(record.revision===v.revision);this.records.set(manifest.id,record);
        }
      } catch { /* Invalid or obsolete packages are never executed. */ }
    }
  }
  private public(record: StoredPlugin): InstalledPlugin {
    return structuredClone({manifest:record.manifest,settings:record.settings,revision:record.revision,installedAt:record.installedAt});
  }
  list(): InstalledPlugin[] { return [...this.records.values()].map(record=>this.public(record)); }
  policy(id: string): InstalledPlugin | undefined { const record=this.records.get(id);return record?this.public(record):undefined; }
  private hash(record: Omit<StoredPlugin,'revision'> | StoredPlugin): string {
    return createHash('sha256').update(JSON.stringify({manifest:record.manifest,settings:record.settings,packageDigest:record.packageDigest,serverConfigCiphertext:record.serverConfigCiphertext,installedAt:record.installedAt})).digest('hex');
  }
  private settings(value: unknown, manifest: StoredPlugin['manifest'], hasServerConfig: boolean): PluginSettings {
    pluginAssert(pluginRecord(value)&&typeof value.enabled==='boolean'&&typeof value.trusted==='boolean'&&(value.toolbarPinned===undefined||typeof value.toolbarPinned==='boolean')&&manifest.scopes.includes(value.scope as never));
    pluginAssert(Array.isArray(value.targets)&&value.targets.length<=50&&value.targets.every(t=>typeof t==='string'&&t.length<=300));
    let targets:string[];try{targets=[...new Set(value.targets.map(t=>teamSpeakTargetKey(parseTeamSpeakTarget(t))))];}catch{throw new PluginError('PLUGIN_TARGET_INVALID');}
    pluginAssert(!value.enabled||value.trusted,'PLUGIN_TRUST_REQUIRED');
    pluginAssert(value.scope!=='server'||!value.enabled||targets.length>0,'PLUGIN_TARGET_REQUIRED');
    return {enabled:value.enabled,trusted:value.trusted,toolbarPinned:value.toolbarPinned===true,scope:value.scope as PluginSettings['scope'],targets,config:parsePluginJson(value.config),hasServerConfig};
  }
  private readSecret(record: StoredPlugin): JsonValue {
    const text=decryptSecret(record.serverConfigCiphertext,this.masterKey,`webspeak:plugin-config:v2:${record.manifest.id}`);
    return text?parsePluginJson(JSON.parse(text)):null;
  }
  serverConfig(id: string): JsonValue { const record=this.records.get(id);pluginAssert(record,'PLUGIN_NOT_FOUND');return this.readSecret(record); }
  private mutate<T>(run:()=>Promise<T>):Promise<T>{const next=this.queue.then(run,run);this.queue=next.catch(()=>undefined);return next;}
  private async commit(record:StoredPlugin):Promise<InstalledPlugin>{
    record.revision=this.hash(record);const directory=path.join(this.directory,'installed'),temporary=path.join(directory,`.${randomUUID()}.tmp`);
    try{await writeFile(temporary,JSON.stringify(record),{flag:'wx',mode:0o600});await rename(temporary,path.join(directory,`${record.manifest.id}.json`));}finally{await unlink(temporary).catch(()=>undefined);}
    this.records.set(record.manifest.id,record);for(const listener of this.listeners){try{listener(record.manifest.id);}catch{}}
    return this.public(record);
  }
  install(input:PluginPackage,expectedRevision:string|null):Promise<InstalledPlugin>{return this.mutate(async()=>{
    const pack=parsePluginPackage(input),previous=this.records.get(pack.manifest.id);pluginAssert((previous?.revision??null)===expectedRevision,'PLUGIN_CHANGED');pluginAssert(previous||this.records.size<50,'PLUGIN_LIMIT');
    const bytes=JSON.stringify(pack),digest=createHash('sha256').update(bytes).digest('hex'),directory=path.join(this.directory,'packages',pack.manifest.id);
    await mkdir(directory,{recursive:true});const file=path.join(directory,`${digest}.wplugin`);
    try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}
    const old=previous?.settings;
    const settings={enabled:false,trusted:false,toolbarPinned:old?.toolbarPinned??false,scope:old&&pack.manifest.scopes.includes(old.scope)?old.scope:pack.manifest.scopes[0],targets:old?.targets??[],config:old?.config??{},hasServerConfig:!!previous?.serverConfigCiphertext};
    return this.commit({schemaVersion:2,manifest:pack.manifest,settings,packageDigest:digest,serverConfigCiphertext:previous?.serverConfigCiphertext??'',installedAt:previous?.installedAt??Date.now(),revision:''});
  });}
  configure(id:string,input:unknown,revision:string):Promise<InstalledPlugin>{return this.mutate(async()=>{
    const record=this.records.get(id);pluginAssert(record,'PLUGIN_NOT_FOUND');pluginAssert(record.revision===revision,'PLUGIN_CHANGED');pluginAssert(pluginRecord(input));
    let secret=record.serverConfigCiphertext;const action=input.serverConfigAction??'keep';pluginAssert(['keep','replace','remove'].includes(String(action)));
    if(action==='remove')secret='';else if(action==='replace')secret=encryptSecret(JSON.stringify(parsePluginJson(input.serverConfig)),this.masterKey,`webspeak:plugin-config:v2:${id}`);
    const settings=this.settings(input,record.manifest,!!secret);return this.commit({...record,settings,serverConfigCiphertext:secret});
  });}
  async getPackage(id:string):Promise<PluginPackage>{
    const record=this.records.get(id);pluginAssert(record,'PLUGIN_NOT_FOUND');
    const bytes=await readFile(path.join(this.directory,'packages',id,`${record.packageDigest}.wplugin`));pluginAssert(bytes.length<=PLUGIN_LIMIT_BYTES,'PLUGIN_TOO_LARGE');
    pluginAssert(createHash('sha256').update(bytes).digest('hex')===record.packageDigest,'PLUGIN_CHECKSUM');
    const pack=parsePluginPackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));pluginAssert(JSON.stringify(pack.manifest)===JSON.stringify(record.manifest),'PLUGIN_PACKAGE_MISMATCH');return pack;
  }
  async materialize(id:string,revision:string):Promise<string>{
    const record=this.records.get(id);pluginAssert(record?.revision===revision,'PLUGIN_CHANGED');const pack=await this.getPackage(id);pluginAssert(this.records.get(id)?.revision===revision,'PLUGIN_CHANGED');
    const parent=path.join(this.directory,'code',id);await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'run-'));
    try{for(const [name,file]of Object.entries(pack.files)){const target=path.resolve(root,name);pluginAssert(target.startsWith(root+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,pluginFileBytes(file),{flag:'wx',mode:0o600});}return root;}
    catch(error){await this.releaseCode(root);throw error;}
  }
  async releaseCode(directory:string):Promise<void>{
    const root=path.resolve(this.directory,'code');pluginAssert(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});
  }
  async dataDirectory(id:string):Promise<string>{pluginAssert(pluginId(id));const directory=path.join(this.directory,'data',id);await mkdir(directory,{recursive:true});return directory;}
  remove(id:string,revision:string):Promise<void>{return this.mutate(async()=>{
    pluginAssert(pluginId(id));const record=this.records.get(id);pluginAssert(record,'PLUGIN_NOT_FOUND');pluginAssert(record.revision===revision,'PLUGIN_CHANGED');
    await unlink(path.join(this.directory,'installed',`${id}.json`));this.records.delete(id);for(const listener of this.listeners){try{listener(id);}catch{}}
  });}
}
