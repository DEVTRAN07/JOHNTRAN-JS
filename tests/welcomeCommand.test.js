"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const canvas = require("../core/canvas/welcome"), command = require("../plugins/commands/welcome");
const originalRender = canvas.renderWelcomeCard, rendered = [];
canvas.renderWelcomeCard = async spec => { rendered.push(spec); return "/tmp/jt-welcome-command-test.png"; };
function fixture({ type = 1, initial = {}, requester = "Tester" } = {}) {
  const data = { ...initial }, sent = [], threadId = "welcome-command-group";
  const api = { async sendMessage(payload, target, sendType) { sent.push({ payload, target, sendType }); return true; } };
  const Threads = { async getData() { return { data }; }, async setData(_id, next) { Object.assign(data, next); } };
  return { data, sent, context: {
    api, event: { threadId, type, data: { dName: requester, avatar: "https://example.com/requester.jpg", groupName: "Nhóm kiểm thử" }},
    args: [], Threads, reply: { error: async message => { throw new Error(message); } }
  }};
}
test("welcome command shows a Canvas status card by default", async () => {
  rendered.length = 0; const f = fixture(); await command.run(f.context);
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].payload.attachments, ["/tmp/jt-welcome-command-test.png"]);
  assert.equal(rendered.at(-1).mode, "status"); assert.equal(rendered.at(-1).enabled, false);
});
test("welcome on/off persist the legacy event_welcome setting", async () => {
  rendered.length = 0; const f = fixture(); f.context.args = ["on"]; await command.run(f.context);
  assert.equal(f.data.event_welcome, true); assert.equal(rendered.at(-1).enabled, true);
  f.context.args = ["off"]; await command.run(f.context);
  assert.equal(f.data.event_welcome, false); assert.equal(rendered.at(-1).enabled, false); assert.equal(f.sent.length, 2);
});
test("welcome test renders one member card with their avatar without changing state", async () => {
  rendered.length = 0; const f = fixture({ requester: "Quang Test" }); f.context.args = ["test"]; await command.run(f.context);
  assert.equal(rendered.at(-1).mode, "welcome");
  assert.deepEqual(rendered.at(-1).member, { name: "Quang Test", avatarUrl: "https://example.com/requester.jpg" });
  assert.equal(f.data.event_welcome, undefined);
});
test("welcome command is group-only", async () => {
  const f = fixture({ type: 0 }); await assert.rejects(command.run(f.context), /chỉ dùng trong nhóm/i);
  assert.equal(f.sent.length, 0);
});
test.after(() => { canvas.renderWelcomeCard = originalRender; });
