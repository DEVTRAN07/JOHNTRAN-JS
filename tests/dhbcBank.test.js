"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const bank = require("../core/games/dhbcBank");

test("DHBC bank fallback contains the original built-in questions", () => {
  const questions = bank.getAll();
  assert.equal(questions.length, 24);
  assert.ok(questions.every((q) => q.id && q.answer && q.clues.length >= 2 && q.symbols.length === q.clues.length));
});

test("DHBC question validation rejects incomplete or unsafe records", () => {
  assert.throws(() => bank.validateQuestion({ id: "bad id", answer: "test", clues: ["a", "b"], symbols: ["a", "b"], hint: "hint" }));
  assert.throws(() => bank.validateQuestion({ id: "valid-id", answer: "test", clues: ["a", "b"], symbols: ["a"], hint: "hint" }));
  assert.throws(() => bank.validateQuestion({ id: "valid-id", answer: "", clues: ["a", "b"], symbols: ["a", "b"], hint: "hint" }));
});

test("DHBC question validation normalizes API input", () => {
  const question = bank.validateQuestion({
    id: "test-question", answer: "Đáp án", clues: [" Gợi ý 1 ", "Gợi ý 2"],
    symbols: ["🧩", "🎯"], hint: "  Gợi ý  "
  });
  assert.deepEqual(question, {
    id: "test-question", answer: "Đáp án", clues: ["Gợi ý 1", "Gợi ý 2"],
    symbols: ["🧩", "🎯"], hint: "Gợi ý"
  });
});
