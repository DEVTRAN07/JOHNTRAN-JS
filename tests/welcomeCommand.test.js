"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const canvas = require("../core/canvas/welcome");
const command = require("../plugins/commands/welcome");
const requesterProfile = require("../core/runtime/requesterProfile");
const originalRender = canvas.renderWelcomeCard;
const originalGetRequesterProfile = requesterProfile.getRequesterProfile;
const rendered = [];
canvas.renderWelcomeCard = async spec => { rendered.push(spec); return "/tmp/jt-welcome-command-test.png"; };

function fixture({ type = 1, initial = {}, requester = "Tester", groupName = "Nhóm kiểm thử" } = {}) {
  const data = { ...initial }, sent = [], threadId = "welcome-command-group";
  const api = {
    async sendMessage(payload, target, sendType) { sent.push({ payload, target, sendType }); return true; },
    async getGroupInfo(id) {
      assert.equal(id, threadId);
      return { gridInfoMap: { [id]: { name: "Tổ Cu 5 · Bot dép lào" } } };
    }
  };
  const Threads = {
    async getData() { return { data }; },
    async setData(_id, next) { Object.assign(data, next); }
  };
  return {
    data, sent, context: {
      api,
      event: {
        threadId, type,
        data: { uidFrom: "test-requester-uid", dName: requester, avatar: "", groupName }
      },
      args: [], Threads,
      reply: { error: async message => { throw new Error(message); } }
    }
  };
}

test("welcome command shows a Canvas status card with the actual group name", async () => {
  rendered.length = 0;
  const f = fixture({ groupName: "" });
  await command.run(f.context);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].payload.attachments, ["/tmp/jt-welcome-command-test.png"]);
  assert.equal(rendered.at(-1).mode, "status");
  assert.equal(rendered.at(-1).enabled, false);
  assert.equal(rendered.at(-1).goodbyeEnabled, false);
  assert.equal(rendered.at(-1).groupName, "Tổ Cu 5 · Bot dép lào");
});

test("welcome on/off persist the legacy event_welcome setting", async () => {
  rendered.length = 0;
  const f = fixture();
  f.context.args = ["on"]; await command.run(f.context);
  assert.equal(f.data.event_welcome, true);
  assert.equal(rendered.at(-1).enabled, true);
  f.context.args = ["off"]; await command.run(f.context);
  assert.equal(f.data.event_welcome, false);
  assert.equal(rendered.at(-1).enabled, false);
  assert.equal(f.sent.length, 2);
});

test("welcome test resolves caller avatar and real profile name", async () => {
  rendered.length = 0;
  const f = fixture({ requester: "Event Fallback", groupName: "" });
  let lookupOptions;
  requesterProfile.getRequesterProfile = async (_api, event, options) => {
    lookupOptions = options;
    assert.equal(event.data.uidFrom, "test-requester-uid");
    return {
      requesterName: "Quang Profile",
      requesterAvatarUrl: "https://example.com/quang-profile.jpg"
    };
  };
  try {
    f.context.args = ["test"];
    await command.run(f.context);
    assert.equal(f.sent.length, 2, "/welcome test must send both JOIN and OUT previews");
    assert.deepEqual(rendered.slice(-2).map(card => card.mode), ["welcome", "goodbye"]);
    assert.deepEqual(rendered.at(-1).member, {
      name: "Quang Profile",
      avatarUrl: "https://example.com/quang-profile.jpg"
    });
    assert.equal(rendered.at(-1).groupName, "Tổ Cu 5 · Bot dép lào");
    assert.deepEqual(rendered.at(-2).member, rendered.at(-1).member);
    assert.ok(lookupOptions.waitMs > 0);
    assert.ok(lookupOptions.avatarWaitMs > 0);
  } finally {
    requesterProfile.getRequesterProfile = originalGetRequesterProfile;
  }
});

test("group-name extraction supports the Zalo getGroupInfo gridInfoMap envelope", () => {
  assert.equal(command._test.extractGroupName({
    gridInfoMap: { "group-42": { name: "Tên nhóm Zalo" } }
  }, "group-42"), "Tên nhóm Zalo");
});

test("welcome command is group-only", async () => {
  const f = fixture({ type: 0 });
  await assert.rejects(command.run(f.context), /chỉ dùng trong nhóm/i);
  assert.equal(f.sent.length, 0);
});

test.after(() => {
  canvas.renderWelcomeCard = originalRender;
  requesterProfile.getRequesterProfile = originalGetRequesterProfile;
});


test("welcome out on/off persists an independent goodbye setting", async () => {
  rendered.length = 0;
  const f = fixture({ initial: { event_welcome: true, event_goodbye: false } });
  f.context.args = ["out", "on"];
  await command.run(f.context);
  assert.equal(f.data.event_welcome, true, "OUT toggle must not change JOIN");
  assert.equal(f.data.event_goodbye, true);
  assert.equal(rendered.at(-1).mode, "status");
  assert.equal(rendered.at(-1).enabled, true);
  assert.equal(rendered.at(-1).goodbyeEnabled, true);

  f.context.args = ["out", "off"];
  await command.run(f.context);
  assert.equal(f.data.event_welcome, true, "turning OUT off must preserve JOIN");
  assert.equal(f.data.event_goodbye, false);
  assert.equal(rendered.at(-1).goodbyeEnabled, false);
  assert.equal(f.sent.length, 2);
});

test("welcome out status shows both switches without changing either one", async () => {
  rendered.length = 0;
  const f = fixture({ initial: { event_welcome: true, event_goodbye: false } });
  f.context.args = ["out"];
  await command.run(f.context);
  assert.equal(f.data.event_welcome, true);
  assert.equal(f.data.event_goodbye, false);
  assert.equal(rendered.at(-1).enabled, true);
  assert.equal(rendered.at(-1).goodbyeEnabled, false);
});


test("welcome reuses listener threadData instead of issuing a duplicate storage read", async () => {
  rendered.length = 0;
  const f = fixture({ initial: { event_welcome: true, event_goodbye: false } });
  let getDataCalls = 0;
  f.context.Threads.getData = async () => {
    getDataCalls++;
    return { data: { event_welcome: false, event_goodbye: true } };
  };
  f.context.threadData = { data: { event_welcome: true, event_goodbye: false, name: "Nhóm từ cache" } };

  await command.run(f.context);
  assert.equal(getDataCalls, 0);
  assert.equal(rendered.at(-1).enabled, true);
  assert.equal(rendered.at(-1).goodbyeEnabled, false);
  assert.equal(rendered.at(-1).groupName, "Nhóm từ cache");
});

test("welcome falls back to durable thread read when listener cache is absent", async () => {
  rendered.length = 0;
  const f = fixture({ initial: { event_welcome: true, event_goodbye: false } });
  let getDataCalls = 0;
  f.context.Threads.getData = async () => {
    getDataCalls++;
    return { data: { event_welcome: true, event_goodbye: false } };
  };

  await command.run(f.context);
  assert.equal(getDataCalls, 1);
  assert.equal(rendered.at(-1).enabled, true);
});
