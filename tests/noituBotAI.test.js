"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/noituEngine");
const ai = require("../core/games/noituBotAI");

test("every offline solo opening has at least one valid AI reply", () => {
  for (const value of ai.OPENING_PHRASES) {
    const phrase = engine.parsePhrase(value);
    const session = { currentPhrase: phrase, used: new Set([phrase.normalized]) };
    const reply = ai.chooseReply(session, () => 0);
    assert.ok(reply, "AI needs a reply after: " + value);
    assert.equal(reply.first, phrase.last);
  }
});

test("AI lookup uses accent-insensitive syllable keys", () => {
  const phrase = engine.parsePhrase("bầu trời");
  const reply = ai.chooseReply({ currentPhrase: phrase, used: new Set([phrase.normalized]) }, () => 0);
  assert.ok(reply);
  assert.equal(reply.first, "troi");
  assert.match(reply.display, /^trời /);
});

test("AI avoids phrases already used in the current match", () => {
  const phrase = engine.parsePhrase("học sinh");
  const used = new Set([phrase.normalized, "sinh vien", "sinh nhat", "sinh hoc"]);
  const reply = ai.chooseReply({ currentPhrase: phrase, used }, () => 0);
  assert.equal(reply, null);
});
 

test("AI falls back to cached Vietnamese dictionary suggestions when local reply is missing", async () => {
  const dictionary = require("../core/runtime/services/games/ghepchuService");
  dictionary.clearDictionaryCache();
  const requests = [];
  const session = {
    currentPhrase: engine.parsePhrase("sinh ngọc"),
    used: new Set(["sinh ngoc"])
  };
  const reply = await ai.findDynamicReply(session, {
    timeoutMs: 650,
    random: () => 0,
    getJson: async (url, options) => {
      requests.push({ url, timeout: options.timeout });
      if (url.includes("/suggest?")) {
        return { data: { suggestions: ["ngọc trai", "ngọc quý", "mặt trời"] } };
      }
      throw new Error("AI suggestions should not need a second lookup request");
    }
  });
  assert.ok(reply);
  assert.equal(reply.first, session.currentPhrase.last);
  assert.match(reply.display, /^ngọc /);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].timeout, 650);
  dictionary.clearDictionaryCache();
});

test("AI dynamic dictionary fallback returns null for unrelated or used suggestions", async () => {
  const session = {
    currentPhrase: engine.parsePhrase("sinh ngọc"),
    used: new Set(["sinh ngoc", "ngoc trai"])
  };
  const reply = await ai.findDynamicReply(session, {
    getJson: async () => ({ data: { suggestions: ["mặt trời", "ngọc trai"] } })
  });
  assert.equal(reply, null);
});
