"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const anti = require("../core/runtime/antiProtection");

function runFixtures() {
  const source = {
    anti_nude: true,
    anti_undo: 1,
    anti_danger_link: false,
    anti_sticker_spam: "true",
    anti_link: true,
    anti_spam: null,
    anti_card: true,
    anti_doodle: 0,
    anti_file: false,
    anti_gif: true,
    anti_join: "on",
    anti_location: true,
    anti_other: {},
    anti_photo: true,
    anti_qr: false,
    anti_reaction: true,
    anti_sticker: false,
    anti_taghide: true,
    anti_video: 1,
    anti_voice: true,
    anti_word: undefined,
    unrelated: "keep"
  };
  const state = anti.getAntiProtectionState(source);
  const data = {
    bot_enabled: true,
    disabled_commands: ["menu"],
    anti_nude_warnings: { memberA: 2 },
    anti_link: false
  };
  const updated = anti.setAntiProtectionState(data, "anti_sticker", true);

  const errors = [];
  for (const [threadData, feature, enabled] of [
    [{}, "anti_unknown", true],
    [{}, "anti_link", "on"],
    [null, "anti_link", true],
    [[], "anti_link", true],
    [{}, Symbol("anti_link"), true]
  ]) {
    try {
      anti.setAntiProtectionState(threadData, feature, enabled);
      errors.push(null);
    } catch (error) {
      errors.push({ name: error.name, message: error.message });
    }
  }

  return {
    keys: anti.ANTI_PROTECTION_KEYS,
    supported: ["anti_nude", "anti_qr", "anti_word", "anti_unknown", "ANTI_LINK"].map(key =>
      anti.isSupportedFeature(key)
    ),
    state,
    data,
    updated,
    errors
  };
}

test("Anti-protection Rust addon exposes the schema and strict-state mapper", t => {
  const diagnostics = anti.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Anti-protection Rust functions are inactive");
  assert.ok(diagnostics.exports.includes("antiIsSupportedFeature"));
  assert.ok(diagnostics.exports.includes("antiProtectionKeys"));
  assert.ok(diagnostics.exports.includes("antiProtectionState"));
});

test("Anti-protection Rust schema and state mapping preserve the JavaScript contract", t => {
  if (!anti.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_ANTI_PROTECTION;
  try {
    process.env.JT_RUST_ANTI_PROTECTION = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_ANTI_PROTECTION;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_ANTI_PROTECTION;
    else process.env.JT_RUST_ANTI_PROTECTION = previous;
  }
});

test("Anti-protection setter mutates only the selected key and preserves unrelated data", () => {
  const data = { bot_enabled: true, anti_nude_warnings: { memberA: 2 } };
  const result = anti.setAntiProtectionState(data, "anti_link", true);
  assert.equal(data.anti_link, true);
  assert.equal(data.bot_enabled, true);
  assert.deepEqual(data.anti_nude_warnings, { memberA: 2 });
  assert.equal(result.anti_link, true);
});
