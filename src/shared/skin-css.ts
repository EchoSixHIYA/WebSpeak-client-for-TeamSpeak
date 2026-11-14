import postcss, { type AtRule, type Declaration, type Node, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";
import {
  DECORATIVE_PART_IDS as OPTIONAL_VISUAL_PARTS,
  HOST_CHROME_PART_IDS,
  HOST_SKIN_ATTRIBUTE,
  PROTECTED_PART_IDS,
} from "./skin-visual-parts.js";

export { OPTIONAL_VISUAL_PARTS };

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
/**
 * Properties that let a skin move a host-chrome part into a viewport-sized
 * overlay or out from under the host's own layout. Appearance properties
 * (colors, borders, radius, shadows, artwork) stay available.
 */
const HOST_CHROME_LOCKED_PROPERTIES = new Set([
  "all", "position", "top", "right", "bottom", "left", "inset", "inset-block", "inset-inline",
  "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end",
  "z-index", "transform", "translate", "scale", "rotate", "zoom", "float", "clear",
  "clip", "clip-path", "mask", "mask-image", "perspective", "contain",
]);
/**
 * The plugin library shell additionally owns its footprint: without a locked
 * size a skin could still stretch it over the recovery entry even though
 * `position`/`inset`/`z-index` are frozen.
 */
const HOST_OVERLAY_LOCKED_PROPERTIES = new Set([
  ...HOST_CHROME_LOCKED_PROPERTIES,
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "inline-size", "block-size", "min-inline-size", "min-block-size", "max-inline-size", "max-block-size",
  "aspect-ratio", "margin", "margin-block", "margin-inline", "margin-block-start", "margin-block-end",
  "margin-inline-start", "margin-inline-end",
]);
/** Properties whose indirect values could smuggle a hidden or moved control past the static checks. */
const INDIRECT_VALUE_PROPERTIES = new Set([
  "all", "display", "visibility", "opacity", "pointer-events", "clip-path", "mask", "mask-image",
  "position", "top", "right", "bottom", "left", "inset",
  "inset-block", "inset-inline", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end",
  "transform", "translate", "scale", "rotate", "zoom",
  // Margins move a subject just like insets do; a variable could resolve to a
  // viewport-sized negative value, so protected controls may not use them.
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-block-start", "margin-block-end",
  "margin-inline", "margin-inline-start", "margin-inline-end",
]);
/** Attributes a skin author must never use to reach outside the public hooks. */
const FORBIDDEN_SCOPE_ATTRIBUTES = new Set([
  HOST_SKIN_ATTRIBUTE,
  "data-ws-skin",
  "data-ws-route",
  "data-theme",
  "data-ws-hidden-host-parts",
  // Host-owned recovery layer internals. They are deliberately not skin hooks,
  // and naming them keeps `:root [data-ws-host-layer]` / mixed selectors from
  // opting into the element by attribute.
  "data-ws-host-layer",
  "data-ws-host-recovery",
  "data-ws-host-layer-content",
  "data-ws-recovery-action",
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
  // Host chrome is Teleported outside `.ws-skin-root`. Rules that target only
  // registered host parts use a second, document-level scope anchored to an
  // attribute the host sets while this exact skin is active. Author CSS never
  // names html/body: the host generates the scope itself.
  const hostSkinScope = `:root[${HOST_SKIN_ATTRIBUTE}="${id}"]`;
  const hostScopeNodes = selectorParser().astSync(hostSkinScope).first!.nodes.map((node) => node.clone());
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
          const hostScope = assertHostChromeSelector(text, schemaVersion, Boolean(pluginId));
          const activeScope = hostScope ? hostSkinScope : scope;
          const activeNodes = hostScope ? hostScopeNodes : scopeNodes;
          if (/^:root\b/.test(text)) {
            selector.replaceWith(selectorParser().astSync(text.replace(/^:root\b/, activeScope)).first!.clone());
            return;
          }
          selector.prepend(selectorParser.combinator({ value: " " }));
          for (let index = activeNodes.length - 1; index >= 0; index -= 1) selector.prepend(activeNodes[index].clone());
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
    const unprefixedProperty = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
    const value = declaration.value.trim();
    const decodedValue = decodeCssEscapes(value);
    const owningRule = findOwningRule(declaration);
    const keyframesRule = owningRule ? findKeyframesRule(owningRule) : null;
    const canHideTarget = owningRule
      ? hideableRules.has(owningRule) || Boolean(keyframesRule && optionalOnlyKeyframes.has(keyframesRule.params.trim()))
      : false;
    // Trusted UI and essential audio/recovery controls stay available even for
    // open skins. The host also draws authorization and recovery UI outside the
    // skin root, so a container-level hide cannot remove them either.
    const protectedTarget = owningRule && !keyframesRule ? selectorSubjectProtectedPart(owningRule.selector) : null;
    // Every themeable host part referenced anywhere in the selector. A rule may
    // target a descendant of the overlay (for example with `*`), so the subject
    // alone is not enough to decide whether host chrome layout is at stake.
    const hostChromeParts = owningRule && !keyframesRule ? selectorHostChromeParts(owningRule.selector) : [];
    const inHostChromeScope = hostChromeParts.length > 0;
    const inOverlayScope = hostChromeParts.includes("host.plugins.overlay");
    if (property.startsWith("--") && !/^--skin-[a-z0-9_-]+$/i.test(property)
      && !(pluginId && property.startsWith(`--plugin-${pluginId}-`))) {
      throw declaration.error(pluginId
        ? `Custom plugin variables must use --plugin-${pluginId}- or --skin- prefixes.`
        : "Custom skin variables must use the --skin- prefix so they cannot replace WebSpeak's structural tokens.");
    }
    if (schemaVersion < 3 && isLayoutAffectingProperty(property)) {
      throw declaration.error("Skin CSS may change component artwork and appearance, but must not change layout, positioning, sizing, text flow, or interaction geometry.");
    }
    // Host chrome lives outside the skin root and owns its own placement. A
    // skin may repaint it (colors, borders, radius, artwork) but must not turn
    // it — or any of its descendants — into a viewport-sized overlay above
    // authorization/recovery UI.
    if (inHostChromeScope && HOST_CHROME_LOCKED_PROPERTIES.has(unprefixedProperty)) {
      throw declaration.error("Host chrome layout is owned by WebSpeak; skins may theme colors, borders, radius and artwork but must not reposition or restack host controls.");
    }
    if (inOverlayScope && HOST_OVERLAY_LOCKED_PROPERTIES.has(unprefixedProperty)) {
      throw declaration.error("The application library shell cannot be resized into a fullscreen overlay; theme its colors, borders, radius and artwork instead.");
    }
    if (property === "font-family") warnings.add("Custom fonts can change localized text wrapping; verify every WebSpeak language before publishing.");
    if (["behavior", "-moz-binding"].includes(property) || /expression\s*\(|javascript\s*:|vbscript\s*:/i.test(decodedValue)) {
      throw declaration.error("Executable CSS values are not allowed.");
    }
    const compactValue = decodeCssEscapes(valueParser(value).nodes.filter((node) => node.type !== "space" && node.type !== "comment").map((node) => node.value ?? "").join("")).toLowerCase();
    if (INDIRECT_VALUE_PROPERTIES.has(unprefixedProperty) && /\b(?:var|attr)\s*\(/i.test(decodedValue)) {
      if (protectedTarget) {
        throw declaration.error(`The required control "${protectedTarget}" cannot use indirect values for visibility or positioning.`);
      }
      if (!canHideTarget && schemaVersion < 3) throw declaration.error("Visibility and interaction styles can only use indirect values on explicitly optional visual parts.");
    }
    const removesVisual = property === "all"
      || (property === "display" && compactValue === "none")
      || (property === "visibility" && /^(?:hidden|collapse)$/.test(compactValue))
      || (property === "opacity" && /^0(?:\.0+)?%?$/.test(compactValue))
      || (property === "pointer-events" && compactValue === "none")
      || (property === "clip-path" && /inset\(\s*50%/.test(compactValue))
      || (property === "mask" && /(?:alpha\(0\)|luminance\(0\))/.test(compactValue));
    if (removesVisual && protectedTarget) {
      throw declaration.error(`The required control "${protectedTarget}" must remain available; permission, recovery and essential audio paths cannot be hidden.`);
    }
    if (removesVisual && !canHideTarget && schemaVersion < 3) {
      throw declaration.error("Only explicitly optional visual parts may be hidden or reset; required controls and their containers must remain available.");
    }
    const visuallyRemoves = (property === "transform" && /scale(?:3d)?\(\s*0(?:\s*[,)]|\s*\))/i.test(decodedValue))
      || (property === "clip-path" && /inset\(\s*50%/i.test(decodedValue))
      || (property === "filter" && /(?:opacity|brightness)\(\s*0(?:%|\s*[,)]|\s*\))/i.test(decodedValue));
    if (visuallyRemoves && protectedTarget) {
      throw declaration.error(`The required control "${protectedTarget}" must remain visible.`);
    }
    if (visuallyRemoves && !canHideTarget && schemaVersion < 3) {
      throw declaration.error("Only explicitly optional visual parts may be visually removed.");
    }
    if (protectedTarget && valueMovesOffscreen(unprefixedProperty, decodedValue)) {
      throw declaration.error(`The required control "${protectedTarget}" must remain on screen and reachable.`);
    }
    if (schemaVersion >= 3 && removesVisual && !protectedTarget) warnings.add("This open skin hides an interface part; keep a usable path to essential voice and recovery controls.");
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

/**
 * A leading `:root` is rewritten in place to `.ws-skin-root[data-ws-skin=…]`.
 * With a sibling combinator (`+` / `~`) that would select siblings of the
 * skin root — for example the host-owned layer, which is a body child and a
 * sibling of the skin root in the preview fixture. Skin scope must only apply
 * to the root's own subtree, so reject that shape structurally. A leading
 * `:root` followed by a descendant combinator (`:root [data-ws-part="…"]`)
 * remains valid.
 */
function assertNoRootSiblingEscape(parsed: selectorParser.Root): void {
  for (const item of parsed.nodes) {
    const first = item.nodes[0];
    if (!first || first.type !== "pseudo" || first.value.toLowerCase() !== ":root") continue;
    const combinator = item.nodes.find((node) => node.type === "combinator");
    if (combinator && (combinator.value === "+" || combinator.value === "~")) {
      throw new SkinCssValidationError(
        "Skin selectors cannot use a sibling combinator after :root; the scope must stay inside the skin root.",
        "SKIN_CSS_SELECTOR",
      );
    }
  }
}

/**
 * Decide whether one selector of an author rule targets host chrome, and
 * enforce the boundary around the extended document-level scope.
 *
 * Returns true when the compiled rule must use `:root[data-ws-host-skin=…]`.
 * Author CSS can never name html/body or the host marker attribute itself; the
 * host generates that anchor. Host parts are only available to open (v3/v4)
 * skins and may not be mixed with page parts in the same selector.
 */
function assertHostChromeSelector(selector: string, schemaVersion: SkinCssSchemaVersion, isPluginStyle: boolean): boolean {
  let parsed: selectorParser.Root;
  try { parsed = selectorParser().astSync(selector); }
  catch { throw new SkinCssValidationError("A CSS selector is invalid.", "SKIN_CSS_SELECTOR"); }
  assertNoRootSiblingEscape(parsed);
  const partNames: string[] = [];
  parsed.walk((node) => {
    if (node.type === "tag" && ["html", "body"].includes(node.value.toLowerCase())) {
      throw new SkinCssValidationError("Skin selectors cannot target html or body elements.", "SKIN_CSS_SELECTOR");
    }
    if (node.type === "attribute" && FORBIDDEN_SCOPE_ATTRIBUTES.has(node.attribute.toLowerCase())) {
      throw new SkinCssValidationError(`Skin selectors cannot reference the host attribute ${node.attribute}.`, "SKIN_CSS_SELECTOR");
    }
    if (node.type === "attribute" && node.attribute.toLowerCase() === "data-ws-part" && node.value) {
      partNames.push(node.value.replace(/^['"]|['"]$/g, ""));
    }
  });
  const hostParts = partNames.filter((part) => HOST_CHROME_PART_IDS.has(part));
  const unknownHostParts = partNames.filter((part) => part.startsWith("host.") && !HOST_CHROME_PART_IDS.has(part));
  if (unknownHostParts.length) {
    throw new SkinCssValidationError(`Trusted or unknown host part cannot be styled: ${unknownHostParts[0]}.`, "SKIN_CSS_SELECTOR");
  }
  if (!hostParts.length) return false;
  if (hostParts.length !== partNames.length) {
    throw new SkinCssValidationError("Host chrome parts cannot be mixed with page parts in one selector.", "SKIN_CSS_SELECTOR");
  }
  if (isPluginStyle) throw new SkinCssValidationError("Plugin styles cannot target host chrome parts.", "SKIN_CSS_SELECTOR");
  if (schemaVersion < 3) throw new SkinCssValidationError("Host chrome theming requires an open (schemaVersion 3 or 4) skin.", "SKIN_CSS_SELECTOR");
  assertHostChromeSubject(parsed);
  return true;
}

/**
 * A host-scope rule is promoted to the document root. To keep that promotion
 * from turning the root/html/body (or an arbitrary ancestor) into the rule's
 * subject, every host-scope selector must be anchored on a themeable host part
 * in its first compound and must never end in `:root`.
 */
function assertHostChromeSubject(parsed: selectorParser.Root): void {
  for (const item of parsed.nodes) {
    if (!item.nodes.length) continue;
    const firstCombinator = item.nodes.findIndex((node) => node.type === "combinator");
    if (firstCombinator === 0) {
      throw new SkinCssValidationError("Host chrome rules must start from a themeable host part.", "SKIN_CSS_SELECTOR");
    }
    const firstCompound = firstCombinator === -1 ? item.nodes : item.nodes.slice(0, firstCombinator);
    const anchored = firstCompound.some((node) => node.type === "attribute"
      && node.attribute.toLowerCase() === "data-ws-part"
      && HOST_CHROME_PART_IDS.has((node.value ?? "").replace(/^['"]|['"]$/g, "")));
    if (!anchored) {
      throw new SkinCssValidationError("Host chrome rules must start from a themeable [data-ws-part=\"host.…\"] selector; the document root cannot be themed or hidden.", "SKIN_CSS_SELECTOR");
    }
    let subjectStart = 0;
    for (let index = item.nodes.length - 1; index >= 0; index -= 1) {
      if (item.nodes[index].type === "combinator") { subjectStart = index + 1; break; }
    }
    for (let index = subjectStart; index < item.nodes.length; index += 1) {
      const node = item.nodes[index];
      if (node.type === "pseudo" && node.value.toLowerCase() === ":root") {
        throw new SkinCssValidationError("Host chrome rules cannot make the document root the subject of a rule.", "SKIN_CSS_SELECTOR");
      }
    }
  }
}

/** Find a protected part in the subject (last compound) of any selector in a rule. */
function selectorSubjectProtectedPart(selector: string): string | null {
  try {
    const parsed = selectorParser().astSync(selector);
    for (const item of parsed.nodes) {
      let start = 0;
      for (let index = item.nodes.length - 1; index >= 0; index -= 1) {
        if (item.nodes[index].type === "combinator") { start = index + 1; break; }
      }
      for (let index = start; index < item.nodes.length; index += 1) {
        const node = item.nodes[index];
        if (node.type !== "attribute" || node.attribute.toLowerCase() !== "data-ws-part" || !node.value) continue;
        const part = node.value.replace(/^['"]|['"]$/g, "");
        if (PROTECTED_PART_IDS.has(part)) return part;
      }
    }
  } catch { /* A malformed selector is rejected elsewhere. */ }
  return null;
}

/** Find every themeable host part referenced by a selector, in any compound. */
function selectorHostChromeParts(selector: string): string[] {
  const parts: string[] = [];
  try {
    selectorParser().astSync(selector).walk((node) => {
      if (node.type !== "attribute" || node.attribute.toLowerCase() !== "data-ws-part" || !node.value) return;
      const part = node.value.replace(/^['"]|['"]$/g, "");
      if (HOST_CHROME_PART_IDS.has(part) && !parts.includes(part)) parts.push(part);
    });
  } catch { /* A malformed selector is rejected elsewhere. */ }
  return parts;
}

function isLayoutAffectingProperty(property: string): boolean {
  const unprefixed = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
  if (LAYOUT_AFFECTING_PROPERTIES.has(unprefixed)) return true;
  if (/^(?:margin|padding)(?:-|$)/.test(unprefixed)) return true;
  if (/^border(?:-|$)/.test(unprefixed) && !/^border-(?:color(?:-|$)|radius(?:-|$))/.test(unprefixed)) return true;
  if (/^(?:grid|flex|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self)|offset|transform|overscroll|overflow|column)(?:-|$)/.test(unprefixed)) return true;
  return /^font-(?!family$|weight$|style$|synthesis$|palette$)/.test(unprefixed);
}

/**
 * True when a positioning/margin/transform value can push a protected control
 * off-screen. Thresholds are deliberately low: a protected control has a
 * minimum 44 px hit target, so an offset of a hundred pixels is already enough
 * to make it unreachable. Percentages and viewport units are compared against a
 * full viewport/containing block.
 */
const OFFSET_PROPERTY_PATTERN = /^(?:margin|inset|left|right|top|bottom|translate|transform|scale|rotate)(?:-|$)/;
const ABSOLUTE_OFFSET_LIMIT_PX = 100;
const RELATIVE_OFFSET_LIMIT = 100;

function absoluteLengthToPixels(magnitude: number, unit: string): number | null {
  switch (unit) {
    case "px": return magnitude;
    case "rem": case "em": return magnitude * 16;
    case "ex": case "rex": case "ch": return magnitude * 8;
    case "cm": return magnitude * 37.8;
    case "mm": return magnitude * 3.78;
    case "q": return magnitude * 0.945;
    case "in": return magnitude * 96;
    case "pt": return magnitude * 1.333;
    case "pc": return magnitude * 16;
    default: return null;
  }
}

function valueMovesOffscreen(property: string, value: string): boolean {
  if (!OFFSET_PROPERTY_PATTERN.test(property)) return false;
  let offscreen = false;
  valueParser(value).walk((node) => {
    if (node.type !== "word") return;
    const match = /^(-?(?:\d+|\d*\.\d+))(px|rem|em|r?ex|ch|%|cm|mm|q|in|pt|pc|(?:s|l|d)?v(?:w|h|min|max)|cq(?:w|h|min|max|i|b))$/i.exec(node.value);
    if (!match) return;
    const magnitude = Math.abs(Number(match[1]));
    const unit = match[2].toLowerCase();
    if (unit === "%" || /^(?:s|l|d)?v(?:w|h|min|max)$/.test(unit) || /^cq(?:w|h|min|max|i|b)$/.test(unit)) {
      if (magnitude >= RELATIVE_OFFSET_LIMIT) offscreen = true;
      return;
    }
    const pixels = absoluteLengthToPixels(magnitude, unit);
    if (pixels !== null && pixels >= ABSOLUTE_OFFSET_LIMIT_PX) offscreen = true;
  });
  // A matrix transform can smuggle a large translation in unitless numbers.
  if (property === "transform") {
    valueParser(value).walk((node) => {
      if (node.type !== "function") return;
      const name = node.value.toLowerCase();
      if (name !== "matrix" && name !== "matrix3d") return;
      const numbers = valueParser.stringify(node.nodes).split(",").map((item) => Number(item.trim()));
      const translations = name === "matrix" ? [numbers[4], numbers[5]] : [numbers[12], numbers[13]];
      if (translations.some((translation) => Number.isFinite(translation) && Math.abs(translation) >= ABSOLUTE_OFFSET_LIMIT_PX)) offscreen = true;
    });
  }
  return offscreen;
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
