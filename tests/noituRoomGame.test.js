"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const room = require("../core/runtime/services/games/noituRoomService");

test("room creation, code join and group isolation", () => {
  const made = room.create("room-group-1", "owner", "Chủ phòng", { code: "A1B2", now: 10 });
  assert.equal(made.ok, true);
  assert.equal(made.room.status, "waiting");
  assert.equal(room.join("another-group", "A1B2", "intruder").code, "WRONG_GROUP");
  const joined = room.join("room-group-1", "A1B2", "player-2", "Người chơi 2");
  assert.equal(joined.ok, true);
  assert.equal(joined.room.players.length, 2);
  assert.equal(room.join("room-group-1", "A1B2", "player-2", "Trùng").code, "ALREADY_JOINED");
  room.finish("room-group-1");
});

test("only owner can start a room and at least two players are required", () => {
  room.create("room-group-2", "owner", "Owner", { code: "B2C3", now: 10 });
  assert.equal(room.start("room-group-2", "owner", { random: () => 0, now: 20 }).code, "NEED_TWO_PLAYERS");
  room.join("room-group-2", "B2C3", "player-2", "Player 2");
  assert.equal(room.start("room-group-2", "player-2").code, "NOT_OWNER");
  const started = room.start("room-group-2", "owner", { random: () => 0, now: 20 });
  assert.equal(started.ok, true);
  assert.equal(started.room.status, "active");
  assert.equal(started.game.players.size, 2);
  assert.equal(started.game.turnUid, "owner");
  room.finish("room-group-2");
});

test("room Nối Từ answers follow player turns and preserve scores", () => {
  room.create("room-group-3", "owner", "Owner", { code: "C3D4", now: 10 });
  room.join("room-group-3", "C3D4", "player-2", "Player 2");
  room.start("room-group-3", "owner", { random: () => 0, now: 20 });
  const first = room.play("room-group-3", "owner", "sinh viên", 21);
  assert.equal(first.ok, true);
  assert.equal(first.nextPlayer.uid, "player-2");
  const wrongTurn = room.play("room-group-3", "owner", "viên chức", 22);
  assert.equal(wrongTurn.code, "NOT_TURN");
  const second = room.play("room-group-3", "player-2", "viên chức", 23);
  assert.equal(second.ok, true);
  assert.equal(second.nextPlayer.uid, "owner");
  assert.equal(room.get("room-group-3").players.get("owner").points, 1);
  room.finish("room-group-3");
});

test("room owner can cancel and waiting-room owner can leave safely", () => {
  room.create("room-group-4", "owner", "Owner", { code: "D4E5" });
  room.join("room-group-4", "D4E5", "player-2", "Player 2");
  const left = room.leave("room-group-4", "owner");
  assert.equal(left.ok, true);
  assert.equal(room.get("room-group-4").ownerId, "player-2");
  assert.equal(room.stop("room-group-4", "player-2").ok, true);
  assert.equal(room.get("room-group-4"), null);
});
