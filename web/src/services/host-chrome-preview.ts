/**
 * Browser-facing re-exports for the static host chrome preview page.
 *
 * Vite serves modules below `web/`, while the host-chrome policy lives in the
 * repository-level `src/shared` tree. Keeping the bridge here lets the preview
 * use exactly the same opt-in and reachability rules as the Vue client.
 */
export {
  DEFAULT_HIDDEN_HOST_PARTS,
  resolveHiddenHostParts,
} from "../../../src/shared/skin-chrome.js";
export type { SkinChromeDocument } from "../../../src/shared/skin-chrome.js";
export { isHostPartReachable, shouldShowRecovery } from "./host-chrome-visibility.js";
