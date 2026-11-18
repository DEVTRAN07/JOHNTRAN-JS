"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const guard = require("../plugins/events/guard");

function makeFixture(initial = {}) {
  const threadId = "guard-test-group";
  const data = { event_guard: true, ...initial };
  const calls = { deleted: [], kicked: [], sent: [], reactions: [] };
  const api = {
    getOwnId() { return "bot-id"; },
    async getGroupInfo(gid) {
      return {
        gridInfoMap: {
          [gid]: { creatorId: "owner-id", adminIds: ["bot-id"] }
        }
      };
    },
    async deleteMessage(destination, onlyMe) {
      calls.deleted.push({ destination, onlyMe });
      return { status: 0 };
    },
    async removeUserFromGroup(uid, gid) {
      calls.kicked.push({ uid, gid });
      return { errorMembers: [] };
    },
    async addReaction(reaction, payload) {
      calls.reactions.push({ reaction, payload });
      return {};
    },
    async sendMessage(payload, gid, type) {
      calls.sent.push({ payload, gid, type });
      return {};
    }
  };
  const Threads = {
    async getData() { return { data }; },
    async setDataAndWait(_gid, next) {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, next);
    }
  };
  return { threadId, data, calls, api, Threads };
}

function makeEvent(threadId, content, id, extra = {}) {
  return {
    threadId,
    type: ThreadType.Group,
    isSelf: false,
    data: {
      uidFrom: "member-id",
      dName: "Member",
      msgId: "msg-" + id,
      cliMsgId: "cli-" + id,
      content,
      ...extra
    }
  };
}

test("Guard removes Zalo group invite links including Markdown URLs and kicks only on the fourth offence", async () => {
  const fixture = makeFixture();
  for (let strike = 1; strike <= 3; strike++) {
    await guard.run({
      api: fixture.api,
      event: makeEvent(
        fixture.threadId,
        "[link nhóm](https://zalo.me/g/trfrv1vrakhqeocdpxpo)",
        strike
      ),
      Threads: fixture.Threads,
      isSelf: false
    });
    assert.equal(fixture.calls.kicked.length, 0, "first three offences are warnings");
    assert.equal(fixture.data["guardWarn_member-id"], strike);
  }
  assert.equal(fixture.calls.deleted.length, 3);
  assert.equal(fixture.calls.sent.length, 3);
  assert.equal(fixture.calls.sent[0].payload.msg.includes("Cảnh cáo 1/3"), true);
  assert.equal(fixture.calls.sent[2].payload.msg.includes("Cảnh cáo 3/3"), true);
  assert.equal(fixture.data["guardWarn_member-id"], 3);

  await guard.run({
    api: fixture.api,
    event: makeEvent(fixture.threadId, "https://zalo.me/g/anothergroup", 4),
    Threads: fixture.Threads,
    isSelf: false
  });
  assert.equal(fixture.calls.deleted.length, 4);
  assert.equal(fixture.calls.kicked.length, 1, "fourth offence must kick after three warnings");
  assert.equal(fixture.data["guardWarn_member-id"], 0);
  assert.match(fixture.calls.sent[3].payload.msg, /đã kick thành viên/i);
});

test("Guard scans nested message metadata for banned words and deletes the violating text", async () => {
  const fixture = makeFixture();
  await guard.run({
    api: fixture.api,
    event: makeEvent(fixture.threadId, "Nội dung chia sẻ", 1, { propertyExt: { nested: { description: "Cảnh báo đánh bạc trong tin chia sẻ" } } }),
    Threads: fixture.Threads,
    isSelf: false
  });
  assert.equal(fixture.calls.deleted.length, 1);
  assert.equal(fixture.calls.sent.length, 1);
  assert.equal(fixture.data["guardWarn_member-id"], 1);
  assert.match(fixture.calls.sent[0].payload.msg, /từ cấm/i);
});

test("Guard does not duplicate URL warnings when Anti-Link owns link moderation", async () => {
  const fixture = makeFixture({ anti_danger_link: true });
  await guard.run({
    api: fixture.api,
    event: makeEvent(fixture.threadId, "https://unknown.example", 1),
    Threads: fixture.Threads,
    isSelf: false
  });
  assert.equal(fixture.calls.deleted.length, 0);
  assert.equal(fixture.calls.kicked.length, 0);
  assert.equal(fixture.calls.sent.length, 0);
});
