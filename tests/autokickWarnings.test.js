"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const autokick = require("../plugins/commands/autokick");

function makeFixture(removeUserFromGroup) {
  const threadId = "autokick-four-strikes";
  const groupData = {
    auto_kick: { enabled: true, words: ["spamword"], violations: {} }
  };
  const calls = { kicked: [], sent: [] };
  const api = {
    async getGroupInfo(gid) {
      return {
        gridInfoMap: {
          [gid]: { creatorId: "owner", adminIds: ["bot-id"] }
        }
      };
    },
    async removeUserFromGroup(uid, gid) {
      calls.kicked.push({ uid, gid });
      return removeUserFromGroup ? removeUserFromGroup(uid, gid) : { errorMembers: [] };
    },
    async sendMessage(payload, gid, type) {
      calls.sent.push({ payload, gid, type });
      return {};
    }
  };
  const Threads = {
    async getData() { return { data: groupData }; },
    async setDataAndWait(_gid, next) {
      for (const key of Object.keys(groupData)) delete groupData[key];
      Object.assign(groupData, next);
    }
  };
  return { threadId, groupData, calls, api, Threads };
}

async function violate(fixture, index, content = "spamword") {
  return autokick.handleEvent({
    api: fixture.api,
    Threads: fixture.Threads,
    event: {
      threadId: fixture.threadId,
      type: ThreadType.Group,
      data: {
        uidFrom: "member-id",
        dName: "Member",
        content,
        msgId: "msg-" + index,
        cliMsgId: "cli-" + index
      }
    }
  });
}

test("autokick gives three warnings and kicks only on the fourth matching message", async () => {
  const previousUsers = global.users;
  global.users = { admin: [], support: [] };
  const fixture = makeFixture();
  try {
    for (let strike = 1; strike <= 3; strike++) {
      await violate(fixture, strike);
      assert.equal(fixture.calls.kicked.length, 0);
      assert.equal(fixture.groupData.auto_kick.violations["member-id"], strike);
      assert.match(fixture.calls.sent[strike - 1].payload.msg, new RegExp("cảnh cáo " + strike + "/3", "i"));
    }
    await violate(fixture, 4);
    assert.equal(fixture.calls.kicked.length, 1);
    assert.equal(fixture.groupData.auto_kick.violations["member-id"], undefined);
    assert.match(fixture.calls.sent[3].payload.msg, /đã kick/i);
  } finally {
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("autokick keeps the three warnings when Zalo refuses the fourth-offence kick", async () => {
  const previousUsers = global.users;
  global.users = { admin: [], support: [] };
  const fixture = makeFixture(async uid => ({ errorMembers: [uid] }));
  fixture.groupData.auto_kick.violations["member-id"] = 3;
  try {
    await violate(fixture, 4);
    assert.equal(fixture.calls.kicked.length, 1);
    assert.equal(fixture.groupData.auto_kick.violations["member-id"], 3);
    assert.match(fixture.calls.sent[0].payload.msg, /đã đủ 3 cảnh cáo/i);
  } finally {
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});


test("autokick treats regular-expression punctuation literally in banned words", async () => {
  const previousUsers = global.users;
  global.users = { admin: [], support: [] };
  const fixture = makeFixture();
  fixture.groupData.auto_kick.words = ["promo.code"];
  try {
    await violate(fixture, 1, "promoXcode");
    assert.equal(fixture.calls.sent.length, 0, "a dot in the configured word must not act as a wildcard");
    await violate(fixture, 2, "promo.code");
    assert.equal(fixture.calls.sent.length, 1, "the exact configured word should be detected");
    assert.equal(fixture.groupData.auto_kick.violations["member-id"], 1);
  } finally {
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});
