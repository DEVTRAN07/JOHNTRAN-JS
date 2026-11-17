"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const sam = require("../core/runtime/services/games/samService");
const tlmn = require("../core/runtime/services/games/tlmnService");

test("Sâm start countdown locks the room, persists its deadline and can be restored", () => {
  const threadId = "test-sam-start-countdown";
  const created = sam.create(threadId, { uid: "sam-host", name: "Sâm host" }, {
    id: "73141", stake: 100
  });
  assert.equal(created.ok, true);
  const joined = sam.joinWaiting(threadId, { uid: "sam-guest", name: "Sâm guest" });
  assert.equal(joined.ok, true);

  const room = created.state;
  room.startCountdownAt = Date.now() + 10_000;
  room.startCountdownBy = "sam-host";
  room.startCountdownMessage = { msgId: "101", cliMsgId: "201" };

  assert.equal(sam.joinWaiting(threadId, { uid: "sam-late", name: "Late" }).code, "STARTING");
  assert.equal(sam.start(threadId, "sam-host").code, "STARTING");

  const saved = sam.serialize(room);
  sam.removeRoom(threadId);
  const restored = sam.restore(saved);
  assert.ok(restored);
  assert.equal(restored.startCountdownAt, room.startCountdownAt);
  assert.deepEqual(restored.startCountdownMessage, { msgId: "101", cliMsgId: "201" });

  sam.removeRoom(threadId);
});

test("Tiến Lên start countdown locks join, bet changes and direct start", () => {
  const threadId = "test-tlmn-start-countdown";
  const created = tlmn.create(threadId, { uid: "tlmn-host", name: "TLMN host" }, {
    code: "73142", bet: 1000
  });
  assert.equal(created.ok, true);
  const joined = tlmn.join(threadId, created.state.id, {
    uid: "tlmn-guest", name: "TLMN guest"
  });
  assert.equal(joined.ok, true);

  const room = created.state;
  room.startCountdownAt = Date.now() + 10_000;
  room.startCountdownBy = "tlmn-host";
  room.startCountdownMessage = { msgId: "102", cliMsgId: "202" };

  assert.equal(tlmn.join(threadId, room.id, {
    uid: "tlmn-late", name: "Late"
  }).code, "STARTING");
  assert.equal(tlmn.updateBet(threadId, "tlmn-host", 2000).code, "ALREADY_STARTED");
  assert.equal(tlmn.start(threadId, "tlmn-host").code, "STARTING");

  const saved = tlmn.serialize(room);
  tlmn.removeRoom(threadId);
  const restored = tlmn.restore(saved);
  assert.ok(restored);
  assert.equal(restored.startCountdownAt, room.startCountdownAt);
  assert.deepEqual(restored.startCountdownMessage, { msgId: "102", cliMsgId: "202" });

  tlmn.removeRoom(threadId);
});
