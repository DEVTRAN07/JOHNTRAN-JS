"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const workerRender = require("../core/canvas/workerRender");

const originalRenderCanvas = workerRender.renderCanvas;
const rendered = [];
const command = (() => {
  workerRender.renderCanvas = async (type, data) => {
    const file = path.join(os.tmpdir(), "jt-anti-menu-" + process.pid + "-" + rendered.length + ".png");
    fs.writeFileSync(file, Buffer.from("anti-preview"));
    rendered.push({ type, data, file });
    return file;
  };
  return require("../plugins/commands/anti");
})();

test("bare /anti sends one Anti-Protection image with no duplicate plaintext table", async () => {
  const sent = [];
  const data = {
    anti_nude: true,
    anti_undo: true,
    anti_danger_link: false,
    anti_sticker_spam: true,
    anti_link: false,
    anti_spam: false
  };

  try {
    await command.run({
      api: { async sendMessage(payload, threadId, type) { sent.push({ payload, threadId, type }); } },
      event: { threadId:"anti-menu-group", type:ThreadType.Group, data:{ uidFrom:"member" } },
      args: [],
      Threads: { async getData() { return { data }; } }
    });

    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].type, "anti-protection-v2");
    assert.equal(rendered[0].data.items.length, 21);
    assert.deepEqual(rendered[0].data.items.map(item => item.command), [
      "/anticard", "/antidoodle", "/antifile", "/antigif", "/antiinvite",
      "/antijoin", "/antilink", "/antilocation", "/antiother", "/antiphoto",
      "/antiqr", "/antireaction", "/antisex", "/antispam", "/antistk",
      "/antistklag", "/antitaghide", "/antivideo", "/antivoice", "/antiword",
      "/antirecall"
    ], "the Anti image must show every moderation command");
    assert.deepEqual(rendered[0].data.items.map(item => item.key), [
      "anti_card", "anti_doodle", "anti_file", "anti_gif", "anti_danger_link",
      "anti_join", "anti_link", "anti_location", "anti_other", "anti_photo",
      "anti_qr", "anti_reaction", "anti_nude", "anti_spam", "anti_sticker",
      "anti_sticker_spam", "anti_taghide", "anti_video", "anti_voice", "anti_word",
      "anti_undo"
    ]);
    assert.deepEqual(rendered[0].data.items.map(item => item.enabled), [
      false, false, false, false, false, false, false, false, false, false,
      false, false, true, false, false, true, false, false, false, false, true
    ], "the Anti image must mirror the exact group flags also managed by Panel");
    assert.equal(sent.length, 1, "the image and its caption are the only message when Canvas succeeds");
    assert.deepEqual(sent[0].payload.attachments, [rendered[0].file]);
    assert.match(sent[0].payload.msg, /ANTI-PROTECTION V2/);
    assert.match(sent[0].payload.msg, /CHƯA XÁC MINH ĐƯỢC QTV/i);
    assert.equal(sent[0].payload.ttlKind, "card");
  } finally {
    for (const item of rendered) {
      try { fs.unlinkSync(item.file); } catch {}
    }
  }
});

test("bare /anti warns when protection flags are ON but the bot has lost QTV", async () => {
  const sent = [];
  const data = { anti_link: true };
  const threadId = "anti-menu-bot-lost-key";
  const api = {
    getOwnId() { return "bot-id"; },
    async getGroupInfo() {
      return { gridInfoMap: { [threadId]: { creatorId: "group-owner", adminIds: ["group-deputy"] } } };
    },
    async sendMessage(payload, id, type) { sent.push({ payload, id, type }); }
  };
  const renderStart = rendered.length;
  await command.run({
    api,
    event: { threadId, type: ThreadType.Group, data: { uidFrom: "member" } },
    args: [],
    Threads: { async getData() { return { data }; } }
  });

  assert.equal(rendered.length, renderStart + 1);
  assert.equal(rendered.at(-1).data.items.find(item => item.key === "anti_link").enabled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.msg, /BOT CHƯA CÓ QTV/i);
  assert.match(sent[0].payload.msg, /Anti đang tạm ngừng xử lý/i);
});

test("legacy /anti link|undo|spam switches require confirmed group QTV and persist durably", async () => {
  const threadId = "anti-toggle-group";
  const data = {};
  const sent = [];
  const api = {
    getOwnId() { return "bot-id"; },
    async getGroupInfo() {
      return { gridInfoMap: { [threadId]: { creatorId:"owner", adminIds:["deputy", "bot-id"] } } };
    },
    async sendMessage(payload) { sent.push(payload); }
  };
  const Threads = {
    async getData() { return { data:{ ...data } }; },
    async setDataAndWait(id, next) { Object.assign(data, next); }
  };

  const renderStart = rendered.length;
  await command.run({
    api, Threads,
    event:{ threadId, type:ThreadType.Group, data:{ uidFrom:"deputy" } },
    args:["link","on"]
  });
  assert.equal(data.anti_link, true);
  assert.match(sent[0].msg, /THÔNG BÁO HỆ THỐNG/);
  assert.ok(Array.isArray(sent[0].attachments));
  assert.equal(rendered[renderStart].type, "card");
  assert.match(rendered[renderStart].data.subtitle, /Đã bật thành công chế độ Anti-Link/);

  await command.run({
    api, Threads,
    event:{ threadId, type:ThreadType.Group, data:{ uidFrom:"deputy" } },
    args:["undo","off"]
  });
  assert.equal(data.anti_undo, false);
  assert.match(rendered[renderStart + 1].data.subtitle, /Đã tắt thành công chế độ Anti-Recall/);
});

test("legacy /anti switch refuses an ordinary member or unknown QTV state", async () => {
  const threadId = "anti-deny-group";
  const sent = [];
  const api = {
    async getGroupInfo() {
      return { gridInfoMap: { [threadId]: { creatorId:"owner", adminIds:[] } } };
    },
    async sendMessage(payload) { sent.push(payload); }
  };
  const data = {};
  await command.run({
    api,
    event:{ threadId, type:ThreadType.Group, data:{ uidFrom:"member" } },
    args:["spam","on"],
    Threads:{ async getData(){ return { data }; }, async setDataAndWait(_id,next){Object.assign(data,next);} }
  });
  assert.equal(data.anti_spam, undefined);
  assert.match(sent[0].msg, /QTV BOX/);

  const unknownSent = [];
  await command.run({
    api:{ async sendMessage(payload){ unknownSent.push(payload); } },
    event:{ threadId, type:ThreadType.Group, data:{ uidFrom:"member" } },
    args:["spam","on"],
    Threads:{ async getData(){ return { data }; }, async setDataAndWait(_id,next){Object.assign(data,next);} }
  });
  assert.equal(data.anti_spam, undefined);
  assert.match(unknownSent[0].msg, /QTV BOX/);
});

test("anti command is visible as a normal group feature; toggles still verify group QTV in the handler", () => {
  assert.equal(command.config.role, 0);
  assert.equal(command.config.category, "Anti");
  assert.equal(typeof command._menu.buildAntiMenuText, "function");
});

test.after(() => {
  workerRender.renderCanvas = originalRenderCanvas;
  for (const item of rendered) {
    try { fs.unlinkSync(item.file); } catch {}
  }
});
