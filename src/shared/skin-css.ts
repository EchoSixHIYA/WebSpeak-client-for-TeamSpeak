import postcss, { type AtRule, type Declaration, type Node, type Rule } from "postcss";
import selectorParser, { type Node as SelectorNode, type Pseudo as SelectorPseudo } from "postcss-selector-parser";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
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
/** CSS-wide keywords never name a keyframe and reset an animatable slot. */
const CSS_WIDE_KEYWORDS = new Set(["initial", "inherit", "unset", "revert", "revert-layer"]);
/** Shorthand keyword slots; a repeated category frees the word to be the name. */
const ANIMATION_KEYWORD_CATEGORIES = new Map<string, string>([
  ["linear", "timing"], ["ease", "timing"], ["ease-in", "timing"], ["ease-out", "timing"],
  ["ease-in-out", "timing"], ["step-start", "timing"], ["step-end", "timing"],
  ["normal", "direction"], ["reverse", "direction"], ["alternate", "direction"], ["alternate-reverse", "direction"],
  ["none", "fill"], ["forwards", "fill"], ["backwards", "fill"], ["both", "fill"],
  ["running", "play"], ["paused", "play"], ["infinite", "iteration"],
]);
/** Words that let an animation hold its `from`/`0%` frame. */
const RESTING_START_KEYWORDS = new Set(["reverse", "alternate", "alternate-reverse", "backwards", "both", "paused"]);

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
  // Host chrome is Teleported outside `.ws-skin-root`; these rules get their own
  // document-level scope, which the host anchors to the active skin attribute.
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
  // Keyframes inherit the protected/locked status of their referencing rules;
  // params are namespaced here, and `from`/`0%` only rests for some rules.
  const protectedKeyframeParts = new Map<string, string>();
  const lockedHostKeyframeParts = new Map<string, Set<string>>();
  const restingFromKeyframes = new Set<string>();
  // Direction/fill/play-state longhands may sit in a sibling rule on the same
  // subject; collect names per subject, then mark resting-from afterwards.
  const subjectKeyframes = new Map<string, Set<string>>();
  const restingSubjects = new Set<string>();
  root.walkRules((rule: Rule) => {
    if (hasKeyframesAncestor(rule)) return;
    const optionalTarget = hideableRules.has(rule);
    const protectedTarget = selectorSubjectProtectedPart(rule.selector);
    const lockedHostParts = selectorLockedHostParts(rule.selector);
    const subjects = [
      ...selectorSubjectParts(rule.selector, PROTECTED_PART_IDS),
      ...selectorSubjectParts(rule.selector, HOST_CHROME_PART_IDS).filter((part) => !OPTIONAL_VISUAL_PARTS.has(part)),
    ];
    const restsAtStart = subjects.length > 0 && ruleCanRestAtStart(rule);
    if (restsAtStart) for (const subject of subjects) restingSubjects.add(subject);
    rule.walkDecls((declaration: Declaration) => {
      // Decode the property like the enforcement walk (`anim\61 tion`), and the
      // value so escaped identifiers match their declared names.
      const property = unprefixed(decodeCssEscapes(declaration.prop).toLowerCase());
      if (property !== "animation" && property !== "animation-name") return;
      const decodedValue = decodeCssEscapes(declaration.value);
      if (/\b(?:var|attr)\s*\(/i.test(decodedValue)) {
        keyframeNames.forEach((_, name) => nonOptionalKeyframes.add(name));
        return;
      }
      const { names } = parseAnimationLayers(decodedValue, property);
      for (const nameNode of names) {
        if (!nameNode) continue;
        const name = nameNode.value;
        for (const [original, scopedName] of keyframeNames) {
          if (name !== original && name !== scopedName) continue;
          referencedKeyframes.add(original);
          if (!optionalTarget) nonOptionalKeyframes.add(original);
          if (protectedTarget && !protectedKeyframeParts.has(scopedName)) {
            protectedKeyframeParts.set(scopedName, protectedTarget);
          }
          if (lockedHostParts.length) {
            const parts = lockedHostKeyframeParts.get(scopedName) ?? new Set<string>();
            for (const part of lockedHostParts) parts.add(part);
            lockedHostKeyframeParts.set(scopedName, parts);
          }
          if (restsAtStart) restingFromKeyframes.add(scopedName);
          for (const subject of subjects) {
            const names = subjectKeyframes.get(subject) ?? new Set<string>();
            names.add(scopedName);
            subjectKeyframes.set(subject, names);
          }
        }
      }
    });
  });
  for (const subject of restingSubjects) {
    for (const name of subjectKeyframes.get(subject) ?? []) restingFromKeyframes.add(name);
  }
  const optionalOnlyKeyframes = new Set([...referencedKeyframes]
    .filter((name) => !nonOptionalKeyframes.has(name))
    .map((name) => keyframeNames.get(name)!));

  root.walkDecls((declaration: Declaration) => {
    const property = decodeCssEscapes(declaration.prop).toLowerCase();
    const unprefixedProperty = unprefixed(property);
    const value = declaration.value.trim();
    const decodedValue = decodeCssEscapes(value);
    const owningRule = findOwningRule(declaration);
    const keyframesRule = owningRule ? findKeyframesRule(owningRule) : null;
    const keyframeScope = keyframesRule?.params.trim() ?? null;
    // `to`/`100%` always rest, and `from`/`0%` when the rule can rest at start.
    const restingFrame = !keyframesRule
      || (keyframeScope !== null && keyframeStepCanRest(owningRule!.selector, restingFromKeyframes.has(keyframeScope)));
    const canHideTarget = owningRule
      ? hideableRules.has(owningRule) || Boolean(keyframesRule && optionalOnlyKeyframes.has(keyframesRule.params.trim()))
      : false;
    // A keyframe inherits the protected status of its referencing rules.
    const protectedTarget = owningRule
      ? keyframesRule
        ? (keyframeScope ? protectedKeyframeParts.get(keyframeScope) ?? null : null)
        : selectorSubjectProtectedPart(owningRule.selector)
      : null;
    // Every locked host part in the selector, not just the subject: `*` under
    // the overlay is still host chrome. Decorative parts are excluded.
    const hostChromeParts = owningRule
      ? keyframesRule
        ? (keyframeScope ? [...(lockedHostKeyframeParts.get(keyframeScope) ?? [])] : [])
        : selectorLockedHostParts(owningRule.selector)
      : [];
    const inHostChromeScope = hostChromeParts.length > 0;
    const inOverlayScope = hostChromeParts.includes("host.plugins.overlay");
    const overlaySubject = Boolean(!keyframesRule && owningRule
      && selectorSubjectPart(owningRule.selector, HOST_CHROME_PART_IDS) === "host.plugins.overlay");
    if (property.startsWith("--") && !/^--skin-[a-z0-9_-]+$/i.test(property)
      && !(pluginId && property.startsWith(`--plugin-${pluginId}-`))) {
      throw declaration.error(pluginId
        ? `Custom plugin variables must use --plugin-${pluginId}- or --skin- prefixes.`
        : "Custom skin variables must use the --skin- prefix so they cannot replace WebSpeak's structural tokens.");
    }
    if (schemaVersion < 3 && isLayoutAffectingProperty(property)) {
      throw declaration.error("Skin CSS may change component artwork and appearance, but must not change layout, positioning, sizing, text flow, or interaction geometry.");
    }
    // Host chrome keeps its placement and footprint; decorative host parts skip
    // this lock. Overlay contents may size themselves unless viewport-sized.
    if (inHostChromeScope && !keyframesRule) {
      if (HOST_CHROME_LOCKED_PROPERTIES.has(unprefixedProperty)) {
        throw declaration.error("Host chrome layout is owned by WebSpeak; skins may theme colors, borders, radius and artwork but must not reposition or restack host controls.");
      }
      if (overlaySubject && HOST_OVERLAY_LOCKED_PROPERTIES.has(unprefixedProperty)) {
        throw declaration.error("The application library shell cannot be resized into a fullscreen overlay; theme its colors, borders, radius and artwork instead.");
      }
      // Overlay contents may size themselves, but not to the viewport.
      if (inOverlayScope && !overlaySubject && OVERLAY_SIZE_PROPERTIES.has(unprefixedProperty) && valueIsViewportSized(decodedValue)) {
        throw declaration.error("The application library shell cannot be resized into a fullscreen overlay; theme its colors, borders, radius and artwork instead.");
      }
    } else if (inHostChromeScope && restingFrame && keyframeEscapesHostLock(unprefixedProperty, decodedValue)) {
      throw declaration.error("Host chrome layout is owned by WebSpeak; skins may theme colors, borders, radius and artwork but must not reposition, restack or resize host controls into a fullscreen layer.");
    }
    if (property === "font-family") warnings.add("Custom fonts can change localized text wrapping; verify every WebSpeak language before publishing.");
    if (["behavior", "-moz-binding"].includes(property) || /expression\s*\(|javascript\s*:|vbscript\s*:/i.test(decodedValue)) {
      throw declaration.error("Executable CSS values are not allowed.");
    }
    if (INDIRECT_VALUE_PROPERTIES.has(unprefixedProperty) && restingFrame && /\b(?:var|attr)\s*\(/i.test(decodedValue)) {
      if (protectedTarget) {
        throw declaration.error(`The required control "${protectedTarget}" cannot use indirect values for visibility or positioning.`);
      }
      if (!canHideTarget && schemaVersion < 3) throw declaration.error("Visibility and interaction styles can only use indirect values on explicitly optional visual parts.");
    }
    // An indirect animation name is checked at the declaration site. Locked
    // host chrome (the plugin overlay) uses the same rule, otherwise a
    // variable could point at a fullscreen keyframe.
    if (!keyframesRule && (unprefixedProperty === "animation" || unprefixedProperty === "animation-name")
      && /\b(?:var|attr)\s*\(/i.test(decodedValue)) {
      if (protectedTarget) {
        throw declaration.error(`The required control "${protectedTarget}" cannot use indirect values for visibility or positioning.`);
      }
      if (inHostChromeScope) {
        throw declaration.error("Host chrome layout is owned by WebSpeak; skins may theme colors, borders, radius and artwork but must not reposition or restack host controls through an indirect animation name.");
      }
    }
    // One predicate for every way a declaration can hide or disable a part.
    const hidesVisual = restingFrame && hidesVisually(unprefixedProperty, decodedValue);
    if (hidesVisual && protectedTarget) {
      throw declaration.error(`The required control "${protectedTarget}" must remain available; permission, recovery and essential audio paths cannot be hidden.`);
    }
    if (hidesVisual && !canHideTarget && schemaVersion < 3) {
      throw declaration.error("Only explicitly optional visual parts may be hidden or reset; required controls and their containers must remain available.");
    }
    if (restingFrame && protectedTarget && valueMovesOffscreen(unprefixedProperty, decodedValue)) {
      throw declaration.error(`The required control "${protectedTarget}" must remain on screen and reachable.`);
    }
    if (schemaVersion >= 3 && hidesVisual && !protectedTarget) warnings.add("This open skin hides an interface part; keep a usable path to essential voice and recovery controls.");
    if (/\bz-index\s*:\s*(?:[1-9]\d{4,}|-\d{4,})\b/i.test(`${property}:${decodedValue}`) || (property === "position" && decodedValue === "fixed")) warnings.add("Fixed positioning or extreme stacking may cover important controls; check the preview on desktop and mobile.");
    const withScopedNames = rewriteScopedNames(value, unprefixedProperty, keyframeNames, fontFamilyNames);
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

/** Functional pseudo-classes whose arguments keep the subject role. */
const SUBJECT_PSEUDO_CLASSES = new Set([":is", ":where", ":matches", ":-webkit-any", ":-moz-any"]);

/** The nodes after the last combinator, i.e. the subject compound. */
function lastCompound(nodes: SelectorNode[]): SelectorNode[] {
  let start = 0;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index].type === "combinator") { start = index + 1; break; }
  }
  return nodes.slice(start);
}

/** Find a part in a compound; `:is()`/`:where()`/`:nth-child(… of S)` and
 * `:not(:not(X))` keep the subject role, a single `:not()` does not. */
function compoundPart(nodes: SelectorNode[], parts: ReadonlySet<string>): string | null {
  for (const node of nodes) {
    if (node.type === "attribute" && node.attribute.toLowerCase() === "data-ws-part" && node.value) {
      const value = node.value.replace(/^['"]|['"]$/g, "");
      if (node.insensitive) {
        const lower = value.toLowerCase();
        for (const part of parts) if (part.toLowerCase() === lower) return part;
      } else if (parts.has(value)) {
        return value;
      }
    }
    if (node.type !== "pseudo" || !node.nodes) continue;
    const pseudo = node.value.toLowerCase();
    if (SUBJECT_PSEUDO_CLASSES.has(pseudo) || pseudo === ":nth-child" || pseudo === ":nth-last-child") {
      for (const nested of node.nodes) {
        const part = compoundPart(lastCompound(nested.nodes), parts);
        if (part) return part;
      }
    } else if (pseudo === ":not") {
      // `:not(:not(X))` and `:not(:not(X), Y)` are `X`; wrappers like
      // `:not(:is(:not(X)))` unwrap the same way. A single `:not(X)` is skipped.
      for (const argument of node.nodes) {
        const inner = nestedNegation(lastCompound(argument.nodes));
        if (!inner) continue;
        for (const nested of inner.nodes) {
          const part = compoundPart(lastCompound(nested.nodes), parts);
          if (part) return part;
        }
      }
    }
  }
  return null;
}

/** A `:not(...)` argument that is itself a `:not`, possibly wrapped in `:is()`. */
function nestedNegation(nodes: SelectorNode[]): SelectorPseudo | null {
  const direct = nodes.find((node): node is SelectorPseudo => node.type === "pseudo" && node.value.toLowerCase() === ":not");
  if (direct) return direct;
  for (const node of nodes) {
    if (node.type !== "pseudo" || !node.nodes || !SUBJECT_PSEUDO_CLASSES.has(node.value.toLowerCase())) continue;
    for (const nested of node.nodes) {
      const found = nestedNegation(lastCompound(nested.nodes));
      if (found) return found;
    }
  }
  return null;
}

/** Every matching part in the subject of any selector in a rule. */
function selectorSubjectParts(selector: string, parts: ReadonlySet<string>): string[] {
  const found: string[] = [];
  try {
    const parsed = selectorParser().astSync(selector);
    for (const item of parsed.nodes) {
      const part = compoundPart(lastCompound(item.nodes), parts);
      if (part && !found.includes(part)) found.push(part);
    }
  } catch { /* A malformed selector is rejected elsewhere. */ }
  return found;
}

function selectorSubjectPart(selector: string, parts: ReadonlySet<string>): string | null {
  return selectorSubjectParts(selector, parts)[0] ?? null;
}

function selectorSubjectProtectedPart(selector: string): string | null {
  return selectorSubjectPart(selector, PROTECTED_PART_IDS);
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

/** Host parts whose layout stays locked; decorative chrome is excluded. */
function selectorLockedHostParts(selector: string): string[] {
  return selectorHostChromeParts(selector).filter((part) => !OPTIONAL_VISUAL_PARTS.has(part));
}

function unprefixed(property: string): string {
  return property.replace(/^-(?:webkit|moz|ms|o)-/, "");
}

function isLayoutAffectingProperty(property: string): boolean {
  const local = unprefixed(property);
  if (LAYOUT_AFFECTING_PROPERTIES.has(local)) return true;
  if (/^(?:margin|padding)(?:-|$)/.test(local)) return true;
  if (/^border(?:-|$)/.test(local) && !/^border-(?:color(?:-|$)|radius(?:-|$))/.test(local)) return true;
  if (/^(?:grid|flex|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self)|offset|transform|overscroll|overflow|column)(?:-|$)/.test(local)) return true;
  return /^font-(?!family$|weight$|style$|synthesis$|palette$)/.test(local);
}

/**
 * True when a positioning/margin/transform value can push a protected control
 * clearly off-screen: -1000 px / -100 % or +2000 px / +200 %. Ordinary layout
 * moves are legitimate, so only viewport-ejecting values are rejected.
 */
const OFFSET_PROPERTY_PATTERN = /^(?:margin|inset|left|right|top|bottom|translate|transform)(?:-|$)/;
const OFFSET_LIMITS = { negativePx: 1000, positivePx: 2000, negativePercent: 100, positivePercent: 200 };

type Dimension = { value: number; unit: string };

const ABSOLUTE_UNIT_PIXELS: Record<string, number> = { px: 1, rem: 16, em: 16, ex: 8, rex: 8, ch: 8, cm: 37.8, mm: 3.78, q: 0.945, in: 96, pt: 1.333, pc: 16 };
function absoluteLengthToPixels(value: number, unit: string): number | null {
  const factor = ABSOLUTE_UNIT_PIXELS[unit];
  return factor ? value * factor : null;
}

type OffsetMeasurement = { kind: "pixels" | "percent"; value: number };

const VIEWPORT_UNIT_PATTERN = /^(?:s|l|d)?v(?:w|h|i|min|max)$|^cq(?:w|h|min|max|i|b)$/;

/** CSS `<number>` including a scientific-notation exponent. */
const CSS_NUMBER_PATTERN = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";

/** One CSS number, percentage or length, including a flat `calc()`. */
function parseDimension(text: string): Dimension | null {
  const compact = text.trim().toLowerCase();
  const calc = /^calc\(([\s\S]*)\)$/.exec(compact);
  if (calc) return evaluateCalc(calc[1]);
  const match = new RegExp(`^(${CSS_NUMBER_PATTERN})([a-z%]*)$`).exec(compact);
  return match ? { value: Number(match[1]), unit: match[2] } : null;
}

/** Flat `calc()`: sums of products over numbers and one unit; nested or mixed
 * input is unknown (`null` → allowed). A sign after `*`/`/` is a factor,
 * so `calc(2px*-1000)` is -2000px, not 2px + -1000. */
function evaluateCalc(text: string): Dimension | null {
  const compact = text.replace(/\s+/g, "");
  const tokens = compact.match(new RegExp(`[*/]|${CSS_NUMBER_PATTERN}(?:[a-z%]+)?`, "g"));
  if (!tokens || tokens.join("") !== compact) return null;
  const total: Dimension = { value: 0, unit: "" };
  let term: Dimension | null = null;
  let pending: "*" | "/" | null = null;
  const addTerm = (): boolean => {
    if (!term || (total.unit && term.unit && total.unit !== term.unit)) return false;
    total.value += term.value;
    total.unit ||= term.unit;
    return true;
  };
  for (const token of tokens) {
    if (token === "*" || token === "/") { pending = token; continue; }
    const factor = parseDimension(token);
    if (!factor) return null;
    if (pending && term) {
      if (factor.unit && (term.unit || pending === "/")) return null;
      term = { value: pending === "/" ? term.value / factor.value : term.value * factor.value, unit: term.unit || factor.unit };
      pending = null;
      continue;
    }
    if (term && !addTerm()) return null;
    term = factor;
    pending = null;
  }
  return !pending && addTerm() ? total : null;
}

/** Normalise one length for comparison; a bare number is not a length. */
function lengthMeasurement(value: string): OffsetMeasurement | null {
  const dimension = parseDimension(value);
  if (!dimension?.unit) return null;
  if (dimension.unit === "%" || VIEWPORT_UNIT_PATTERN.test(dimension.unit)) return { kind: "percent", value: dimension.value };
  const pixels = absoluteLengthToPixels(dimension.value, dimension.unit);
  return pixels === null ? null : { kind: "pixels", value: pixels };
}

function exceedsOffset(measurement: OffsetMeasurement | null): boolean {
  if (!measurement) return false;
  const [negative, positive] = measurement.kind === "percent"
    ? [OFFSET_LIMITS.negativePercent, OFFSET_LIMITS.positivePercent]
    : [OFFSET_LIMITS.negativePx, OFFSET_LIMITS.positivePx];
  return measurement.value <= -negative || measurement.value >= positive;
}

function valueMovesOffscreen(property: string, value: string): boolean {
  if (!OFFSET_PROPERTY_PATTERN.test(property)) return false;
  let offscreen = false;
  valueParser(value).walk((node) => {
    const name = node.type === "function" ? node.value.toLowerCase() : "";
    if (node.type === "word") offscreen ||= exceedsOffset(lengthMeasurement(node.value));
    else if (name === "calc") {
      offscreen ||= exceedsOffset(lengthMeasurement(valueParser.stringify(node)));
      return false;
    } else if (node.type === "function" && (name === "matrix" || name === "matrix3d")) {
      // A matrix can smuggle a large translation in unitless numbers.
      const items = valueParser.stringify(node.nodes).split(",").map((item) => Number(item.trim()));
      offscreen ||= (name === "matrix" ? [items[4], items[5]] : [items[12], items[13]])
        .some((item) => item <= -OFFSET_LIMITS.negativePx || item >= OFFSET_LIMITS.positivePx);
      return false;
    }
    return undefined;
  });
  return offscreen;
}

/** This declaration removes the element from view; partial effects stay allowed. */
function hidesVisually(property: string, value: string): boolean {
  if (property === "all") return true;
  const text = decodeCssEscapes(value).trim().toLowerCase();
  if ((property === "display" && text === "none") || (property === "visibility" && /^(?:hidden|collapse)$/.test(text))
    || (property === "pointer-events" && text === "none") || (property === "content-visibility" && text === "hidden")) return true;
  if (property === "opacity") return (numericValue(text) ?? 1) <= 0.01;
  if (property === "filter") return filterHides(text);
  if (property === "transform") return transformHides(text);
  if (property === "scale") return scalePropertyHides(text);
  if (property === "clip-path") return clipPathHides(text);
  if (property === "clip") return clipHides(text);
  return property === "mask" || property === "mask-image" ? maskHides(text) : false;
}

/** Visit every function node; `test` gets the lower-cased name and its arguments. */
function anyFunction(value: string, test: (name: string, args: string) => boolean): boolean {
  let hit = false;
  valueParser(value).walk((node) => {
    if (node.type === "function" && test(node.value.toLowerCase(), valueParser.stringify(node.nodes))) hit = true;
  });
  return hit;
}

/** A number, a percentage as 0–1, or a flat `calc()` of numbers. */
function numericValue(value: string): number | null {
  const dimension = parseDimension(value);
  if (!dimension) return null;
  return dimension.unit === "%" ? dimension.value / 100 : dimension.unit === "" ? dimension.value : null;
}

function filterHides(value: string): boolean {
  return anyFunction(value, (name, args) => {
    const amount = numericValue(args);
    return amount !== null && (name === "opacity" ? amount <= 0.01 : name === "brightness" && amount <= 0);
  });
}

function numbers(text: string): number[] {
  return text.split(/[\s,]+/).map(numericValue).filter((item): item is number => item !== null);
}

function isZeroFactor(value: number): boolean {
  return Math.abs(value) <= 0.001;
}

function transformHides(value: string): boolean {
  return anyFunction(value, (name, args) => {
    const factors = numbers(args);
    if (name === "scale" || name === "scale3d") return factors.slice(0, 2).some(isZeroFactor);
    return (name === "scalex" || name === "scaley") && isZeroFactor(factors[0] ?? 1);
  });
}

function scalePropertyHides(value: string): boolean {
  const factors = numbers(value);
  return factors.length > 0 && (isZeroFactor(factors[0]) || (factors.length > 1 && isZeroFactor(factors[1])));
}

function zeroLength(value: string | undefined): boolean {
  const dimension = value ? parseDimension(value) : null;
  return dimension !== null && isZeroFactor(dimension.value);
}

function insetHides(args: string): boolean {
  const sides = args.split(/\bround\b/i)[0].trim().split(/\s+/).map(parseDimension);
  if (sides.some((side) => !side || (side.unit !== "" && side.unit !== "%"))) return false;
  const values = sides.map((side) => side!.value);
  const [top, right = top, bottom = top, left = right] = values;
  return top + bottom >= 100 || left + right >= 100;
}

function clipPathHides(value: string): boolean {
  return anyFunction(value, (name, args) => {
    const shape = args.split(/\bat\b/i)[0].trim();
    if (name === "inset") return insetHides(args);
    if (name === "circle") return zeroLength(shape.split(/\s+/)[0]);
    return name === "ellipse" && shape.split(/\s+/).filter(Boolean).slice(0, 2).some(zeroLength);
  });
}

function clipHides(value: string): boolean {
  const match = /^rect\(([\s\S]*)\)$/i.exec(value.trim());
  if (!match) return false;
  const sides = match[1].split(/[\s,]+/).filter(Boolean);
  return sides.length === 4 && sides.every(zeroLength);
}

const GRADIENT_PRELUDE_KEYWORDS = new Set([
  "from", "to", "left", "right", "top", "bottom", "center", "at", "circle", "ellipse",
  "closest-side", "closest-corner", "farthest-side", "farthest-corner", "in",
]);

/** `#rgb0` / `#rrggbb00`, `transparent`, or a colour function with alpha ≤ 0.01. */
function colorIsTransparent(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (value === "transparent" || /^#(?:[\da-f]{3}0|[\da-f]{6}00)$/.test(value)) return true;
  return anyFunction(value, (name, args) => {
    if (!/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/.test(name)) return false;
    const slash = args.split("/");
    if (slash.length > 1) return (numericValue(slash[slash.length - 1].trim()) ?? 1) <= 0.01;
    const channels = numbers(args);
    return (name === "rgba" || name === "hsla") && channels.length >= 4 && channels[3] <= 0.01;
  });
}

/** A gradient is a full mask only when every colour stop is fully transparent. */
function gradientIsAllTransparent(args: string): boolean {
  let transparent = false;
  for (const segment of args.split(/,(?![^(]*\))/)) {
    const text = segment.trim().toLowerCase();
    if (!text) continue;
    const first = valueParser(text).nodes.find((node) => node.type !== "space" && node.type !== "comment");
    if (!first) continue;
    if (first.type === "function" ? colorIsTransparent(valueParser.stringify([first])) : colorIsTransparent(first.value)) {
      transparent = true;
      continue;
    }
    if (first.type === "word" && (GRADIENT_PRELUDE_KEYWORDS.has(first.value.toLowerCase()) || parseDimension(first.value)?.unit)) continue;
    return false;
  }
  return transparent;
}

function maskHides(value: string): boolean {
  return anyFunction(value, (name, args) =>
    name === "alpha" || name === "luminance"
      ? (numericValue(args) ?? 1) <= 0
      : name.endsWith("gradient") && gradientIsAllTransparent(args));
}

/**
 * Name token per layer. In the shorthand a keyword fills the first slot of its
 * category; a repeated category (or any other word) is the name, so
 * `bob 2s alternate` references `bob`. Times, numbers and functions are skipped.
 */
function parseAnimationLayers(value: string, property: string): { parsed: ReturnType<typeof valueParser>; names: Array<ValueNode | null> } {
  const parsed = valueParser(value);
  const groups: ValueNode[][] = [[]];
  for (const node of parsed.nodes) {
    if (node.type === "div" && node.value === ",") groups.push([]);
    else if (node.type !== "space" && node.type !== "comment") groups[groups.length - 1].push(node);
  }
  const names = groups.map((nodes) => {
    const words = nodes.filter((node) => node.type === "word" || node.type === "string");
    if (property === "animation-name") {
      const name = words[0] ? decodeCssEscapes(words[0].value).toLowerCase() : "";
      return words[0] && name !== "none" && !CSS_WIDE_KEYWORDS.has(name) ? words[0] : null;
    }
    const used = new Set<string>();
    for (const node of words) {
      const token = decodeCssEscapes(node.value).toLowerCase();
      const dimension = parseDimension(token);
      if (dimension && ["", "s", "ms"].includes(dimension.unit)) continue;
      const category = ANIMATION_KEYWORD_CATEGORIES.get(token);
      if (category && used.has(category)) return node;
      if (category) used.add(category);
      else if (node.type === "word" && CSS_WIDE_KEYWORDS.has(token)) continue;
      else return node;
    }
    return null;
  });
  return { parsed, names };
}

/** Any restart/alternate/fill keyword or indirect value can hold the start frame.
 * Multi-layer rules are judged as a whole, which errs towards checking `from`. */
function ruleCanRestAtStart(rule: Rule): boolean {
  let resting = false;
  rule.walkDecls((declaration: Declaration) => {
    const property = unprefixed(decodeCssEscapes(declaration.prop).toLowerCase());
    if (!["animation", "animation-direction", "animation-fill-mode", "animation-play-state"].includes(property)) return;
    const value = decodeCssEscapes(declaration.value).toLowerCase();
    resting ||= /\b(?:var|attr)\s*\(/.test(value)
      || valueParser(value).nodes.some((node) => node.type === "word" && RESTING_START_KEYWORDS.has(node.value));
  });
  return resting;
}

/** `to`/`100%` always rest; `from`/`0%` rest for reverse/alternate, a
 * backwards/both fill, or a paused start. A long animation or a pause mid-way
 * (negative delay) can linger on an unchecked intermediate frame — accepted,
 * because recovery lives in a closed-shadow top-layer capsule. */
function keyframeStepCanRest(selector: string, restsAtStart: boolean): boolean {
  return selector.split(",").some((step) => {
    const value = decodeCssEscapes(step).trim().toLowerCase();
    if (value === "to") return true;
    if (value === "from") return restsAtStart;
    const position = parseDimension(value);
    return position?.unit === "%" && (position.value >= 100 || (restsAtStart && position.value <= 0));
  });
}

const OVERLAY_SIZE_PROPERTIES = new Set([
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "inline-size", "block-size", "min-inline-size", "min-block-size", "max-inline-size", "max-block-size", "aspect-ratio",
]);

function isViewportSizedDimension(dimension: Dimension | null): boolean {
  return Boolean(dimension && VIEWPORT_UNIT_PATTERN.test(dimension.unit) && Math.abs(dimension.value) >= 100);
}

function valueIsViewportSized(value: string): boolean {
  let sized = false;
  valueParser(value).walk((node) => {
    if (node.type === "word") sized ||= isViewportSizedDimension(parseDimension(node.value));
    else if (node.type === "function" && node.value.toLowerCase() === "calc") {
      sized ||= isViewportSizedDimension(parseDimension(valueParser.stringify(node)));
      return false;
    }
    return undefined;
  });
  return sized;
}

function isIdentityNumber(value: number): boolean {
  return Math.abs(value - 1) <= 0.001;
}

function isZeroAngleOrLength(value: string): boolean {
  return zeroLength(value);
}

/** Identity transforms (`none`, `scale(1)`, `translate(0)`, `rotate(0deg)`). */
function transformIsIdentity(value: string): boolean {
  const compact = value.trim().toLowerCase();
  if (compact === "none") return true;
  let seen = false;
  let identity = true;
  valueParser(compact).walk((node) => {
    if (node.type !== "function") return;
    seen = true;
    const name = node.value.toLowerCase();
    const args = valueParser.stringify(node.nodes);
    const factors = numbers(args);
    if (name === "scale" || name === "scale3d") identity &&= factors.length > 0 && factors.every(isIdentityNumber);
    else if (name === "scalex" || name === "scaley" || name === "scalez") identity &&= factors.length > 0 && isIdentityNumber(factors[0]);
    else if (/^translate(?:3d|[xyz])?$/.test(name)) identity &&= args.split(/[,\s]+/).filter(Boolean).every(isZeroAngleOrLength);
    else if (/^rotate(?:3d|[xyz])?$/.test(name) || name === "skew" || name === "skewx" || name === "skewy") {
      identity &&= args.split(/[,\s]+/).filter(Boolean).every(isZeroAngleOrLength);
    } else identity = false;
  });
  return seen && identity;
}

function isNeutralLockValue(property: string, value: string): boolean {
  const compact = value.trim().toLowerCase();
  if (["none", "auto", "static"].includes(compact) || CSS_WIDE_KEYWORDS.has(compact)) return true;
  if (property === "scale" || property === "zoom") {
    const factors = numbers(compact);
    return factors.length > 0 && factors.every(isIdentityNumber);
  }
  if (property === "rotate") return isZeroAngleOrLength(compact);
  if (property === "transform") return transformIsIdentity(compact);
  if (property === "translate" || property.startsWith("inset") || /^(?:top|right|bottom|left)$/.test(property)) {
    return compact.split(/\s+/).every((token) => token === "auto" || isZeroAngleOrLength(token));
  }
  return compact === "0" || isZeroAngleOrLength(compact);
}

/** Resting host-chrome keyframes reuse the direct lock per property: locked
 * properties only accept identity/neutral values; sizes only reject viewport sizes. */
function keyframeEscapesHostLock(property: string, value: string): boolean {
  const compact = decodeCssEscapes(value).trim().toLowerCase();
  if (isNeutralLockValue(property, compact)) return false;
  if (OVERLAY_SIZE_PROPERTIES.has(property)) return valueIsViewportSized(value);
  return HOST_CHROME_LOCKED_PROPERTIES.has(property);
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
  if (!["animation", "animation-name", "font", "font-family"].includes(property)) return value;
  // Rewrite against the decoded value: `p\75 lse` must become the scoped name
  // of `@keyframes pulse`, exactly like the matching walk above.
  const decoded = decodeCssEscapes(value);
  if (property === "animation" || property === "animation-name") {
    const { parsed, names } = parseAnimationLayers(decoded, property);
    for (const node of names) {
      const scoped = node ? keyframes.get(node.value) : undefined;
      if (node && scoped) node.value = scoped;
    }
    return parsed.toString();
  }
  const parsed = valueParser(decoded);
  parsed.walk((node) => {
    if (node.type !== "word" && node.type !== "string") return;
    const family = fontFamilies.get(node.value.toLowerCase());
    if (family) node.value = family;
  });
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
