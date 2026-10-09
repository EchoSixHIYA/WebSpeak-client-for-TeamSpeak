import {
  createSkinExtensionApproval,
  parseSkinExtensionManifest,
  type SkinExtensionSessionStatus,
} from "../../../src/shared/skin-extension.js";
import {
  computeSkinRuntimePluginDigest,
  isSkinRuntimePluginApproved,
  parseSkinRuntimePluginApproval,
  type SkinRuntimePluginApproval,
} from "../../../src/shared/skin-runtime-plugin-approval.js";
import { parseSkinRuntimePluginDocument, type SkinRuntimePlugin } from "../../../src/shared/skin-runtime-plugins.js";
import {
  createSkinExtensionWasmSandboxPrototype,
  type SkinExtensionWasmSandboxHandle,
} from "./skin-extension-wasm-sandbox.js";

export class SkinRuntimePluginWasmError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinRuntimePluginWasmError";
  }
}

export interface SkinRuntimePluginWasmOptions {
  skinId: string;
  skinVersion: string;
  plugin: SkinRuntimePlugin;
  approval: unknown;
  files: Readonly<Record<string, Blob>>;
  uiInput?: unknown;
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus>;
  prototypeOnly: true;
}

const WASM_PROTOTYPE_PERMISSIONS = new Set(["session.status.read"]);

/** Starts a Wasm entry only after rechecking the exact package digest and local approval. */
export async function createSkinRuntimePluginWasmSandboxPrototype(
  options: SkinRuntimePluginWasmOptions,
): Promise<SkinExtensionWasmSandboxHandle> {
  if (options.prototypeOnly !== true) throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_PROTOTYPE_ONLY", "The Wasm runner is a development-only security prototype.");
  const plugin = parseSkinRuntimePluginDocument({ schemaVersion: 1, plugins: [options.plugin] }).plugins[0];
  if (plugin.runtime !== "wasm") throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_ENTRY_INVALID", "Only a Wasm plugin entry can use the bounded Wasm runner.");

  const unsupportedPermission = plugin.permissions.find((permission) => !WASM_PROTOTYPE_PERMISSIONS.has(permission));
  if (unsupportedPermission) {
    throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_PERMISSION_UNSUPPORTED", `The Wasm prototype does not implement ${unsupportedPermission}.`);
  }

  const digest = await computeSkinRuntimePluginDigest(plugin, options.files);
  let approval: SkinRuntimePluginApproval;
  try { approval = parseSkinRuntimePluginApproval(options.approval); }
  catch { throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_APPROVAL_INVALID", "The Wasm plugin does not have a valid local approval."); }
  if (!isSkinRuntimePluginApproved(approval, options.skinId, options.skinVersion, plugin, digest)) {
    throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_APPROVAL_INVALID", "The Wasm plugin approval does not match this skin, version, plugin, or package digest.");
  }

  const entry = options.files[plugin.entry];
  if (!(entry instanceof Blob)) throw new SkinRuntimePluginWasmError("SKIN_EXTENSION_WASM_ENTRY_INVALID", "The approved Wasm entry is unavailable.");
  const wasmBytes = new Uint8Array(await entry.arrayBuffer());
  const manifest = parseSkinExtensionManifest({
    schemaVersion: 1,
    packageType: "extension",
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    permissions: [...plugin.permissions],
  });

  // This legacy approval object is created only after the v4 digest-bound host approval above.
  return createSkinExtensionWasmSandboxPrototype({
    manifest,
    approval: createSkinExtensionApproval(manifest),
    wasmBytes,
    uiInput: options.uiInput,
    readSessionStatus: options.readSessionStatus,
    prototypeOnly: true,
  });
}
