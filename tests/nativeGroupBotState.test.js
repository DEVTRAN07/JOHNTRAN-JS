"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const groupPolicy = require("../src/domain/groups/botState");

function runFixtures() {
  const records = [
    { threadId: "g1", data: { bot_enabled: true } },
    { id: "g2", bot_enabled: "true" },
    { threadId: "g3", data: { bot_enabled: false } },
    { threadId: "", data: { bot_enabled: true } },
    null
  ];
  const groups = [
    { gid: "g1", name: "One", members: 4 },
    { gid: "g2", name: "Two", members: 5 },
    { gid: "g3", name: "Three", members: 6 },
    { gid: "", name: "Empty id" },
    null
  ];

  return {
    enabled: [
      groupPolicy.isEnabled({ data: { bot_enabled: true } }),
      groupPolicy.isEnabled({ bot_enabled: true }),
      groupPolicy.isEnabled({ data: { bot_enabled: 1 } }),
      groupPolicy.isEnabled({ bot_enabled: "true" }),
      groupPolicy.isEnabled(null),
      groupPolicy.isEnabled(false)
    ],
    controls: [
      groupPolicy.isAllowedControl(" BOT ", ["On"]),
      groupPolicy.isAllowedControl("bot", ["STATUS"]),
      groupPolicy.isAllowedControl("bot", ["off"]),
      groupPolicy.isAllowedControl("menu", ["on"]),
      groupPolicy.isAllowedControl("bot", []),
      groupPolicy.isAllowedControl(null, ["on"])
    ],
    messages: [
      groupPolicy.isAllowedControlMessage("/bot on", "/"),
      groupPolicy.isAllowedControlMessage("/bot status extra", "/"),
      groupPolicy.isAllowedControlMessage("!BOT\uFEFFSTATUS", "!"),
      groupPolicy.isAllowedControlMessage("::bot\u00A0on", "::"),
      groupPolicy.isAllowedControlMessage("/bot off", "/"),
      groupPolicy.isAllowedControlMessage("bot on", "/"),
      groupPolicy.isAllowedControlMessage("/bot\u0085on", "/"),
      groupPolicy.isAllowedControlMessage("/bot on", ""),
      groupPolicy.isAllowedControlMessage("/bot on", null)
    ],
    gate: [
      groupPolicy.canRunCommandInGroup({ data: { bot_enabled: false } }, "bot", ["on"]),
      groupPolicy.canRunCommandInGroup({ bot_enabled: false }, "BOT", ["status"]),
      groupPolicy.canRunCommandInGroup({ bot_enabled: false }, "menu", []),
      groupPolicy.canRunCommandInGroup({ bot_enabled: true }, "menu", [])
    ],
    attached: groupPolicy.attachGroupBotState(groups, records),
    snapshot: groupPolicy.getGroupBotStateSnapshot(records),
    invalidArrays: [
      groupPolicy.attachGroupBotState(null, records),
      groupPolicy.attachGroupBotState(groups, null),
      groupPolicy.getGroupBotStateSnapshot(null)
    ]
  };
}

test("group-state Rust addon exposes all policy operations", t => {
  const diagnostics = groupPolicy.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Rust group-state functions are inactive");
  for (const name of [
    "groupIsEnabled",
    "groupIsAllowedControl",
    "groupIsAllowedControlMessage",
    "groupCanRunCommand",
    "groupEnabledFlags",
    "groupStateSnapshot"
  ]) {
    assert.ok(diagnostics.exports.includes(name) || diagnostics.exports.includes(name.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase())));
  }
});

test("group-state Rust implementation preserves the JavaScript policy and snapshots", t => {
  if (!groupPolicy.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_GROUP_STATE;
  try {
    process.env.JT_RUST_GROUP_STATE = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_GROUP_STATE;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_GROUP_STATE;
    else process.env.JT_RUST_GROUP_STATE = previous;
  }
});
