import assert from "node:assert/strict";
import test from "node:test";
import { requestMediaBeforeAudioResume } from "./microphone-start.js";

test("starts getUserMedia before waiting for AudioContext resume", async () => {
  const calls: string[] = [];
  const stream = { id: "microphone-stream" };

  const result = await requestMediaBeforeAudioResume(
    async () => {
      calls.push("getUserMedia");
      return stream;
    },
    async () => {
      calls.push("resume");
    },
  );

  assert.deepEqual(calls, ["getUserMedia", "resume"]);
  assert.equal(result, stream);
});

test("keeps the acquired microphone when AudioContext resume is blocked", async () => {
  const stream = { id: "microphone-stream" };

  const result = await requestMediaBeforeAudioResume(
    async () => stream,
    async () => { throw new Error("user gesture required"); },
  );

  assert.equal(result, stream);
});
