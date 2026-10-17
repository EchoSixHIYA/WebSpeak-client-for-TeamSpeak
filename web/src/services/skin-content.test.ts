import assert from "node:assert/strict";
import test from "node:test";
import { resolveSkinMessages } from "./skin-content.js";

test("localized skin messages merge the package default with the selected language", () => {
  const messages = resolveSkinMessages({
    defaultLocale: "zh-CN",
    locales: {
      "zh-CN": { messages: { hello: "你好", fallback: "默认文案" } },
      de: { messages: { hello: "Hallo" } },
      "de-DE": { messages: { hello: "Guten Tag" } },
    },
  }, "de");

  assert.deepEqual(messages, { hello: "Guten Tag", fallback: "默认文案" });
});

test("a skin without package messages resolves to an empty map", () => {
  assert.deepEqual(resolveSkinMessages(undefined, "en"), {});
});
