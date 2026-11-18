"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const command = require("../plugins/commands/tlmn");

const previousConfig = global.config;

test("TLMN fast path ignores unrelated group messages before acquiring room lock", () => {
  global.config = { prefix: "/" };
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-idle-fast-path",
      data: { uidFrom: "player-1", content: "chào cả nhóm" }
    }
  };

  assert.equal(command._test.shouldQueueIncoming(context), false);
});

test("TLMN fast path keeps the room creation keyword", () => {
  global.config = { prefix: "/" };
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-go-fast-path",
      data: { uidFrom: "player-1", content: "go" }
    }
  };

  assert.equal(command._test.shouldQueueIncoming(context), true);
});

test("TLMN fast path excludes private and prefixed command messages", () => {
  global.config = { prefix: "/" };
  const base = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      threadId: "tlmn-filter-fast-path",
      data: { uidFrom: "player-1", content: "go" }
    }
  };

  assert.equal(command._test.shouldQueueIncoming({
    ...base, event: { ...base.event, type: ThreadType.User }
  }), false);
  assert.equal(command._test.shouldQueueIncoming({
    ...base, event: { ...base.event, type: ThreadType.Group, content: undefined,
      data: { ...base.event.data, content: "/stk 12" } }
  }), false);
});

test("TLMN fast path respects the per-group game toggle", () => {
  global.config = { prefix: "/" };
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: false } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-disabled-fast-path",
      data: { uidFrom: "player-1", content: "go" }
    }
  };

  assert.equal(command._test.shouldQueueIncoming(context), false);
});

test.after(() => {
  if (previousConfig === undefined) delete global.config;
  else global.config = previousConfig;
});


test("TLMN avoids group-setting lookup for unrelated chat when no room exists", () => {
  global.config = { prefix: "/" };
  let cacheReads = 0;
  const context = {
    isSelf: false,
    Threads: { getCachedData() { cacheReads++; return { data: { tlmn_enabled: true } }; } },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-no-room-no-config-read",
      data: { uidFrom: "player-1", content: "chào cả nhóm" }
    }
  };

  assert.equal(command._test.shouldQueueIncoming(context), false);
  assert.equal(cacheReads, 0);
});
