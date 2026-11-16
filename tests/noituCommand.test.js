"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const command = require("../plugins/commands/noitu");

test("Nối Từ is reachable through the short nt alias", () => {
  assert.equal(command.config.name, "noitu");
  assert.ok(command.config.aliases.includes("nt"));
});

test("bare nt guide contains the requested game modes and utilities", () => {
  const guide = command._test.help("!");
  for (const expected of [
    "@Wuang 📖 NỐI TỪ TIẾNG VIỆT",
    "!nt go",
    "!nt q",
    "!nt gc",
    "!nt room",
    "!nt bxh",
    "!nt check",
    "!nt words",
    "!nt on / off",
    "!nt reset"
  ]) {
    assert.ok(guide.includes(expected), "guide should include: " + expected);
  }
});


const gameService = require("../core/runtime/services/games/noituService");
const noituEngine = require("../core/games/noituEngine");

test("nt go answers plain text without a prefix", async () => {
  const session = noituEngine.createSession("test-group", "player-1", "Wuang", () => 0);
  gameService.sessions.set("test-group", session);
  const sent = [];
  const consumed = await command._test.handleNoiTuText({
    api: { async sendMessage(payload) { sent.push(payload); } },
    event: {
      threadId: "test-group",
      type: 2,
      data: { uidFrom: "player-1", content: "sinh viên" }
    },
    eventType: "message",
    Users: { async getData() { return { data: {} }; }, async setData() {} }
  });
  assert.equal(consumed, true);
  assert.equal(session.moves, 1);
  assert.match(sent[0].msg, /sinh viên/);
  gameService.sessions.clear();
});

test("nt go accepts self-listen answers only when allow_self_command is enabled", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: true, prefix: "/" };
  const session = noituEngine.createSession("self-group", "bot-owner", "Wuang", () => 0);
  gameService.sessions.set("self-group", session);
  const sent = [];

  try {
    const consumed = await command._test.handleNoiTuText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: {
        threadId: "self-group",
        type: 2,
        isSelf: true,
        data: { uidFrom: "bot-owner", content: "sinh viên" }
      },
      eventType: "message",
      isSelf: true,
      Users: { async getData() { return { data: {} }; }, async setData() {} }
    });
    assert.equal(consumed, true);
    assert.equal(session.moves, 1);
    assert.match(sent[0].msg, /sinh viên/);
  } finally {
    gameService.sessions.clear();
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});


test("nt go wrong-link hint shows the final syllable of the current phrase", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  const session = noituEngine.createSession("wrong-link-group", "player-1", "Wuang", () => 0);
  gameService.sessions.set("wrong-link-group", session);
  const sent = [];
  try {
    const consumed = await command._test.handleNoiTuText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: {
        threadId: "wrong-link-group",
        type: 2,
        data: { uidFrom: "player-1", content: "bầu trời" }
      },
      eventType: "message"
    });
    assert.equal(consumed, true);
    assert.match(sent[0].msg, /sinh/);
    assert.equal(session.moves, 0);
  } finally {
    gameService.sessions.clear();
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});


test("nt go plays a bot reply after the human's plain-text answer", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  const session = command._test.createSoloBotSession("solo-ai-test", "p1", "Player", () => 0).session;
  const sent = [];
  const scores = {};
  const Users = {
    async getData(uid) { return { data: scores[uid] || {} }; },
    async setData(uid, data) { scores[uid] = data; }
  };

  try {
    const consumed = await command._test.handleNoiTuText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: {
        threadId: "solo-ai-test",
        type: 2,
        data: { uidFrom: "p1", content: "sinh viên" }
      },
      eventType: "message",
      Users
    });
    assert.equal(consumed, true);
    assert.match(sent[0].msg, /JOHNTRAN AI/);
    assert.match(sent[0].msg, /viên (chức|mãn|ngọc)/);
    assert.equal(session.moves, 2);
    assert.equal(session.turnUid, "p1");
    assert.equal(session.currentPhrase.first, "vien");
    assert.equal(scores.p1.noitu.points, 1);
    assert.equal(scores.p1.noitu.moves, 1);
  } finally {
    gameService.sessions.clear();
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("nt go awards five bonus points when the AI has no matching phrase", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  command._test.createSoloBotSession("solo-ai-win", "p1", "Player", () => 0);
  const sent = [];
  const scores = {};
  const Users = {
    async getData(uid) { return { data: scores[uid] || {} }; },
    async setData(uid, data) { scores[uid] = data; }
  };

  try {
    const consumed = await command._test.handleNoiTuText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: {
        threadId: "solo-ai-win",
        type: 2,
        data: { uidFrom: "p1", content: "sinh giới" }
      },
      eventType: "message",
      Users
    });
    assert.equal(consumed, true);
    assert.match(sent[0].msg, /BẠN ĐÃ THẮNG JOHNTRAN AI/);
    assert.equal(scores.p1.noitu.points, 6);
    assert.equal(scores.p1.noitu.botWins, 1);
    assert.equal(gameService.get("solo-ai-win"), null);
  } finally {
    gameService.sessions.clear();
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("solo AI messages from non-players are not consumed", async () => {
  const session = command._test.createSoloBotSession("solo-ai-isolation", "p1", "Player", () => 0).session;
  const consumed = await command._test.handleNoiTuText({
    api: { async sendMessage() { throw new Error("stranger message should not be answered"); } },
    event: {
      threadId: "solo-ai-isolation",
      type: 2,
      data: { uidFrom: "p2", content: "sinh viên" }
    },
    eventType: "message",
    Users: { async getData() { return { data: {} }; }, async setData() {} }
  });
  assert.equal(consumed, false);
  assert.equal(session.moves, 0);
  gameService.sessions.clear();
});


function makeNoituUsers(initial = {}) {
  const records = new Map(Object.entries(initial).map(([uid, data]) => [uid, { ...data }]));
  return {
    records,
    getAll() {
      return [...records.entries()].map(([userId, data]) => ({ userId, data }));
    },
    async getData(uid) {
      return { userId: String(uid), data: records.get(String(uid)) || {} };
    },
    async setData(uid, data) {
      records.set(String(uid), { ...data });
    }
  };
}

test("Nối Từ score updates aggregate, per-mode and monthly rankings", async () => {
  const Users = makeNoituUsers();
  await command._test.updateNoituScore(Users, "score-user", 10, { mode: "gc", move: true });
  await command._test.updateNoituScore(Users, "score-user", 2, { mode: "q" });
  await command._test.updateNoituScore(Users, "other-user", 4, { mode: "room" });

  const data = Users.records.get("score-user");
  const month = command._test.currentMonthKey();
  assert.equal(data.noitu.points, 12);
  assert.equal(data.noitu.modes.gc, 10);
  assert.equal(data.noitu.modes.q, 2);
  assert.equal(data.noitu.months[month].all, 12);
  assert.equal(data.noitu.months[month].gc, 10);

  const gc = await command._test.leaderboard(Users, "gc");
  const q = await command._test.leaderboard(Users, "q");
  const all = await command._test.leaderboard(Users, "all", month);
  assert.equal(gc[0].uid, "score-user");
  assert.equal(gc[0].points, 10);
  assert.equal(q[0].points, 2);
  assert.equal(all[0].points, 12);
});

test("Nối Từ reset by mode preserves other mode scores; all reset removes the profile", async () => {
  const Users = makeNoituUsers({
    u1: { name: "Player", noitu: { points: 16, moves: 3, modes: { gc: 10, q: 2, room: 4 }, months: { "2026-11": { gc: 10, q: 2, room: 4, all: 16 } } } },
    u2: { name: "Other", noitu: { points: 3, modes: { gc: 3 }, months: {} } }
  });

  const affected = await command._test.resetNoituScores(Users, "gc");
  assert.equal(affected, 2);
  assert.equal(Users.records.get("u1").noitu.points, 6);
  assert.equal(Users.records.get("u1").noitu.modes.gc, 0);
  assert.equal(Users.records.get("u1").noitu.modes.q, 2);
  assert.equal(Users.records.get("u1").noitu.months["2026-11"].all, 6);

  await command._test.resetNoituScores(Users, "all");
  assert.equal("noitu" in Users.records.get("u1"), false);
  assert.equal("noitu" in Users.records.get("u2"), false);
});

test("Nối Từ group toggle persists without changing the bot_enabled switch", async () => {
  const stored = { bot_enabled: true, prefix: "!" };
  const Threads = {
    getCachedData() { return { data: stored }; },
    async getData() { return { data: stored }; },
    async setDataAndWait(threadId, data) {
      assert.equal(threadId, "toggle-group");
      Object.assign(stored, data);
    }
  };

  await command._test.setNoituEnabled(Threads, "toggle-group", false);
  assert.equal(command._test.isNoituEnabled(Threads, "toggle-group"), false);
  assert.equal(stored.bot_enabled, true);
  await command._test.setNoituEnabled(Threads, "toggle-group", true);
  assert.equal(command._test.isNoituEnabled(Threads, "toggle-group"), true);
});

test("Nối Từ disabled groups do not consume active plain-text answers", async () => {
  const session = noituEngine.createSession("disabled-group", "player-1", "Wuang", () => 0);
  gameService.sessions.set("disabled-group", session);
  const result = await command._test.handleActiveGameText({
    api: { async sendMessage() { throw new Error("disabled game must not consume text"); } },
    event: {
      threadId: "disabled-group",
      type: 2,
      data: { uidFrom: "player-1", content: "sinh viên" }
    },
    eventType: "message",
    Threads: { getCachedData() { return { data: { noitu_enabled: false } }; } }
  });
  assert.equal(result, false);
  assert.equal(session.moves, 0);
  gameService.sessions.clear();
});

test("nt check uses the local dictionary fallback when the API has no entry", async () => {
  const dictionary = require("../core/runtime/services/games/ghepchuService");
  const original = dictionary.lookupVietnameseTerm;
  dictionary.lookupVietnameseTerm = async () => null;
  try {
    const entry = await command._test.checkNoituWord("học sinh");
    assert.equal(entry.answer, "học sinh");
    assert.equal(entry.source, "fallback");
    assert.match(entry.definition, /Người học tập/);
  } finally {
    dictionary.lookupVietnameseTerm = original;
  }
});

test("nt help card reflects the persisted group state", () => {
  assert.match(command._test.help("/", false), /Trạng thái: 🔴 TẮT/);
  assert.match(command._test.help("/", true), /Trạng thái: 🟢 BẬT/);
});
