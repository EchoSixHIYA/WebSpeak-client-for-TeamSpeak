import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const chrome = [process.env.WEBSPEAK_TEST_CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]
  .find(candidate => candidate && existsSync(candidate));

test("real WebCodecs Opus encoding survives a VOX pause and reset", { skip: !chrome && "Chrome is not installed" }, async t => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const port = server.httpServer.address().port;
  const dom = await new Promise((resolve, reject) => {
    const child = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--virtual-time-budget=4000", "--dump-dom", `http://127.0.0.1:${port}/test/fixtures/opus-uplink-browser.html`]);
    let output = "", error = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { error += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Browser timed out")); }, 30_000);
    child.on("error", err => { clearTimeout(timer); reject(err); });
    child.on("exit", () => { clearTimeout(timer); output.includes('id="result"') ? resolve(output) : reject(new Error(error)); });
  });
  const result = JSON.parse(dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  assert.equal(result.error, undefined);
  assert.equal(result.initialized, true);
  assert.equal(result.before.active, true);
  assert.ok(result.before.frames > 0, JSON.stringify(result));
  assert.equal(result.after.active, true);
  assert.ok(result.after.frames > result.before.frames, JSON.stringify(result));
  assert.deepEqual(result.fallback, []);
});
