"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");

function makeEvent(threadId, options = {}) {
  return {
    threadId,
    type: options.eventType === "group_event" ? "join" : ThreadType.Group,
    isGroup: options.eventType === "undo",
    data: {
      uidFrom: options.uidFrom || "member",
      dName: "Member",
      msgType: options.msgType || "webchat",
      content: options.content === undefined ? "hello" : options.content,
      cliMsgId: options.cliMsgId || "cli-" + threadId,
      msgId: options.msgId || "msg-" + threadId,
      ts: Date.now(),
      ...(options.data || {})
    }
  };
}

function makeApi(threadId, options = {}) {
  const calls = { deleted: [], undone: [], kicked: [], sent: [], scanned: [] };
  return {
    calls,
    api: {
      getOwnId() { return "bot-id"; },
      async getGroupInfo() {
        return {
          gridInfoMap: {
            [threadId]: { creatorId: "bot-id", adminIds: [] }
          }
        };
      },
      async scanURL(url) {
        calls.scanned.push(url);
        return options.scanURL ? options.scanURL(url) : { isSafe: true };
      },
      async deleteMessage(destination, onlyMe) {
        calls.deleted.push({ destination, onlyMe });
        return { status: 0 };
      },
      async undo(payload, gid, type) {
        calls.undone.push({ payload, gid, type });
        return { status: 0 };
      },
      async removeUserFromGroup(uid, gid) {
        calls.kicked.push({ uid, gid });
        return options.removeUserFromGroup
          ? options.removeUserFromGroup(uid, gid)
          : { errorMembers: [] };
      },
      async sendMessage(payload, gid, type) {
        calls.sent.push({ payload, gid, type });
        return true;
      }
    }
  };
}

async function runMessage(threadData, api, event, eventType = "message") {
  const Threads = {
    async getData() { return { data: threadData }; },
    async setDataAndWait(_threadId, next) {
      Object.assign(threadData, next);
      return { data: threadData };
    }
  };
  return anti.handleEvent({
    event, api, eventType, isSelf: event?.isSelf === true, Threads
  });
}

test("all media Anti modes classify their target message and remove it", async () => {
  const cases = [
    ["anti_card", "chat.recommended", { action: "recommended.user", params: "shared-user" }],
    ["anti_doodle", "chat.doodle", { isDoodle: true }],
    ["anti_file", "share.file", { href: "https://cdn.example/file.bin" }],
    ["anti_gif", "chat.gif", { href: "https://cdn.example/animated.gif", mimeType: "image/gif" }],
    ["anti_location", "chat.location", { lat: 10.1, lng: 106.2 }],
    ["anti_photo", "chat.photo", { href: "https://cdn.example/photo.jpg" }],
    ["anti_qr", "chat.qr", { isQr: true }],
    ["anti_video", "chat.video.msg", { href: "https://cdn.example/clip.mp4" }],
    ["anti_voice", "chat.voice", { href: "https://cdn.example/voice.mp3", mimeType: "audio/mpeg" }],
    ["anti_sticker", "chat.sticker", { id: 99, catId: 1 }],
    ["anti_other", "chat.unsupported", { unsupported: true }]
  ];

  for (const [flag, msgType, content] of cases) {
    const threadId = "anti-media-" + flag;
    const { api, calls } = makeApi(threadId);
    const threadData = { [flag]: true };
    await runMessage(threadData, api, makeEvent(threadId, { msgType, content }));

    assert.equal(calls.deleted.length, 1, flag + " must delete its matching message");
    assert.equal(calls.deleted[0].onlyMe, false);
    assert.equal(threadData[flag + "_warnings"]?.member, 1);
    assert.match(calls.sent[0].payload.msg, /cảnh cáo lần 1\/3/i);
  }
});

test("Anti-Tag-Hide and Anti-Word detect hidden mentions and blocked words", async () => {
  const hiddenThread = "anti-hidden-mention";
  const hiddenFixture = makeApi(hiddenThread);
  const hiddenEvent = makeEvent(hiddenThread, { content: "xin chào" });
  hiddenEvent.data.mentions = [{ hidden: true, uid: "target" }];
  const hiddenData = { anti_taghide: true };
  await runMessage(hiddenData, hiddenFixture.api, hiddenEvent);
  assert.equal(hiddenFixture.calls.deleted.length, 1);
  assert.equal(hiddenData.anti_taghide_warnings.member, 1);

  const wordThread = "anti-blocked-word";
  const wordFixture = makeApi(wordThread);
  const wordData = { anti_word: true };
  await runMessage(wordData, wordFixture.api, makeEvent(wordThread, { content: "địt mẹ" }));
  assert.equal(wordFixture.calls.deleted.length, 1);
  assert.equal(wordData.anti_word_warnings.member, 1);
});

test("Anti-Reaction warns on three spam bursts and kicks on the fourth", async () => {
  const threadId = "anti-reaction-bursts";
  const { api, calls } = makeApi(threadId);
  const threadData = { anti_reaction: true };

  for (let burst = 1; burst <= 4; burst++) {
    for (let item = 1; item <= 6; item++) {
      const event = makeEvent(threadId, {
        eventType: "reaction",
        uidFrom: "member",
        cliMsgId: "reaction-" + burst + "-" + item,
        msgId: "reaction-msg-" + burst + "-" + item
      });
      await runMessage(threadData, api, event, "reaction");
    }

    if (burst <= 3) {
      assert.equal(calls.kicked.length, 0, "the first three spam bursts must only warn");
      assert.equal(threadData.anti_reaction_warnings.member, burst);
    }
  }

  assert.equal(calls.kicked.length, 1, "the fourth spam burst must kick");
  assert.deepEqual(threadData.anti_reaction_warnings, {});
  assert.match(calls.sent.at(-1).payload.msg, /đã tái phạm spam cảm xúc/i);
});

test("Anti-Join tracks repeated joins in a ten-minute window and kicks on the third", async () => {
  const threadId = "anti-rejoin-window";
  const { api, calls } = makeApi(threadId);
  const threadData = { anti_join: true };
  const Threads = {
    async getData() { return { data: threadData }; },
    async setDataAndWait(_threadId, next) { Object.assign(threadData, next); }
  };

  for (let count = 1; count <= 3; count++) {
    const event = {
      threadId,
      type: "join",
      data: { updateMembers: [{ id: "member", dName: "Member" }] }
    };
    await anti.handleEvent({ event, eventType: "group_event", api, Threads });
    if (count < 3) assert.equal(calls.kicked.length, 0);
  }

  assert.equal(calls.kicked.length, 1);
  assert.equal(calls.kicked[0].uid, "member");
  assert.equal(threadData.anti_join_history.member, undefined);
  assert.match(calls.sent.at(-1).payload.msg, /Anti-Join/i);
});
