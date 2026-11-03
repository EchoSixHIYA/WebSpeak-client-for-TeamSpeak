import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/build-plugin.mjs APPLICATION_DIR OUTPUT.wplugin');
const root=path.resolve(input),manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.apiVersion!==2||manifest.permissions!==undefined)throw new Error('Application runtime v2 manifest required');
const validPath=value=>typeof value==='string'&&value.length<=500&&value.split('/').every(s=>/^[A-Za-z0-9._@+~-]+$/.test(s)&&!['.','..'].includes(s)&&!s.endsWith('.')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const files=Object.create(null);let total=0;
async function collect(directory){
 for(const entry of(await readdir(path.join(root,directory),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
  const name=directory+'/'+entry.name;if(!validPath(name)||entry.isSymbolicLink())throw new Error('Invalid package path: '+name);
  if(entry.isDirectory())await collect(name);
  else if(entry.isFile()){
   const bytes=await readFile(path.join(root,name));total+=bytes.length;
   if(bytes.length>16*1024*1024||total>32*1024*1024||Object.keys(files).length>=4096)throw new Error('Package size limit');
   try{files[name]={encoding:'utf8',data:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}
   catch{files[name]={encoding:'base64',data:bytes.toString('base64')};}
  }else throw new Error('Only ordinary files are supported: '+name);
 }
}
await collect('client');if(manifest.server)await collect('server');
if(!validPath(manifest.client?.entry)||!manifest.client.entry.startsWith('client/')||files[manifest.client.entry]?.encoding!=='utf8')throw new Error('Missing HTML client entry');
if(manifest.server&&(!validPath(manifest.server.entry)||!manifest.server.entry.startsWith('server/')||files[manifest.server.entry]?.encoding!=='utf8'))throw new Error('Missing bundled server entry');
const bytes=JSON.stringify({manifest,files});if(Buffer.byteLength(bytes)>48*1024*1024)throw new Error('Package size limit');
await writeFile(output,bytes);console.log(`${manifest.id} v${manifest.version} -> ${output}`);
