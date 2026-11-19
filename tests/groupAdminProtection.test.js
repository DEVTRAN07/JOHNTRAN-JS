"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getGroupAdminState } = require("../core/runtime/groupAdmin");
const autokick = require("../plugins/commands/autokick");
const guard = require("../plugins/events/guard");

test("group-admin lookup distinguishes creator, deputy and ordinary member", async () => {
  let lookupCount = 0;
  const api = {
    async getGroupInfo() {
      lookupCount++;
      return { gridInfoMap: { group: { creatorId: 1, adminIds: [2, "3"] } } };
    }
  };
  assert.equal(await getGroupAdminState(api, "group", "1"), true);
  assert.equal(await getGroupAdminState(api, "group", 2), true);
  assert.equal(await getGroupAdminState(api, "group", 3), true);
  assert.equal(await getGroupAdminState(api, "group", "member"), false);
  assert.equal(lookupCount, 1, "one group-info request should serve all checks in the short cache window");
});

test("group-admin lookup returns unknown for partial metadata or API failures", async () => {
  assert.equal(await getGroupAdminState({}, "group", "member"), null);
  assert.equal(await getGroupAdminState({
    async getGroupInfo() { return { gridInfoMap: { group: { creatorId: "owner" } } }; }
  }, "group", "owner"), true, "a confirmed creator does not need adminIds to prove QTV access");
  assert.equal(await getGroupAdminState({
    async getGroupInfo() { return { gridInfoMap: { group: { creatorId: "owner" } } }; }
  }, "group", "member"), null);
  assert.equal(await getGroupAdminState({
    async getGroupInfo() { throw new Error("Zalo unavailable"); }
  }, "group", "member"), null);
});

test("autokick does not warn or kick when group-admin status is unknown", async () => {
  const previousUsers = global.users;
  global.users = { admin: [], support: [] };
  let writes = 0;
  let messages = 0;
  let kicks = 0;
  const Threads = {
    async getData() {
      return { data: { auto_kick: { enabled: true, words: ["badword"], violations: {} } } };
    },
    async setData() { writes++; }
  };
  const api = {
    async getGroupInfo() { return { gridInfoMap: { group: { name: "Group" } } }; },
    async removeUserFromGroup() { kicks++; },
    async sendMessage() { messages++; }
  };

  try {
    await autokick.handleEvent({
      api,
      event: {
        threadId: "group",
        type: 1,
        data: { uidFrom: "member", content: "this badword", dName: "Member" }
      },
      Threads
    });
    assert.equal(writes, 0);
    assert.equal(messages, 0);
    assert.equal(kicks, 0);
  } finally {
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("guard does not warn or kick when group-admin status is unknown", async () => {
  let writes = 0;
  let messages = 0;
  let reactions = 0;
  let kicks = 0;
  const Threads = {
    async getData() {
      return { data: { event_guard: true } };
    },
    async setData() { writes++; }
  };
  const api = {
    async getGroupInfo() { return { gridInfoMap: { group: { name: "Group" } } }; },
    async removeUserFromGroup() { kicks++; },
    async addReaction() { reactions++; },
    async sendMessage() { messages++; }
  };

  await guard.run({
    api,
    event: {
      threadId: "group",
      type: 1,
      data: { uidFrom: "member", content: "https://untrusted.example/path", msgId: 1, cliMsgId: "1" }
    },
    Threads,
    isSelf: false
  });

  assert.equal(writes, 0);
  assert.equal(messages, 0);
  assert.equal(reactions, 0);
  assert.equal(kicks, 0);
});


test("box_only group-admin lookup fails closed within a short bounded deadline", async () => {
  const startedAt = Date.now();
  const result = await getGroupAdminState({
    getGroupInfo() { return new Promise(() => {}); }
  }, "group-hung-admin-lookup", "ordinary-member", { timeoutMs: 25 });

  assert.equal(result, null, "unknown metadata must never grant group-admin permission");
  assert.ok(Date.now() - startedAt < 250, "a hung permission lookup must not hold a command for seconds");
});
