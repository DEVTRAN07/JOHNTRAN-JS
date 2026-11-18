"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const anti = require("../plugins/commands/anti");

function makeEvent(threadId, userId, content, index = 1) {
  return {
    threadId,
    type: 1,
    isGroup: true,
    data: {
      uidFrom: userId,
      dName: "Member",
      msgType: "webchat",
      content,
      cliMsgId: "cli-" + index,
      msgId: index,
      ts: Date.now()
    }
  };
}

function makeApi(groupInfo, calls, options = {}) {
  return {
    getOwnId() { return "bot-id"; },
    async getGroupInfo(threadId) {
      calls.groupLookups++;
      if (options.groupInfoError) throw new Error("group info unavailable");
      return { gridInfoMap: { [threadId]: groupInfo } };
    },
    async deleteMessage(payload, force) {
      calls.deleted.push({ payload, force });
      return true;
    },
    async sendMessage(payload, threadId, type) {
      calls.sent.push({ payload, threadId, type });
      return true;
    }
  };
}

async function handle(threadData, api, event) {
  await anti.handleEvent({
    event,
    api,
    Threads: { async getData() { return { data: threadData }; } },
    isSelf: false
  });
}

function makeCalls() {
  return { groupLookups: 0, deleted: [], sent: [] };
}

test("Anti moderates members when the bot itself is a deputy", async () => {
  const calls = makeCalls();
  const api = makeApi({ creatorId: "group-owner", adminIds: ["bot-id"] }, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-link-group", "ordinary-member", "Check https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /không được gửi link/i);
});

test("Anti is completely silent when the bot is not a group owner or deputy", async () => {
  const calls = makeCalls();
  const api = makeApi(
    { creatorId: "group-owner", adminIds: ["group-deputy"] },
    calls
  );
  await handle(
    { anti_link: true },
    api,
    makeEvent("no-bot-key-group", "ordinary-member", "https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.sent.length, 0);
});

test("Anti stays silent when Zalo cannot confirm the bot group role", async () => {
  const calls = makeCalls();
  const api = makeApi(null, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("unknown-bot-role-group", "ordinary-member", "https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.sent.length, 0);
});

test("Group owner and deputy senders are still moderated when the bot has QTV", async () => {
  const calls = makeCalls();
  const api = makeApi(
    { creatorId: "group-owner", adminIds: ["bot-id", "group-deputy"] },
    calls
  );

  await handle(
    { anti_link: true },
    api,
    makeEvent("admin-senders-group", "group-owner", "https://owner.example", 1)
  );
  await handle(
    { anti_link: true },
    api,
    makeEvent("admin-senders-group", "group-deputy", "https://deputy.example", 2)
  );

  assert.equal(calls.groupLookups, 1, "the bot's QTV status is cached briefly");
  assert.equal(calls.deleted.length, 2);
  assert.equal(calls.sent.length, 2);
});

test("Anti stays silent when the group info API fails", async () => {
  const calls = makeCalls();
  const api = makeApi(null, calls, { groupInfoError: true });
  await handle(
    { anti_link: true },
    api,
    makeEvent("group-info-error", "ordinary-member", "https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.sent.length, 0);
});
