"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/noituEngine");

const syllables = [
  "ĐIỆN",
  "CHỨC",
  "a\u0301",
  "\uFEFFViÊN",
  "猫",
  0,
  false
];

const phrases = [
  "  VIÊN   CHỨC! ",
  "ĐIỆN-thoại",
  "\uFEFFVIÊN\u00A0CHỨC",
  "a\u0085b c",
  "猫 猫",
  "một hai ba bốn năm",
  "học sinh",
  "BẦU TRỜI",
  "",
  0,
  false
];

test("Nối Từ Rust addon exports all migrated text operations", t => {
  const diagnostics = engine.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Nối Từ Rust functions are inactive");
});

test("Nối Từ Rust text operations preserve JavaScript normalization and parsing", t => {
  if (!engine.getNativeDiagnostics().loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }

  const previous = process.env.JT_RUST_NOITU_ENGINE;
  try {
    process.env.JT_RUST_NOITU_ENGINE = "0";
    const fallback = {
      syllables: syllables.map(value => engine.normalizeSyllable(value)),
      phrases: phrases.map(value => engine.normalizePhrase(value)),
      parsed: phrases.map(value => engine.parsePhrase(value))
    };

    delete process.env.JT_RUST_NOITU_ENGINE;
    const rust = {
      syllables: syllables.map(value => engine.normalizeSyllable(value)),
      phrases: phrases.map(value => engine.normalizePhrase(value)),
      parsed: phrases.map(value => engine.parsePhrase(value))
    };
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_NOITU_ENGINE;
    else process.env.JT_RUST_NOITU_ENGINE = previous;
  }
});
