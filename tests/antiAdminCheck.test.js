"use strict";

const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const anti = require("../plugins/commands/anti");

const previousSpamCache = global.spamCache;
after(() => {
  if (previousSpamCache === undefined) delete global.spamCache;
  else global.spamCache = previousSpamCache;
});

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

test("anti_link deletes a normal member link without a role lookup", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "owner", adminIds: ["moderator"] }, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-link-group", "ordinary-member", "Check https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 0);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /không được gửi link/i);
});

test("anti_link deletes group creator links too", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "group-owner", adminIds: ["moderator"] }, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-link-admin-group", "group-owner", "https://owner.example", 1)
  );

  assert.equal(calls.groupLookups, 0);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
});

test("anti_link still enforces the rule when group role metadata is unavailable", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi(null, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-unknown-group", "ordinary-member", "https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 0);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
});

test("anti_spam detects the group owner's sixth message without an admin exemption", async () => {
  global.spamCache = {};
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "owner", adminIds: [] }, calls);
  const threadId = "anti-spam-group";

  for (let index = 1; index <= 6; index++) {
    await handle(
      { anti_spam: true },
      api,
      makeEvent(threadId, "owner", "message " + index, index)
    );
  }

  assert.equal(calls.groupLookups, 0, "anti moderation does not exempt admins or require role lookups");
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /không spam/i);
});
