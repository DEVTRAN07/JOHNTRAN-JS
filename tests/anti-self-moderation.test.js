"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");
const { ThreadType } = require("zalo-client");
const { shouldProcessUndoEvent, shouldCacheIncomingMessage } = require("../core/listen");
const { updateMessageCache, getMessageCache } = require("../utils/messageCache");
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

test("self-test message cache stores bot test messages but excludes Anti-generated replies", () => {
  const previousConfig = global.config;
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: true };
  const threadId = "self-test-cache-group";
  const botMessage = {
    threadId,
    type: ThreadType.Group,
    isSelf: true,
    data: {
      uidFrom: "bot-account",
      cliMsgId: "bot-cache-cli",
      msgId: "bot-cache-msg",
      msgType: "webchat",
      content: "Tin thử nghiệm cần được cache"
    }
  };
  assert.equal(shouldCacheIncomingMessage(botMessage), true);

  const antiNotice = "🚫 Anti đã xử lý vi phạm";
  anti._test.rememberAntiSelfEcho(threadId, { msg: antiNotice });
  const antiEvent = {
    threadId,
    type: ThreadType.Group,
    isSelf: true,
    data: { uidFrom: "bot-account", content: antiNotice }
  };
  assert.equal(shouldCacheIncomingMessage(antiEvent), false);
  assert.equal(
    anti._test.shouldSkipSelfEvent({ isSelf: true, event: antiEvent }),
    true,
    "cache decision must not consume the Anti echo marker before Anti handles the event"
  );

  if (previousConfig === undefined) delete global.config;
  else global.config = previousConfig;
});

test("antirecall restores a bot-authored test message from the self-test cache", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_anti: true };
  const threadId = "self-antirecall-group";
  const cliMsgId = "bot-self-recall-" + Date.now();
  const sent = [];
  const originalMessage = {
    threadId,
    type: ThreadType.Group,
    isSelf: true,
    data: {
      uidFrom: "bot-account",
      dName: "Bot",
      cliMsgId,
      msgId: "bot-original-msg",
      msgType: "webchat",
      content: "Nội dung do bot gửi để thử Anti Undo",
      ts: Date.now()
    }
  };

  try {
    assert.equal(shouldCacheIncomingMessage(originalMessage), true);
    updateMessageCache(originalMessage);

    const api = {
      getOwnId() { return "bot-account"; },
      async getGroupInfo(gid) {
        return { gridInfoMap: { [gid]: { creatorId: "bot-account", adminIds: [] } } };
      },
      async sendMessage(payload, gid, type) {
        sent.push({ payload, gid, type });
        return { message: { msgId: "notice-msg", cliMsgId: "notice-cli" } };
      }
    };
    const undoEvent = {
      threadId,
      isGroup: true,
      isSelf: true,
      data: {
        uidFrom: "bot-account",
        dName: "Bot",
        ts: Date.now(),
        content: { cliMsgId }
      }
    };

    await anti.handleEvent({
      api,
      event: undoEvent,
      eventType: "undo",
      isSelf: true,
      Threads: { async getData() { return { data: { anti_undo: true } }; } }
    });

    assert.equal(sent.length, 1, "the recalled bot test message is restored once");
    assert.match(sent[0].payload.msg, /Nội dung do bot gửi để thử Anti Undo/);
    assert.equal(sent[0].gid, threadId);
    assert.equal(sent[0].type, ThreadType.Group);
  } finally {
    delete getMessageCache()[cliMsgId];
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
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


async function runLinkModeration({
  isSelf = false,
  senderId = "member",
  allowSelf = false,
  featureKey = "anti_link",
  url = "https://example.com/blocked",
  isSafe = false
} = {}) {
  anti._test.clearAntiSelfEchoes();
  global.config = { allow_self_anti: allowSelf };
  const calls = { deleted: [], undone: [], sent: [], scanned: [], groupLookups: 0 };
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
    async scanURL(value) {
      calls.scanned.push(value);
      return { isSafe };
    },
    async deleteMessage(destination, onlyMe) {
      calls.deleted.push({ destination, onlyMe });
      return { status: 0 };
    },
    async undo(payload, threadId, type) {
      calls.undone.push({ payload, threadId, type });
      return { status: 0 };
    },
    async sendMessage(payload, threadId, type) {
      calls.sent.push({ payload, threadId, type });
      return { message: { msgId: "anti-notice-msg", cliMsgId: "anti-notice-cli" } };
    }
  };
  const Threads = {
    async getData() {
      return { data: { [featureKey]: true } };
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
      content: url
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

test("Anti link recalls a bot self-test message with undo instead of deleteMessage", async () => {
  const calls = await runLinkModeration({
    isSelf: true,
    senderId: "bot-account",
    allowSelf: true,
    featureKey: "anti_danger_link"
  });

  assert.equal(calls.groupLookups, 1, "the bot QTV key is checked");
  assert.deepEqual(calls.scanned, ["https://example.com/blocked"], "antilink uses Zalo scanURL");
  assert.equal(calls.deleted.length, 0, "deleteMessage must not be used for the bot's own message");
  assert.equal(calls.undone.length, 1, "the bot's own violation must be recalled through undo");
  assert.deepEqual(calls.undone[0], {
    payload: { msgId: "original-msg", cliMsgId: "original-cli" },
    threadId: "anti-e2e-group",
    type: ThreadType.Group
  });
  assert.equal(calls.sent.length, 1, "one warning is sent");
  assert.match(calls.sent[0].payload.msg, /URL không an toàn/i);
});

test("Anti link continues to moderate ordinary members while self testing is disabled", async () => {
  const calls = await runLinkModeration({
    isSelf: false,
    senderId: "ordinary-member",
    allowSelf: false
  });

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 1, "a member's link uses group deleteMessage");
  assert.equal(calls.undone.length, 0);
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
  assert.equal(calls.undone.length, 0);
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
