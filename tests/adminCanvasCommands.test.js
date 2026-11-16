"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const workerRender = require("../core/canvas/workerRender");
const originalRender = workerRender.renderCanvas;
const calls = [];
workerRender.renderCanvas = async (type, data) => {
  const file = path.join(os.tmpdir(), "jt-admin-command-" + process.pid + "-" + calls.length + ".png");
  fs.writeFileSync(file, "mock");
  calls.push({ type, data, file });
  return file;
};
const adminCommand = require("../plugins/commands/admin");
after(() => {
  workerRender.renderCanvas = originalRender;
  for (const call of calls) { try { fs.unlinkSync(call.file); } catch {} }
});
function mockApi(sent) {
  return {
    async sendMessage(payload, threadId, type) { sent.push({ payload, threadId, type }); return { ok: true }; },
    async getUserInfo(uid) {
      return { changed_profiles: { [uid]: { displayName: "User " + uid } } };
    }
  };
}
function mockReply() {
  return {
    card: async spec => { throw new Error("unexpected fallback card: " + JSON.stringify(spec)); },
    success: async value => value,
    error: async value => { throw new Error(value); }
  };
}

test("/admin help sends a menu-style Canvas card", async () => {
  const sent = [];
  global.config = { name_bot: "JOHNTRAN" };
  global.users = { admin: [], support: [] };
  await adminCommand.run({
    args: [],
    event: { threadId: "admin-help", type: 1, data: {} },
    api: mockApi(sent),
    Threads: {},
    reply: mockReply()
  });
  const call = calls.find(item => item.type === "admin" && item.data.meta === "ADMIN GUIDE");
  assert.ok(call);
  assert.equal(sent[0].payload.ttlKind, "card");
  assert.ok(Array.isArray(sent[0].payload.attachments));
});

test("/admin list shows Admin and Support entries in a Canvas card", async () => {
  const sent = [];
  global.config = { name_bot: "JOHNTRAN" };
  global.users = { admin: ["100", "200"], support: ["300"] };
  await adminCommand.run({
    args: ["list"],
    event: { threadId: "admin-list", type: 1, data: {} },
    api: mockApi(sent),
    Threads: {},
    reply: mockReply()
  });
  const call = calls.find(item => item.type === "admin" && item.data.meta === "ADMIN DIRECTORY");
  assert.ok(call);
  assert.equal(call.data.sections[0].items.length, 2);
  assert.equal(call.data.sections[1].items[0].uid, "300");
  assert.equal(sent[sent.length - 1].payload.ttlKind, "card");
});

test("/admin permission toggles remain quick text replies, not Canvas", async () => {
  const sent = [];
  const thread = { admin_only: false };
  global.config = { name_bot: "JOHNTRAN" };
  global.users = { admin: [], support: [] };
  await adminCommand.run({
    args: ["adminonly"],
    event: { threadId: "admin-toggle", type: 1, data: {} },
    api: mockApi(sent),
    Threads: {
      async getData() { return { data: thread }; },
      async setData(_id, data) { Object.assign(thread, data); }
    },
    reply: mockReply()
  });
  assert.equal(thread.admin_only, true);
  assert.equal(calls.some(item => item.type === "admin"), false);
});
