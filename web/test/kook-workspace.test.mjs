import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { effectScope, ref } from "vue";

let vite, useKookWorkspace;
before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useKookWorkspace } = await vite.ssrLoadModule("/src/composables/useKookWorkspace.ts"));
});
after(async () => { await vite?.close(); });

function mount(t) {
  const scope = effectScope();
  const skinId = ref("community.kaak-voice"), connected = ref(false);
  const workspace = scope.run(() => useKookWorkspace({ skinId, connected }));
  t.after(() => scope.stop());
  return { ...workspace, skinId, connected };
}

test("first-time and failed connections stay on onboarding until a successful connection", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1 }, []);
  assert.equal(workspace.active.value, false);
  workspace.connected.value = true;
  assert.equal(workspace.active.value, true);
  workspace.connected.value = false;
  assert.equal(workspace.active.value, true, "disconnecting keeps the server rail and add button available");
});

test("returning users go directly to the workspace even without saved servers", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1, hasConnected: true }, []);
  assert.equal(workspace.active.value, true);
  assert.equal(workspace.connected.value, false, "entering the workspace does not silently start voice capture");
});

test("existing recent-server history migrates returning users", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1 }, [{ id: "server.invalid", address: "server.invalid", lastConnectedAt: 1 }]);
  assert.equal(workspace.active.value, true);
});

test("other skins retain their original flow and switching back restores KOOK", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1, hasConnected: true }, []);
  for (const id of ["builtin.light", "builtin.dark", "community.illusia-voice"]) {
    workspace.skinId.value = id;
    assert.equal(workspace.active.value, false);
  }
  workspace.skinId.value = "community.kaak-voice";
  assert.equal(workspace.active.value, true);
});

test("a saved nickname alone is not evidence of a successful connection", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1, lastNickname: "Previous failed attempt" }, []);
  assert.equal(workspace.active.value, false);
});

test("late preference loading cannot undo a successful connection", t => {
  const workspace = mount(t);
  workspace.connected.value = true;
  workspace.connected.value = false;
  workspace.restore({ schemaVersion: 1 }, []);
  assert.equal(workspace.active.value, true);
});

test("clearing local data resets onboarding", t => {
  const workspace = mount(t);
  workspace.restore({ schemaVersion: 1, hasConnected: true }, []);
  workspace.reset();
  assert.equal(workspace.active.value, false);
  workspace.connected.value = true;
  assert.equal(workspace.active.value, true);
});
