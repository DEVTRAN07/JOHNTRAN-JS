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
