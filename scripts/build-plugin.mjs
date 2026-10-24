import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePluginPackage } from '../src/shared/plugins.ts';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node --import tsx scripts/build-plugin.mjs SOURCE_DIR OUTPUT.wplugin');
const read = file => readFile(path.join(input, file), 'utf8');
const pack = parsePluginPackage({manifest:JSON.parse(await read('manifest.json')),html:await read('panel.html'),script:await read('player.js'),styles:{light:await read('light.css'),dark:await read('dark.css')}});
await writeFile(output, JSON.stringify(pack));
console.log(`${pack.manifest.id} v${pack.manifest.version} -> ${output}`);
