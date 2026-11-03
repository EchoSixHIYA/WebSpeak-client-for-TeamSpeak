import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstanceAuthorization, INSTANCE_AUTHORIZATION_KEY, canUseSkin, setInstanceAuthorization } from './instance-authorization.js';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test('new instances require an explicit decision; legacy package approvals do not imply consent', () => {
  const data = storage(); data.values.set('webspeak:skin-plugin-approvals', '{"grants":{"old":true}}');
  const state = createInstanceAuthorization(data);
  assert.equal(state.decision.value, null); assert.equal(state.allowed.value, false);
  state.set(false); assert.equal(createInstanceAuthorization(data).decision.value, false);
  state.set(true); assert.equal(createInstanceAuthorization(data).allowed.value, true);
  assert.deepEqual([...data.values.keys()].sort(), [INSTANCE_AUTHORIZATION_KEY, 'webspeak:skin-plugin-approvals'].sort());
});
test('separate instance storage stays independent; revocation and clearing propagate on reload', () => {
  const first = storage(), second = storage(), tab = createInstanceAuthorization(first), otherTab = createInstanceAuthorization(first);
  tab.set(true); otherTab.reload(); assert.equal(otherTab.allowed.value, true);
  assert.equal(createInstanceAuthorization(second).decision.value, null);
  tab.set(false); otherTab.reload(); assert.equal(otherTab.allowed.value, false);
  first.values.clear(); otherTab.reload(); assert.equal(otherTab.decision.value, null);
});
test('malformed or inaccessible storage never grants access; explicit choices survive in memory', () => {
  const data = storage();
  for (const value of ['true', '{}', '{"schemaVersion":1,"allowed":"true"}', '{"schemaVersion":2,"allowed":true}', 'broken']) {
    data.setItem(INSTANCE_AUTHORIZATION_KEY, value); assert.equal(createInstanceAuthorization(data).allowed.value, false);
  }
  const unavailable = createInstanceAuthorization({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(unavailable.allowed.value, false); unavailable.set(true); assert.equal(unavailable.allowed.value, true);
  unavailable.set(false); assert.equal(unavailable.allowed.value, false);
});
test('only the three official IDs bypass consent, including when KAAK is shipped as built-in', () => {
  setInstanceAuthorization(false);
  for (const id of ['builtin.light', 'builtin.dark', 'community.illusia-voice']) assert.equal(canUseSkin(id), true);
  for (const id of ['community.kaak-voice', 'community.discord-voice', 'builtin.other']) assert.equal(canUseSkin(id), false);
  setInstanceAuthorization(true); assert.equal(canUseSkin('community.kaak-voice'), true);
  setInstanceAuthorization(false);
});
