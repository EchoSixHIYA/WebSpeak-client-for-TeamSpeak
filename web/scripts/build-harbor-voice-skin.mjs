import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceDirectory = new URL("../../docs/examples/harbor-voice/", import.meta.url);
const outputPath = fileURLToPath(new URL("../../docs/examples/harbor-voice.wskin", import.meta.url));
const files = Object.fromEntries(await Promise.all(["manifest.json", "components.json", "skin.css"].map(async (name) => [
  name,
  await readFile(new URL(name, sourceDirectory)),
])));

await writeFile(outputPath, zipSync(files, { level: 9 }));
