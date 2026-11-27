import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVoiceProfileSetting, resolveVoiceProfile } from "./voice-profile.js";

test("auto keeps direct requests on legacy and opts Cloudflare requests into adaptive", () => {
  assert.equal(normalizeVoiceProfileSetting(undefined), "auto");
  assert.equal(normalizeVoiceProfileSetting(""), "auto");
  assert.equal(normalizeVoiceProfileSetting("unknown"), "auto");
  assert.equal(resolveVoiceProfile("auto", false), "legacy");
  assert.equal(resolveVoiceProfile("auto", true), "adaptive");
});

test("explicit profile settings override request detection in both directions", () => {
  assert.equal(resolveVoiceProfile("legacy", true), "legacy");
  assert.equal(resolveVoiceProfile("adaptive", false), "adaptive");
  assert.equal(normalizeVoiceProfileSetting(" LEGACY "), "legacy");
  assert.equal(normalizeVoiceProfileSetting("Adaptive"), "adaptive");
});
