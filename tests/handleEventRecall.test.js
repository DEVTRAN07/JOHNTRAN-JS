"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const handleEvent = require("../core/handle/handleEvent");
const noituCommand = require("../plugins/commands/noitu");

test("active Nối Từ event replies use the shared recall-clock wrapper", async () => {
  const originalHandler = noituCommand.handleEvent;
  const originalHasActiveGame = noituCommand.hasActiveGameForThread;
  const originalSetTimeout = global.setTimeout;
  const previousCountdown = process.env.JT_RECALL_COUNTDOWN_ENABLED;
  process.env.JT_RECALL_COUNTDOWN_ENABLED = "1";
  const scheduled = [];
  const reactions = [];
  const sent = [];
  const threadId = "noitu-clock-" + Date.now();

  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  const rawApi = {
    async sendMessage(payload, targetThreadId, targetType) {
      sent.push({ payload, targetThreadId, targetType });
      return { message: { msgId: 987, cliMsgId: "noitu-clock-message" } };
    },
    async addReaction(icon, destination) {
      reactions.push({ icon, destination });
    },
    async undo() {}
  };

  noituCommand.hasActiveGameForThread = () => true; // simulate an active session
  noituCommand.handleEvent = async ({ api, event }) => {
    assert.notEqual(api, rawApi, "the early Nối Từ consumer must not receive the raw API");
    assert.equal(Object.prototype.hasOwnProperty.call(api, "sendMessage"), true);
    await api.sendMessage(
      { msg: "Lượt tiếp theo", recallAfterMs: 1500 },
      event.threadId,
      event.type
    );
    return true;
  };

  try {
    const result = await handleEvent("message", {
      threadId,
      type: ThreadType.User,
      data: { uidFrom: "player-1", content: "cụm từ" }
    }, rawApi, false);

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(result.consumed, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].targetThreadId, threadId);
    assert.equal(sent[0].payload.recallAfterMs, undefined);
    assert.equal(reactions.length, 1, "the auto-recalled reply receives an initial clock reaction");
    assert.equal(reactions[0].destination.threadId, threadId);
    assert.deepEqual(reactions[0].destination.data, {
      msgId: "987",
      cliMsgId: "noitu-clock-message"
    });
    assert.ok(scheduled.some(timer => timer.delay === 1500), "the reply is still scheduled for recall");
  } finally {
    noituCommand.handleEvent = originalHandler;
    noituCommand.hasActiveGameForThread = originalHasActiveGame;
    global.setTimeout = originalSetTimeout;
    if (previousCountdown === undefined) delete process.env.JT_RECALL_COUNTDOWN_ENABLED;
    else process.env.JT_RECALL_COUNTDOWN_ENABLED = previousCountdown;
  }
});
