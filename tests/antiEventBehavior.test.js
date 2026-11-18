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
  const Threads = {
    async getData() { return { data: threadData }; },
    async setDataAndWait(_threadId, nextData) {
      for (const key of Object.keys(threadData)) delete threadData[key];
      Object.assign(threadData, nextData);
      return { data: threadData };
    }
  };
  return anti.handleEvent({
    event, api, eventType, isSelf: event?.isSelf === true, Threads
  });
}

test("legacy anti_link blocks ordinary text and recommended links", async () => {
  const { api, calls } = makeApi();
  const threadData = { anti_link: true };
  await run(threadData, api, makeEvent({ content: "Xem https://bad.example/path" }));
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.deleted[0].onlyMe, false);
  assert.equal(threadData.anti_link_warnings.member, 1);
  assert.match(calls.sent[0].payload.msg, /cảnh cáo lần 1\/3/i);

  await run(threadData, api, makeEvent({
    msgType: "chat.recommended",
    content: { action: "recommended.link", href: "https://zalo.me/g/group123" },
    cliMsgId: "cli-2", msgId: "msg-2"
  }));
  assert.equal(calls.deleted.length, 2);
  assert.equal(threadData.anti_link_warnings.member, 2);
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
  const threadData = { anti_danger_link: true };
  await run(threadData, api, makeEvent({ content: "https://malware.example" }));
  assert.equal(calls.deleted.length, 1);
  assert.equal(threadData.anti_link_warnings.member, 1);
  await run(threadData, api, makeEvent({
    content: "[tham gia nhóm](https://zalo.me/g/trfrv1vrakhqeocdpxpo)",
    cliMsgId: "cli-zalo", msgId: "msg-zalo"
  }));
  assert.equal(calls.deleted.length, 2, "Markdown Zalo invitation should be deleted");
  assert.equal(threadData.anti_link_warnings.member, 2);
  await run(threadData, api, makeEvent({
    content: "https://safe.example", cliMsgId: "cli-2", msgId: "msg-2"
  }));
  assert.equal(calls.deleted.length, 2);
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
  assert.equal(calls.deleted.length, 6, "all stickers in the flood should be deleted");
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /cảnh cáo lần 1\/3/i);
  assert.match(calls.sent[0].payload.msg, /dội bom sticker/i);
});

test("antinude deletes and warns three times before kicking on the fourth violation", async () => {
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
    const threadData = { anti_nude: true };
    for (let strike = 1; strike <= 3; strike++) {
      await run(threadData, api, makeEvent({
        uidFrom: "deputy",
        msgType: "chat.photo",
        content: { href: "https://cdn.zaloapp.com/photo-" + strike + ".jpg" },
        cliMsgId: "nude-cli-" + strike,
        msgId: "nude-msg-" + strike
      }));
      assert.equal(calls.kicked.length, 0, "the first three violations must only warn");
      assert.equal(threadData.anti_nude_warnings.deputy, strike, "warning count must be persisted for this member");
      assert.match(calls.sent[strike - 1].payload.msg, new RegExp("cảnh cáo lần " + strike + "/3"));
    }

    await run(threadData, api, makeEvent({
      uidFrom: "deputy",
      msgType: "chat.photo",
      content: { href: "https://cdn.zaloapp.com/photo-4.jpg" },
      cliMsgId: "nude-cli-4",
      msgId: "nude-msg-4"
    }));

    assert.equal(calls.deleted.length, 4, "every violating image must be removed");
    assert.equal(calls.kicked.length, 1, "the fourth violation must kick the member");
    assert.deepEqual(threadData.anti_nude_warnings, {}, "successful kick must clear the member's warning counter");
    assert.match(calls.sent[3].payload.msg, /đã đủ 3 lần cảnh cáo và đã kick thành viên/i);
  } finally {
    http.request = originalRequest;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("antinude keeps the three warnings when Zalo refuses to kick on the next violation", async () => {
  const originalRequest = http.request;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  http.request = async () => ({
    status: 200,
    json: () => ({ results: [{ category_scores: { sexual: 0.99 }, category_applied_input_types: { sexual: ["image"] } }] })
  });
  try {
    const { api, calls } = makeApi({
      removeUserFromGroup: async uid => ({ errorMembers: [uid] })
    });
    const threadData = { anti_nude: true, anti_nude_warnings: { member: 3 } };
    await run(threadData, api, makeEvent({
      uidFrom: "member",
      msgType: "chat.photo",
      content: { href: "https://cdn.zaloapp.com/photo-after-warnings.jpg" }
    }));
    assert.equal(calls.deleted.length, 1);
    assert.equal(calls.kicked.length, 1, "kick must be attempted after three warnings");
    assert.equal(threadData.anti_nude_warnings.member, 3, "failed kick must preserve the strike counter");
    assert.match(calls.sent[0].payload.msg, /đã đủ 3 lần cảnh cáo nhưng Zalo chưa cho kick/i);
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
    assert.equal(calls.sent[0].payload.msg.includes("cảnh cáo lần"), false, "bot self-test must not consume a warning");
    assert.match(calls.sent[0].payload.msg, /bỏ qua cảnh cáo và kick tài khoản bot/i);
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
    assert.equal(calls.undone.length, 6, "all six messages in the bot self-test spam burst should be recalled");
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
  assert.equal(calls.deleted.length, 6, "all six texts in the spam burst should be removed");
  assert.equal(calls.sent.length, 1);
  assert.match(calls.sent[0].payload.msg, /cảnh cáo lần 1\/3/i);
  assert.match(calls.sent[0].payload.msg, /vui lòng không spam/i);
});


test("Anti Link warns three times, kicks on the fourth violation and clears its counter", async () => {
  const { api, calls } = makeApi();
  const threadData = { anti_link: true };
  for (let strike = 1; strike <= 3; strike++) {
    await run(threadData, api, makeEvent({
      content: "https://blocked-" + strike + ".example",
      cliMsgId: "link-cli-" + strike,
      msgId: "link-msg-" + strike
    }));
    assert.equal(calls.kicked.length, 0, "first three violations are warnings only");
    assert.equal(threadData.anti_link_warnings.member, strike);
    assert.match(calls.sent[strike - 1].payload.msg, new RegExp("cảnh cáo lần " + strike + "/3", "i"));
  }
  await run(threadData, api, makeEvent({
    content: "https://blocked-fourth.example",
    cliMsgId: "link-cli-4",
    msgId: "link-msg-4"
  }));
  assert.equal(calls.deleted.length, 4);
  assert.equal(calls.kicked.length, 1, "the fourth offence kicks the sender");
  assert.deepEqual(threadData.anti_link_warnings, {});
  assert.match(calls.sent[3].payload.msg, /đã kick thành viên/i);
});

test("Anti Link preserves all three warnings when Zalo refuses the fourth-offence kick", async () => {
  const { api, calls } = makeApi({
    removeUserFromGroup: async uid => ({ errorMembers: [uid] })
  });
  const threadData = { anti_link: true, anti_link_warnings: { member: 3 } };
  await run(threadData, api, makeEvent({
    content: "https://blocked-fourth.example",
    cliMsgId: "link-fail-cli",
    msgId: "link-fail-msg"
  }));
  assert.equal(calls.kicked.length, 1);
  assert.equal(threadData.anti_link_warnings.member, 3);
  assert.match(calls.sent[0].payload.msg, /Zalo từ chối kick/i);
});

test("Anti-Join counts repeated group joins and kicks on the third join within ten minutes", async () => {
  const { api, calls } = makeApi();
  const threadData = { anti_join: true };
  for (let join = 1; join <= 2; join++) {
    await run(threadData, api, {
      threadId: "anti-join-group",
      type: "join",
      data: { updateMembers: [{ id: "repeat-member", dName: "Repeat Member" }] }
    }, "group_event");
    assert.equal(calls.kicked.length, 0, "the first two joins must only be recorded");
    assert.equal(threadData.anti_join_history["repeat-member"].length, join);
  }

  await run(threadData, api, {
    threadId: "anti-join-group",
    type: "join",
    data: { updateMembers: [{ id: "repeat-member", dName: "Repeat Member" }] }
  }, "group_event");

  assert.deepEqual(calls.kicked, [{ uid: "repeat-member", gid: "anti-join-group" }]);
  assert.equal(threadData.anti_join_history["repeat-member"], undefined,
    "successful kick clears the repeated-join history");
  assert.ok(calls.sent.some(item => /Anti-Join/.test(item.payload.msg)));
});

test("Anti-Join retains its three-join history and retries when Zalo refuses the kick", async () => {
  const { api, calls } = makeApi({
    removeUserFromGroup: async uid => ({ errorMembers: [uid] })
  });
  const threadData = { anti_join: true };
  const joinEvent = {
    threadId: "anti-join-retry-group",
    type: "join",
    data: { updateMembers: [{ id: "repeat-member", dName: "Repeat Member" }] }
  };

  for (let join = 1; join <= 4; join++) {
    await run(threadData, api, joinEvent, "group_event");
  }

  assert.equal(calls.kicked.length, 2,
    "the third join attempts a kick; a later join retries after the API failure");
  assert.equal(threadData.anti_join_history["repeat-member"].length, 4);
  assert.ok(calls.sent.some(item => /chưa kick được/.test(item.payload.msg)));
});

test("Anti-Reaction issues three warnings then kicks on the fourth spam burst", async () => {
  global.antiReactionSpamCache = new Map();
  const { api, calls } = makeApi();
  const threadData = { anti_reaction: true };
  const reactionEvent = {
    threadId: "anti-reaction-group",
    type: ThreadType.Group,
    data: { uidFrom: "reaction-spammer", dName: "Reaction Spammer" }
  };

  for (let burst = 1; burst <= 3; burst++) {
    for (let reaction = 1; reaction <= 6; reaction++) {
      await run(threadData, api, reactionEvent, "reaction");
    }
    assert.equal(calls.kicked.length, 0, "the first three spam bursts only warn");
    assert.equal(threadData.anti_reaction_warnings["reaction-spammer"], burst);
  }

  for (let reaction = 1; reaction <= 6; reaction++) {
    await run(threadData, api, reactionEvent, "reaction");
  }

  assert.deepEqual(calls.kicked, [{
    uid: "reaction-spammer",
    gid: "anti-reaction-group"
  }]);
  assert.equal(threadData.anti_reaction_warnings["reaction-spammer"], undefined,
    "a successful fourth-offence kick clears the warning counter");
  assert.equal(calls.sent.length, 4);
  assert.match(calls.sent[0].payload.msg, /Cảnh cáo 1\/3/);
  assert.match(calls.sent[1].payload.msg, /Cảnh cáo 2\/3/);
  assert.match(calls.sent[2].payload.msg, /Cảnh cáo 3\/3/);
  assert.match(calls.sent[3].payload.msg, /bị kick khỏi nhóm/i);
});

test("Anti-Reaction preserves three warnings when Zalo refuses the fourth-burst kick", async () => {
  global.antiReactionSpamCache = new Map();
  const { api, calls } = makeApi({
    removeUserFromGroup: async uid => ({ errorMembers: [uid] })
  });
  const threadData = {
    anti_reaction: true,
    anti_reaction_warnings: { "reaction-spammer": 3 }
  };
  const reactionEvent = {
    threadId: "anti-reaction-retry-group",
    type: ThreadType.Group,
    data: { uidFrom: "reaction-spammer", dName: "Reaction Spammer" }
  };

  for (let reaction = 1; reaction <= 6; reaction++) {
    await run(threadData, api, reactionEvent, "reaction");
  }

  assert.equal(calls.kicked.length, 1);
  assert.equal(threadData.anti_reaction_warnings["reaction-spammer"], 3);
  assert.ok(calls.sent.some(item => /chưa kick được/.test(item.payload.msg)));
});

