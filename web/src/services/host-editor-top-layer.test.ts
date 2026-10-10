import assert from "node:assert/strict";
import test from "node:test";
import { promoteHostEditorToTopLayer } from "./host-editor-top-layer.js";

test("host editors use Popover API top layer when it is available", () => {
  const attributes = new Map<string, string>();
  let showCount = 0;
  const element = {
    showPopover() { showCount += 1; },
    matches(selector: string) { return selector === ":popover-open" && showCount > 0; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
  } as unknown as HTMLElement;

  promoteHostEditorToTopLayer(element);
  promoteHostEditorToTopLayer(element);

  assert.equal(attributes.get("popover"), "manual");
  assert.equal(showCount, 1, "repeated ref notifications do not reopen an already visible popover");
});

test("host editors keep their ordinary positioning when Popover API is unavailable or fails", () => {
  let showCount = 0;
  const unsupported = {
    setAttribute() { throw new Error("must not add unsupported popover attributes"); },
  } as unknown as HTMLElement;
  const failingAttributes = new Map<string, string>();
  const failing = {
    showPopover() { showCount += 1; throw new Error("browser denied popover"); },
    setAttribute(name: string, value: string) { failingAttributes.set(name, value); },
    removeAttribute(name: string) { failingAttributes.delete(name); },
  } as unknown as HTMLElement;

  promoteHostEditorToTopLayer(unsupported);
  promoteHostEditorToTopLayer(null);
  promoteHostEditorToTopLayer(failing);

  assert.equal(showCount, 1);
  assert.equal(failingAttributes.has("popover"), false, "a failed top-layer promotion leaves the CSS fallback visible");
});
