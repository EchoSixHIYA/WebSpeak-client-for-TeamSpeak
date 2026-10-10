/** Safe, declarative UI extensions shipped inside a v3 skin package.
 * Extension authors provide a bounded component tree and action declarations,
 * never executable HTML, JavaScript, or browser APIs.
 */
export const SKIN_PLUGIN_SCHEMA_VERSION = 3 as const;
export const SKIN_PLUGIN_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2, 3] as const);
export const SKIN_PLUGIN_DOCUMENT_LIMIT_BYTES = 256 * 1024;
export const SKIN_PLUGIN_COMPONENT_LIMIT = 128;
export const SKIN_PLUGIN_NODE_LIMIT = 2048;
export const SKIN_PLUGIN_TREE_DEPTH_LIMIT = 32;
export const SKIN_PLUGIN_REPEAT_LIMIT = 250;
export const SKIN_PLUGIN_RENDER_NODE_LIMIT = 8192;

export const SKIN_PLUGIN_PERMISSIONS = Object.freeze({
  "ui.surface.replace": Object.freeze({ policyVersion: 1, description: "Replace the built-in public page with a custom skin surface; the host recovery controls remain available." }),
  "ui.input.read": Object.freeze({ policyVersion: 1, description: "Read values entered or autofilled in this plugin's own input fields. Never enter passwords or other secrets." }),
  "session.status.read": Object.freeze({ policyVersion: 1, description: "Read the current connection and channel summary." }),
  "session.channels.read": Object.freeze({ policyVersion: 1, description: "Read the public TeamSpeak channel tree; the demo page uses synthetic sample data." }),
  "session.members.read": Object.freeze({ policyVersion: 1, description: "Read visible member names and speaking states; the demo page uses synthetic sample data." }),
  "chat.channel.read": Object.freeze({ policyVersion: 1, description: "Read the current public text channel; the demo page uses synthetic sample data." }),
  "chat.channel.send": Object.freeze({ policyVersion: 1, description: "Send to the current public text channel; the demo page only simulates this action." }),
  "favorites.read": Object.freeze({ policyVersion: 1, description: "Read favorite labels and opaque local identifiers, without server addresses or credentials." }),
  "favorites.switch": Object.freeze({ policyVersion: 1, description: "Select a saved TeamSpeak server using the host's connection flow." }),
  "servers.quickList.read": Object.freeze({ policyVersion: 1, description: "Read favorite and recent server labels and opaque local identifiers, without server addresses or credentials." }),
  "servers.quickList.switch": Object.freeze({ policyVersion: 1, description: "Switch to a user-selected favorite or recent server through the host connection flow." }),
  "session.channel.join": Object.freeze({ policyVersion: 1, description: "Request joining a visible TeamSpeak channel through the host; the demo page only changes simulated state." }),
  "audio.status.read": Object.freeze({ policyVersion: 1, description: "Read the user's own microphone and speaker mute states." }),
  "audio.microphone.control": Object.freeze({ policyVersion: 1, description: "Toggle the user's own microphone through WebSpeak's audio pipeline." }),
  "audio.output.control": Object.freeze({ policyVersion: 1, description: "Toggle or adjust the user's local speaker output." }),
  "voice.presence.write": Object.freeze({ policyVersion: 1, description: "Set the user's own away status through the connected TeamSpeak session." }),
  "voice.whisper.control": Object.freeze({ policyVersion: 1, description: "Enable or disable the user's existing TeamSpeak whisper target selection." }),
  "voice.disconnect": Object.freeze({ policyVersion: 1, description: "Disconnect the user's current TeamSpeak voice session." }),
  "voice.whisper.status.read": Object.freeze({ policyVersion: 1, description: "Read whether whisper is active and how many existing targets are selected." }),
  "voice.screenShare.status.read": Object.freeze({ policyVersion: 1, description: "Read the user's own screen-share state." }),
  "voice.screenShare.read": Object.freeze({ policyVersion: 1, description: "Read visible screen-share names, owners, audio flags, and viewer counts." }),
  "voice.screenShare.control": Object.freeze({ policyVersion: 1, description: "Start or stop the user's screen share, or join/leave a visible share through the host." }),
} as const);

export type SkinPluginPermission = keyof typeof SKIN_PLUGIN_PERMISSIONS;
export type SkinPluginPage = "home" | "voice" | "demo";
export type SkinPluginComponentMode = "widget" | "surface";
export const SKIN_PLUGIN_HOST_WIDGETS = Object.freeze([
  "home.connection-form",
  "app.skin-switcher",
  "app.language-switcher",
  "voice.channel-panel",
  "voice.member-cards",
  "voice.chat-panel",
  "voice.audio-controls",
  "voice.screen-share-player",
  "voice.screen-share-start",
  "voice.whisper-controls",
  "voice.performance-panel",
  "voice.connection-controls",
  "voice.disconnect-control",
] as const);
export type SkinPluginHostWidget = typeof SKIN_PLUGIN_HOST_WIDGETS[number];
const widgetPermissions = (...permissions: SkinPluginPermission[]): readonly SkinPluginPermission[] => Object.freeze(permissions);
export const SKIN_PLUGIN_HOST_WIDGET_PERMISSIONS: Partial<Record<SkinPluginHostWidget, readonly SkinPluginPermission[]>> = Object.freeze({
  "voice.audio-controls": widgetPermissions("audio.status.read", "audio.microphone.control", "audio.output.control"),
  "voice.chat-panel": widgetPermissions("chat.channel.read", "chat.channel.send"),
  "voice.connection-controls": widgetPermissions("voice.disconnect"),
  "voice.disconnect-control": widgetPermissions("voice.disconnect"),
  "voice.member-cards": widgetPermissions("session.members.read", "voice.screenShare.read", "voice.screenShare.control"),
  "voice.screen-share-player": widgetPermissions("voice.screenShare.read", "voice.screenShare.control"),
  "voice.screen-share-start": widgetPermissions("voice.screenShare.control"),
  "voice.whisper-controls": widgetPermissions("voice.whisper.status.read", "voice.whisper.control"),
});
export function missingSkinPluginWidgetPermission(
  widget: SkinPluginHostWidget,
  permissions: readonly SkinPluginPermission[],
): SkinPluginPermission | undefined {
  return SKIN_PLUGIN_HOST_WIDGET_PERMISSIONS[widget]?.find((permission) => !permissions.includes(permission));
}
export type SkinPluginEvent =
  | "click" | "dblclick" | "change" | "input" | "submit" | "keydown"
  | "keyup" | "contextmenu" | "focus" | "blur" | "pointerdown" | "pointerup"
  | "pointerenter" | "pointerleave" | "dragstart" | "dragover" | "drop";
export type SkinPluginAction =
  | "ui.setState" | "ui.toggleState"
  | "voice.joinChannel" | "favorites.switch" | "quickServers.switch" | "chat.sendMessage"
  | "voice.toggleMicrophone" | "voice.toggleOutputMute" | "voice.setOutputVolume"
  | "voice.disconnect" | "voice.setAway" | "voice.setWhisperActive"
  | "voice.startScreenShare" | "voice.stopScreenShare" | "voice.joinScreenShare" | "voice.leaveScreenShare";

export interface SkinPluginActionDefinition {
  type: SkinPluginAction;
  args: Record<string, string | number | boolean>;
}

export interface SkinPluginNode {
  widget?: SkinPluginHostWidget;
  tag?: string;
  text?: string;
  part?: string;
  className?: string;
  attributes?: Record<string, string | number | boolean>;
  asset?: string;
  bindValue?: string;
  repeat?: { path: string; as: string };
  when?: { path: string; equals?: string | number | boolean; empty?: boolean };
  events?: Partial<Record<SkinPluginEvent, string>>;
  children?: SkinPluginNode[];
}

export interface SkinPluginComponent {
  id: string;
  name: string;
  page: SkinPluginPage;
  mode?: SkinPluginComponentMode;
  accessibleName: string;
  permissions: SkinPluginPermission[];
  state?: Record<string, string | number | boolean>;
  /** Internal marker used only for generated Wasm views; rejected by package JSON validation. */
  runtimeCallbacks?: boolean;
  actions: Record<string, SkinPluginActionDefinition>;
  root: SkinPluginNode;
}

export interface SkinPluginDocument {
  schemaVersion: 1 | 2 | typeof SKIN_PLUGIN_SCHEMA_VERSION;
  components: SkinPluginComponent[];
}

export interface SkinPluginApproval {
  pluginId: string;
  policyVersions: Partial<Record<SkinPluginPermission, number>>;
}

export class SkinPluginValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinPluginValidationError";
  }
}

const ELEMENTS = new Set([
  "article", "aside", "b", "blockquote", "br", "button", "caption", "circle", "cite", "code", "dd", "del", "details", "div", "dl", "dt",
  "em", "fieldset", "figcaption", "figure", "footer", "form", "g", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input",
  "kbd", "label", "legend", "li", "line", "main", "mark", "nav", "ol", "option", "output", "p", "path", "polyline", "pre", "progress", "q",
  "rect", "s", "section", "select", "small", "span", "strong", "sub", "summary", "sup", "svg", "table", "tbody", "td", "textarea", "th", "thead",
  "time", "tr", "u", "ul", "wbr",
]);
const VOID_ELEMENTS = new Set(["br", "circle", "hr", "img", "input", "line", "path", "polyline", "rect", "wbr"]);
const ATTRIBUTES = new Set([
  "alt", "aria-current", "aria-expanded", "aria-hidden", "aria-label", "aria-pressed", "aria-selected", "autocomplete", "checked", "class", "colspan", "disabled", "draggable", "fill", "height", "inputmode", "max", "maxlength", "min",
  "minlength", "multiple", "name", "open", "placeholder", "required", "role", "rows", "rowspan", "step", "stroke", "stroke-linecap", "stroke-linejoin",
  "stroke-width", "tabindex", "title", "type", "value", "viewbox", "width", "x", "x1", "x2", "y", "y1", "y2",
]);
const EVENTS = new Set<string>([
  "click", "dblclick", "change", "input", "submit", "keydown", "keyup", "contextmenu", "focus", "blur", "pointerdown", "pointerup",
  "pointerenter", "pointerleave", "dragstart", "dragover", "drop",
]);
const V3_EVENTS = new Set<string>([
  "keyup", "contextmenu", "focus", "blur", "pointerdown", "pointerup", "pointerenter", "pointerleave", "dragstart", "dragover", "drop",
]);
const PASSIVE_EVENTS = new Set<string>(["focus", "blur", "pointerenter", "pointerleave", "dragstart", "dragover"]);
const ACTIONS = new Set<string>([
  "ui.setState", "ui.toggleState", "voice.joinChannel", "favorites.switch", "quickServers.switch", "chat.sendMessage",
  "voice.toggleMicrophone", "voice.toggleOutputMute", "voice.setOutputVolume", "voice.disconnect", "voice.setAway", "voice.setWhisperActive",
  "voice.startScreenShare", "voice.stopScreenShare", "voice.joinScreenShare", "voice.leaveScreenShare",
]);
const V3_ACTIONS = new Set<string>([
  "ui.toggleState", "voice.toggleMicrophone", "voice.toggleOutputMute", "voice.setOutputVolume", "voice.disconnect", "voice.setAway",
  "voice.setWhisperActive", "voice.startScreenShare", "voice.stopScreenShare", "voice.joinScreenShare", "voice.leaveScreenShare",
]);
const PERMISSIONS = new Set<string>(Object.keys(SKIN_PLUGIN_PERMISSIONS));
const HOST_WIDGETS = new Set<string>(SKIN_PLUGIN_HOST_WIDGETS);
const ACTION_ARGS: Record<SkinPluginAction, ReadonlySet<string>> = {
  "ui.setState": new Set(["key", "value"]),
  "ui.toggleState": new Set(["key"]),
  "voice.joinChannel": new Set(["channelId"]),
  "favorites.switch": new Set(["favoriteId"]),
  "quickServers.switch": new Set(["quickServerId"]),
  "chat.sendMessage": new Set(["text"]),
  "voice.toggleMicrophone": new Set([]),
  "voice.toggleOutputMute": new Set([]),
  "voice.setOutputVolume": new Set(["volume"]),
  "voice.disconnect": new Set([]),
  "voice.setAway": new Set(["away", "message"]),
  "voice.setWhisperActive": new Set(["active"]),
  "voice.startScreenShare": new Set([]),
  "voice.stopScreenShare": new Set([]),
  "voice.joinScreenShare": new Set(["streamId"]),
  "voice.leaveScreenShare": new Set([]),
};
const ACTION_PERMISSION: Record<SkinPluginAction, SkinPluginPermission | null> = {
  "ui.setState": null,
  "ui.toggleState": null,
  "voice.joinChannel": "session.channel.join",
  "favorites.switch": "favorites.switch",
  "quickServers.switch": "servers.quickList.switch",
  "chat.sendMessage": "chat.channel.send",
  "voice.toggleMicrophone": "audio.microphone.control",
  "voice.toggleOutputMute": "audio.output.control",
  "voice.setOutputVolume": "audio.output.control",
  "voice.disconnect": "voice.disconnect",
  "voice.setAway": "voice.presence.write",
  "voice.setWhisperActive": "voice.whisper.control",
  "voice.startScreenShare": "voice.screenShare.control",
  "voice.stopScreenShare": "voice.screenShare.control",
  "voice.joinScreenShare": "voice.screenShare.control",
  "voice.leaveScreenShare": "voice.screenShare.control",
};
export const SKIN_PLUGIN_ACTION_PERMISSIONS: readonly SkinPluginPermission[] = Object.freeze([...new Set(
  Object.values(ACTION_PERMISSION).filter((permission): permission is SkinPluginPermission => permission !== null),
)]);
const COLLECTION_PERMISSION: Record<string, SkinPluginPermission> = {
  "session.channels": "session.channels.read",
  "session.members": "session.members.read",
  "favorites.items": "favorites.read",
  "servers.quickList": "servers.quickList.read",
  "chat.messages": "chat.channel.read",
  "screenShare.streams": "voice.screenShare.read",
};
const COLLECTION_FIELDS: Record<string, ReadonlySet<string>> = {
  "session.channels": new Set(["id", "name", "parentId", "depth", "memberCount", "current"]),
  "session.members": new Set(["id", "name", "channelId", "status", "speaking", "self"]),
  "favorites.items": new Set(["id", "label", "current", "kind"]),
  "servers.quickList": new Set(["id", "label", "current", "kind", "favorite"]),
  "chat.messages": new Set(["id", "author", "text", "time", "kind", "channelId"]),
  "screenShare.streams": new Set(["streamId", "source", "ownerClientId", "ownerNickname", "name", "audio", "viewerCount"]),
};
const SESSION_STATUS_FIELDS = new Set(["connected", "connecting", "serverLabel", "channelId", "channelName", "userName"]);
const CONTEXT_FIELDS: Record<string, ReadonlySet<string>> = {
  "audio.status": new Set(["microphoneMuted", "outputMuted"]),
  "screenShare.status": new Set(["active", "starting", "viewing"]),
  "whisper.status": new Set(["active", "targetCount"]),
};
const CONTEXT_PERMISSIONS: Record<string, SkinPluginPermission> = {
  "audio.status": "audio.status.read",
  "screenShare.status": "voice.screenShare.status.read",
  "whisper.status": "voice.whisper.status.read",
};

function fail(code: string, message: string): never { throw new SkinPluginValidationError(code, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, context: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail("SKIN_PLUGIN_FIELD_INVALID", `${context} contains an unsupported field: ${unknown}.`);
}
function boundedText(value: unknown, field: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value !== value.trim()) fail("SKIN_PLUGIN_FIELD_INVALID", `${field} must be a non-empty bounded string.`);
  return value;
}
function identifier(value: unknown, field: string): string {
  const result = boundedText(value, field, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(result)) fail("SKIN_PLUGIN_FIELD_INVALID", `${field} must use a lowercase identifier.`);
  return result;
}
function bindingPermissions(value: string, aliases: ReadonlyMap<string, string>, stateKeys: ReadonlySet<string>): SkinPluginPermission[] {
  const found = new Set<SkinPluginPermission>();
  for (const match of value.matchAll(/\{\{\s*([a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,5})\s*\}\}/g)) {
    const path = match[1].split(".");
    if (path[0] === "state") {
      if (path.length !== 2 || !stateKeys.has(path[1])) fail("SKIN_PLUGIN_BINDING_INVALID", "A state binding must reference a declared local state key.");
      continue;
    }
    const aliasCollection = aliases.get(path[0]);
    if (aliasCollection) {
      if (path.length !== 2 || !COLLECTION_FIELDS[aliasCollection]?.has(path[1])) fail("SKIN_PLUGIN_BINDING_INVALID", "A repeated item binding references an unsupported public field.");
      continue;
    }
    if (path[0] === "session" && path.length === 3 && path[1] === "status" && SESSION_STATUS_FIELDS.has(path[2])) {
      found.add("session.status.read");
      continue;
    }
    const contextPath = path.slice(0, 2).join(".");
    if (path.length === 3 && CONTEXT_FIELDS[contextPath]?.has(path[2])) {
      found.add(CONTEXT_PERMISSIONS[contextPath]);
      continue;
    }
    const collectionPath = path.slice(0, 2).join(".");
    const permission = COLLECTION_PERMISSION[collectionPath];
    if (permission && (path.length === 2 || (path.length === 3 && COLLECTION_FIELDS[collectionPath].has(path[2])))) {
      found.add(permission);
      continue;
    }
    fail("SKIN_PLUGIN_BINDING_INVALID", `The data path ${match[1]} is not available to skin components.`);
  }
  if (/\{\{[^}]*\}\}/.test(value.replace(/\{\{\s*[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,5}\s*\}\}/g, ""))) {
    fail("SKIN_PLUGIN_BINDING_INVALID", "A component binding must use a simple registered data path.");
  }
  return [...found];
}

export function parseSkinPluginDocument(input: unknown): SkinPluginDocument {
  if (!isRecord(input)) fail("SKIN_PLUGIN_DOCUMENT_INVALID", "components.json must contain an object.");
  onlyKeys(input, new Set(["schemaVersion", "components"]), "components.json");
  if (!SKIN_PLUGIN_SUPPORTED_SCHEMA_VERSIONS.includes(input.schemaVersion as 1 | 2 | 3) || !Array.isArray(input.components)
    || (input.schemaVersion !== 3 && !input.components.length)
    || input.components.length > (input.schemaVersion === 3 ? SKIN_PLUGIN_COMPONENT_LIMIT : 32)) {
    fail("SKIN_PLUGIN_DOCUMENT_INVALID", "components.json uses an unsupported schema or component count.");
  }
  const ids = new Set<string>();
  const inputSchemaVersion = input.schemaVersion as 1 | 2 | 3;
  const components = input.components.map((rawComponent, componentIndex): SkinPluginComponent => {
    if (!isRecord(rawComponent)) fail("SKIN_PLUGIN_COMPONENT_INVALID", `Component ${componentIndex} must be an object.`);
    onlyKeys(rawComponent, new Set(["id", "name", "page", "mode", "accessibleName", "permissions", "actions", "state", "root"]), "Skin plugin component");
    if (inputSchemaVersion === 1 && rawComponent.mode !== undefined) fail("SKIN_PLUGIN_SCHEMA_UNSUPPORTED", "Page surfaces require components schema version 2.");
    const id = identifier(rawComponent.id, "component.id");
    if (ids.has(id)) fail("SKIN_PLUGIN_COMPONENT_DUPLICATE", "Component IDs must be unique within the skin.");
    ids.add(id);
    if (!(rawComponent.page === "home" || rawComponent.page === "voice" || rawComponent.page === "demo")) fail("SKIN_PLUGIN_COMPONENT_INVALID", "A plugin component must target a public page.");
    const page = rawComponent.page as SkinPluginPage;
    const mode = rawComponent.mode === undefined ? "widget" : rawComponent.mode;
    if (mode !== "widget" && mode !== "surface") fail("SKIN_PLUGIN_COMPONENT_INVALID", "A component mode must be widget or surface.");
    if (mode === "surface" && page === "demo") fail("SKIN_PLUGIN_COMPONENT_INVALID", "Page surfaces are supported only for the home and voice client pages.");
    const name = boundedText(rawComponent.name, "component.name", 80);
    const accessibleName = boundedText(rawComponent.accessibleName, "component.accessibleName", 120);
    if (!Array.isArray(rawComponent.permissions) || rawComponent.permissions.length > (inputSchemaVersion >= 3 ? 32 : 11)) fail("SKIN_PLUGIN_PERMISSION_INVALID", "A component requests too many explicit permissions.");
    const permissions: SkinPluginPermission[] = [];
    for (const permission of rawComponent.permissions) {
      if (typeof permission !== "string" || !PERMISSIONS.has(permission)) fail("SKIN_PLUGIN_PERMISSION_UNKNOWN", "The component requests an unsupported permission.");
      if (permissions.includes(permission as SkinPluginPermission)) fail("SKIN_PLUGIN_PERMISSION_DUPLICATE", "A component permission is duplicated.");
      permissions.push(permission as SkinPluginPermission);
    }
    if (mode === "surface" && !permissions.includes("ui.surface.replace")) {
      fail("SKIN_PLUGIN_PERMISSION_MISSING", "A page surface requires ui.surface.replace so users can approve page replacement explicitly.");
    }
    const state: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
    if (rawComponent.state !== undefined) {
      if (!isRecord(rawComponent.state) || Object.keys(rawComponent.state).length > (inputSchemaVersion >= 3 ? 64 : 32)) fail("SKIN_PLUGIN_STATE_INVALID", "A component declares too many local state values.");
      for (const [key, value] of Object.entries(rawComponent.state)) {
        identifier(key, "state.key");
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") fail("SKIN_PLUGIN_STATE_INVALID", "Component state values must be scalar.");
        if (typeof value === "string" && value.length > 512) fail("SKIN_PLUGIN_STATE_INVALID", "A component state string exceeds its limit.");
        state[key] = value;
      }
    }
    const stateKeys = new Set(Object.keys(state));
    if (!isRecord(rawComponent.actions)) fail("SKIN_PLUGIN_ACTION_INVALID", "A component must declare an action map.");
    const actionEntries = Object.entries(rawComponent.actions);
    if (actionEntries.length > (inputSchemaVersion >= 3 ? 64 : 24)) fail("SKIN_PLUGIN_ACTION_INVALID", "A component declares too many actions.");
    const actions: Record<string, SkinPluginActionDefinition> = Object.create(null) as Record<string, SkinPluginActionDefinition>;
    for (const [actionId, rawAction] of actionEntries) {
      identifier(actionId, "action.id");
      if (!isRecord(rawAction)) fail("SKIN_PLUGIN_ACTION_INVALID", "An action must be an object.");
      onlyKeys(rawAction, new Set(["type", "args"]), "Component action");
      if (typeof rawAction.type !== "string" || !ACTIONS.has(rawAction.type)) fail("SKIN_PLUGIN_ACTION_UNKNOWN", "An action type is not supported by the host.");
      if (inputSchemaVersion < 3 && V3_ACTIONS.has(rawAction.type)) fail("SKIN_PLUGIN_SCHEMA_UNSUPPORTED", "This action requires components schema version 3.");
      if (!isRecord(rawAction.args)) fail("SKIN_PLUGIN_ACTION_INVALID", "An action must define an argument object.");
      const requiredPermission = ACTION_PERMISSION[rawAction.type as SkinPluginAction];
      if (requiredPermission && !permissions.includes(requiredPermission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The ${rawAction.type} action requires ${requiredPermission}.`);
      if (Object.keys(rawAction.args).length > 8) fail("SKIN_PLUGIN_ACTION_INVALID", "An action has too many arguments.");
      const args: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
      for (const [key, value] of Object.entries(rawAction.args)) {
        if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(key) || !ACTION_ARGS[rawAction.type as SkinPluginAction].has(key)) fail("SKIN_PLUGIN_ACTION_INVALID", "An action uses an unsupported argument name.");
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") fail("SKIN_PLUGIN_ACTION_INVALID", "Action arguments must be static scalars or simple data bindings.");
        if (typeof value === "string") {
          if (value.length > 512) fail("SKIN_PLUGIN_ACTION_INVALID", "An action argument exceeds its length limit.");
        }
        args[key] = value;
      }
      if (rawAction.type === "ui.setState" && (typeof args.key !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(args.key) || !stateKeys.has(args.key) || !("value" in args))) {
        fail("SKIN_PLUGIN_ACTION_INVALID", "ui.setState requires a local state key and value.");
      }
      if (rawAction.type === "ui.toggleState" && (typeof args.key !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(args.key) || !stateKeys.has(args.key) || typeof state[args.key] !== "boolean")) {
        fail("SKIN_PLUGIN_ACTION_INVALID", "ui.toggleState requires a declared boolean local state key.");
      }
      if (rawAction.type === "voice.joinChannel" && typeof args.channelId !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "voice.joinChannel requires a channelId binding.");
      if (rawAction.type === "favorites.switch" && typeof args.favoriteId !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "favorites.switch requires a favoriteId binding.");
      if (rawAction.type === "quickServers.switch" && typeof args.quickServerId !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "quickServers.switch requires a quickServerId binding.");
      if (rawAction.type === "chat.sendMessage" && typeof args.text !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "chat.sendMessage requires a text binding.");
      if (rawAction.type === "voice.setOutputVolume" && typeof args.volume !== "number" && typeof args.volume !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "voice.setOutputVolume requires a volume value.");
      if (rawAction.type === "voice.setAway" && typeof args.away !== "boolean") fail("SKIN_PLUGIN_ACTION_INVALID", "voice.setAway requires an away boolean.");
      if (rawAction.type === "voice.setWhisperActive" && typeof args.active !== "boolean") fail("SKIN_PLUGIN_ACTION_INVALID", "voice.setWhisperActive requires an active boolean.");
      if (rawAction.type === "voice.joinScreenShare" && typeof args.streamId !== "string") fail("SKIN_PLUGIN_ACTION_INVALID", "voice.joinScreenShare requires a visible streamId.");
      actions[actionId] = { type: rawAction.type as SkinPluginAction, args };
    }
    let componentNodes = 0;
    const walk = (rawNode: unknown, depth: number, aliases: ReadonlyMap<string, string> = new Map()): SkinPluginNode => {
      componentNodes += 1;
      if (componentNodes > (inputSchemaVersion >= 3 ? SKIN_PLUGIN_NODE_LIMIT : 256)) fail("SKIN_PLUGIN_COMPLEXITY_LIMIT", "A component contains too many template nodes.");
      if (depth > (inputSchemaVersion >= 3 ? SKIN_PLUGIN_TREE_DEPTH_LIMIT : 16) || !isRecord(rawNode)) fail("SKIN_PLUGIN_TREE_INVALID", "A component tree is too deep or contains an invalid node.");
      onlyKeys(rawNode, new Set(["widget", "tag", "text", "part", "className", "attributes", "asset", "bindValue", "repeat", "when", "events", "children"]), "Component node");
      if (inputSchemaVersion === 1 && rawNode.widget !== undefined) fail("SKIN_PLUGIN_SCHEMA_UNSUPPORTED", "Host widgets require components schema version 2.");
      const nodeKinds = Number(rawNode.widget !== undefined) + Number(rawNode.tag !== undefined) + Number(rawNode.text !== undefined);
      if (nodeKinds !== 1) fail("SKIN_PLUGIN_TREE_INVALID", "Each component node must define exactly one of widget, tag, or text.");
      const node: SkinPluginNode = {};
      if (rawNode.widget !== undefined) {
        if (typeof rawNode.widget !== "string" || !HOST_WIDGETS.has(rawNode.widget)) fail("SKIN_PLUGIN_WIDGET_INVALID", "The component requests an unsupported host widget.");
        if (page === "demo") fail("SKIN_PLUGIN_WIDGET_INVALID", "Host widgets are available only on the home and voice client pages.");
        // Preserve existing schema v2 packages; newly authored v3 widgets must declare every
        // permission needed by the trusted host UI they embed. Screen-share start was already gated.
        const requiredPermission = inputSchemaVersion >= 3 || rawNode.widget === "voice.screen-share-start"
          ? missingSkinPluginWidgetPermission(rawNode.widget as SkinPluginHostWidget, permissions)
          : undefined;
        if (requiredPermission) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The ${rawNode.widget} widget requires ${requiredPermission}.`);
        const widgetOnlyKeys = new Set(["widget", "part", "className", "when"]);
        onlyKeys(rawNode, widgetOnlyKeys, "Host widget node");
        node.widget = rawNode.widget as SkinPluginHostWidget;
      }
      if (rawNode.tag !== undefined) {
        if (typeof rawNode.tag !== "string" || !ELEMENTS.has(rawNode.tag)) fail("SKIN_PLUGIN_ELEMENT_INVALID", "The component uses an unsupported HTML element.");
        node.tag = rawNode.tag;
      }
      if (rawNode.text !== undefined) {
        node.text = boundedText(rawNode.text, "node.text", 2048);
        for (const permission of bindingPermissions(node.text, aliases, stateKeys)) {
          if (!permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The component data requires ${permission}.`);
        }
      }
      if (rawNode.part !== undefined) node.part = identifier(rawNode.part, "node.part");
      if (rawNode.className !== undefined) {
        if (typeof rawNode.className !== "string" || rawNode.className.length > 160 || /[<>]/.test(rawNode.className)) fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "Component class names must be bounded plain text.");
        node.className = rawNode.className;
      }
      if (rawNode.attributes !== undefined) {
        if (!isRecord(rawNode.attributes) || Object.keys(rawNode.attributes).length > (inputSchemaVersion >= 3 ? 48 : 24)) fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "Component attributes must be a small object.");
        const attrs: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
        for (const [key, value] of Object.entries(rawNode.attributes)) {
          const lowerKey = key.toLowerCase();
          const isAriaOrData = inputSchemaVersion >= 3 && /^(?:aria|data)-[a-z][a-z0-9-]{0,47}$/.test(lowerKey);
          if ((!ATTRIBUTES.has(lowerKey) && !isAriaOrData) || lowerKey.startsWith("on") || key !== lowerKey) fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "The component uses an unsupported or executable attribute.");
          if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "Component attributes must be scalar values.");
          if (typeof value === "string" && ["fill", "stroke"].includes(lowerKey) && /\burl\s*\(|javascript\s*:/i.test(value)) fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "SVG paint attributes cannot load external or executable resources.");
          if (typeof value === "string") {
            for (const permission of bindingPermissions(value, aliases, stateKeys)) {
              if (!permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The component data requires ${permission}.`);
            }
            if (value.length > 512) fail("SKIN_PLUGIN_ATTRIBUTE_INVALID", "A component attribute exceeds its length limit.");
          }
          attrs[key] = value;
        }
        node.attributes = attrs;
      }
      if (rawNode.asset !== undefined) {
        const asset = boundedText(rawNode.asset, "node.asset", 120);
        if (node.tag !== "img") fail("SKIN_PLUGIN_ASSET_INVALID", "Package image assets can only be attached to img elements.");
        if (!/^assets\/[a-zA-Z0-9._/-]+$/.test(asset) || asset.split("/").some((part) => !part || part === "." || part === "..")) fail("SKIN_PLUGIN_ASSET_INVALID", "Component assets must use safe package-relative paths.");
        node.asset = asset;
      }
      if (rawNode.bindValue !== undefined) {
        const key = identifier(rawNode.bindValue, "node.bindValue");
        if (node.tag !== "input" && node.tag !== "select" && node.tag !== "textarea") fail("SKIN_PLUGIN_BINDING_INVALID", "Only input, select, and textarea elements can bind local state.");
        if (!stateKeys.has(key)) fail("SKIN_PLUGIN_BINDING_INVALID", "A bound form control must reference a declared local state key.");
        node.bindValue = key;
      }
      if (rawNode.repeat !== undefined) {
        if (!isRecord(rawNode.repeat)) fail("SKIN_PLUGIN_REPEAT_INVALID", "A repeat declaration must be an object.");
        onlyKeys(rawNode.repeat, new Set(["path", "as"]), "Repeat declaration");
        const path = boundedText(rawNode.repeat.path, "repeat.path", 120);
        const nestedChannelMembers = path.split(".").length === 2
          && path.endsWith(".members")
          && aliases.get(path.slice(0, path.lastIndexOf("."))) === "session.channels";
        if (!(path === "session.channels" || path === "session.members" || path === "favorites.items" || path === "servers.quickList" || path === "chat.messages" || path === "screenShare.streams" || nestedChannelMembers)) {
          fail("SKIN_PLUGIN_REPEAT_INVALID", "A component may repeat only a registered public collection or the members of a repeated channel.");
        }
        const permission = nestedChannelMembers ? "session.members.read" : COLLECTION_PERMISSION[path];
        if (!permission || !permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `Repeating ${path} requires ${permission ?? "a registered collection permission"}.`);
        const alias = identifier(rawNode.repeat.as, "repeat.as");
        if (aliases.has(alias)) fail("SKIN_PLUGIN_REPEAT_INVALID", "Repeat aliases cannot shadow an existing alias.");
        node.repeat = { path, as: alias };
      }
      if (rawNode.when !== undefined) {
        if (!isRecord(rawNode.when)) fail("SKIN_PLUGIN_CONDITION_INVALID", "A condition must be an object.");
        onlyKeys(rawNode.when, new Set(inputSchemaVersion >= 3 ? ["path", "equals", "empty"] : ["path", "equals"]), "Component condition");
        const path = boundedText(rawNode.when.path, "condition.path", 120);
        for (const permission of bindingPermissions(`{{${path}}}`, aliases, stateKeys)) {
          if (!permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The condition data requires ${permission}.`);
        }
        const equals = rawNode.when.equals;
        if (equals !== undefined && typeof equals !== "string" && typeof equals !== "number" && typeof equals !== "boolean") fail("SKIN_PLUGIN_CONDITION_INVALID", "A condition comparison must be scalar.");
        const empty = rawNode.when.empty;
        if (empty !== undefined && (inputSchemaVersion < 3 || typeof empty !== "boolean" || equals !== undefined)) fail("SKIN_PLUGIN_CONDITION_INVALID", "An empty-collection condition must be a schema v3 boolean and cannot also compare a scalar.");
        if (typeof equals === "string") {
          if (inputSchemaVersion < 3 && equals.includes("{{")) fail("SKIN_PLUGIN_SCHEMA_UNSUPPORTED", "Data-bound condition comparisons require schema v3.");
          for (const permission of bindingPermissions(equals, aliases, stateKeys)) {
            if (!permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The condition comparison data requires ${permission}.`);
          }
        }
        if (empty !== undefined && !["chat.messages", "session.channels", "session.members", "favorites.items", "servers.quickList", "screenShare.streams"].includes(path)) {
          fail("SKIN_PLUGIN_CONDITION_INVALID", "An empty condition must reference a registered public collection.");
        }
        node.when = { path, ...(equals === undefined ? {} : { equals }), ...(empty === undefined ? {} : { empty }) };
      }
      if (rawNode.events !== undefined) {
        if (!isRecord(rawNode.events) || Object.keys(rawNode.events).length > (inputSchemaVersion >= 3 ? 18 : 6)) fail("SKIN_PLUGIN_EVENT_INVALID", "Component events must be a small object.");
        const events: Partial<Record<SkinPluginEvent, string>> = {};
        for (const [event, actionIdValue] of Object.entries(rawNode.events)) {
          if (!EVENTS.has(event) || (inputSchemaVersion < 3 && V3_EVENTS.has(event)) || typeof actionIdValue !== "string" || !actions[actionIdValue]) fail("SKIN_PLUGIN_EVENT_INVALID", "Each component event must refer to a declared host action supported by this schema.");
          const action = actions[actionIdValue];
          if (action.type !== "ui.setState" && event === "input") fail("SKIN_PLUGIN_EVENT_INVALID", "Host actions cannot run while a form value is being typed; use a committed change or submit event.");
          if (action.type !== "ui.setState" && action.type !== "ui.toggleState" && PASSIVE_EVENTS.has(event)) {
            fail("SKIN_PLUGIN_EVENT_INVALID", "Voice and host actions require an explicit user activation event.");
          }
          for (const argument of Object.values(action.args)) {
            if (typeof argument !== "string") continue;
            for (const permission of bindingPermissions(argument, aliases, stateKeys)) {
              if (!permissions.includes(permission)) fail("SKIN_PLUGIN_PERMISSION_MISSING", `The event data requires ${permission}.`);
            }
          }
          events[event as SkinPluginEvent] = actionIdValue;
        }
        node.events = events;
      }
      if (rawNode.children !== undefined) {
        if (!Array.isArray(rawNode.children) || rawNode.children.length > (inputSchemaVersion >= 3 ? 256 : 100)) fail("SKIN_PLUGIN_TREE_INVALID", "A component node contains too many children.");
        if (node.tag && VOID_ELEMENTS.has(node.tag) && rawNode.children.length) fail("SKIN_PLUGIN_TREE_INVALID", "A void element cannot contain child nodes.");
        const childAliases = new Map(aliases);
        if (node.repeat) childAliases.set(node.repeat.as, node.repeat.path.endsWith(".members") ? "session.members" : node.repeat.path);
        node.children = rawNode.children.map((child) => walk(child, depth + 1, childAliases));
      }
      return node;
    };
    const root = walk(rawComponent.root, 1);
    if (!root.tag && !root.widget) fail("SKIN_PLUGIN_TREE_INVALID", "A plugin component root must be an element or a host widget.");
    if (mode === "surface" && (!root.tag || root.repeat || root.when || !root.children?.length)) {
      fail("SKIN_PLUGIN_TREE_INVALID", "A page surface root must be a visible container with at least one child.");
    }
    return { id, name, page, mode, accessibleName, permissions, actions, ...(Object.keys(state).length ? { state } : {}), root };
  });
  const surfaces = new Set<SkinPluginPage>();
  const widgetsByPage = new Map<SkinPluginPage, Set<SkinPluginHostWidget>>();
  for (const component of components) {
    if (component.mode === "surface") {
      if (surfaces.has(component.page)) fail("SKIN_PLUGIN_SURFACE_DUPLICATE", "A skin may define only one page surface per public page.");
      surfaces.add(component.page);
    }
    const pageWidgets = widgetsByPage.get(component.page) ?? new Set<SkinPluginHostWidget>();
    const visit = (node: SkinPluginNode) => {
      if (node.widget) {
        if (pageWidgets.has(node.widget)) fail("SKIN_PLUGIN_WIDGET_DUPLICATE", "A skin may mount each stateful host widget only once per page.");
        pageWidgets.add(node.widget);
      }
      node.children?.forEach(visit);
    };
    visit(component.root);
    widgetsByPage.set(component.page, pageWidgets);
  }
  return { schemaVersion: inputSchemaVersion, components };
}

export function parseSkinPluginJson(source: string): SkinPluginDocument {
  if (!source || new TextEncoder().encode(source).byteLength > SKIN_PLUGIN_DOCUMENT_LIMIT_BYTES) fail("SKIN_PLUGIN_DOCUMENT_SIZE", "components.json exceeds the 256 KiB limit.");
  let input: unknown;
  try { input = JSON.parse(source); } catch { fail("SKIN_PLUGIN_DOCUMENT_INVALID", "components.json must contain valid JSON."); }
  return parseSkinPluginDocument(input);
}

/** Parse a single runtime action using the same schema and permission rules as declarative skin actions. */
export function parseSkinPluginRuntimeAction(
  input: unknown,
  permissions: readonly SkinPluginPermission[],
): SkinPluginActionDefinition {
  if (!isRecord(input)) fail("SKIN_PLUGIN_ACTION_INVALID", "A runtime action request must be an object.");
  const parsed = parseSkinPluginDocument({
    schemaVersion: 3,
    components: [{
      id: "runtime-action",
      name: "Runtime action",
      page: "voice",
      accessibleName: "Runtime action",
      permissions: [...permissions],
      actions: { request: input },
      root: { tag: "main", children: [{ text: "Runtime action" }] },
    }],
  });
  const action = parsed.components[0].actions.request;
  if (!action || action.type === "ui.setState" || action.type === "ui.toggleState") {
    fail("SKIN_PLUGIN_ACTION_INVALID", "A runtime action request must name a host capability.");
  }
  return action;
}

export function listSkinPluginAssetPaths(document: SkinPluginDocument): string[] {
  const paths = new Set<string>();
  const visit = (node: SkinPluginNode) => {
    if (node.asset) paths.add(node.asset);
    node.children?.forEach(visit);
  };
  document.components.forEach((component) => visit(component.root));
  return [...paths];
}

export function createSkinPluginApproval(pluginId: string, permissions: readonly SkinPluginPermission[]): SkinPluginApproval {
  const policyVersions: Partial<Record<SkinPluginPermission, number>> = {};
  for (const permission of permissions) policyVersions[permission] = SKIN_PLUGIN_PERMISSIONS[permission].policyVersion;
  return { pluginId, policyVersions };
}

export function isSkinPluginPermissionApproved(approval: SkinPluginApproval | null | undefined, pluginId: string, permission: SkinPluginPermission): boolean {
  return approval?.pluginId === pluginId && approval.policyVersions[permission] === SKIN_PLUGIN_PERMISSIONS[permission].policyVersion;
}

export function skinPluginActionPermission(action: SkinPluginAction): SkinPluginPermission | null {
  return ACTION_PERMISSION[action];
}
