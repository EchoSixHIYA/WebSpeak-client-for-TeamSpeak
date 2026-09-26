/** Reduce built-in theme specificity while a community skin is active.
 * The community skin is loaded after this stylesheet and should own appearance
 * without needing !important or private component selectors.
 */
export function scopeBuiltinThemeForCustomSkin(css: string, theme: "light" | "dark", skinId: string): string {
  const sourceRoot = `.ws-skin-root[data-ws-skin="builtin.${theme}"]`;
  const customRoot = `:where(.ws-skin-root[data-ws-skin="${skinId}"])`;
  return css.replaceAll(sourceRoot, customRoot);
}
