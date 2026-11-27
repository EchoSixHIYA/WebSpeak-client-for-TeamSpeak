/**
 * Pure presentation decisions for the trusted recovery entry.
 *
 * The recovery entry has two host buttons ("use built-in skin" and
 * "application library"). A skin may dock them as one capsule (the historical
 * `host.recovery` slot), as one chrome-less toolbar group, or as two separate
 * toolbar buttons (`host.recovery.built-in` / `host.recovery.library`).
 *
 * This module keeps the duplicate and fallback rules in one testable place:
 *  - an action is only "in the toolbar" when its anchor is currently slotted,
 *    so a missing/hidden anchor immediately returns it to the floating capsule;
 *  - the capsule renders only the actions that are not currently in the
 *    toolbar, so the same page never shows two copies of an action;
 *  - the shortcut forces every action back into the capsule (and hides the
 *    toolbar) so one keystroke still summons the complete recovery entry;
 *  - a toolbar-mode application-library action suppresses the ordinary
 *    `host.plugins.launcher`, because the host button is now the only library
 *    entry on that page (docked or floating, the capsule still offers it).
 */

export type HostRecoveryAction = "built-in" | "library";

export interface HostRecoveryToolbarActionState {
  /** The slot declaration exists and the action is usable on this page. */
  available: boolean;
  /** The slot binding currently reports a valid, docked anchor. */
  docked: boolean;
}

export interface HostRecoveryPresentationInput {
  /** The recovery entry should be visible at all (third-party skin / shortcut). */
  visible: boolean;
  /** The recovery shortcut is currently holding the entry open. */
  shortcutOpen: boolean;
  /** The application library is usable (connected with a plugin session). */
  libraryAvailable: boolean;
  builtIn: HostRecoveryToolbarActionState;
  library: HostRecoveryToolbarActionState;
}

export interface HostRecoveryPresentation {
  /** Toolbar entries the host should paint (and bind) on this page. */
  toolbar: HostRecoveryToolbarActionState & { visible: boolean };
  /** Whether each action is currently painted by a docked toolbar button. */
  docked: HostRecoveryDockedState;
  /** Actions still shown by the floating capsule, in render order. */
  capsuleActions: HostRecoveryAction[];
  capsuleVisible: boolean;
  /** Hide the ordinary plugin launcher to keep exactly one library entry. */
  suppressLauncher: boolean;
}

export interface HostRecoveryDockedState {
  builtIn: boolean;
  library: boolean;
}

export function resolveHostRecoveryPresentation(
  input: HostRecoveryPresentationInput,
): HostRecoveryPresentation {
  const toolbarVisible = input.visible && !input.shortcutOpen;
  const docked: HostRecoveryDockedState = {
    builtIn: toolbarVisible && input.builtIn.available && input.builtIn.docked,
    library: toolbarVisible && input.libraryAvailable && input.library.available && input.library.docked,
  };

  const capsuleActions: HostRecoveryAction[] = [];
  if (input.visible && !docked.builtIn) capsuleActions.push("built-in");
  if (input.visible && input.libraryAvailable && !docked.library) capsuleActions.push("library");

  return {
    toolbar: {
      available: toolbarVisible && (input.builtIn.available || input.library.available),
      docked: docked.builtIn || docked.library,
      visible: toolbarVisible,
    },
    docked,
    capsuleActions,
    capsuleVisible: capsuleActions.length > 0,
    // A toolbar-mode library button replaces the normal launcher even while
    // its anchor is invalid, because the fallback capsule would otherwise add
    // a second library entry next to that launcher.
    suppressLauncher: input.visible
      && input.libraryAvailable
      && input.library.available,
  };
}
