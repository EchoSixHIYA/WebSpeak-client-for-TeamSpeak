import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

// Ordinary trusted Node code: use your own modules, network clients and routes.
export default async function activate({ dataDir, signal }) {
  const filename=path.join(dataDir,'counter.json');
  let count=JSON.parse(await readFile(filename,'utf8').catch(()=> '0'));
  let writes=Promise.resolve();
  return {
    async handle(request,response) {
      if(request.method!=='POST'||new URL(request.url,'http://app.local').pathname!=='/my-counter'){response.writeHead(404);response.end();return;}
      // req.webspeak is host-authenticated context; it is not supplied by the browser.
      writes=writes.then(async()=>{count++;await writeFile(filename+'.tmp',JSON.stringify(count));await rename(filename+'.tmp',filename);});
      try{await writes;response.setHeader('content-type','application/json');response.end(JSON.stringify({count,participant:request.webspeak.self.id}));}
      catch{response.writeHead(500);response.end();}
    },
    async stop(){await writes.catch(()=>undefined);}
  };
}
