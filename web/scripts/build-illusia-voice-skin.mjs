import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceDirectory = new URL("../../docs/examples/illusia-voice/", import.meta.url);

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(new URL(prefix, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collectFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const files = Object.fromEntries(await Promise.all((await collectFiles(sourceDirectory)).map(async (name) => [
  name,
  await readFile(new URL(name, sourceDirectory)),
])));
const archive = zipSync(files, { level: 9 });

await Promise.all([
  writeFile(fileURLToPath(new URL("../../docs/examples/illusia-voice.wskin", import.meta.url)), archive),
  writeFile(fileURLToPath(new URL("../public/skins/illusia-voice.wskin", import.meta.url)), archive),
]);
