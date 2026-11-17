"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sendGameGuideOnce } = require("../core/games/gameGuideDelivery");

function memoryUsers() {
  const rows = new Map();
  return {
    rows,
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); }
  };
}

test("game guide is sent and persisted only once per user and game", async () => {
  const Users = memoryUsers();
  let sends = 0;
  const args = {
    Users, uid: "guide-player-1", gameKey: "tlmn",
    send: async () => ({ msgId: ++sends })
  };
  const first = await sendGameGuideOnce(args);
  const second = await sendGameGuideOnce(args);

  assert.deepEqual(first, { ok: true, sent: true, persisted: true });
  assert.equal(second.sent, false);
  assert.equal(second.alreadySent, true);
  assert.equal(sends, 1);
  assert.equal(Users.rows.get("guide-player-1").gameGuides.tlmn, true);
});

test("a failed private guide send is not marked delivered and can be retried", async () => {
  const Users = memoryUsers();
  let sends = 0;
  const failed = await sendGameGuideOnce({
    Users, uid: "guide-player-2", gameKey: "sam",
    send: async () => { sends += 1; return null; }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "SEND_FAILED");
  assert.equal(Users.rows.has("guide-player-2"), false);

  const retried = await sendGameGuideOnce({
    Users, uid: "guide-player-2", gameKey: "sam",
    send: async () => { sends += 1; return { msgId: "ok" }; }
  });
  assert.equal(retried.sent, true);
  assert.equal(sends, 2);
});

test("concurrent guide requests for the same user collapse into one send", async () => {
  const Users = memoryUsers();
  let sends = 0;
  let release;
  let started;
  const hasStarted = new Promise(resolve => { started = resolve; });
  const send = () => new Promise(resolve => {
    sends += 1;
    release = resolve;
    started();
  });
  const args = { Users, uid: "guide-player-3", gameKey: "tlmn", send };
  const first = sendGameGuideOnce(args);
  await hasStarted;
  const second = sendGameGuideOnce(args);
  release({ msgId: "single" });
  const [a, b] = await Promise.all([first, second]);

  assert.equal(sends, 1);
  assert.equal(a.sent, true);
  assert.equal(b.sent, true);
  assert.equal(Users.rows.get("guide-player-3").gameGuides.tlmn, true);
});
