"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/tutien");
const engine = require("../core/games/tuTienEngine");

test("start identity uses Zalo displayName and avatar returned by getUserInfo", async () => {
  let requested;
  const api = {
    async getUserInfo(uid, avatarSize) {
      requested = { uid, avatarSize };
      return {
        changed_profiles: {
          [uid]: {
            userId: uid,
            displayName: "Zalo Display Name",
            zaloName: "Zalo Name",
            avatar: "https://zalo.example/avatar.png"
          }
        }
      };
    }
  };
  const result = await command._test.getZaloIdentity(api, {
    data: { uidFrom: "user-77", dName: "Event Name" }
  }, "user-77");

  assert.deepEqual(requested, { uid: "user-77", avatarSize: 240 });
  assert.equal(result.displayName, "Zalo Display Name");
  assert.equal(result.avatarUrl, "https://zalo.example/avatar.png");
});

test("identity falls back to Zalo event sender fields when profile API is unavailable", async () => {
  const result = await command._test.getZaloIdentity({}, {
    data: { dName: "Fallback Name", avatar: "https://zalo.example/event-avatar.png" }
  }, "user-78");
  assert.equal(result.displayName, "Fallback Name");
  assert.equal(result.avatarUrl, "https://zalo.example/event-avatar.png");
});

test("only the first configured bot admin is the fixed sect master", () => {
  const previous = global.users;
  try {
    global.users = { admin: ["owner-1", "admin-2", ""] };
    assert.equal(command._test.getSectMasterId(), "owner-1");
  } finally {
    global.users = previous;
  }
});

test("sect creation command is rejected and states there is only one fixed sect", async () => {
  const sent = [];
  const api = { async sendMessage(payload) { sent.push(payload.msg); } };
  await command.run({
    args: ["laptonmon"],
    event: { threadId: "g-1", type: 1, data: { uidFrom: "user-1" } },
    api,
    Users: {}
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /tông môn duy nhất/i);
  assert.match(sent[0], /không thể lập tông môn khác/i);
});

test("the removed breakthrough command no longer exists", async () => {
  const player = engine.createPlayer(1000, { displayName: "Tester", avatarUrl: "https://zalo.example/a.png" });
  const sent = [];
  const api = { async sendMessage(payload) { sent.push(payload.msg); } };
  const Users = {
    async getData() { return { data: { tuTien: player } }; },
    async setData() {}
  };
  await command.run({
    args: ["dotpha"],
    event: { threadId: "g-1", type: 1, data: { uidFrom: "user-2", dName: "Tester" } },
    api,
    Users
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Đạo pháp không tồn tại/);
});
