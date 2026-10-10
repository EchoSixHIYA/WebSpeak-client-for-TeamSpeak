import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceDirectory = new URL("../../docs/examples/kaak-voice/", import.meta.url);
const sourceFiles = ["manifest.json", "components.json", "content.json", "skin.css"];
const files = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name,
  await readFile(new URL(name, sourceDirectory)),
])));
const archive = zipSync(files, { level: 9 });

await Promise.all([
  writeFile(fileURLToPath(new URL("../../docs/examples/kaak-voice.wskin", import.meta.url)), archive),
  writeFile(fileURLToPath(new URL("../public/skins/kaak-voice.wskin", import.meta.url)), archive),
]);
