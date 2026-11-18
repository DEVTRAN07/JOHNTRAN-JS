"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");
const { ThreadType } = require("zalo-client");
const { shouldProcessUndoEvent } = require("../core/listen");
const { getDispatchSources } = require("../core/handle/handleEvent")._test;

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


async function runLinkModeration({ isSelf = false, senderId = "member", allowSelf = false } = {}) {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: allowSelf };
  const calls = { deleted: [], sent: [], groupLookups: 0 };
  const api = {
    getOwnId() { return "bot-account"; },
    async getGroupInfo(threadId) {
      calls.groupLookups++;
      return {
        gridInfoMap: {
          [threadId]: { creatorId: "group-owner", adminIds: ["bot-account"] }
        }
      };
    },
    async deleteMessage(destination, force) {
      calls.deleted.push({ destination, force });
      return { success: true };
    },
    async sendMessage(payload, threadId, type) {
      calls.sent.push({ payload, threadId, type });
      return { message: { msgId: "anti-notice-msg", cliMsgId: "anti-notice-cli" } };
    }
  };
  const Threads = {
    async getData() {
      return { data: { anti_link: true } };
    }
  };
  const event = {
    threadId: "anti-e2e-group",
    type: ThreadType.Group,
    isSelf,
    data: {
      uidFrom: senderId,
      dName: "Tester",
      msgId: "original-msg",
      cliMsgId: "original-cli",
      content: "https://example.com/blocked"
    }
  };

  await anti.handleEvent({
    api,
    event,
    eventType: "message",
    isSelf,
    Threads
  });
  return calls;
}

test("Anti link moderates a self-sent bot test message when explicitly enabled", async () => {
  const calls = await runLinkModeration({
    isSelf: true,
    senderId: "bot-account",
    allowSelf: true
  });

  assert.equal(calls.groupLookups, 1, "the bot QTV key is checked");
  assert.equal(calls.deleted.length, 1, "the link message is deleted");
  assert.equal(calls.sent.length, 1, "one warning is sent");
  assert.match(calls.sent[0].payload.msg, /không được gửi link/i);
});

test("Anti link continues to moderate ordinary members while self testing is disabled", async () => {
  const calls = await runLinkModeration({
    isSelf: false,
    senderId: "ordinary-member",
    allowSelf: false
  });

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
});


test("Anti link does not exempt a group owner or deputy sender", async () => {
  const calls = await runLinkModeration({
    isSelf: false,
    senderId: "group-owner",
    allowSelf: false
  });

  assert.equal(calls.groupLookups, 1, "the bot's QTV key is verified independently");
  assert.equal(calls.deleted.length, 1, "the group owner link is moderated too");
  assert.equal(calls.sent.length, 1);
});


test("bot self-undo is allowed only in Anti test mode and dispatched only to Anti", () => {
  const antiCommand = { handleEvent() {} };
  const otherCommand = { handleEvent() {} };
  const eventModule = {
    config: { event_type: ["undo"] },
    run() {}
  };
  const events = new Map([["some-event", eventModule]]);
  const commands = new Map([
    ["anti", antiCommand],
    ["other", otherCommand]
  ]);

  global.config = { allow_self_anti: true };
  assert.equal(shouldProcessUndoEvent({ isSelf: true }), true);
  assert.equal(shouldProcessUndoEvent({ isSelf: false }), true);

  const sources = getDispatchSources("undo", { isSelf: true }, true, events, commands);
  assert.equal(sources.events.size, 0, "self-undo must not reach unrelated event plugins");
  assert.deepEqual([...sources.commands.keys()], ["anti"]);
  assert.equal(sources.commands.get("anti"), antiCommand);

  global.config = { allow_self_anti: false };
  assert.equal(shouldProcessUndoEvent({ isSelf: true }), false);
});
