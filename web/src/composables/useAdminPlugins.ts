import { reactive, ref, shallowRef } from 'vue';
import { createAdminRequests } from '../services/admin-requests.js';
import { AdminApiError, isAdminRequestCancelled, type AdminApi } from '../services/admin-api.js';
import { parsePluginPackage, pluginRecord, PLUGIN_LIMIT_BYTES, type InstalledPlugin, type JsonValue, type PluginCatalog, type PluginStoreEntry, type PluginRuntimeSettings, type PluginSettingsInput } from '../../../src/shared/plugins.js';

export const musicBotId = 'community.webspeak-tsmb';
export const musicBotRepository = 'https://github.com/Funvvell/webspeak-plugin-tsmb';

interface ConfigField {
  key: string;
  type: 'url' | 'password' | 'text' | 'number' | 'json' | 'select' | 'boolean';
  placeholder?: string;
  choices?: readonly string[];
}

export const musicBotPrivateFields: readonly ConfigField[] = [
  {key:'baseUrl',type:'url',placeholder:'http://127.0.0.1:3000'},
  {key:'apiKey',type:'password',placeholder:'tsmb_…'},
  {key:'requestTimeoutMs',type:'number',placeholder:'8000'},
  {key:'connectTimeoutMs',type:'number',placeholder:'4000'},
  {key:'maxResponseBytes',type:'number',placeholder:'1048576'},
  {key:'maxCoverBytes',type:'number',placeholder:'2097152'},
  {key:'coverAllowedHosts',type:'json',placeholder:'[]'},
];

export const musicBotPublicFields: readonly ConfigField[] = [
  {key:'botId',type:'text'},
  {key:'botIdByScope',type:'json',placeholder:'{}'},
  {key:'webUiUrl',type:'url'},
  {key:'controlPolicy',type:'select',choices:['everyone','host','readonly'],placeholder:'everyone'},
  {key:'pollIntervalMs',type:'number',placeholder:'2000'},
  {key:'progressIntervalMs',type:'number',placeholder:'500'},
  {key:'searchLimit',type:'number',placeholder:'20'},
  {key:'searchMaxLimit',type:'number',placeholder:'50'},
  {key:'searchOffsetMax',type:'number',placeholder:'500'},
  {key:'maxQueueDisplay',type:'number',placeholder:'50'},
  {key:'lyricsEnabled',type:'boolean',choices:['true','false'],placeholder:'true'},
  {key:'coverProxyEnabled',type:'boolean',choices:['true','false'],placeholder:'true'},
  {key:'heartbeatMs',type:'number',placeholder:'10000'},
  {key:'idleRoomTTLms',type:'number',placeholder:'1800000'},
  {key:'locale',type:'text',placeholder:'auto'},
];

function makeConfigDraft(fields: readonly ConfigField[], config?: JsonValue): Record<string, string> {
  return Object.fromEntries(fields.map(({key,type}) => {
    const value = pluginRecord(config) ? config[key] : undefined;
    return [key, value === undefined ? '' : type === 'json' ? JSON.stringify(value) : String(value)];
  }));
}

function readConfigFields(fields: readonly ConfigField[], draft: Record<string, string>, existing?: JsonValue): Record<string, JsonValue> {
  const config = pluginRecord(existing) ? {...existing} as Record<string, JsonValue> : {};
  for (const {key,type} of fields) {
    const input = String(draft[key] ?? '').trim();
    if (!input) { delete config[key]; continue; }
    if (type === 'number' || type === 'json' || type === 'boolean') {
      try {
        const value: JsonValue = JSON.parse(input);
        if (type === 'number' && !Number.isSafeInteger(value)) throw new Error();
        if (key === 'coverAllowedHosts' && (!Array.isArray(value) || !value.every(host => typeof host === 'string'))) throw new Error();
        if (key === 'botIdByScope' && (!pluginRecord(value) || !Object.values(value).every(id => typeof id === 'string'))) throw new Error();
        config[key] = value;
      } catch { throw new Error(`Invalid value: ${key}`); }
    } else {
      config[key] = input;
    }
  }
  return config;
}

export function useAdminPlugins(api: AdminApi) {
  const installed=shallowRef<InstalledPlugin[]>([]),catalog=shallowRef<PluginCatalog|null>(null),runtime=shallowRef<PluginRuntimeSettings|null>(null);
  const origin=ref(''),busy=ref(false),error=ref(''),catalogError=ref(''),requests=createAdminRequests();
  const drafts=reactive<Record<string,{enabled:boolean;trusted:boolean;toolbarPinned:boolean;scope:'server'|'instance';targets:string;config:string;serverConfigAction:'keep'|'replace'|'remove';serverConfig:string;publicFields:Record<string,string>;privateFields:Record<string,string>}>>({});
  function apply(records:InstalledPlugin[]){
    installed.value=records;
    for(const record of records)if(!drafts[record.manifest.id]){
      const musicBot = record.manifest.id === musicBotId;
      drafts[record.manifest.id]={enabled:record.settings.enabled,trusted:record.settings.trusted,toolbarPinned:record.settings.toolbarPinned,scope:record.settings.scope,targets:record.settings.targets.join('\n'),config:JSON.stringify(record.settings.config,null,2),serverConfigAction:'keep',serverConfig:'',publicFields:musicBot?makeConfigDraft(musicBotPublicFields,record.settings.config):{},privateFields:musicBot?makeConfigDraft(musicBotPrivateFields):{}};
    }
    for(const id of Object.keys(drafts))if(!records.some(r=>r.manifest.id===id))delete drafts[id];
  }
  async function work(run:(signal:AbortSignal,current:()=>boolean)=>Promise<void>){
    if(busy.value)return;const request=requests.begin('plugins');busy.value=true;error.value='';
    const timer=setTimeout(()=>{if(request.isCurrent()){error.value='PLUGIN_TIMEOUT';requests.cancel('plugins');busy.value=false;}},90_000);
    try{await run(request.signal,request.isCurrent);}catch(e){if(request.isCurrent()&&!isAdminRequestCancelled(e))error.value=e instanceof AdminApiError?e.code:e instanceof Error?e.message:'PLUGIN_FAILED';}
    finally{clearTimeout(timer);if(request.isCurrent())busy.value=false;request.finish();}
  }
  function configValue(id: string, key: 'config' | 'serverConfig'): JsonValue {
    return JSON.parse(drafts[id][key] || '{}') as JsonValue;
  }
  function setConfigValue(id: string, key: 'config' | 'serverConfig', value: JsonValue) {
    drafts[id][key] = JSON.stringify(value);
  }
  function musicBotCollection(id: string, section: 'publicFields' | 'privateFields', key: string): JsonValue {
    const value = drafts[id][section][key];
    return value ? JSON.parse(value) as JsonValue : key === 'coverAllowedHosts' ? [] : {};
  }
  function setMusicBotCollection(id: string, section: 'publicFields' | 'privateFields', key: string, value: JsonValue) {
    drafts[id][section][key] = JSON.stringify(value);
  }
  function load(){return work(async(signal,current)=>{
    const records=await api.plugins(signal);if(current())apply(records.plugins);
    const settings=await api.pluginRuntime(signal);if(current()){runtime.value=settings.runtime;origin.value=settings.runtime.publicOrigin;}
    try{const store=await api.pluginStore(signal);if(current()){catalog.value=store;catalogError.value='';}}catch(e){if(current()&&!isAdminRequestCancelled(e)){catalog.value=null;catalogError.value=e instanceof Error?e.message:'PLUGIN_STORE_UNAVAILABLE';}}
  });}
  function install(entry:PluginStoreEntry){return work(async(signal,current)=>{
    const result=await api.installPlugin({id:entry.id,revision:entry.revision,installedRevision:installed.value.find(p=>p.manifest.id===entry.id)?.revision??null},signal);
    if(current()){delete drafts[entry.id];apply([...installed.value.filter(p=>p.manifest.id!==entry.id),result.plugin]);}
  });}
  function save(record:InstalledPlugin){return work(async(signal,current)=>{
    const draft=drafts[record.manifest.id],captured=JSON.stringify(draft);
    const musicBot=record.manifest.id===musicBotId;
    const settings:PluginSettingsInput={enabled:draft.enabled,trusted:draft.trusted,toolbarPinned:draft.toolbarPinned,scope:draft.scope,targets:draft.targets.split(/\r?\n/).map(t=>t.trim()).filter(Boolean),config:musicBot?readConfigFields(musicBotPublicFields,draft.publicFields,record.settings.config):JSON.parse(draft.config),serverConfigAction:draft.serverConfigAction};
    if(draft.serverConfigAction==='replace'){
      settings.serverConfig=musicBot?readConfigFields(musicBotPrivateFields,draft.privateFields):JSON.parse(draft.serverConfig);
      if(musicBot && pluginRecord(settings.serverConfig) && (typeof settings.serverConfig.apiKey !== 'string' || !/^tsmb_[A-Za-z0-9_-]{20,}$/.test(settings.serverConfig.apiKey))) throw new Error('TSMB_API_KEY_REQUIRED');
    }
    if(musicBot && draft.enabled && (draft.serverConfigAction==='remove' || (draft.serverConfigAction==='keep' && !record.settings.hasServerConfig))) throw new Error('TSMB_API_KEY_REQUIRED');
    const result=await api.configurePlugin(record.manifest.id,record.revision,settings,signal);
    if(current()){if(JSON.stringify(drafts[record.manifest.id])===captured)delete drafts[record.manifest.id];apply(installed.value.map(p=>p.manifest.id===record.manifest.id?result.plugin:p));}
  });}
  function restart(record:InstalledPlugin){return work(async(signal,current)=>{const result=await api.restartPlugin(record.manifest.id,record.revision,signal);if(current())apply(installed.value.map(p=>p.manifest.id===record.manifest.id?result.plugin:p));});}
  function saveRuntime(){return work(async(signal,current)=>{if(!runtime.value)return;const captured=origin.value,result=await api.configurePluginRuntime(captured,runtime.value.revision,signal);if(current()){runtime.value=result.runtime;if(origin.value===captured)origin.value=result.runtime.publicOrigin;}});}
  function remove(record:InstalledPlugin){return work(async(signal,current)=>{await api.removePlugin(record.manifest.id,record.revision,signal);if(current())apply(installed.value.filter(p=>p.manifest.id!==record.manifest.id));});}
  function upload(file:File){return work(async(signal,current)=>{
    if(file.size>PLUGIN_LIMIT_BYTES)throw new Error('PLUGIN_TOO_LARGE');const pack=parsePluginPackage(JSON.parse(await file.text()));if(!current())return;
    const result=await api.uploadPlugin(pack,installed.value.find(p=>p.manifest.id===pack.manifest.id)?.revision??null,signal);
    if(current()){delete drafts[pack.manifest.id];apply([...installed.value.filter(p=>p.manifest.id!==pack.manifest.id),result.plugin]);}
  });}
  function cancelRequests(){requests.reset();busy.value=false;for(const draft of Object.values(drafts)){draft.serverConfig='';draft.serverConfigAction='keep';for(const key of Object.keys(draft.privateFields))draft.privateFields[key]='';}}
  function reset(){cancelRequests();installed.value=[];catalog.value=null;runtime.value=null;origin.value='';error.value='';catalogError.value='';for(const id of Object.keys(drafts))delete drafts[id];}
  return {installed,catalog,runtime,origin,busy,error,catalogError,drafts,load,install,save,restart,saveRuntime,remove,upload,cancelRequests,reset,configValue,setConfigValue,musicBotCollection,setMusicBotCollection};
}
