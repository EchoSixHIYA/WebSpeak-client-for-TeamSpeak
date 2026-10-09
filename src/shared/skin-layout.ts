export type SkinLayoutPage = "home" | "voice" | "demo";
export type SkinLayoutProfile = "desktop" | "tablet" | "mobile";

export interface SkinLayoutPlacement {
  visible?: boolean;
  x?: number;
  y?: number;
  scale?: number;
  order?: number;
  width?: number;
  height?: number;
  foreground?: string;
  background?: string;
  border?: string;
  radius?: number;
}

export interface SkinLayoutDocument {
  schemaVersion: 1;
  pages: Partial<Record<SkinLayoutPage, Partial<Record<SkinLayoutProfile, Record<string, SkinLayoutPlacement>>>>>;
}

export interface SkinLayoutComponent {
  id: string;
  page: SkinLayoutPage | "common";
  selectorPart: string;
  controlKind?: string;
  name: string;
  purpose: "host-shell" | "host-action" | "session-content" | "identity-content" | "page-content" | "decoration" | "trusted-status";
  category: "core" | "optional" | "trusted-chrome";
  allowedContainers: readonly string[];
  layoutModes: readonly ("position" | "size" | "visibility" | "appearance" | "order")[];
  dataSensitivity: "none" | "public" | "session" | "identity";
  keyboardBehavior: "host-native";
  focusOrder: "host-dom";
  accessibleNamePolicy: "preserve-host-name";
  narrowScreenBehavior: "host-responsive" | "decorative" | "trusted-fixed";
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  minScale: number;
  maxScale: number;
  minTouchTarget: number;
  allowedStyleTokens: readonly ("foreground" | "background" | "border" | "radius")[];
  editable: boolean;
}

const PUBLIC_PART_IDS = new Set<string>([
  "app",
  "app.toast",
  "control",
  "demo.action.poke",
  "demo.action.reconnect",
  "demo.action.speaking",
  "demo.actions",
  "demo.actions.heading",
  "demo.avatar",
  "demo.badge",
  "demo.brand",
  "demo.channel",
  "demo.channel.members",
  "demo.channel.select",
  "demo.channels",
  "demo.channels.heading",
  "demo.chat.composer",
  "demo.chat.empty",
  "demo.chat.heading",
  "demo.chat.input",
  "demo.chat.message",
  "demo.chat.messages",
  "demo.chat.send",
  "demo.chat.tab",
  "demo.chat.tabs",
  "demo.header",
  "demo.header-tools",
  "demo.hero",
  "demo.hero.description",
  "demo.hero.online",
  "demo.hero.title",
  "demo.home-link",
  "demo.language-switcher",
  "demo.layout",
  "demo.live",
  "demo.main",
  "demo.member-name",
  "demo.member-status",
  "demo.note",
  "demo.poke-notification",
  "demo.poke.dismiss",
  "demo.reconnect",
  "demo.reconnect.restore",
  "demo.skin-switcher",
  "demo.user",
  "demo.voice-card",
  "demo.voice-grid",
  "demo.voice-heading",
  "demo.wave",
  "home",
  "home.brand",
  "home.community-dialog",
  "home.connect",
  "home.content",
  "home.favorite-toggle",
  "home.feature",
  "home.features",
  "home.field",
  "home.field-label",
  "home.footer",
  "home.form",
  "home.gateway-status",
  "home.header",
  "home.header-tools",
  "home.hero",
  "home.hero.description",
  "home.hero.eyebrow",
  "home.hero.title",
  "home.identity",
  "home.identity-actions",
  "home.identity-export.button",
  "home.identity-import-dialog",
  "home.identity-import.cancel",
  "home.identity-import.close",
  "home.identity-import.drop-zone",
  "home.identity-import.error",
  "home.identity-import.file-button",
  "home.identity-import.footer",
  "home.identity-import.header",
  "home.identity-import.open",
  "home.identity-import.security",
  "home.identity-import.submit",
  "home.identity-import.textarea",
  "home.join-card",
  "home.join-card.sonar",
  "home.join-card.waveform",
  "home.join-description",
  "home.join-title",
  "home.notice",
  "home.relay-choice",
  "home.relay-choice.copy",
  "home.security-note",
  "home.server-history",
  "home.server-history.favorite-toggle",
  "home.server-history.group",
  "home.server-history.item",
  "home.server-history.select",
  "home.server-target",
  "home.visitors",
  "language.menu",
  "language.option",
  "language.trigger",
  "skin.menu",
  "skin.option",
  "skin.trigger",
  "voice.activity",
  "voice.activity-heading",
  "voice.activity.artwork",
  "voice.audio-dock",
  "voice.audio-dock.microphone",
  "voice.audio-dock.microphone-panel",
  "voice.audio-dock.output",
  "voice.audio-dock.output-panel",
  "voice.audio-settings",
  "voice.audio-status",
  "voice.breadcrumbs",
  "voice.channel-group",
  "voice.channel-group.heading",
  "voice.channel-group.members",
  "voice.chat",
  "voice.chat.composer",
  "voice.chat.empty",
  "voice.chat.event",
  "voice.chat.heading",
  "voice.chat.message",
  "voice.chat.message-avatar",
  "voice.chat.message-body",
  "voice.chat.message-bubble",
  "voice.chat.messages",
  "voice.chat.status",
  "voice.chat.tab",
  "voice.chat.tabs",
  "voice.connection-status",
  "voice.content",
  "voice.context-menu",
  "voice.context-menu-backdrop",
  "voice.context-menu.header",
  "voice.context-menu.move-submenu",
  "voice.favorite-servers.add",
  "voice.favorite-servers.avatar",
  "voice.favorite-servers.current-toggle",
  "voice.favorite-servers.dialog",
  "voice.favorite-servers.dialog-backdrop",
  "voice.favorite-servers.dialog.actions",
  "voice.favorite-servers.dialog.cancel",
  "voice.favorite-servers.dialog.close",
  "voice.favorite-servers.dialog.field",
  "voice.favorite-servers.dialog.form",
  "voice.favorite-servers.dialog.header",
  "voice.favorite-servers.dialog.hint",
  "voice.favorite-servers.dialog.input",
  "voice.favorite-servers.dialog.submit",
  "voice.favorite-servers.dialog.target",
  "voice.favorite-servers.favorite-toggle",
  "voice.favorite-servers.rail",
  "voice.favorite-servers.rail.item",
  "voice.favorite-servers.rail.list",
  "voice.favorite-servers.server",
  "voice.favorite-servers.strip",
  "voice.favorite-servers.strip.add",
  "voice.favorite-servers.strip.favorite-toggle",
  "voice.favorite-servers.strip.item",
  "voice.favorite-servers.strip.server",
  "voice.favorite-servers.switch-status",
  "voice.favorite-servers.tooltip",
  "voice.header",
  "voice.header-actions",
  "voice.member",
  "voice.member-panel",
  "voice.member-panel.channels",
  "voice.member-panel.heading",
  "voice.member-panel.search",
  "voice.member-row",
  "voice.member-row.avatar",
  "voice.member-row.copy",
  "voice.member-row.flags",
  "voice.member-row.volume",
  "voice.member.avatar",
  "voice.member.avatar-wrap",
  "voice.member.live-indicator",
  "voice.member.name",
  "voice.member.share-actions",
  "voice.member.status",
  "voice.member.stop-share",
  "voice.members",
  "voice.members.empty",
  "voice.mobile-more",
  "voice.mobile-nav",
  "voice.performance",
  "voice.performance.metrics",
  "voice.performance.panel",
  "voice.performance.route",
  "voice.performance.status",
  "voice.performance.webrtc-stats",
  "voice.poke",
  "voice.screen-player",
  "voice.screen-player.controls",
  "voice.screen-player.exit",
  "voice.screen-player.fullscreen",
  "voice.screen-player.live",
  "voice.screen-player.placeholder",
  "voice.screen-player.source",
  "voice.screen-player.stage",
  "voice.screen-player.video",
  "voice.screen-player.viewer-avatar",
  "voice.screen-player.viewers",
  "voice.screen-player.volume",
  "voice.screen-share-error",
  "voice.screen-share-settings",
  "voice.screen-share-settings.actions",
  "voice.screen-share-settings.fields",
  "voice.screen-share-settings.heading",
  "voice.screen-share-settings.note",
  "voice.scroll",
  "voice.shell",
  "voice.whisper-strip",
  "voice.workspace",
]);

const CONTROL_KINDS = ["button", "link", "input", "checkbox", "range", "select", "textarea", "menuitem", "draggable"] as const;
const TRUSTED_PART_IDS = new Set([
  "app",
  "app.toast",
  "home.security-note",
  "home.identity-import.security",
  "voice.connection-status",
  "voice.screen-share-error",
]);
const DECORATIVE_PART_IDS = new Set([
  "demo.avatar", "demo.badge", "demo.note", "demo.poke-notification", "demo.wave",
  "home.feature", "home.features", "home.footer", "home.hero.eyebrow", "home.join-card.sonar",
  "home.join-card.waveform", "home.visitors", "voice.activity.artwork", "voice.member.avatar-wrap",
  "voice.member.live-indicator", "voice.performance.metrics", "voice.performance.webrtc-stats",
  "voice.screen-player.viewer-avatar",
]);
const SHELL_PART_IDS = new Set([
  "app", "home", "home.content", "home.form", "home.header", "voice.shell", "voice.workspace",
  "voice.content", "demo.layout", "demo.main",
]);
const ACTION_PART_IDS = new Set([
  "control", "home.connect", "home.favorite-toggle", "home.identity-actions", "home.identity-export.button",
  "home.identity-import.cancel", "home.identity-import.close", "home.identity-import.file-button",
  "home.identity-import.open", "home.identity-import.submit", "home.relay-choice.copy",
  "home.server-history.favorite-toggle", "home.server-history.select", "language.trigger", "language.menu",
  "language.option", "skin.trigger", "skin.menu", "skin.option", "voice.audio-dock.microphone",
  "voice.audio-dock.output", "voice.context-menu", "voice.favorite-servers.add",
  "voice.favorite-servers.current-toggle", "voice.favorite-servers.dialog.cancel",
  "voice.favorite-servers.dialog.close", "voice.favorite-servers.dialog.submit",
  "voice.favorite-servers.favorite-toggle", "voice.favorite-servers.strip.add",
  "voice.favorite-servers.strip.favorite-toggle", "voice.member-row.copy", "voice.member-row.volume",
  "voice.member.share-actions", "voice.member.stop-share", "voice.member.stop-share",
  "voice.mobile-more", "voice.mobile-nav", "voice.poke", "voice.screen-player.controls",
  "voice.screen-player.exit", "voice.screen-player.fullscreen", "voice.screen-player.volume",
  "demo.action.poke", "demo.action.reconnect", "demo.action.speaking", "demo.channel.select",
  "demo.chat.send", "demo.chat.tab", "demo.home-link", "demo.poke.dismiss", "demo.reconnect.restore",
  "voice.channel-group.heading", "voice.chat.tab", "voice.favorite-servers.server",
  "voice.favorite-servers.strip.server", "demo.voice-card", "home.identity-import.drop-zone",
  "voice.channel-group", "voice.member-row", "demo.skin-switcher", "demo.language-switcher",
]);
const INTERACTIVE_PART_IDS = new Set([
  "demo.action.poke", "demo.action.reconnect", "demo.action.speaking", "demo.channel.select",
  "demo.chat.input", "demo.chat.send", "demo.chat.tab", "demo.home-link", "demo.poke.dismiss",
  "demo.reconnect.restore", "home.connect", "home.favorite-toggle", "home.identity-export.button",
  "home.identity-import.cancel", "home.identity-import.close", "home.identity-import.file-button",
  "home.identity-import.open", "home.identity-import.submit", "home.identity-import.textarea",
  "home.server-history.favorite-toggle", "home.server-history.select", "language.option",
  "language.trigger", "skin.option", "skin.trigger", "voice.channel-group.heading", "voice.chat.tab",
  "voice.favorite-servers.add", "voice.favorite-servers.current-toggle", "voice.favorite-servers.dialog.cancel",
  "voice.favorite-servers.dialog.close", "voice.favorite-servers.dialog.input", "voice.favorite-servers.dialog.submit",
  "voice.favorite-servers.favorite-toggle", "voice.favorite-servers.server", "voice.favorite-servers.strip.add",
  "voice.favorite-servers.strip.favorite-toggle", "voice.favorite-servers.strip.server", "voice.member.stop-share",
  "voice.screen-player.exit", "voice.screen-player.fullscreen", "demo.voice-card",
  "home.identity-import.drop-zone", "voice.channel-group", "voice.member-row", "demo.skin-switcher",
  "demo.language-switcher",
]);
const IDENTITY_PART_IDS = new Set([
  "home.identity", "home.identity-actions", "home.identity-export.button", "home.identity-import-dialog",
  "home.identity-import.cancel", "home.identity-import.close", "home.identity-import.drop-zone",
  "home.identity-import.error", "home.identity-import.file-button", "home.identity-import.footer",
  "home.identity-import.header", "home.identity-import.open", "home.identity-import.submit",
  "home.identity-import.textarea", "home.identity-import.security",
]);
const COMMON_PART_IDS = new Set([
  "app", "app.toast", "control", "skin.trigger", "skin.menu", "skin.option",
  "language.trigger", "language.menu", "language.option",
]);

function pageOfPart(id: string): SkinLayoutPage | "common" | null {
  if (COMMON_PART_IDS.has(id)) return "common";
  if (id === "home" || id.startsWith("home.")) return "home";
  if (id.startsWith("voice.")) return "voice";
  if (id.startsWith("demo.")) return "demo";
  return null;
}

const LAYOUT_MODES = ["position", "size", "visibility", "appearance", "order"] as const;
const STYLE_TOKENS = ["foreground", "background", "border", "radius"] as const;
const COMPONENT_NAME_PARTS: Record<string, string> = {
  action: "Action", actions: "Actions", activity: "Activity", add: "Add", app: "Application", artwork: "Artwork",
  audio: "Audio", avatar: "Avatar", backdrop: "Backdrop", badge: "Badge", body: "Body", brand: "Brand",
  breadcrumbs: "Breadcrumbs", bubble: "Bubble", button: "Button", cancel: "Cancel", card: "Card",
  channel: "Channel", channels: "Channels", chat: "Chat", checkbox: "Checkbox", choice: "Choice", close: "Close",
  community: "Community", composer: "Composer", connect: "Connect", connection: "Connection", content: "Content",
  context: "Context", control: "Control", controls: "Controls", copy: "Copy", current: "Current", demo: "Demo",
  description: "Description", dialog: "Dialog", dismiss: "Dismiss", dock: "Dock", draggable: "Draggable",
  drop: "Drop", empty: "Empty state", error: "Error", event: "Event", exit: "Exit", export: "Export",
  eyebrow: "Eyebrow", favorite: "Favorite", feature: "Feature", features: "Features", field: "Field", fields: "Fields",
  file: "File", flags: "Flags", footer: "Footer", form: "Form", fullscreen: "Fullscreen", gateway: "Gateway",
  grid: "Grid", group: "Group", header: "Header", heading: "Heading", hero: "Hero", hint: "Hint", history: "History",
  home: "Home page", identity: "Identity", import: "Import", indicator: "Indicator", input: "Input", item: "Item",
  join: "Join", label: "Label", language: "Language", layout: "Layout", link: "Link", list: "List", live: "Live status",
  main: "Main content", member: "Member", members: "Members", menu: "Menu", menuitem: "Menu item", message: "Message",
  messages: "Messages", metrics: "Metrics", microphone: "Microphone", mobile: "Mobile", more: "More", move: "Move",
  name: "Name", nav: "Navigation", note: "Note", notice: "Notice", notification: "Notification", online: "Online status",
  open: "Open", option: "Option", output: "Output", panel: "Panel", performance: "Performance", placeholder: "Placeholder",
  player: "Player", poke: "Poke", rail: "Rail", range: "Range", reconnect: "Reconnect", relay: "Relay", restore: "Restore",
  route: "Route", row: "Row", screen: "Screen", scroll: "Scrollable area", search: "Search", security: "Security",
  select: "Select", send: "Send", server: "Server", servers: "Servers", settings: "Settings", share: "Share",
  shell: "Application shell", skin: "Skin", sonar: "Sonar effect", source: "Source", speaking: "Speaking status",
  stage: "Stage", stats: "Statistics", status: "Status", stop: "Stop", strip: "Strip", submenu: "Submenu",
  submit: "Submit", switch: "Switch", switcher: "Switcher", tab: "Tab", tabs: "Tabs", target: "Target", textarea: "Text area",
  title: "Title", toast: "Notifications", toggle: "Toggle", tools: "Tools", tooltip: "Tooltip", trigger: "Trigger",
  user: "User", video: "Video", viewer: "Viewer", viewers: "Viewers", visitors: "Visitors", voice: "Voice",
  volume: "Volume", wave: "Wave", waveform: "Waveform", webrtc: "WebRTC", whisper: "Whisper", workspace: "Workspace",
  wrap: "Wrapper", zone: "Drop zone",
};

function componentName(id: string): string {
  return id.split(".").map((part) => part.split("-").map((word) => COMPONENT_NAME_PARTS[word]
    ?? (word.charAt(0).toUpperCase() + word.slice(1))).join(" ")).join(" · ");
}

function describeComponent(id: string, page: SkinLayoutPage | "common", controlKind?: string): SkinLayoutComponent {
  const category: SkinLayoutComponent["category"] = TRUSTED_PART_IDS.has(id) ? "trusted-chrome"
    : DECORATIVE_PART_IDS.has(id) ? "optional" : "core";
  const purpose: SkinLayoutComponent["purpose"] = TRUSTED_PART_IDS.has(id) ? "trusted-status"
    : SHELL_PART_IDS.has(id) ? "host-shell"
      : ACTION_PART_IDS.has(id) || Boolean(controlKind) ? "host-action"
        : IDENTITY_PART_IDS.has(id) ? "identity-content"
          : DECORATIVE_PART_IDS.has(id) ? "decoration"
            : page === "voice" ? "session-content" : "page-content";
  const allowedContainers = category === "trusted-chrome" ? [] : ["app"];
  const editable = category !== "trusted-chrome";
  const isControl = editable && (Boolean(controlKind) || id === "control" || purpose === "host-action" || INTERACTIVE_PART_IDS.has(id));
  return {
    id,
    page,
    selectorPart: id.startsWith("control.") ? "control" : id,
    ...(controlKind ? { controlKind } : {}),
    name: componentName(id),
    purpose,
    category,
    allowedContainers,
    layoutModes: editable ? LAYOUT_MODES : [],
    dataSensitivity: IDENTITY_PART_IDS.has(id) ? "identity" : page === "voice" ? "session" : purpose === "decoration" ? "none" : "public",
    keyboardBehavior: "host-native",
    focusOrder: "host-dom",
    accessibleNamePolicy: "preserve-host-name",
    narrowScreenBehavior: category === "trusted-chrome" ? "trusted-fixed" : category === "optional" ? "decorative" : "host-responsive",
    minWidth: editable ? isControl ? 44 : 12 : 0,
    minHeight: editable ? isControl ? 44 : 12 : 0,
    maxWidth: editable ? isControl ? 1600 : 2400 : 0,
    maxHeight: editable ? isControl ? 1200 : 2400 : 0,
    minScale: editable ? isControl ? 1 : 0.5 : 1,
    maxScale: editable ? isControl ? 3 : 4 : 1,
    minTouchTarget: isControl ? 44 : 0,
    allowedStyleTokens: editable ? STYLE_TOKENS : [],
    editable,
  };
}

const regularComponents: SkinLayoutComponent[] = [...PUBLIC_PART_IDS].flatMap((id) => {
  const page = pageOfPart(id);
  return page ? [describeComponent(id, page)] : [];
});
const virtualControls: SkinLayoutComponent[] = CONTROL_KINDS.map((kind) => ({
  ...describeComponent("control." + kind, "common", kind),
}));

export const SKIN_LAYOUT_COMPONENTS: readonly SkinLayoutComponent[] = [
  ...regularComponents,
  ...virtualControls,
];

const componentById = new Map(SKIN_LAYOUT_COMPONENTS.map((component) => [component.id, component]));

function dynamicSkinPartPage(id: string): SkinLayoutPage | undefined {
  const match = /^skin\.(home|voice|demo)\.((?:[a-z][a-z0-9-]{0,63}|runtime_plugin_[a-z][a-z0-9-]{0,63}__[a-z][a-z0-9-]{0,63}))(?:\.(control-)?(node-root(?:-\d+){0,32}|part-[a-z][a-z0-9-]{0,63}))?$/.exec(id);
  return match?.[1] as SkinLayoutPage | undefined;
}

function isDynamicSkinControl(id: string): boolean {
  return /^skin\.(?:home|voice|demo)\.(?:[a-z][a-z0-9-]{0,63}|runtime_plugin_[a-z][a-z0-9-]{0,63}__[a-z][a-z0-9-]{0,63})\.control-(?:node-root(?:-\d+){0,32}|part-[a-z][a-z0-9-]{0,63})$/.test(id);
}

const dynamicSkinPartCache = new Map<string, SkinLayoutComponent>();

function dynamicSkinLayoutComponent(id: string, page: SkinLayoutPage): SkinLayoutComponent {
  let component = dynamicSkinPartCache.get(id);
  if (!component) {
    component = describeComponent(id, page, isDynamicSkinControl(id) ? "button" : undefined);
    if (dynamicSkinPartCache.size >= 4096) dynamicSkinPartCache.clear();
    dynamicSkinPartCache.set(id, component);
  }
  return component;
}

/** Dynamic IDs are generated only for declared skin component roots and nodes. */
export function getSkinLayoutComponents(page: SkinLayoutPage, dynamicParts: readonly string[] = []): SkinLayoutComponent[] {
  const components = SKIN_LAYOUT_COMPONENTS.filter((component) => component.page === "common" || component.page === page);
  const seen = new Set(components.map((component) => component.id));
  for (const id of dynamicParts) {
    if (seen.has(id) || dynamicSkinPartPage(id) !== page) continue;
    seen.add(id);
    components.push(dynamicSkinLayoutComponent(id, page));
  }
  return components;
}

export function getSkinLayoutComponent(id: string, page?: SkinLayoutPage): SkinLayoutComponent | undefined {
  const component = componentById.get(id)
    ?? (dynamicSkinPartPage(id) ? dynamicSkinLayoutComponent(id, dynamicSkinPartPage(id)!) : undefined);
  if (!component || (page && component.page !== "common" && component.page !== page)) return undefined;
  return component;
}

export function canEditSkinLayoutComponent(id: string, page: SkinLayoutPage, ancestorIds: readonly string[] = []): boolean {
  const component = getSkinLayoutComponent(id, page);
  if (!component?.editable) return false;
  return ancestorIds.every((ancestorId) => getSkinLayoutComponent(ancestorId, page)?.category !== "trusted-chrome");
}

export function getSkinLayoutComponentId(part: string | undefined, controlKind?: string): string | null {
  if (!part) return null;
  if (part === "control" && controlKind) return "control." + controlKind;
  return part;
}

const ALLOWED_PLACEMENT_FIELDS = new Set([
  "visible", "x", "y", "scale", "order", "width", "height", "foreground", "background", "border", "radius",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(context + " contains an unknown field: " + key);
  }
}

function readNumber(value: unknown, key: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error("Skin layout field " + key + " is outside its allowed range.");
  }
  return value;
}

function readColor(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Skin layout field " + key + " must be a six-digit hex color.");
  return value.toLowerCase();
}

export function validateSkinLayout(value: unknown): SkinLayoutDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.pages)) {
    throw new Error("Skin layout must use schemaVersion 1 and contain a pages object.");
  }
  assertOnlyKeys(value, new Set(["schemaVersion", "pages"]), "Skin layout");
  const pages: SkinLayoutDocument["pages"] = {};
  let placementCount = 0;

  for (const [pageKey, pageValue] of Object.entries(value.pages)) {
    if (!(["home", "voice", "demo"] as string[]).includes(pageKey) || !isRecord(pageValue)) {
      throw new Error("Skin layout contains an unsupported page.");
    }
    assertOnlyKeys(pageValue, new Set(["desktop", "tablet", "mobile"]), "Skin layout page");
    const profiles: Partial<Record<SkinLayoutProfile, Record<string, SkinLayoutPlacement>>> = {};
    for (const profile of ["desktop", "tablet", "mobile"] as const) {
      const profileValue = pageValue[profile];
      if (profileValue === undefined) continue;
      if (!isRecord(profileValue)) throw new Error("Skin layout profile must be a component map.");
      const placements: Record<string, SkinLayoutPlacement> = {};
      for (const [id, rawPlacement] of Object.entries(profileValue)) {
        placementCount += 1;
        if (placementCount > 512) throw new Error("Skin layout contains too many component placements.");
        const component = getSkinLayoutComponent(id, pageKey as SkinLayoutPage);
        if (!component) throw new Error("Skin layout references an unknown component: " + id);
        if (!component.editable) throw new Error("Skin layout cannot change trusted component: " + id);
        if (!isRecord(rawPlacement)) throw new Error("Skin component placement must be an object.");
        assertOnlyKeys(rawPlacement, ALLOWED_PLACEMENT_FIELDS, "Skin component placement");
        const supportedFields = new Set<string>();
        if (component.layoutModes.includes("visibility")) supportedFields.add("visible");
        if (component.layoutModes.includes("position")) { supportedFields.add("x"); supportedFields.add("y"); }
        if (component.layoutModes.includes("size")) { supportedFields.add("scale"); supportedFields.add("width"); supportedFields.add("height"); }
        if (component.layoutModes.includes("appearance")) component.allowedStyleTokens.forEach((token) => supportedFields.add(token));
        if (component.layoutModes.includes("order")) supportedFields.add("order");
        assertOnlyKeys(rawPlacement, supportedFields, "Skin component placement");
        const placement: SkinLayoutPlacement = {};
        if (rawPlacement.visible !== undefined) {
          if (typeof rawPlacement.visible !== "boolean") throw new Error("Skin layout visible must be a boolean.");
          placement.visible = rawPlacement.visible;
        }
        const x = readNumber(rawPlacement.x, "x", -2000, 2000);
        const y = readNumber(rawPlacement.y, "y", -2000, 2000);
        const scale = readNumber(rawPlacement.scale, "scale", component.minScale, component.maxScale);
        const order = readNumber(rawPlacement.order, "order", -100, 100);
        const width = readNumber(rawPlacement.width, "width", component.minWidth, component.maxWidth);
        const height = readNumber(rawPlacement.height, "height", component.minHeight, component.maxHeight);
        const radius = readNumber(rawPlacement.radius, "radius", 0, 64);
        if (x !== undefined) placement.x = x;
        if (y !== undefined) placement.y = y;
        if (scale !== undefined) placement.scale = scale;
        if (order !== undefined) placement.order = order;
        if (width !== undefined) placement.width = width;
        if (height !== undefined) placement.height = height;
        if (radius !== undefined) placement.radius = radius;
        const foreground = readColor(rawPlacement.foreground, "foreground");
        const background = readColor(rawPlacement.background, "background");
        const border = readColor(rawPlacement.border, "border");
        if (foreground !== undefined) placement.foreground = foreground;
        if (background !== undefined) placement.background = background;
        if (border !== undefined) placement.border = border;
        placements[id] = placement;
      }
      profiles[profile] = placements;
    }
    pages[pageKey as SkinLayoutPage] = profiles;
  }

  return { schemaVersion: 1, pages };
}

export function parseSkinLayoutJson(source: string): SkinLayoutDocument {
  if (!source || new TextEncoder().encode(source).byteLength > 128 * 1024) {
    throw new Error("Skin layout must be smaller than 128 KiB.");
  }
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error("Skin layout is not valid JSON."); }
  return validateSkinLayout(value);
}
