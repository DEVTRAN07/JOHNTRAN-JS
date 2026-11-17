"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const spam = require("../plugins/commands/spam");
const { stopSerialJob } = require("../core/serialJob");

test("/spam accepts a numeric UID as the first argument and tags that UID", async () => {
  const previousConfig = global.config;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  const sent = [];
  const uid = "123456789012345678";
  const threadId = "spam-direct-uid-test";

  global.config = { prefix: "/" };
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };

  try {
    const options = spam._test.parseArgs([uid, "vi", "-t", "1", "-d", "0.3"]);
    assert.deepEqual(options.targets, [uid]);
    assert.equal(options.langs.includes("vi"), true);
    assert.equal(options.times, 1);
    assert.equal(options.delay, 300);

    await spam.run({
      api: {
        async sendMessage(payload) {
          sent.push(payload);
          return { status: 1 };
        }
      },
      event: {
        threadId,
        type: 2,
        data: { uidFrom: "admin" }
      },
      args: [uid, "vi", "-t", "1", "-d", "0.3"]
    });

    assert.equal(scheduled.length, 1, "the first send should be scheduled once");
    await scheduled[0].callback();

    const tagged = sent.find(payload => Array.isArray(payload.mentions));
    assert.ok(tagged, "a message with mentions should be sent");
    assert.deepEqual(tagged.mentions, [{ pos: 0, uid, len: 2 }]);
    assert.match(tagged.msg, /^@\. /);
    assert.equal(spam._test.running.has(threadId), false, "finite one-send job completes");
    assert.ok(sent.some(payload => /Đã spam xong 1 lần/.test(payload.msg || "")));
  } finally {
    stopSerialJob(threadId, spam._test.running);
    spam._test.running.clear();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});
