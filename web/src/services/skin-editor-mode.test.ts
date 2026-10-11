import assert from "node:assert/strict";
import test from "node:test";
import { createSkinEditorModeController } from "./skin-editor-mode.js";

function sessionResponse(authenticated: boolean, mustChangePassword = false): Response {
  return new Response(JSON.stringify({
    authenticated,
    mustChangePassword,
    ...(authenticated ? { csrfToken: "test-csrf" } : {}),
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("skin editor mode is available only to an authenticated admin", async () => {
  const controller = createSkinEditorModeController(async (input, init) => {
    assert.equal(input, "/api/admin/session");
    assert.equal(init?.credentials, "same-origin");
    return sessionResponse(true);
  });

  assert.equal(await controller.setEnabled(true), true);
  assert.equal(controller.isAdmin.value, true);
  assert.equal(controller.isEnabled.value, true);
  assert.equal(await controller.setEnabled(false), true);
  assert.equal(controller.isEnabled.value, false);
});

test("unauthenticated, forced-password-change, and failed sessions keep editor mode hidden", async () => {
  for (const fetcher of [
    async () => sessionResponse(false),
    async () => sessionResponse(true, true),
    async () => new Response("unauthorized", { status: 401 }),
    async () => { throw new Error("offline"); },
  ]) {
    const controller = createSkinEditorModeController(fetcher as typeof fetch);
    assert.equal(await controller.setEnabled(true), false);
    assert.equal(controller.isAdmin.value, false);
    assert.equal(controller.isEnabled.value, false);
  }
});

test("an expired admin session disables an already-open editor mode", async () => {
  let authenticated = true;
  const controller = createSkinEditorModeController(async () => sessionResponse(authenticated));
  assert.equal(await controller.setEnabled(true), true);
  authenticated = false;
  assert.equal(await controller.refreshAdminAccess(), false);
  assert.equal(controller.isEnabled.value, false);
});
