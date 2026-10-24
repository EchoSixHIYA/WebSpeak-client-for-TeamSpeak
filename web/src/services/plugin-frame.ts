import { type PluginPackage } from "../../../src/shared/plugins.js";

/** The SDK never receives a voice socket, TS identity, cookie, or admin API. */
export function pluginFrameDocument(pack: PluginPackage, channel: string): string {
  const escape = (source: string, tag: string) => source.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
  const bootstrap = `(() => {
    const channel = ${JSON.stringify(channel)};
    const pending = new Map(), listeners = new Set(); let sequence = 0, context;
    const send = value => parent.postMessage({channel,...value}, '*');
    const ready = new Promise(resolve => window.addEventListener('message', function receive(event) {
      if(event.source !== parent || event.data?.channel !== channel) return;
      const m = event.data;
      if(m.type === 'context') { context=m.context; document.documentElement.dataset.theme=context.theme;
        document.getElementById('plugin-light').media=context.theme==='dark'?'not all':'all';
        document.getElementById('plugin-dark').media=context.theme==='dark'?'all':'not all'; resolve(context); }
      if(m.type === 'snapshot') for(const fn of listeners) { try {fn(m.snapshot);} catch {} }
      if(m.type === 'reply') { const task=pending.get(m.id); if(task) {pending.delete(m.id); clearTimeout(task.timer); m.error?task.reject(new Error(m.error)):task.resolve(m.result);} }
    }));
    const request = (method,args) => new Promise((resolve,reject) => {
      if(pending.size>=16) return reject(new Error('PLUGIN_RATE_LIMITED'));
      const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(new Error('PLUGIN_TIMEOUT'));},12000);
      pending.set(id,{resolve,reject,timer}); send({type:'request',id,method,args});
    });
    window.webspeak = Object.freeze({apiVersion:1,ready,
      room:Object.freeze({snapshot:()=>request('room.snapshot'),update:(revision,state)=>request('room.update',{revision,state}),
        subscribe(fn){listeners.add(fn); return ()=>listeners.delete(fn);}})});
    send({type:'ready'});
  })();`;
  // Opaque origin + no same-origin, popups, forms, navigation, fetch, or nested frames.
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; media-src https: http: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${escape(bootstrap,"script")}</script><style>html,body{margin:0;min-height:100%;font:15px system-ui}*{box-sizing:border-box}body{padding:20px}html[data-theme="dark"]{color-scheme:dark}</style><style id="plugin-light">${escape(pack.styles.light,"style")}</style><style id="plugin-dark" media="not all">${escape(pack.styles.dark,"style")}</style></head><body>${pack.html}<script>${escape(pack.script,"script")}</script></body></html>`;
}
