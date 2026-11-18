"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const command = require("../plugins/commands/getvd");

test("/vd 18+ is detected without changing normal /vd reply behavior", () => {
  assert.equal(command._test.isAdultVideoRequest(["18+"]), true);
  assert.equal(command._test.isAdultVideoRequest(["18+", "anime"]), true);
  assert.equal(command._test.isAdultVideoRequest([]), false);
  assert.equal(command._test.isAdultVideoRequest(["random"]), false);
});

test("/vd 18+ without a search term uses the external random endpoint", () => {
  const url = new URL(command._test.buildAdultVideoApiUrl(["18+"]));
  assert.equal(url.origin, "https://adultembed.com");
  assert.equal(url.pathname, "/api/v1/videos/random");
  assert.equal(url.searchParams.get("count"), "1");
});

test("/vd 18+ keyword searches the external catalogue with bounded results", () => {
  const url = new URL(command._test.buildAdultVideoApiUrl(["18+", "romance", "couple"]));
  assert.equal(url.pathname, "/api/v1/search");
  assert.equal(url.searchParams.get("query"), "romance couple");
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("sort"), "popular");
  assert.equal(url.searchParams.get("quality"), "complete");
});

test("/vd 18+ normalizes catalogue results and ignores invalid IDs", () => {
  const rows = command._test.normalizeAdultVideoResults({
    results: [{ id: 123, title: "Scene" }, { id: "bad" }, { title: "No ID" }]
  });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].id), 123);
});

test("/vd 18+ formats player links instead of downloading or rehosting video files", () => {
  const message = command._test.formatAdultVideoResults([
    { id: 123, title: "Sample scene", duration: "00:12:34", studio: { name: "Studio" } }
  ], "romance");
  assert.match(message, /TÌM VIDEO 18\+/);
  assert.match(message, /Sample scene/);
  assert.match(message, /00:12:34/);
  assert.match(message, /https:\/\/adultembed\.com\/player\/embed\/123\//);
  assert.match(message, /chỉ dành cho người từ đủ 18 tuổi/i);
  assert.doesNotMatch(message, /attachments/);
});

test("/vd 18+ is available in groups only to configured bot admins", () => {
  const previousConfig = global.config;
  const previousUsers = global.users;
  global.config = { ...(previousConfig || {}), admin_bot: ["owner-uid"] };
  global.users = previousUsers || {};

  try {
    const adminAccess = command._test.resolveAdultVideoAccess({
      type: ThreadType.Group,
      data: { uidFrom: "owner-uid" }
    });
    const memberAccess = command._test.resolveAdultVideoAccess({
      type: ThreadType.Group,
      data: { uidFrom: "member-uid" }
    });

    assert.deepEqual(adminAccess, { allowed: true, audience: "group" });
    assert.equal(memberAccess.allowed, false);
    assert.match(memberAccess.message, /chỉ admin bot/i);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("/vd 18+ retains private-chat support and rejects unknown thread types", () => {
  const privateAccess = command._test.resolveAdultVideoAccess({
    type: ThreadType.User,
    data: { uidFrom: "regular-user" }
  });
  const unknownAccess = command._test.resolveAdultVideoAccess({
    type: 99,
    data: { uidFrom: "regular-user" }
  });

  assert.deepEqual(privateAccess, { allowed: true, audience: "private" });
  assert.equal(unknownAccess.allowed, false);
});
