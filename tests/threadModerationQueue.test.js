"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runThreadQueue } = require("../core/runtime/threadQueue");
const autokick = require("../plugins/commands/autokick");
const guard = require("../plugins/events/guard");

function clone(value) { return structuredClone(value); }
function makeThreads(initialData) {
  let data = clone(initialData);
  return {
    async getData() { return { data: clone(data) }; },
    async setData(_threadId, next) { data = clone(next); },
    async setDataAndWait(_threadId, next) { data = clone(next); },
    snapshot() { return clone(data); }
  };
}
function makeApi() {
  const calls = { sent: [], reactions: 0, kicks: 0 };
  const api = {
    async getGroupInfo() {
      return { gridInfoMap: { group: { creatorId: "owner", adminIds: ["deputy"] } } };
    },
    async addReaction() { calls.reactions++; },
    async removeUserFromGroup() { calls.kicks++; },
    async sendMessage(payload) { calls.sent.push(payload); }
  };
  return { api, calls };
}

test("thread queue serializes asynchronous operations and continues after failure", async () => {
  const order = [];
  await Promise.all([
    runThreadQueue("group", async () => { await new Promise(resolve => setImmediate(resolve)); order.push(1); }),
    runThreadQueue("group", async () => { order.push(2); throw new Error("expected"); }).catch(() => {}),
    runThreadQueue("group", async () => { order.push(3); })
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("simultaneous autokick violations increment once per message and kick once", async () => {
  const previousUsers = global.users;
  global.users = { admin: [], support: [] };
  const Threads = makeThreads({
    auto_kick: { enabled: true, words: ["badword"], violations: {} }
  });
  const { api, calls } = makeApi();
  const event = {
    threadId: "group",
    type: 1,
    data: { uidFrom: "member", content: "this badword", dName: "Member" }
  };
  try {
    await Promise.all([1, 2, 3].map(() => autokick.handleEvent({ api, event, Threads })));
    assert.equal(calls.kicks, 1);
    assert.equal(calls.sent.filter(item => /lần 1\/3/.test(item.msg || "")).length, 1);
    assert.equal(calls.sent.filter(item => /lần 2\/3/.test(item.msg || "")).length, 1);
    assert.equal(calls.sent.filter(item => /Đã kick/.test(item.msg || "")).length, 1);
    assert.equal(Threads.snapshot().auto_kick.violations.member, undefined);
  } finally {
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("simultaneous guard violations increment once per message and kick once", async () => {
  const Threads = makeThreads({ event_guard: true });
  const { api, calls } = makeApi();
  const event = {
    threadId: "group",
    type: 1,
    data: { uidFrom: "member", content: "https://untrusted.example/path", msgId: 100, cliMsgId: "100" }
  };
  await Promise.all([1, 2, 3].map(() => guard.run({ api, event, Threads, isSelf: false })));
  assert.equal(calls.kicks, 1);
  assert.equal(calls.reactions, 2);
  assert.equal(calls.sent.filter(item => /Cảnh cáo 1\/3/.test(item.msg || "")).length, 1);
  assert.equal(calls.sent.filter(item => /Cảnh cáo 2\/3/.test(item.msg || "")).length, 1);
  assert.equal(calls.sent.filter(item => /Đã kick/.test(item.msg || "")).length, 1);
  assert.equal(Threads.snapshot().guardWarn_member, 0);
});
