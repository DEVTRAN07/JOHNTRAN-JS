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

test("anti_link awaits role lookup and deletes a non-admin link message", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "owner", adminIds: ["moderator"] }, calls);
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

test("anti_link preserves group creator messages", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "group-owner", adminIds: ["moderator"] }, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-link-admin-group", "group-owner", "https://safe-for-admin.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.sent.length, 0);
});

test("anti rules fail safe when group role metadata cannot be verified", async () => {
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi(null, calls);
  await handle(
    { anti_link: true },
    api,
    makeEvent("anti-unknown-group", "ordinary-member", "https://bad.example", 1)
  );

  assert.equal(calls.groupLookups, 1);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.sent.length, 0);
});

test("anti_spam detects the sixth message from a non-admin member", async () => {
  global.spamCache = {};
  const calls = { groupLookups: 0, deleted: [], sent: [] };
  const api = makeApi({ creatorId: "owner", adminIds: [] }, calls);
  const threadId = "anti-spam-group";

  for (let index = 1; index <= 6; index++) {
    await handle(
      { anti_spam: true },
      api,
      makeEvent(threadId, "spam-member", "message " + index, index)
    );
  }

  assert.equal(calls.groupLookups, 6, "one role lookup per incoming message");
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /không spam/i);
});
