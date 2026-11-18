"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");
const http = require("../core/http");
const { updateMessageCache, getMessageCache } = require("../utils/messageCache");

function makeEvent(options = {}) {
  const threadId = options.threadId || "anti-test-group";
  return {
    threadId,
    type: ThreadType.Group,
    isSelf: options.isSelf === true,
    data: {
      uidFrom: options.uidFrom || "member",
      dName: "Member",
      msgType: options.msgType || "webchat",
      content: options.content === undefined ? "" : options.content,
      cliMsgId: options.cliMsgId || "cli-1",
      msgId: options.msgId || "msg-1",
      ts: Date.now()
    }
  };
}

function makeApi(options = {}) {
  const groupInfo = options.groupInfo === undefined
    ? { creatorId: "bot-id", adminIds: [] }
    : options.groupInfo;
  const calls = { lookups: 0, deleted: [], undone: [], kicked: [], sent: [], scanned: [] };
  const api = {
    getOwnId() { return "bot-id"; },
    async getGroupInfo(threadId) {
      calls.lookups++;
      return { gridInfoMap: { [threadId]: groupInfo } };
    },
    async scanURL(url) {
      calls.scanned.push(url);
      return options.scanURL ? options.scanURL(url) : { isSafe: true };
    },
    async deleteMessage(destination, onlyMe) {
      calls.deleted.push({ destination, onlyMe });
      return options.deleteMessage ? options.deleteMessage(destination, onlyMe) : { status: 0 };
    },
    async undo(payload, threadId, type) {
      calls.undone.push({ payload, threadId, type });
      return { status: 0 };
    },
    async removeUserFromGroup(uid, gid) {
      calls.kicked.push({ uid, gid });
      return options.removeUserFromGroup ? options.removeUserFromGroup(uid, gid) : { errorMembers: [] };
    },
    async sendMessage(payload, gid, type) {
      calls.sent.push({ payload, gid, type });
      return true;
    },
    async sendVideo(payload, gid, type) {
      calls.sent.push({ payload, gid, type, kind: "video" });
      return true;
    },
    async sendSticker(payload, gid, type) {
      calls.sent.push({ payload, gid, type, kind: "sticker" });
      return true;
    },
    async sendVoice(payload, gid, type) {
      calls.sent.push({ payload, gid, type, kind: "voice" });
      return true;
    }
  };
  return { api, calls };
}

async function run(threadData, api, event, eventType = "message") {
  return anti.handleEvent({
    event, api, eventType, isSelf: event?.isSelf === true,
    Threads: { async getData() { return { data: threadData }; } }
  });
}

test("legacy anti_link blocks ordinary text and recommended links", async () => {
  const { api, calls } = makeApi();
  await run({ anti_link: true }, api, makeEvent({ content: "Xem https://bad.example/path" }));
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.deleted[0].onlyMe, false);

  await run({ anti_link: true }, api, makeEvent({
    msgType: "chat.recommended",
    content: { action: "recommended.link", href: "https://zalo.me/g/group123" },
    cliMsgId: "cli-2", msgId: "msg-2"
  }));
  assert.equal(calls.deleted.length, 2);
});

test("Anti link also moderates the group creator and deputies; no role lookup can bypass enforcement", async () => {
  const admin = makeApi({ groupInfo: { creatorId: "owner", adminIds: ["bot-id", "deputy"] } });
  await run({ anti_link: true }, admin.api, makeEvent({
    uidFrom: "owner", content: "https://owner-link.example"
  }));
  await run({ anti_link: true }, admin.api, makeEvent({
    uidFrom: "deputy", content: "https://deputy-link.example",
    cliMsgId: "admin-cli-2", msgId: "admin-msg-2"
  }));
  assert.equal(admin.calls.deleted.length, 2);
  assert.equal(admin.calls.sent.length, 2);
  assert.equal(admin.calls.lookups, 1, "the bot QTV role is checked once and cached for the event burst");

  const unknown = makeApi({ groupInfo: null });
  await run({ anti_link: true }, unknown.api, makeEvent({ content: "https://member-link.example" }));
  assert.equal(unknown.calls.deleted.length, 0, "unknown bot role must fail closed");
  assert.equal(unknown.calls.sent.length, 0, "a group without verified bot QTV stays silent");
});

test("antilink uses Zalo scanURL and only deletes unsafe URLs", async () => {
  const { api, calls } = makeApi({
    scanURL: url => ({ isSafe: url !== "https://malware.example" })
  });
  await run({ anti_danger_link: true }, api, makeEvent({ content: "https://malware.example" }));
  assert.equal(calls.deleted.length, 1);
  await run({ anti_danger_link: true }, api, makeEvent({
    content: "https://safe.example", cliMsgId: "cli-2", msgId: "msg-2"
  }));
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.scanned.length, 2);
});

test("antispam sticker flood deletes six stickers from one member", async () => {
  global.antiStickerSpamCache = new Map();
  global.antiStickerSpamWarnings = new Map();
  const { api, calls } = makeApi();
  for (let i = 1; i <= 6; i++) {
    await run({ anti_sticker_spam: true }, api, makeEvent({
      uidFrom: "deputy",
      msgType: "chat.sticker",
      content: { id: i, catId: 1 },
      cliMsgId: "sticker-" + i,
      msgId: "sticker-msg-" + i
    }));
  }
  assert.equal(calls.deleted.length, 6);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /dội bom sticker/i);
});

test("antinude calls moderation, deletes the image and verifies kick result", async () => {
  const originalRequest = http.request;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  http.request = async () => ({
    status: 200,
    json: () => ({
      results: [{
        category_scores: { sexual: 0.99 },
        category_applied_input_types: { sexual: ["image"] }
      }]
    })
  });
  try {
    const { api, calls } = makeApi();
    await run({ anti_nude: true }, api, makeEvent({
      uidFrom: "deputy",
      msgType: "chat.photo",
      content: { href: "https://cdn.zaloapp.com/photo.jpg" }
    }));
    assert.equal(calls.deleted.length, 1);
    assert.equal(calls.kicked.length, 1);
    assert.match(calls.sent[0].payload.msg, /đã kick thành viên/i);
  } finally {
    http.request = originalRequest;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("antinude reports a Zalo errorMembers kick refusal", async () => {
  const originalRequest = http.request;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  http.request = async () => ({
    status: 200,
    json: () => ({ results: [{ category_scores: { sexual: 0.99 } }] })
  });
  try {
    const { api, calls } = makeApi({
      removeUserFromGroup: async uid => ({ errorMembers: [uid] })
    });
    await run({ anti_nude: true }, api, makeEvent({
      msgType: "chat.photo",
      content: { href: "https://cdn.zaloapp.com/photo.jpg" }
    }));
    assert.equal(calls.deleted.length, 1);
    assert.match(calls.sent[0].payload.msg, /chưa kick được thành viên/i);
  } finally {
    http.request = originalRequest;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("antinude self-test recalls an explicit bot image but never kicks the bot account", async () => {
  const originalRequest = http.request;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousConfig = global.config;
  process.env.OPENAI_API_KEY = "test-key";
  global.config = { allow_self_anti: true };
  http.request = async () => ({
    status: 200,
    json: () => ({
      results: [{
        category_scores: { sexual: 0.99 },
        category_applied_input_types: { sexual: ["image"] }
      }]
    })
  });
  try {
    const { api, calls } = makeApi();
    await run({ anti_nude: true }, api, makeEvent({
      isSelf: true,
      uidFrom: "bot-id",
      msgType: "chat.photo",
      content: { href: "https://cdn.zaloapp.com/bot-test-photo.jpg" }
    }));
    assert.equal(calls.deleted.length, 0, "bot-authored image must not use deleteMessage");
    assert.equal(calls.undone.length, 1, "bot-authored image must use undo");
    assert.deepEqual(calls.undone[0], {
      payload: { msgId: "msg-1", cliMsgId: "cli-1" },
      threadId: "anti-test-group",
      type: ThreadType.Group
    });
    assert.equal(calls.kicked.length, 0, "Anti must never kick its own bot account during self testing");
    assert.match(calls.sent[0].payload.msg, /bỏ qua kick tài khoản bot/i);
  } finally {
    http.request = originalRequest;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("antispam recalls bot self-test sticker flood through undo", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_anti: true };
  global.antiStickerSpamCache = new Map();
  global.antiStickerSpamWarnings = new Map();
  const { api, calls } = makeApi();
  try {
    for (let i = 1; i <= 6; i++) {
      await run({ anti_sticker_spam: true }, api, makeEvent({
        isSelf: true,
        uidFrom: "bot-id",
        msgType: "chat.sticker",
        content: { id: i, catId: 1 },
        cliMsgId: "bot-sticker-" + i,
        msgId: "bot-sticker-msg-" + i
      }));
    }
    assert.equal(calls.deleted.length, 0);
    assert.equal(calls.undone.length, 6, "all six bot test stickers must be recalled");
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /dội bom sticker/i);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("legacy anti_spam recalls the sixth bot self-test text message", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_anti: true };
  global.spamCache = {};
  const { api, calls } = makeApi();
  try {
    for (let i = 1; i <= 6; i++) {
      await run({ anti_spam: true }, api, makeEvent({
        isSelf: true,
        uidFrom: "bot-id",
        content: "bot spam test " + i,
        cliMsgId: "bot-spam-" + i,
        msgId: "bot-spam-msg-" + i
      }));
    }
    assert.equal(calls.deleted.length, 0);
    assert.equal(calls.undone.length, 1, "only the sixth rapid message crosses the spam threshold");
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /vui lòng không spam/i);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("antirecall restores cached text using group Undo payload without type", async () => {
  const cliMsgId = "anti-undo-" + Date.now();
  const event = makeEvent({
    cliMsgId, msgId: "global-" + cliMsgId, content: "tin gốc"
  });
  updateMessageCache(event);
  const { api, calls } = makeApi();
  const undoEvent = {
    threadId: event.threadId,
    isGroup: true,
    isSelf: false,
    data: {
      uidFrom: "owner",
      dName: "Group owner",
      msgId: "undo-id",
      cliMsgId: "undo-cli",
      ts: Date.now(),
      content: { cliMsgId }
    }
  };
  try {
    await run({ anti_undo: true }, api, undoEvent, "undo");
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /tin gốc/);
    assert.equal(calls.sent[0].type, ThreadType.Group);
  } finally {
    delete getMessageCache()[cliMsgId];
  }
});

test("antirecall prepares temp folder before restoring a shared file", async () => {
  const cliMsgId = "anti-undo-file-" + Date.now();
  updateMessageCache({
    threadId: "anti-test-group",
    type: ThreadType.Group,
    data: {
      cliMsgId,
      msgId: "file-msg",
      uidFrom: "member",
      dName: "Member",
      msgType: "share.file",
      content: { href: "https://files.zaloapp.com/demo.pdf", title: "demo.pdf" },
      ts: Date.now()
    }
  });
  const originalRequest = http.request;
  http.request = async () => ({
    status: 200,
    headers: {},
    body: Buffer.from("sample-file")
  });
  const { api, calls } = makeApi();
  try {
    const undoEvent = {
      threadId: "anti-test-group",
      isGroup: true,
      data: { uidFrom: "member", content: { cliMsgId }, ts: Date.now() }
    };
    await run({ anti_undo: true }, api, undoEvent, "undo");
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /demo\.pdf/);
  } finally {
    http.request = originalRequest;
    delete getMessageCache()[cliMsgId];
  }
});

test("all Anti modes stay silent when the bot is not a group owner or deputy", async () => {
  const { api, calls } = makeApi({
    groupInfo: { creatorId: "group-owner", adminIds: ["group-deputy"] }
  });
  const threadData = {
    anti_nude: true,
    anti_undo: true,
    anti_danger_link: true,
    anti_sticker_spam: true,
    anti_link: true,
    anti_spam: true
  };

  await run(threadData, api, makeEvent({ content: "https://danger.example" }));
  await run(threadData, api, makeEvent({
    msgType: "chat.sticker",
    content: { id: 1, catId: 1 },
    cliMsgId: "no-key-sticker",
    msgId: "no-key-sticker"
  }));

  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.kicked.length, 0);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.scanned.length, 0);
  assert.equal(calls.lookups, 1, "bot role lookup is cached during the event burst");
});

test("legacy anti_spam also deletes the sixth rapid text message from the group owner", async () => {
  global.spamCache = {};
  const { api, calls } = makeApi();
  for (let i = 1; i <= 6; i++) {
    await run({ anti_spam: true }, api, makeEvent({
      uidFrom: "owner",
      content: "tin nhắn " + i,
      cliMsgId: "spam-" + i,
      msgId: "spam-msg-" + i
    }));
  }
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /vui lòng không spam/i);
});
