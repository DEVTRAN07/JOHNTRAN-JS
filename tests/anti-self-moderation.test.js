"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");

const originalConfig = global.config;

test.after(() => {
  anti._test.clearAntiSelfEchoes();
  if (originalConfig === undefined) delete global.config;
  else global.config = originalConfig;
});

test("self-sent messages can be moderated when allow_self_anti is enabled", () => {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: true };

  const context = {
    isSelf: true,
    event: {
      threadId: "group-self-test",
      isSelf: true,
      data: { uidFrom: "bot-account", content: "https://example.com/test" }
    }
  };

  assert.equal(anti._test.shouldSkipSelfEvent(context), false);
});

test("self-sent messages remain skipped when allow_self_anti is disabled", () => {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: false };

  const context = {
    isSelf: true,
    event: {
      threadId: "group-self-disabled",
      isSelf: true,
      data: { uidFrom: "bot-account", content: "hello" }
    }
  };

  assert.equal(anti._test.shouldSkipSelfEvent(context), true);
});

test("human member messages are not skipped by the self-message policy", () => {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: false };

  const context = {
    isSelf: false,
    event: {
      threadId: "group-member",
      data: { uidFrom: "group-admin", content: "https://example.com/admin-link" }
    }
  };

  assert.equal(anti._test.shouldSkipSelfEvent(context), false);
});

test("Anti-generated bot replies are ignored to prevent self-moderation loops", () => {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: true };
  const threadId = "group-echo";
  const notice = "🚫 @Bot, không được gửi link trong nhóm này!";

  anti._test.rememberAntiSelfEcho(threadId, { msg: notice });

  const context = {
    isSelf: true,
    event: {
      threadId,
      isSelf: true,
      data: { uidFrom: "bot-account", content: notice }
    }
  };

  assert.equal(anti._test.shouldSkipSelfEvent(context), true);
});

test("URL extraction covers plain text, recommended links, and nested Zalo metadata", () => {
  const urls = anti._test.extractMessageUrls({
    msgType: "chat.recommended",
    content: {
      action: "recommended.link",
      href: "https://zalo.me/g/group-code"
    },
    propertyExt: {
      nested: {
        description: "Video: https://example.com/watch?id=123."
      }
    },
    quote: {
      text: "Original link https://example.org/post"
    }
  });

  assert.deepEqual(urls, [
    "https://zalo.me/g/group-code",
    "https://example.com/watch?id=123",
    "https://example.org/post"
  ]);
});
