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
  const file = path.join(os.tmpdir(), "jt-settings-command-" + process.pid + "-" + calls.length + ".png");
  fs.writeFileSync(file, "mock");
  calls.push({ type, data, file });
  return file;
};
const eventsCommand = require("../plugins/commands/events");
const themeCommand = require("../plugins/commands/theme");
const themeBackgrounds = require("../core/canvas/themeBackgrounds");
after(() => {
  workerRender.renderCanvas = originalRender;
  for (const call of calls) { try { fs.unlinkSync(call.file); } catch {} }
});
function mockApi(sent) {
  return { async sendMessage(payload, threadId, type) { sent.push({ payload, threadId, type }); return { ok: true }; } };
}

test("/events default view sends a menu-themed Canvas status card", async () => {
  const sent = [];
  await eventsCommand.run({
    api: mockApi(sent),
    event: { threadId: "events-group", type: 1 },
    args: [],
    Threads: { async getData() { return { data: { event_welcome: true, event_rank: true } }; } },
    reply: { error: async message => { throw new Error(message); }, info: async () => { throw new Error("unexpected info fallback"); }, success: async () => ({}) }
  });
  const call = calls.find(item => item.type === "events" && item.data.mode === "status");
  assert.ok(call);
  assert.equal(call.data.events.length, 4);
  assert.equal(call.data.events[0].enabled, true);
  assert.equal(sent[0].payload.ttlKind, "card");
  assert.ok(Array.isArray(sent[0].payload.attachments));
});

test("/events guard allowed view uses a Canvas host list while on/off stays a quick text reply", async () => {
  const sent = [];
  const thread = { guard_allowed_hosts: ["example.com"] };
  await eventsCommand.run({
    api: mockApi(sent),
    event: { threadId: "events-group", type: 1 },
    args: ["guard", "allowed"],
    Threads: { async getData() { return { data: thread }; } },
    reply: { info: async () => { throw new Error("unexpected info fallback"); }, success: async () => ({}) }
  });
  assert.ok(calls.some(item => item.type === "events" && item.data.mode === "hosts" && item.data.hosts[0] === "example.com"));
  const changed = {};
  await eventsCommand.run({
    api: mockApi(sent),
    event: { threadId: "events-group", type: 1 },
    args: ["guard", "on"],
    Threads: { async getData() { return { data: changed }; }, async setData(_id, value) { Object.assign(changed, value); } },
    reply: { success: async message => message, error: async message => { throw new Error(message); } }
  });
  assert.equal(changed.event_guard, true);
});

test("/theme default view sends the photo wallpaper gallery card", async () => {
  const sent = [];
  const originalCurrent = themeBackgrounds.getCurrent;
  const originalBackgrounds = themeBackgrounds.getBackgrounds;
  themeBackgrounds.getCurrent = () => ({
    selected: "random", random: true, name: "Ngẫu nhiên · Aurora Mix"
  });
  themeBackgrounds.getBackgrounds = () => [
    { id: "1", name: "Aurora Muse 01" },
    { id: "2", name: "Aurora Muse 02" },
    { id: "3", name: "Aurora Muse 03" }
  ];
  try {
    await themeCommand.run({
      api: mockApi(sent),
      event: { threadId: "theme-group", type: 1 },
      args: []
    });
  } finally {
    themeBackgrounds.getCurrent = originalCurrent;
    themeBackgrounds.getBackgrounds = originalBackgrounds;
  }
  const call = calls.find(item => item.type === "theme");
  assert.ok(call);
  assert.equal(call.data.backgrounds.length, 3);
  assert.equal(sent[sent.length - 1].payload.ttlKind, "card");
});

test("/theme numeric selection stores a photo background instead of changing brand colors", async () => {
  const sent = [];
  const originalSet = themeBackgrounds.setSelection;
  let selectedInput = "";
  themeBackgrounds.setSelection = input => {
    selectedInput = input;
    return { selected: "2", random: false, name: "Aurora Muse 02" };
  };
  try {
    await themeCommand.run({
      api: mockApi(sent),
      event: { threadId: "theme-group", type: 1 },
      args: ["2"]
    });
  } finally {
    themeBackgrounds.setSelection = originalSet;
  }
  assert.equal(selectedInput, "2");
  assert.ok(calls.some(item => item.type === "theme"));
  assert.match(sent[sent.length - 1].payload.msg, /Aurora Muse 02/);
});

test("theme fallback message lists photo choices and random mode", () => {
  const output = themeCommand._test.buildText(
    { name: "Ngẫu nhiên", selected: "random" },
    [
      { id: "1", name: "Aurora Muse 01" },
      { id: "2", name: "Aurora Muse 02" },
      { id: "3", name: "Aurora Muse 03" }
    ]
  );
  assert.match(output, /PHOTO THEME LIBRARY/);
  assert.ok(output.includes("/theme 1"));
  assert.ok(output.includes("/theme random"));
});
