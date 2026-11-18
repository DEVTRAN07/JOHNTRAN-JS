"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const rank = require("../plugins/events/rank");

const previousConfig = global.config;
global.config = { ...(previousConfig || {}), prefix: "!" };

test("Rank returns from cached OFF state without reading group storage", async () => {
  let storageReads = 0;
  let writes = 0;
  await rank.run({
    api: {},
    event: {
      threadId: "rank-fast-off",
      type: 1,
      isSelf: false,
      data: { uidFrom: "member-1", content: "hello group" }
    },
    Threads: {
      getCachedData() { return { threadId: "rank-fast-off", data: { event_rank: false } }; },
      async getData() { storageReads++; throw new Error("unexpected storage read"); },
      async setData() { writes++; }
    },
    isSelf: false
  });

  assert.equal(storageReads, 0);
  assert.equal(writes, 0);
});

test("Rank uses the hot group snapshot and skips writes during a member EXP cooldown", async () => {
  let storageReads = 0;
  let writes = 0;
  const uid = "member-cooldown";
  const threadId = "rank-fast-cooldown";
  await rank.run({
    api: {},
    event: {
      threadId,
      type: 1,
      isSelf: false,
      data: { uidFrom: uid, content: "hello group" }
    },
    Threads: {
      getCachedData() {
        return {
          threadId,
          data: { event_rank: true, ["rankExp_" + uid]: Date.now() }
        };
      },
      async getData() { storageReads++; throw new Error("hot snapshot should be enough"); },
      async setData() { writes++; }
    },
    isSelf: false
  });

  assert.equal(storageReads, 0);
  assert.equal(writes, 0);
});

test.after(() => {
  global.config = previousConfig;
});
