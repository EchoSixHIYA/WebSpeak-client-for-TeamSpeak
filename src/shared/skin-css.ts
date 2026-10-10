import postcss, { type AtRule, type Declaration, type Node, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

export type SkinCssSchemaVersion = 1 | 2 | 3 | 4;
export type SkinCssAssets = Readonly<Record<string, unknown>> | Map<string, unknown> | Set<string>;
const MAX_CSS_BYTES = 512 * 1024;

export class SkinCssValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SkinCssValidationError";
  }
}

function hasSkinCssAsset(assets: SkinCssAssets, path: string): boolean {
  if (assets instanceof Set) return assets.has(path);
  if (assets instanceof Map) return assets.has(path);
  return Object.prototype.hasOwnProperty.call(assets, path) && Boolean(assets[path]);
}

const ALLOWED_AT_RULES = new Set(["media", "supports", "container", "layer", "font-face", "keyframes", "-webkit-keyframes"]);
const LAYOUT_AFFECTING_PROPERTIES = new Set([
  "all", "display", "position", "top", "right", "bottom", "left", "inset", "inset-block", "inset-inline",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size",
  "min-inline-size", "min-block-size", "max-inline-size", "max-block-size", "aspect-ratio", "box-sizing",
  "gap", "row-gap", "column-gap", "grid", "flex", "order", "float", "clear", "overflow", "overflow-x",
  "overflow-y", "overflow-block", "overflow-inline", "overscroll-behavior", "z-index", "visibility",
  "pointer-events", "clip", "clip-path", "mask", "mask-image", "transform", "transform-origin", "transform-style", "translate", "scale", "rotate",
  "perspective", "perspective-origin", "contain", "content-visibility", "container", "container-name",
  "container-type", "contain-intrinsic-size", "resize", "columns", "column-count", "column-width", "scrollbar-width", "font",
  "font-size", "line-height", "letter-spacing", "word-spacing", "white-space", "word-break", "overflow-wrap", "word-wrap",
  "text-wrap", "text-overflow", "text-indent", "text-transform", "text-combine-upright", "text-autospace", "text-spacing-trim",
  "line-clamp", "tab-size", "hyphens", "line-break", "text-size-adjust", "initial-letter", "shape-outside", "baseline-shift",
  "box-orient", "box-direction", "box-lines", "ruby-position", "caption-side", "table-layout", "border-collapse", "border-spacing",
  "writing-mode", "direction", "unicode-bidi", "vertical-align", "appearance", "zoom", "scrollbar-gutter", "touch-action", "user-select", "cursor", "content",
  "position-anchor", "position-area", "position-try-fallbacks", "position-try-order", "anchor-name", "anchor-scope",
]);
const OPTIONAL_VISUAL_PARTS = new Set([
  "home.hero.eyebrow",
  "home.gateway-status",
  "home.features",
  "home.feature",
  "home.visitors",
  "home.join-card.waveform",
  "home.join-card.sonar",
  "voice.activity-heading",
  "voice.member.avatar",
  "voice.member.live-indicator",
  "voice.member-row.avatar",
  "voice.screen-player.viewer-avatar",
  "voice.screen-player.live",
  "demo.badge",
  "demo.wave",
  "demo.avatar",
  "demo.member-status",
  "demo.note",
]);
export function compileSkinCss(source: string, id: string, assets: SkinCssAssets, schemaVersion: SkinCssSchemaVersion, pluginId?: string): { css: string; warnings: string[] } {
  const size = new TextEncoder().encode(source).byteLength;
  if (!size || size > MAX_CSS_BYTES) throw new SkinCssValidationError("The CSS entry must be between 1 byte and 512 KiB.", "SKIN_CSS_SIZE");
  let root: postcss.Root;
  try { root = postcss.parse(source, { from: undefined }); }
  catch (error) { throw new SkinCssValidationError(`The CSS file could not be parsed: ${(error as Error).message}`, "SKIN_CSS_INVALID"); }

  const skinScope = `.ws-skin-root[data-ws-skin="${id}"]`;
  const scope = pluginId
    ? `${skinScope} .ws-plugin-component[data-ws-runtime-plugin="${pluginId}"]`
    : skinScope;
  const namespace = `ws-${id.replace(/[^a-z0-9_-]/gi, "-")}${pluginId ? `-${pluginId}` : ""}`;
  const scopeNodes = selectorParser().astSync(scope).first!.nodes.map((node) => node.clone());
  const warnings = new Set<string>();
  const keyframeNames = new Map<string, string>();
  const fontFamilyNames = new Map<string, string>();
  const hideableRules = new WeakSet<Rule>();
  let nodeCount = 0;
  root.walk((node) => {
    nodeCount += 1;
    if (nodeCount > 12000) throw new SkinCssValidationError("The CSS file contains too many rules.", "SKIN_CSS_COMPLEXITY");
  });

  root.walkAtRules((rule: AtRule) => {
    const name = rule.name.toLowerCase();
    if (!ALLOWED_AT_RULES.has(name)) throw rule.error(`The @${rule.name} rule is not allowed in a skin package.`);
    if (name.endsWith("keyframes")) {
      const keyframeName = rule.params.trim();
      if (!/^[-_a-z][-_a-z0-9]*$/i.test(keyframeName)) throw rule.error("Keyframe names must be simple CSS identifiers.");
      keyframeNames.set(keyframeName, `${namespace}-${keyframeName}`);
      rule.params = `${namespace}-${keyframeName}`;
    } else if (name === "layer") {
      const layers = rule.params.split(",").map((layer) => layer.trim());
      if (!layers.length || layers.some((layer) => !layer || !layer.split(".").every((part) => /^[-_a-z][-_a-z0-9]*$/i.test(part)))) {
        throw rule.error("Skin CSS must use named @layer values so layer names can be isolated.");
      }
      rule.params = layers.map((layer) => `${namespace}-${layer.split(".").join(`.${namespace}-`)}`).join(", ");
    } else if (name === "font-face") {
      if (/\blocal\s*\(/i.test(decodeCssEscapes(rule.toString()))) throw rule.error("@font-face local() is not allowed; include a WOFF2 file in the package.");
      const family = rule.nodes?.find((node): node is Declaration => node.type === "decl" && node.prop.toLowerCase() === "font-family");
      if (!family) throw rule.error("Each @font-face rule must declare font-family.");
      const originalFamily = parseSingleFontFamily(family.value);
      const scopedFamily = `${namespace}-${originalFamily.replace(/[^a-z0-9_-]/gi, "-")}`;
      fontFamilyNames.set(originalFamily.toLowerCase(), scopedFamily);
      family.value = `"${scopedFamily}"`;
    }
  });

  root.walkRules((rule: Rule) => {
    if (hasKeyframesAncestor(rule)) return;
    if (rule.parent?.type === "rule") throw rule.error("Nested style rules are not supported; use flat selectors.");
    if (!pluginId && !selectorUsesPublicHook(rule.selector, schemaVersion >= 3)) {
      throw new SkinCssValidationError(rule.error("Skin selectors must use :root, [data-ws-page], [data-ws-part], or [data-ws-plugin-part] so they stay attached to WebSpeak's stable visual interface.").message, "SKIN_CSS_SELECTOR");
    }
    if (targetsOnlyOptionalVisualParts(rule.selector)) hideableRules.add(rule);
    try {
      rule.selector = selectorParser((selectors) => {
        selectors.each((selector) => {
          const text = selector.toString().trim();
          if (!text) throw new SkinCssValidationError("Empty selectors are not allowed.", "SKIN_CSS_SELECTOR");
          if (/:global\s*\(|:host(?:-context)?\b/i.test(text)) throw new SkinCssValidationError("Shadow and global escape selectors are not allowed.", "SKIN_CSS_SELECTOR");
          if (/^:root\b/.test(text)) {
            selector.replaceWith(selectorParser().astSync(text.replace(/^:root\b/, scope)).first!.clone());
            return;
          }
          selector.prepend(selectorParser.combinator({ value: " " }));
          for (let index = scopeNodes.length - 1; index >= 0; index -= 1) selector.prepend(scopeNodes[index].clone());
        });
      }).processSync(rule.selector);
    } catch (error) {
      if (error instanceof SkinCssValidationError) throw error;
      throw rule.error(`A CSS selector is invalid: ${(error as Error).message}`);
    }
  });

  const referencedKeyframes = new Set<string>();
  const nonOptionalKeyframes = new Set<string>();
  root.walkRules((rule: Rule) => {
    if (hasKeyframesAncestor(rule)) return;
    const optionalTarget = hideableRules.has(rule);
    rule.walkDecls((declaration: Declaration) => {
      const property = declaration.prop.toLowerCase();
      if (property !== "animation" && property !== "animation-name") return;
      const value = declaration.value;
      if (/\b(?:var|attr)\s*\(|\\/i.test(value)) {
        keyframeNames.forEach((_, name) => nonOptionalKeyframes.add(name));
        return;
      }
      for (const name of keyframeNames.keys()) {
        if (!referencesCssIdentifier(value, name)) continue;
        referencedKeyframes.add(name);
        if (!optionalTarget) nonOptionalKeyframes.add(name);
      }
    });
  });
  const optionalOnlyKeyframes = new Set([...referencedKeyframes]
    .filter((name) => !nonOptionalKeyframes.has(name))
    .map((name) => keyframeNames.get(name)!));

  root.walkDecls((declaration: Declaration) => {
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
    const value = declaration.value.trim();
    const decodedValue = decodeCssEscapes(value);
    const owningRule = findOwningRule(declaration);
    const keyframesRule = owningRule ? findKeyframesRule(owningRule) : null;
    const canHideTarget = owningRule
      ? hideableRules.has(owningRule) || Boolean(keyframesRule && optionalOnlyKeyframes.has(keyframesRule.params.trim()))
      : false;
    if (property.startsWith("--") && !/^--skin-[a-z0-9_-]+$/i.test(property)
      && !(pluginId && property.startsWith(`--plugin-${pluginId}-`))) {
      throw declaration.error(pluginId
        ? `Custom plugin variables must use --plugin-${pluginId}- or --skin- prefixes.`
        : "Custom skin variables must use the --skin- prefix so they cannot replace WebSpeak's structural tokens.");
    }
    if (schemaVersion < 3 && isLayoutAffectingProperty(property)) {
      throw declaration.error("Skin CSS may change component artwork and appearance, but must not change layout, positioning, sizing, text flow, or interaction geometry.");
    }
    if (property === "font-family") warnings.add("Custom fonts can change localized text wrapping; verify every WebSpeak language before publishing.");
    if (["behavior", "-moz-binding"].includes(property) || /expression\s*\(|javascript\s*:|vbscript\s*:/i.test(decodedValue)) {
      throw declaration.error("Executable CSS values are not allowed.");
    }
    const compactValue = decodeCssEscapes(valueParser(value).nodes.filter((node) => node.type !== "space" && node.type !== "comment").map((node) => node.value ?? "").join("")).toLowerCase();
    if (schemaVersion < 3 && ["display", "visibility", "opacity", "pointer-events", "clip-path", "mask", "mask-image"].includes(property) && /\b(?:var|attr)\s*\(/i.test(decodedValue)) {
      if (!canHideTarget) throw declaration.error("Visibility and interaction styles can only use indirect values on explicitly optional visual parts.");
    }
    const removesVisual = property === "all"
      || (property === "display" && compactValue === "none")
      || (property === "visibility" && /^(?:hidden|collapse)$/.test(compactValue))
      || (property === "opacity" && /^0(?:\.0+)?%?$/.test(compactValue))
      || (property === "pointer-events" && compactValue === "none")
      || (property === "clip-path" && /inset\(\s*50%/.test(compactValue))
      || (property === "mask" && /(?:alpha\(0\)|luminance\(0\))/.test(compactValue));
    if (removesVisual && !canHideTarget && schemaVersion < 3) {
      throw declaration.error("Only explicitly optional visual parts may be hidden or reset; required controls and their containers must remain available.");
    }
    const visuallyRemoves = (property === "transform" && /scale(?:3d)?\(\s*0(?:\s*[,)]|\s*\))/i.test(decodedValue))
      || (property === "clip-path" && /inset\(\s*50%/i.test(decodedValue))
      || (property === "filter" && /(?:opacity|brightness)\(\s*0(?:%|\s*[,)]|\s*\))/i.test(decodedValue));
    if (visuallyRemoves && !canHideTarget && schemaVersion < 3) {
      throw declaration.error("Only explicitly optional visual parts may be visually removed.");
    }
    if (schemaVersion >= 3 && removesVisual) warnings.add("This open skin hides an interface part; keep a usable path to essential voice and recovery controls.");
    if (/\bz-index\s*:\s*(?:[1-9]\d{4,}|-\d{4,})\b/i.test(`${property}:${decodedValue}`) || (property === "position" && decodedValue === "fixed")) warnings.add("Fixed positioning or extreme stacking may cover important controls; check the preview on desktop and mobile.");
    const withScopedNames = rewriteScopedNames(value, property, keyframeNames, fontFamilyNames);
    declaration.value = rewriteAssetUrls(withScopedNames, (assetPath) => {
      if (!hasSkinCssAsset(assets, assetPath)) throw declaration.error(`CSS references an asset not present in the package: ${assetPath}`);
      return `wskin-asset:${encodeURIComponent(assetPath)}`;
    });
  });

  return { css: root.toString(), warnings: [...warnings] };
}

export function rewriteSkinCssAssets(css: string, resolve: (path: string) => string): string {
  const root = postcss.parse(css, { from: undefined });
  root.walkDecls((declaration) => {
    declaration.value = rewriteAssetUrls(declaration.value, resolve);
  });
  return root.toString();
}

function targetsOnlyOptionalVisualParts(selector: string): boolean {
  try {
    const parsed = selectorParser().astSync(selector);
    return parsed.nodes.length > 0 && parsed.nodes.every((item) => {
      if (item.nodes.length !== 1 || item.nodes[0].type !== "attribute") return false;
      const attribute = item.nodes[0];
      if (attribute.attribute.toLowerCase() !== "data-ws-part" || attribute.operator !== "=") return false;
      const part = (attribute.value ?? "").replace(/^['"]|['"]$/g, "");
      return OPTIONAL_VISUAL_PARTS.has(part);
    });
  } catch {
    return false;
  }
}

function selectorUsesPublicHook(selector: string, allowCustomClasses = false): boolean {
  try {
    const parsed = selectorParser().astSync(selector);
    return parsed.nodes.length > 0 && parsed.nodes.every((item) => {
      let scoped = false;
      let usesPrivateName = false;
      item.walk((node) => {
        if (node.type === "attribute" && ["data-ws-part", "data-ws-page", ...(allowCustomClasses ? ["data-ws-plugin-part"] : [])].includes(node.attribute.toLowerCase())) scoped = true;
        if (node.type === "pseudo" && node.value.toLowerCase() === ":root") scoped = true;
        if (!allowCustomClasses && (node.type === "class" || node.type === "id")) usesPrivateName = true;
      });
      return scoped && !usesPrivateName;
    });
  } catch {
    return false;
  }
}

function isLayoutAffectingProperty(property: string): boolean {
  const unprefixed = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
  if (LAYOUT_AFFECTING_PROPERTIES.has(unprefixed)) return true;
  if (/^(?:margin|padding)(?:-|$)/.test(unprefixed)) return true;
  if (/^border(?:-|$)/.test(unprefixed) && !/^border-(?:color(?:-|$)|radius(?:-|$))/.test(unprefixed)) return true;
  if (/^(?:grid|flex|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self)|offset|transform|overscroll|overflow|column)(?:-|$)/.test(unprefixed)) return true;
  return /^font-(?!family$|weight$|style$|synthesis$|palette$)/.test(unprefixed);
}

function findOwningRule(node: Node): Rule | null {
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "rule") return parent as Rule;
    parent = parent.parent;
  }
  return null;
}

function findKeyframesRule(rule: Rule): AtRule | null {
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && /(?:^|-)?keyframes$/i.test(parent.name)) return parent as AtRule;
    parent = parent.parent;
  }
  return null;
}

function referencesCssIdentifier(value: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^-_a-z0-9])${escaped}(?=$|[^-_a-z0-9])`, "i").test(value);
}

export function rewriteAssetUrls(value: string, resolve: (path: string) => string): string {
  const parsed = valueParser(value);
  const resolvePackageAsset = (rawValue: string): string => {
    const raw = decodeCssEscapes(rawValue.trim());
    if (!raw || raw.startsWith("#")) throw new SkinCssValidationError("CSS images and fonts must point to assets inside this skin package.", "SKIN_EXTERNAL_RESOURCE");
    const isInternalMarker = raw.startsWith("wskin-asset:");
    if (!isInternalMarker && /^(?:data:|blob:|https?:|\/\/|file:|javascript:)/i.test(raw)) throw new SkinCssValidationError("Only relative paths to assets inside this skin package are allowed in url().", "SKIN_EXTERNAL_RESOURCE");
    let path: string;
    try { path = isInternalMarker ? decodeURIComponent(raw.slice("wskin-asset:".length)) : normalizeAssetPath(raw); }
    catch { throw new SkinCssValidationError("A skin asset reference is invalid.", "SKIN_ASSET_PATH"); }
    return resolve(path);
  };
  const visit = (nodes: typeof parsed.nodes, inImageSet = false): void => {
    for (const node of nodes) {
      const functionName = node.type === "function" ? decodeCssEscapes(node.value).toLowerCase() : "";
      if (node.type === "function" && functionName === "url") {
        const raw = valueParser.stringify(node.nodes).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
        node.nodes = [{ type: "string", quote: '"', value: resolvePackageAsset(raw), sourceIndex: 0, sourceEndIndex: 0, unclosed: undefined }];
        node.before = "";
        node.after = "";
        continue;
      }
      if (node.type === "function" && (functionName === "image-set" || functionName === "-webkit-image-set")) {
        for (const child of node.nodes) {
          if (child.type === "string") child.value = resolvePackageAsset(child.value);
          else if (child.type === "function") visit([child]);
        }
        continue;
      }
      if (node.type === "function") visit(node.nodes, inImageSet);
      else if (inImageSet && node.type === "string") node.value = resolvePackageAsset(node.value);
    }
  };
  visit(parsed.nodes);
  return parsed.toString();
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([\da-f]{1,6})(?:[\t\n\f\r ]|\r\n)?|\\([^\da-f\r\n\f])/gi, (match, hexadecimal: string | undefined, escaped: string | undefined) => {
    if (hexadecimal) {
      const codePoint = Number.parseInt(hexadecimal, 16);
      if (!codePoint || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(codePoint);
    }
    return escaped ?? match;
  });
}

function parseSingleFontFamily(value: string): string {
  const parsed = valueParser(value).nodes.filter((node) => node.type !== "space" && node.type !== "comment");
  if (parsed.length !== 1 || (parsed[0].type !== "string" && parsed[0].type !== "word") || !parsed[0].value.trim()) {
    throw new SkinCssValidationError("@font-face must declare exactly one font family.", "SKIN_FONT_FAMILY");
  }
  return parsed[0].value.trim();
}

function rewriteScopedNames(value: string, property: string, keyframes: Map<string, string>, fontFamilies: Map<string, string>): string {
  const parsed = valueParser(value);
  if (["animation", "animation-name", "font", "font-family"].includes(property)) {
    parsed.walk((node) => {
      if (node.type !== "word" && node.type !== "string") return;
      const keyframe = keyframes.get(node.value);
      if (keyframe) node.value = keyframe;
      const family = fontFamilies.get(node.value.toLowerCase());
      if (family) node.value = family;
    });
  }
  return parsed.toString();
}

function normalizeAssetPath(raw: string): string {
  let path = raw.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { throw new SkinCssValidationError("An asset URL contains invalid encoding.", "SKIN_ASSET_PATH"); }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[a-z]:/i.test(path)) throw new SkinCssValidationError("An asset URL must be a relative package path.", "SKIN_ASSET_PATH");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new SkinCssValidationError("An asset URL cannot leave the skin package.", "SKIN_ASSET_PATH");
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (!segments.length) throw new SkinCssValidationError("An asset URL must point to a package file.", "SKIN_ASSET_PATH");
  return segments.join("/");
}

function hasKeyframesAncestor(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return true;
    parent = parent.parent;
  }
  return false;
}
