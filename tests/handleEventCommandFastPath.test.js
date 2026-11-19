"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const handleEvent = require("../core/handle/handleEvent");

test("command messages skip game/rank subscribers but retain Guard and Anti moderation", async () => {
  const previousClient = global.client;
  const calls = [];
  const events = new Map([
    ["caro", {
      config: { name: "caro", event_type: ["message"], ignoreCommandMessages: true },
      async run() { calls.push("caro"); }
    }],
    ["rank", {
      config: { name: "rank", event_type: ["message"], ignoreCommandMessages: true },
      async run() { calls.push("rank"); }
    }],
    ["guard", {
      config: { name: "guard", event_type: ["message"] },
      async run() { calls.push("guard"); }
    }]
  ]);
  const commands = new Map([
    ["anti", {
      config: { name: "anti", event_type: ["message"] },
      async handleEvent() { calls.push("anti"); }
    }],
    ["noitu", {
      config: { name: "noitu", event_type: ["message"], ignoreCommandMessages: true },
      async handleEvent() { calls.push("noitu"); }
    }]
  ]);
  global.client = { events, commands };

  try {
    const result = await handleEvent("message", {
      threadId: "command-filter-test",
      type: ThreadType.User,
      data: { uidFrom: "member-1", content: "/menu" }
    }, {
      async sendMessage() { return {}; }
    }, false, {
      isCommandMessage: true,
      skipGameConsumers: true
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(result, { eventModules: 1, commandModules: 1 });
    assert.deepEqual(calls.sort(), ["anti", "guard"]);
  } finally {
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
  }
});
