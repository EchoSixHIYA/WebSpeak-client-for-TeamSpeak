import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceDirectory = new URL("../../docs/examples/discord-voice/", import.meta.url);
const sourceFiles = ["manifest.json", "components.json", "content.json", "skin.css"];
const files = Object.fromEntries(await Promise.all(sourceFiles.map(async (name) => [
  name,
  Buffer.from((await readFile(new URL(name, sourceDirectory), "utf8")).replace(/\r\n/g, "\n")),
])));
const archive = zipSync(files, { level: 9, mtime: new Date("2020-01-01T00:00:00.000Z") });

await writeFile(fileURLToPath(new URL("../../docs/examples/discord-voice.wskin", import.meta.url)), archive);
