import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const interpreterRoot = path.join(repositoryRoot, "web", "skin-wasm-interpreter");
const sourceArtifact = path.join(interpreterRoot, "target", "wasm32-unknown-unknown", "release", "webspeak_skin_wasm_interpreter.wasm");
const publicDirectory = path.join(repositoryRoot, "web", "public");
const publicArtifact = path.join(publicDirectory, "skin-wasm-interpreter.wasm");
const rustFlags = "-C link-arg=--max-memory=67108864 -C panic=abort";

const result = spawnSync("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown"], {
  cwd: interpreterRoot,
  env: { ...process.env, RUSTFLAGS: rustFlags },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const artifactInfo = await stat(sourceArtifact);
if (artifactInfo.size < 8 || artifactInfo.size > 8 * 1024 * 1024) {
  throw new Error(`The Wasmi interpreter artifact has an unexpected size: ${artifactInfo.size} bytes.`);
}
const header = await readFile(sourceArtifact, { encoding: null, flag: "r" });
if (header[0] !== 0 || header[1] !== 0x61 || header[2] !== 0x73 || header[3] !== 0x6d) {
  throw new Error("The Wasmi interpreter build did not produce a WebAssembly module.");
}

await mkdir(publicDirectory, { recursive: true });
await copyFile(sourceArtifact, publicArtifact);
console.log(`Built bounded Wasmi interpreter (${artifactInfo.size} bytes) at web/public/skin-wasm-interpreter.wasm.`);
