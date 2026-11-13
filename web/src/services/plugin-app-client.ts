import { parsePluginManifest, pluginAssert, pluginRecord, type PluginManifest, type PluginAppLaunch, type PluginScope, type PluginRuntimeStatus } from '../../../src/shared/plugins.js';

export interface AvailablePluginApp { manifest: PluginManifest; scope: PluginScope; toolbarPinned: boolean; runtime: PluginRuntimeStatus }
export function createPluginAppClient(gatewayUrl:string,token:string,fetcher:typeof fetch=fetch,timeoutMs=15000){
  pluginAssert(/^[A-Za-z0-9_-]{43}$/.test(token),'PLUGIN_NOT_CONNECTED');
  const gateway=new URL(gatewayUrl);pluginAssert(['ws:','wss:','http:','https:'].includes(gateway.protocol)&&!gateway.username&&!gateway.password);
  gateway.protocol=gateway.protocol==='wss:'||gateway.protocol==='https:'?'https:':'http:';
  const base=gateway.origin+'/api/plugins';
  async function request(route:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<unknown>{
    const controller=new AbortController();let timedOut=false;
    const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      const response=await fetcher(base+route,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},credentials:'omit',redirect:'error',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const value:unknown=await response.json();
      if(!response.ok)throw new Error(pluginRecord(value)&&typeof value.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(value.code)?value.code:'PLUGIN_RUNTIME_FAILED');
      return value;
    }catch(error){if(timedOut)throw new Error('PLUGIN_TIMEOUT');if(signal?.aborted)throw new Error('PLUGIN_REQUEST_CANCELLED');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {
    async list(signal?:AbortSignal):Promise<AvailablePluginApp[]>{
      const value=await request('','GET',undefined,signal);pluginAssert(pluginRecord(value)&&Array.isArray(value.plugins)&&value.plugins.length<=50,'PLUGIN_INVALID_RESPONSE');
      return value.plugins.map(entry=>{
        pluginAssert(pluginRecord(entry)&&(entry.scope==='server'||entry.scope==='instance')&&pluginRecord(entry.runtime)&&['disabled','client','stopped','starting','running','failed'].includes(String(entry.runtime.state)),'PLUGIN_INVALID_RESPONSE');
        return {manifest:parsePluginManifest(entry.manifest),scope:entry.scope,toolbarPinned:entry.toolbarPinned===true,runtime:{state:entry.runtime.state as PluginRuntimeStatus['state'],...(typeof entry.runtime.error==='string'?{error:entry.runtime.error}:{})}};
      });
    },
    async open(id:string,options:{openId:string;theme:'light'|'dark';language:string},signal?:AbortSignal):Promise<PluginAppLaunch>{
      const value=await request('/'+encodeURIComponent(id)+'/open','POST',options,signal);
      pluginAssert(pluginRecord(value)&&typeof value.id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.id)&&typeof value.url==='string','PLUGIN_INVALID_RESPONSE');
      const manifest=parsePluginManifest(value.manifest),url=new URL(value.url);
      pluginAssert(manifest.id===id&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==='/apps/'+value.id+'/'+manifest.client.entry&&!url.hash&&!url.search,'PLUGIN_INVALID_RESPONSE');
      return {id:value.id,url:url.href,manifest};
    },
    cancelOpen:(openId:string)=>request('/opening/'+encodeURIComponent(openId),'DELETE'),
    appearance:(id:string,theme:'light'|'dark',language:string)=>request('/apps/'+encodeURIComponent(id),'PATCH',{theme,language}),
  };
}
export type PluginAppClient=ReturnType<typeof createPluginAppClient>;
