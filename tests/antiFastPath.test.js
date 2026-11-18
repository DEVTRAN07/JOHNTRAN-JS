"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");

function makeContext({ groupId, content, flags, api, uid = "member-1" }) {
  return {
    event: {
      threadId: groupId,
      type: ThreadType.Group,
      data: { uidFrom: uid, dName: "Member", content, msgId: "msg-1", cliMsgId: "cli-1" }
    },
    eventType: "message",
    isSelf: false,
    api,
    Threads: {
      getCachedData() {
        return { threadId: groupId, data: { bot_enabled: true, ...flags } };
      }
    }
  };
}

test("Anti does not query the bot group role for harmless text when Anti-Link is enabled", async () => {
  let ownIdCalls = 0;
  let groupInfoCalls = 0;
  const api = {
    async getOwnId() { ownIdCalls++; return "bot-id"; },
    async getGroupInfo() { groupInfoCalls++; return { gridInfoMap: {} }; }
  };

  await anti._test.handleAntiEvent(makeContext({
    groupId: "anti-fast-harmless",
    content: "xin chao moi nguoi",
    flags: { anti_link: true, anti_word: true },
    api
  }));

  assert.equal(ownIdCalls, 0);
  assert.equal(groupInfoCalls, 0);
});

test("Anti-Spam counts normal messages locally without querying group role before the threshold", async () => {
  global.spamCache = {};
  let groupInfoCalls = 0;
  const api = {
    async getOwnId() { return "bot-id"; },
    async getGroupInfo() { groupInfoCalls++; return { gridInfoMap: {} }; }
  };

  for (let index = 0; index < 5; index++) {
    await anti._test.handleAntiEvent(makeContext({
      groupId: "anti-fast-spam-counter",
      content: "tin nhan thu " + index,
      flags: { anti_spam: true },
      api
    }));
  }

  assert.equal(groupInfoCalls, 0);
});

test("Anti still verifies the bot group role before enforcing a detected link violation", async () => {
  let ownIdCalls = 0;
  let groupInfoCalls = 0;
  let sendCalls = 0;
  const groupId = "anti-fast-link-violation";
  const api = {
    async getOwnId() { ownIdCalls++; return "bot-id"; },
    async getGroupInfo(id) {
      groupInfoCalls++;
      return { gridInfoMap: { [id]: { creatorId: "owner-id", adminIds: [] } } };
    },
    async sendMessage() { sendCalls++; }
  };

  await anti._test.handleAntiEvent(makeContext({
    groupId,
    content: "https://example.com/invite",
    flags: { anti_link: true },
    api
  }));

  assert.equal(ownIdCalls, 1);
  assert.equal(groupInfoCalls, 1);
  assert.equal(sendCalls, 0, "moderation must remain disabled when the bot is not a group admin");
});


test("a slow Anti danger-link scan does not block the next ordinary group message", async () => {
  let releaseScanStarted;
  const scanStarted = new Promise(resolve => { releaseScanStarted = resolve; });
  const api = {
    async getOwnId() { return "bot-id"; },
    async getGroupInfo(id) {
      return { gridInfoMap: { [id]: { creatorId: "owner-id", adminIds: ["bot-id"] } } };
    },
    scanURL() {
      releaseScanStarted();
      return new Promise(() => {});
    }
  };
  const groupId = "anti-no-head-of-line";
  const first = anti.handleEvent(makeContext({
    groupId,
    content: "https://example.com/suspicious",
    flags: { anti_danger_link: true },
    api
  }));

  await scanStarted;
  const second = anti.handleEvent(makeContext({
    groupId,
    content: "tin nhan binh thuong",
    flags: { anti_danger_link: true },
    api,
    uid: "member-2"
  }));

  let timeout;
  try {
    await Promise.race([
      second,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("second message waited behind the stalled scan")), 250);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(first && typeof first.then === "function");
});
