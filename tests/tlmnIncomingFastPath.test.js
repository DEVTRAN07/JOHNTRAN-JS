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


test("TLMN idle-group fast path skips Unicode normalization for ordinary chat", () => {
  global.config = { prefix: "/" };
  const engine = require("../core/games/tlmnEngine");
  const originalNormalize = engine.normalizeText;
  let normalizeCalls = 0;
  engine.normalizeText = value => {
    normalizeCalls++;
    return originalNormalize(value);
  };
  try {
    const context = {
      isSelf: false,
      Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
      event: {
        type: ThreadType.Group,
        threadId: "tlmn-no-room-no-normalize",
        data: { uidFrom: "player-1", content: "chào cả nhóm" }
      }
    };

    assert.equal(command._test.shouldQueueIncoming(context), false);
    assert.equal(normalizeCalls, 0);
  } finally {
    engine.normalizeText = originalNormalize;
  }
});

test("TLMN idle-group fast path keeps case-insensitive and accented GO keywords", () => {
  global.config = { prefix: "/" };
  const engine = require("../core/games/tlmnEngine");
  const originalNormalize = engine.normalizeText;
  let normalizeCalls = 0;
  engine.normalizeText = value => {
    normalizeCalls++;
    return originalNormalize(value);
  };
  const Threads = { getCachedData: () => ({ data: { tlmn_enabled: true } }) };
  const context = {
    isSelf: false,
    Threads,
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-no-room-go-keyword",
      data: { uidFrom: "player-1", content: "GO" }
    }
  };
  const accentedContext = {
    ...context,
    event: { ...context.event, data: { ...context.event.data, content: "gó" } }
  };

  try {
    assert.equal(command._test.shouldQueueIncoming(context), true);
    assert.equal(normalizeCalls, 0, "plain GO should use the cheap ASCII check");
    assert.equal(command._test.shouldQueueIncoming(accentedContext), true);
    assert.equal(normalizeCalls, 1, "accented input keeps the legacy normalization fallback");
  } finally {
    engine.normalizeText = originalNormalize;
  }
});


test("TLMN ignores non-text object payloads without primitive coercion errors", async () => {
  global.config = { prefix: "/" };
  const content = Object.create(null);
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-object-payload",
      data: { uidFrom: "player-1", content }
    }
  };

  assert.doesNotThrow(() => command._test.shouldQueueIncoming(context));
  assert.equal(command._test.shouldQueueIncoming(context), false);
  assert.equal(await command.handleIncoming(context), false);
});

test("TLMN reads text title from structured message payloads", () => {
  global.config = { prefix: "/" };
  const content = Object.assign(Object.create(null), { title: "go" });
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-object-title",
      data: { uidFrom: "player-1", content }
    }
  };

  assert.equal(command._test.shouldQueueIncoming(context), true);
});

test("TLMN safely ignores non-primitive Zalo sender identifiers", async () => {
  global.config = { prefix: "/" };
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-object-sender-id",
      data: { uidFrom: Object.create(null), content: "3b" }
    }
  };

  await assert.doesNotReject(async () => {
    assert.equal(await command.handleIncoming(context), false);
  });
});


test("TLMN fast path does not coerce an invalid configured prefix", () => {
  global.config = { prefix: Object.create(null) };
  const context = {
    isSelf: false,
    Threads: { getCachedData: () => ({ data: { tlmn_enabled: true } }) },
    event: {
      type: ThreadType.Group,
      threadId: "tlmn-invalid-prefix",
      data: { uidFrom: "player-1", content: "go" }
    }
  };

  assert.doesNotThrow(() => command._test.shouldQueueIncoming(context));
  assert.equal(command._test.shouldQueueIncoming(context), true);
});

test("TLMN converts malformed sender display names to a safe fallback", () => {
  const malformedName = Object.create(null);
  assert.equal(command._test.safeEventName({
    data: { dName: malformedName, name: malformedName }
  }, "Người chơi"), "Người chơi");
  assert.equal(command._test.safeEventName({
    data: { dName: "  Wuang  " }
  }), "Wuang");
});
