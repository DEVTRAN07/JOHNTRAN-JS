"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const canvas = require("../core/canvas/welcome"), eventPlugin = require("../plugins/events/welcome");
const originalRender = canvas.renderWelcomeCard; let rendered = [];
canvas.renderWelcomeCard = async spec => { rendered.push(spec); return "/tmp/jt-welcome-event-test.png"; };
function fixture({ enabled = true, type = "join", members } = {}) {
  const sent = [], Threads = { async getData() { return { data: { event_welcome: enabled } }; } };
  const api = {
    async getOwnId() { return "bot-id"; },
    async sendMessage(payload, threadId, threadType) { sent.push({ payload, threadId, threadType }); return true; }
  };
  const event = { type, threadId: "welcome-event-group", data: {
    groupName: "JOHNTRAN Community",
    updateMembers: members || [
      { id: "user-1", dName: "Member One", avatar: "https://example.com/member-1.jpg" },
      { id: "user-2", dName: "Member Two", avatar_25: "https://example.com/member-2.jpg" },
      { id: "bot-id", dName: "Bot" }
    ]
  }};
  return { sent, api, Threads, event };
}
test("join event sends one personalized Canvas and one mention per new member", async () => {
  rendered = []; const f = fixture();
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0].threadType, 1);
  for (const sent of f.sent) {
    assert.deepEqual(sent.payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
    assert.match(sent.payload.msg, /@\. đến với nhóm/); assert.equal(sent.payload.mentions.length, 1);
    const mention = sent.payload.mentions[0];
    assert.equal(sent.payload.msg.slice(mention.pos, mention.pos + mention.len), "@.");
  }
  assert.deepEqual(f.sent.map(s => s.payload.mentions[0].uid), ["user-1", "user-2"]);
  assert.deepEqual(rendered.map(x => x.member.name), ["Member One", "Member Two"]);
  assert.equal(rendered[0].member.avatarUrl, "https://example.com/member-1.jpg");
  assert.equal(rendered[1].member.avatarUrl, "https://example.com/member-2.jpg");
  assert.equal(rendered[0].groupName, "JOHNTRAN Community");
});
test("welcome event extracts both full and small Zalo avatar fields", () => {
  const members = eventPlugin._test.newMembers({ updateMembers: [
    { id: "full", dName: "Full", avatar: "https://example.com/full.jpg" },
    { id: "small", dName: "Small", avatar_25: "https://example.com/small.jpg" }
  ]});
  assert.deepEqual(members.map(x => x.avatarUrl), ["https://example.com/full.jpg", "https://example.com/small.jpg"]);
});
test("welcome event mention points only to the member represented by its card", () => {
  const msg = eventPlugin._test.makePersonalMessage({ uid: "user-9" });
  assert.equal(msg.mentions.length, 1); assert.equal(msg.mentions[0].uid, "user-9");
  assert.equal(msg.msg.slice(msg.mentions[0].pos, msg.mentions[0].pos + 2), "@.");
});
test("welcome event does nothing when disabled or when event is not JOIN", async () => {
  rendered = []; const disabled = fixture({ enabled: false });
  await eventPlugin.run({ ...disabled, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(disabled.sent.length, 0);
  const leave = fixture({ type: "leave" });
  await eventPlugin.run({ ...leave, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(leave.sent.length, 0); assert.equal(rendered.length, 0);
});
test("welcome event never greets the bot account as a new member", async () => {
  rendered = []; const f = fixture({ members: [{ id: "bot-id", dName: "Bot" }] });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 0); assert.equal(rendered.length, 0);
});
test.after(() => { canvas.renderWelcomeCard = originalRender; });
