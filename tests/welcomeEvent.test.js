"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const canvas = require("../core/canvas/welcome");
const eventPlugin = require("../plugins/events/welcome");
const originalRender = canvas.renderWelcomeCard;
let rendered = [];
canvas.renderWelcomeCard = async spec => { rendered.push(spec); return "/tmp/jt-welcome-event-test.png"; };

function fixture({ enabled = true, goodbyeEnabled = true, type = "join", members } = {}) {
  const sent = [];
  const Threads = { async getData() { return { data: { event_welcome: enabled, event_goodbye: goodbyeEnabled } }; } };
  const api = {
    async getOwnId() { return "bot-id"; },
    async sendMessage(payload, threadId, threadType) { sent.push({ payload, threadId, threadType }); return true; }
  };
  const event = {
    type, threadId: "welcome-event-group",
    data: {
      groupName: "JOHNTRAN Community",
      updateMembers: members || [
        { id: "user-1", dName: "Member One", avatar: "https://example.com/member-1.jpg" },
        { id: "user-2", dName: "Member Two", avatar_25: "https://example.com/member-2.jpg" },
        { id: "bot-id", dName: "Bot" }
      ]
    }
  };
  return { sent, api, Threads, event };
}

test("join event sends one Canvas card with a colored personal tag per member", async () => {
  rendered = [];
  const f = fixture();
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].threadType, 1);
  for (const [index, name] of ["Member One", "Member Two"].entries()) {
    const payload = f.sent[index].payload;
    assert.deepEqual(payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
    assert.match(payload.msg, new RegExp("@"+name.replace(/[.*+?^${}()|[\]\\]/g, "\\test("join event sends each Canvas first and its personalized mention directly below", async () => {
  rendered = [];
  const f = fixture();
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 4);
  assert.equal(f.sent[0].threadType, 1);
  for (const index of [0, 2]) {
    assert.deepEqual(f.sent[index].payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
    assert.equal(f.sent[index].payload.msg, "");
    assert.equal(f.sent[index].payload.mentions, undefined);
  }
  for (const index of [1, 3]) {
    const tag = f.sent[index].payload;
    assert.equal(tag.attachments, undefined);
    assert.match(tag.msg, /@\. đến với nhóm/);
    assert.equal(tag.mentions.length, 1);
    const mention = tag.mentions[0];
    assert.equal(tag.msg.slice(mention.pos, mention.pos + mention.len), "@.");
  }
  assert.deepEqual([f.sent[1], f.sent[3]].map(s => s.payload.mentions[0].uid), ["user-1", "user-2"]);
  assert.deepEqual(rendered.map(x => x.member.name), ["Member One", "Member Two"]);
  assert.equal(rendered[0].member.avatarUrl, "https://example.com/member-1.jpg");
  assert.equal(rendered[1].member.avatarUrl, "https://example.com/member-2.jpg");
  assert.equal(rendered[0].groupName, "JOHNTRAN Community");
});")));
    assert.match(payload.msg, /Chào mừng/);
    assert.equal(payload.mentions, undefined,
      "the @name is painted into the Canvas footer rather than sent as a separate mention");
  }
  assert.deepEqual(rendered.map(x => x.member.name), ["Member One", "Member Two"]);
  assert.equal(rendered[0].member.avatarUrl, "https://example.com/member-1.jpg");
  assert.equal(rendered[1].member.avatarUrl, "https://example.com/member-2.jpg");
  assert.equal(rendered[0].groupName, "JOHNTRAN Community");
});

test("JOIN parsing uses avatar_25 when a truthy full-avatar field is invalid", () => {
  const members = eventPlugin._test.newMembers({ updateMembers: [
    { id: "small-only", dName: "Small avatar", avatar: "not-a-url", avatar_25: "https://example.com/small.jpg" }
  ] });
  assert.equal(members[0].avatarUrl, "https://example.com/small.jpg");
});

test("missing JOIN avatars are hydrated in one batch from Zalo group-member profiles", async () => {
  const members = eventPlugin._test.newMembers({ updateMembers: [
    { id: "u1", dName: "Event Name One", avatar: "" },
    { id: "u2", dName: "Event Name Two", avatar: "" }
  ] });
  const calls = [];
  await eventPlugin._test.hydrateMemberProfiles({
    async getGroupMembersInfo(ids) {
      calls.push(ids);
      return { profiles: {
        u1_0: { id: "u1", displayName: "Real Name One", avatar: "https://example.com/u1.jpg" },
        u2_0: { id: "u2", displayName: "Real Name Two", avatar: "https://example.com/u2.jpg" }
      }};
    }
  }, members);
  assert.deepEqual(calls, [["u1", "u2"]]);
  assert.deepEqual(members.map(member => member.avatarUrl), [
    "https://example.com/u1.jpg", "https://example.com/u2.jpg"
  ]);
  assert.deepEqual(members.map(member => member.name), ["Real Name One", "Real Name Two"]);
});

test("missing group-member avatar falls back to Zalo avatar URL endpoint", async () => {
  const members = [{ uid: "fallback-user", name: "Fallback", avatarUrl: "" }];
  await eventPlugin._test.hydrateMemberProfiles({
    async getGroupMembersInfo() { return { profiles: {} }; },
    async getAvatarUrlProfile(ids, size) {
      assert.deepEqual(ids, ["fallback-user"]);
      assert.equal(size, 240);
      return { "fallback-user_0": { avatar: "https://example.com/fallback.jpg" } };
    }
  }, members);
  assert.equal(members[0].avatarUrl, "https://example.com/fallback.jpg");
});

test("welcome event tag text includes the actual member name in the card caption", () => {
  const message = eventPlugin._test.makePersonalMessage({ uid: "user-9", name: "Member Nine" });
  assert.match(message.msg, /@Member Nine/);
  assert.equal(message.mentions, undefined);
});

test("welcome event does nothing when disabled or when event is not JOIN", async () => {
  rendered = [];
  const disabled = fixture({ enabled: false });
  await eventPlugin.run({ ...disabled, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(disabled.sent.length, 0);
  const update = fixture({ type: "update" });
  await eventPlugin.run({ ...update, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(update.sent.length, 0);
  assert.equal(rendered.length, 0);

  const legacyJoinEnabled = fixture({ type: "leave", enabled: true, goodbyeEnabled: false });
  await eventPlugin.run({ ...legacyJoinEnabled, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(legacyJoinEnabled.sent.length, 2, "legacy JOIN-on groups must automatically get OUT too");
  assert.ok(legacyJoinEnabled.sent.every(item => item.payload.attachments?.length === 1));
  assert.ok(legacyJoinEnabled.sent.every(item => /Tạm biệt @/.test(item.payload.msg)));

  const allDisabled = fixture({ type: "leave", enabled: false, goodbyeEnabled: true });
  await eventPlugin.run({ ...allDisabled, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(allDisabled.sent.length, 0, "master switch OFF disables both JOIN and OUT");
});

test("welcome event never greets the bot account as a new member", async () => {
  rendered = [];
  const f = fixture({ members: [{ id: "bot-id", dName: "Bot" }] });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 0);
  assert.equal(rendered.length, 0);
});

test.after(() => { canvas.renderWelcomeCard = originalRender; });


test("leave event sends one personalized Goodbye Canvas per departed member", async () => {
  rendered = [];
  const f = fixture({
    type: "leave",
    members: [
      { id: "former-1", dName: "Former One", avatar: "https://example.com/former-1.jpg" },
      { id: "former-2", dName: "Former Two", avatar_25: "https://example.com/former-2.jpg" },
      { id: "bot-id", dName: "Bot" }
    ]
  });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 2);
  assert.deepEqual(rendered.map(card => card.mode), ["goodbye", "goodbye"]);
  assert.deepEqual(rendered.map(card => card.member.name), ["Former One", "Former Two"]);
  assert.ok(f.sent.every(item => item.payload.attachments?.length === 1));
  assert.match(f.sent[0].payload.msg, /Tạm biệt @Former One đã rời nhóm/);
  assert.match(f.sent[1].payload.msg, /Tạm biệt @Former Two đã rời nhóm/);
  assert.ok(f.sent.every(item => item.payload.mentions === undefined));
});

test("remove-member event is treated as OUT and resolves departed user avatars through user profiles", async () => {
  rendered = [];
  const f = fixture({
    type: "remove_member",
    members: [{ id: "removed-user", dName: "Event Name", avatar: "" }]
  });
  const lookups = [];
  f.api.getUserInfo = async (ids, size) => {
    lookups.push(["getUserInfo", ids, size]);
    return { changed_profiles: {
      "removed-user_0": {
        userId: "removed-user",
        displayName: "Resolved Former Member",
        avatar: "https://example.com/removed-user.jpg"
      }
    }};
  };
  f.api.getGroupMembersInfo = async () => {
    throw new Error("Departed users should not be looked up in current group members");
  };
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
  assert.match(f.sent[0].payload.msg, /Chào mừng @Resolved Former Member/);
  assert.equal(f.sent[0].payload.mentions, undefined);
  assert.deepEqual(lookups, [["getUserInfo", ["removed-user"], 240]]);
  assert.equal(rendered[0].mode, "goodbye");
  assert.equal(rendered[0].member.name, "Resolved Former Member");
  assert.equal(rendered[0].member.avatarUrl, "https://example.com/removed-user.jpg");
});

test("JOIN and OUT event kinds are recognized independently", () => {
  assert.equal(eventPlugin._test.eventKind({ type: "join" }, "group_event", {}), "welcome");
  assert.equal(eventPlugin._test.eventKind({ type: "leave" }, "group_event", {}), "goodbye");
  assert.equal(eventPlugin._test.eventKind({ type: "remove_member" }, "group_event", {}), "goodbye");
  assert.equal(eventPlugin._test.eventKind({ type: "update" }, "group_event", {}), "");
});


test("BLOCK_MEMBER event is treated as OUT and sends a Goodbye Canvas", async () => {
  rendered = [];
  const f = fixture({
    type: "block_member",
    members: [{ id: "blocked-user", dName: "Blocked Member", avatar: "https://example.com/blocked.jpg" }]
  });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 1);
  assert.equal(rendered.length, 1);
  assert.match(f.sent[0].payload.msg, /Tạm biệt @Blocked Member đã rời nhóm/);
  assert.deepEqual(f.sent[0].payload.attachments, ["/tmp/jt-welcome-event-test.png"]);
  assert.equal(f.sent[0].payload.mentions, undefined);
  assert.equal(rendered[0].mode, "goodbye");
  assert.equal(rendered[0].member.name, "Blocked Member");
});

test("JOIN hydration stops after group-member profile already provides the avatar", async () => {
  const members = [{ uid: "fast-user", name: "Event Name", avatarUrl: "" }];
  const calls = [];
  await eventPlugin._test.hydrateMemberProfiles({
    async getGroupMembersInfo(ids) {
      calls.push(["group", ids]);
      return { profiles: {
        "fast-user_0": { id: "fast-user", displayName: "Resolved Fast User", avatar: "https://example.com/fast.jpg" }
      }};
    },
    async getUserInfo() { calls.push(["user"]); throw new Error("Must not perform redundant user lookup"); },
    async getAvatarUrlProfile() { calls.push(["avatar"]); throw new Error("Must not perform redundant avatar lookup"); }
  }, members);
  assert.deepEqual(calls, [["group", ["fast-user"]]]);
  assert.deepEqual(members[0], {
    uid: "fast-user",
    name: "Resolved Fast User",
    avatarUrl: "https://example.com/fast.jpg"
  });
});

test("OUT hydration uses avatar-only endpoint only when user profile has no avatar", async () => {
  const members = [{ uid: "former-user", name: "Former User", avatarUrl: "" }];
  const calls = [];
  await eventPlugin._test.hydrateMemberProfiles({
    async getGroupMembersInfo() { calls.push("group"); throw new Error("OUT member is not a current group member"); },
    async getUserInfo(ids, size) {
      calls.push(["user", ids, size]);
      return { changed_profiles: {
        "former-user_0": { userId: "former-user", displayName: "Former User", avatar: "" }
      }};
    },
    async getAvatarUrlProfile(ids, size) {
      calls.push(["avatar", ids, size]);
      return { "former-user_0": { avatar: "https://example.com/former-fallback.jpg" } };
    }
  }, members, { includeGroupMembers: false });
  assert.deepEqual(calls, [
    ["user", ["former-user"], 240],
    ["avatar", ["former-user"], 240]
  ]);
  assert.equal(members[0].avatarUrl, "https://example.com/former-fallback.jpg");
});


test("duplicate UIDs in one JOIN/OUT payload are merged into one member card", () => {
  const members = eventPlugin._test.newMembers({ updateMembers: [
    { id: "same-user", dName: "Same User", avatar: "" },
    { id: "same-user", dName: "Same User", avatar_25: "https://example.com/same-user.jpg" }
  ] });
  assert.equal(members.length, 1);
  assert.equal(members[0].uid, "same-user");
  assert.equal(members[0].avatarUrl, "https://example.com/same-user.jpg");
});

test("automatic event resolves real group name from getGroupInfo and caches it", async () => {
  eventPlugin._test.clearWelcomeEventCaches();
  const calls = [];
  const api = {
    async getGroupInfo(groupId) {
      calls.push(groupId);
      return { gridInfoMap: {
        [groupId]: { name: "Nhóm JOHNTRAN · IT25A" }
      }};
    }
  };
  const event = {
    threadId: "group-name-123",
    data: { groupName: "Nhóm hiện tại" }
  };
  assert.equal(await eventPlugin._test.resolveGroupName(api, event), "Nhóm JOHNTRAN · IT25A");
  assert.equal(await eventPlugin._test.resolveGroupName(api, event), "Nhóm JOHNTRAN · IT25A");
  assert.deepEqual(calls, ["group-name-123"]);
  eventPlugin._test.clearWelcomeEventCaches();
});

test("profile hydration resolves a missing member name even when the avatar is already present", async () => {
  const members = [{
    uid: "known-avatar-user",
    name: "Thành viên mới",
    avatarUrl: "https://example.com/already-have-avatar.jpg"
  }];
  const calls = [];
  await eventPlugin._test.hydrateMemberProfiles({
    async getGroupMembersInfo(ids) {
      calls.push(ids);
      return { profiles: {
        "known-avatar-user_0": {
          id: "known-avatar-user",
          displayName: "Real Zalo Display Name",
          avatar: ""
        }
      }};
    },
    async getUserInfo() {
      throw new Error("A resolved name and existing avatar must not trigger another lookup");
    }
  }, members);
  assert.deepEqual(calls, [["known-avatar-user"]]);
  assert.equal(members[0].name, "Real Zalo Display Name");
  assert.equal(members[0].avatarUrl, "https://example.com/already-have-avatar.jpg");
});

test("replayed WebSocket JOIN event is sent only once", async () => {
  eventPlugin._test.clearWelcomeEventCaches();
  rendered = [];
  const f = fixture({
    members: [{ id: "replayed-user", dName: "Replayed User", avatar: "https://example.com/replayed.jpg" }]
  });
  f.event.data.time = "1795059000000";
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  await eventPlugin.run({ ...f, isSelf: false, threadType: 1, eventType: "group_event" });
  assert.equal(f.sent.length, 1);
  assert.equal(rendered.length, 1);
  eventPlugin._test.clearWelcomeEventCaches();
});
