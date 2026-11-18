"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const message = require("../core/message");

const helpers = message._test;

test("recall countdown uses a bounded number of clock updates", () => {
  const updates = helpers.getRecallCountdownUpdates(60000);
  assert.equal(updates.length, 3);
  assert.deepEqual(updates.map(item => item.waitMs), [15000, 30000, 45000]);
  assert.equal(updates.at(-1).icon, "⏰");
});

test("recall reaction scheduler coalesces stale ticks while Zalo is busy", async () => {
  let releaseFirst;
  const firstRequest = new Promise(resolve => { releaseFirst = resolve; });
  const sent = [];
  const api = {
    async addReaction(payload) {
      sent.push(payload.icon);
      if (sent.length === 1) await firstRequest;
    }
  };
  const expiresAt = Date.now() + 10000;
  const target = { msgId: "msg-1", cliMsgId: "client-1" };

  helpers.addRecallClock(api, target, "recall-test-group", 1, "🕙", expiresAt);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ["🕙"]);

  helpers.addRecallClock(api, target, "recall-test-group", 1, "🕗", expiresAt);
  helpers.addRecallClock(api, target, "recall-test-group", 1, "⏰", expiresAt);
  releaseFirst();

  for (let attempt = 0; attempt < 20 && sent.length < 2; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(sent, ["🕙", "⏰"]);
  assert.equal(helpers.getRecallReactionQueueStats().active, 0);
  assert.equal(helpers.getRecallReactionQueueStats().tracked, 0);
});
