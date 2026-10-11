import assert from "node:assert/strict";
import test from "node:test";
import { parseSkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import { approveSkinPluginComponents, getMissingSkinPluginApprovals, isSkinPluginComponentApproved, revokeSkinPluginApprovals } from "./skin-plugin-approval.js";

const document = parseSkinPluginDocument({
  schemaVersion: 3,
  components: [{
    id: "admin-editor-test",
    name: "Admin editor test",
    page: "voice",
    mode: "widget",
    accessibleName: "Admin editor permission test",
    actions: {},
    permissions: ["session.status.read"],
    root: { tag: "div", children: [] },
  }],
});

test("skin component permissions can be approved for the current session without persistent storage", () => {
  const skinId = "community.editor-mode-test";
  const component = document.components[0];
  const subset = { ...document, components: [component] };

  revokeSkinPluginApprovals(skinId);
  assert.deepEqual(getMissingSkinPluginApprovals(skinId, "1.0.0", subset), [component]);
  approveSkinPluginComponents(skinId, "1.0.0", [component]);
  assert.deepEqual(getMissingSkinPluginApprovals(skinId, "1.0.0", subset), []);
  assert.equal(isSkinPluginComponentApproved(skinId, "1.0.0", component), true);

  revokeSkinPluginApprovals(skinId);
  assert.equal(isSkinPluginComponentApproved(skinId, "1.0.0", component), false);
});
