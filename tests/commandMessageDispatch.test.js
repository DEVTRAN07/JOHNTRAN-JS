"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { filterDispatchSources } = require("../core/runtime/eventRegistry");

function plugin(name, config = {}) {
  return { config: { name, ...config } };
}

test("command messages only reach explicit subscribers while Guard and Anti stay active", () => {
  const sources = {
    events: new Map([
      ["guard", plugin("guard", { allowCommandMessages: true })],
      ["rank", plugin("rank")],
      ["topchatcounter", plugin("topchatcounter")],
      ["custom-command-aware", plugin("custom-command-aware", { allowCommandMessages: true })]
    ]),
    commands: new Map([
      ["anti", plugin("anti", { allowCommandMessages: true })],
      ["menu", plugin("menu")],
      ["noitu", plugin("noitu", { allowCommandMessages: true })],
      ["custom-command-aware", plugin("custom-command-aware", { allowCommandMessages: true })]
    ])
  };

  const filtered = filterDispatchSources(sources, {
    isCommandMessage: true,
    skipGameConsumers: true,
    skipTopchatCounter: true
  });

  assert.deepEqual([...filtered.events.keys()], ["guard", "custom-command-aware"]);
  assert.deepEqual([...filtered.commands.keys()], ["anti", "custom-command-aware"]);
});

test("ordinary messages keep normal subscribers while avoiding duplicate game and Top Chat work", () => {
  const sources = {
    events: new Map([
      ["guard", plugin("guard")],
      ["rank", plugin("rank")],
      ["topchatcounter", plugin("topchatcounter")],
      ["noitu", plugin("noitu")],
      ["tlmn", plugin("tlmn")]
    ]),
    commands: new Map([
      ["anti", plugin("anti")],
      ["noitu", plugin("noitu")],
      ["tlmn", plugin("tlmn")],
      ["music", plugin("music")]
    ])
  };

  const filtered = filterDispatchSources(sources, {
    skipGameConsumers: true,
    skipTopchatCounter: true
  });

  assert.deepEqual([...filtered.events.keys()], ["guard", "rank"]);
  assert.deepEqual([...filtered.commands.keys()], ["anti", "music"]);
});

test("explicit opt-in does not override ignoreCommandMessages", () => {
  const sources = {
    events: new Map([["ignored", plugin("ignored", {
      allowCommandMessages: true,
      ignoreCommandMessages: true
    })]]),
    commands: new Map([["ignored", plugin("ignored", {
      allowCommandMessages: true,
      ignoreCommandMessages: true
    })]])
  };

  const filtered = filterDispatchSources(sources, { isCommandMessage: true });
  assert.equal(filtered.events.size, 0);
  assert.equal(filtered.commands.size, 0);
});
