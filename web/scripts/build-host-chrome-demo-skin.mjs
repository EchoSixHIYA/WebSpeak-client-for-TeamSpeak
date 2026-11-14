import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";

const source = new URL("../../docs/examples/host-chrome-demo/", import.meta.url);
const examples = new URL("../../docs/examples/", import.meta.url);
const publicDir = new URL("../public/", import.meta.url);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Build a tiny 24x24 RGBA PNG without any native image dependency. */
function iconPng(base, accent) {
  const size = 24;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const border = x < 2 || y < 2 || x > size - 3 || y > size - 3;
      const glyph = (x > 6 && x < 18 && y > 6 && y < 10) || (x > 10 && x < 14 && y > 6 && y < 18);
      const color = border ? accent : glyph ? [255, 255, 255] : base;
      const offset = y * stride + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const icons = {
  "assets/icons/language.png": iconPng([29, 79, 156], [16, 46, 96]),
  "assets/icons/skin.png": iconPng([22, 130, 106], [12, 76, 62]),
  "assets/icons/apps.png": iconPng([208, 108, 32], [128, 62, 12]),
  "assets/icons/settings.png": iconPng([92, 92, 118], [48, 48, 68]),
  "assets/icons/status.png": iconPng([150, 60, 90], [84, 28, 52]),
};

const [manifestText, cssText, chromeText] = await Promise.all([
  readFile(new URL("manifest.json", source), "utf8"),
  readFile(new URL("skin.css", source)),
  readFile(new URL("chrome.json", source), "utf8"),
]);

const chrome = JSON.parse(chromeText);
const sharedFiles = {
  "skin.css": new Uint8Array(cssText),
  ...Object.fromEntries(Object.entries(icons).map(([path, bytes]) => [path, new Uint8Array(bytes)])),
};

// Variant A: theming + bitmap icons only (watermark / hints / launcher visible).
const themedManifest = JSON.stringify({ ...JSON.parse(manifestText), id: "community.host-chrome-themed", name: "Host Chrome Themed" });
const themedChrome = JSON.stringify({ schemaVersion: 1, visibleParts: chrome.visibleParts, icons: chrome.icons });
const themed = zipSync({
  "manifest.json": strToU8(themedManifest),
  "chrome.json": strToU8(themedChrome),
  ...sharedFiles,
}, { level: 9 });

// Variant B: the same package plus declarative hiding of non-critical chrome.
const hidden = zipSync({
  "manifest.json": strToU8(manifestText),
  "chrome.json": strToU8(chromeText),
  ...sharedFiles,
}, { level: 9 });

await Promise.all([
  writeFile(new URL("host-chrome-themed.wskin", examples), themed),
  writeFile(new URL("host-chrome-demo.wskin", examples), hidden),
  writeFile(new URL("host-chrome-themed.wskin", publicDir), themed),
  writeFile(new URL("host-chrome-demo.wskin", publicDir), hidden),
]);

console.log(`Built host chrome demo skins (${themed.byteLength} / ${hidden.byteLength} bytes) into docs/examples and web/public.`);
