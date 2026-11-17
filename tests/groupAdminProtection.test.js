"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getGroupAdminState } = require("../core/runtime/groupAdmin");
const autokick = require("../plugins/commands/autokick");
const guard = require("../plugins/events/guard");

test("group-admin lookup distinguishes creator, deputy and ordinary member", async () => {
  const api = {
    async getGroupInfo() {
      return { gridInfoMap: { group: { creatorId: 1, adminIds: [2, "3"] } } };
    }
  };
  assert.equal(await getGroupAdminState(api, "group", "1"), true);
  assert.equal(await getGroupAdminState(api, "group", 2), true);
  assert.equal(await getGroupAdminState(api, "group", 3), true);
  assert.equal(await getGroupAdminState(api, "group", "member"), false);
});

test("group-admin lookup returns unknown for partial metadata or API failures", async () => {
  assert.equal(await getGroupAdminState({}, "group", "member"), null);
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
