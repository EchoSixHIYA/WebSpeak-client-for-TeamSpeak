import assert from "node:assert/strict";
import test from "node:test";
import { isRecoveryShortcut } from "./host-chrome.js";
import { HOST_OWNED_LAYER_Z_INDEX, syncRecoveryPopover } from "./host-owned-layer.js";

type ShortcutEvent = {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
};

const shortcut = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  key: "",
  ...overrides,
});

test("the recovery shortcut requires the full Ctrl/Cmd+Alt+Shift+R chord", () => {
  assert.equal(isRecoveryShortcut(shortcut({ ctrlKey: true, altKey: true, shiftKey: true, key: "r" })), true);
  // macOS uses the Meta/Command key in place of Ctrl.
  assert.equal(isRecoveryShortcut(shortcut({ metaKey: true, altKey: true, shiftKey: true, key: "R" })), true);

  for (const rejected of [
    shortcut({ ctrlKey: true, altKey: true, shiftKey: true, key: "x" }),
    shortcut({ ctrlKey: true, altKey: true, shiftKey: true, key: "Enter" }),
    // Ordinary app/browser shortcuts must stay available.
    shortcut({ ctrlKey: true, key: "r" }),
    shortcut({ altKey: true, key: "r" }),
    shortcut({ ctrlKey: true, shiftKey: true, key: "r" }),
    shortcut({ ctrlKey: true, altKey: true, key: "r" }),
    shortcut({ ctrlKey: false, altKey: true, shiftKey: true, key: "r" }),
  ]) {
    assert.equal(isRecoveryShortcut(rejected), false, JSON.stringify(rejected));
  }
});

interface FakePopover {
  style: { display: string };
  showPopover?: () => void;
  hidePopover?: () => void;
  matches?: (selector: string) => boolean;
  removedAttributes: string[];
  removeAttribute(name: string): void;
}

const fakePopover = (overrides: Partial<FakePopover> = {}): FakePopover => {
  const element: FakePopover = {
    style: { display: "" },
    removedAttributes: [],
    removeAttribute(name: string) {
      element.removedAttributes.push(name);
    },
    matches: () => false,
    ...overrides,
  };
  return element;
};

const asElement = (element: FakePopover) => element as unknown as HTMLElement;

test("a missing showPopover uses the display fallback, visible and hidden", () => {
  const element = fakePopover();
  syncRecoveryPopover(asElement(element), true);
  assert.equal(element.style.display, "flex", "the capsule must be laid out without the Popover API");
  syncRecoveryPopover(asElement(element), false);
  assert.equal(element.style.display, "none");
  syncRecoveryPopover(asElement(element), true);
  assert.equal(element.style.display, "flex");
});

test("a throwing showPopover drops the popover attribute and shows the capsule", () => {
  let calls = 0;
  const element = fakePopover({
    showPopover() {
      calls += 1;
      throw new Error("top-layer promotion rejected");
    },
  });

  syncRecoveryPopover(asElement(element), true);
  assert.deepEqual(element.removedAttributes, ["popover"], "the UA display:none rule must be removed");
  assert.equal(element.style.display, "flex");
  assert.notEqual(element.style.display, "none");
  assert.equal(calls, 1);

  // Once fallback is in use the element must not flap back to showPopover().
  syncRecoveryPopover(asElement(element), false);
  assert.equal(element.style.display, "none");
  syncRecoveryPopover(asElement(element), true);
  assert.equal(element.style.display, "flex");
  assert.equal(calls, 1);
});

test("a working showPopover/hidePopover keeps the top-layer path", () => {
  let open = false;
  let shown = 0;
  let hidden = 0;
  const element = fakePopover({
    showPopover() {
      shown += 1;
      open = true;
    },
    hidePopover() {
      hidden += 1;
      open = false;
    },
    matches: (selector) => selector === ":popover-open" && open,
  });

  syncRecoveryPopover(asElement(element), true);
  assert.equal(shown, 1);
  assert.equal(element.style.display, "", "the top-layer path must not force display");
  syncRecoveryPopover(asElement(element), true);
  assert.equal(shown, 1, "an already-open popover is not reopened");

  syncRecoveryPopover(asElement(element), false);
  assert.equal(hidden, 1);
  assert.deepEqual(element.removedAttributes, [], "a working popover keeps its attribute");
});

test("the pre-Popover host layer uses the CSS 32-bit maximum z-index", () => {
  assert.equal(HOST_OWNED_LAYER_Z_INDEX, 2147483647);
});
