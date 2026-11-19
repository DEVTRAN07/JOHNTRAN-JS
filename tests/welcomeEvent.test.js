"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const canvas = require("../core/canvas/welcome");
const eventPlugin = require("../plugins/events/welcome");

const originalRender = canvas.renderWelcomeCard;
let rendered = [];
canvas.renderWelcomeCard = async spec => {
  rendered.push(spec);
  return "/tmp/jt-welcome-event-test.png";
};

function fixture({ enabled = true, type = "join", members } = {}) {
  const sent = [];
  const Threads = {
    async getData() { return { data: { event_welcome: enabled } }; }
  };
  const api = {
    async getOwnId() { return "bot-id"; },
    async sendMessage(payload, threadId, threadType) {
      sent.push({ payload, threadId, threadType });
      return true;
    }
  };
  const event = {
    type,
    threadId: "welcome-event-group",
    data: {
      groupName: "JOHNTRAN Community",
      updateMembers: members || [
        { id: "user-1", dName: "Member One" },
        { id: "user-2", dName: "Member Two" },
        { id: "bot-id", dName: "Bot" }
      ]
    }
  };
  return { sent, api, Threads, event };
}

test("join event sends a custom Canvas card and mentions each new human member", async () => {
  rendered = [];
  const f = fixture();
  await eventPlugin.run({
    ...f,
    isSelf: false,
    threadType: 1,
    eventType: "group_event"
  });

  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].threadType, 1);
  assert.deepEqual(f.sent[0].payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
  assert.match(f.sent[0].payload.msg, /@\. @\./);
  assert.deepEqual(f.sent[0].payload.mentions.map(item => item.uid), ["user-1", "user-2"]);
  for (const mention of f.sent[0].payload.mentions) {
    assert.equal(f.sent[0].payload.msg.slice(mention.pos, mention.pos + mention.len), "@.");
  }
  assert.deepEqual(rendered[0].memberNames, ["Member One", "Member Two"]);
  assert.equal(rendered[0].groupName, "JOHNTRAN Community");
});

test("welcome event does nothing when disabled or when event is not JOIN", async () => {
  rendered = [];
  const disabled = fixture({ enabled: false });
  await eventPlugin.run({ ...disabled, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(disabled.sent.length, 0);

  const leave = fixture({ type: "leave" });
  await eventPlugin.run({ ...leave, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(leave.sent.length, 0);
  assert.equal(rendered.length, 0);
});

test("welcome event never greets the bot account as a new member", async () => {
  rendered = [];
  const f = fixture({ members: [{ id: "bot-id", dName: "Bot" }] });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 0);
  assert.equal(rendered.length, 0);
});

test.after(() => {
  canvas.renderWelcomeCard = originalRender;
});
