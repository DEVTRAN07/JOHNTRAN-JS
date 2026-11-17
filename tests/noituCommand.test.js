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
    "📖 NỐI TỪ TIẾNG VIỆT",
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


const noituBotAI = require("../core/games/noituBotAI");
const { Reactions } = require("zalo-client");

test("Solo Nối Từ has curated meanings for the opening phrase and AI reply bank", () => {
  assert.match(noituBotAI.getCuratedMeaning("từ chức").definition, /Rời bỏ chức vụ/);
  assert.match(noituBotAI.getCuratedMeaning("sinh viên").definition, /đại học/);
  assert.equal(noituBotAI.getCuratedMeaning("sinh blabla"), null);
});

test("Solo answer without a dictionary meaning is rejected and counts as one mistake", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  const threadId = "solo-meaning-required";
  const session = command._test.createSoloBotSession(threadId, "meaning-player", "Meaning Player", () => 0).session;
  gameService.sessions.set(threadId, session);
  session.soloTurnEndsAt = Date.now() + 60000;
  const original = noituBotAI.getPhraseMeaning;
  noituBotAI.getPhraseMeaning = async () => null;
  const sent = [];
  try {
    const consumed = await command._test.handleSoloBotText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId, type: 2, data: { uidFrom: "meaning-player", content: "sinh blabla" } },
      Users: { async getData() { return { data: {} }; }, async setData() {} },
      session
    });
    assert.equal(consumed, true);
    assert.equal(session.moves, 0);
    assert.equal(session.soloWrongAttempts, 1);
    assert.match(sent[0].msg, /Không tìm thấy ý nghĩa hợp lệ/);
  } finally {
    noituBotAI.getPhraseMeaning = original;
    command._test.stopNoituGames(threadId);
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("third Solo mistake ends the game and tags the player with a real mention", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  const threadId = "solo-three-strikes";
  const session = command._test.createSoloBotSession(threadId, "strike-player", "Strike Player", () => 0).session;
  gameService.sessions.set(threadId, session);
  session.soloTurnEndsAt = Date.now() + 60000;
  session.soloWrongAttempts = 2;
  const sent = [];
  const original = noituBotAI.getPhraseMeaning;
  noituBotAI.getPhraseMeaning = async () => null;
  try {
    await command._test.handleSoloBotText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId, type: 2, data: { uidFrom: "strike-player", content: "sinh blabla" } },
      session
    });
    assert.equal(gameService.get(threadId), null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].msg, /đã thua ván Nối Từ Solo/i);
    assert.deepEqual(sent[0].mentions, [{ pos: 0, uid: "strike-player", len: "@Strike Player".length }]);
  } finally {
    noituBotAI.getPhraseMeaning = original;
    command._test.stopNoituGames(threadId);
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("Solo timeout applies zero-star penalty and tags the actual player uid", async () => {
  const threadId = "solo-timeout-test";
  const session = command._test.createSoloBotSession(threadId, "timeout-player", "Timeout Player", () => 0).session;
  gameService.sessions.set(threadId, session);
  session.threadType = 2;
  const undoCalls = [];
  const sent = [];
  session.lastBotResponse = { message: { msgId: "prompt-1", cliMsgId: "client-1" } };
  const api = {
    async undo(payload, tid, type) { undoCalls.push({ payload, tid, type }); },
    async sendMessage(payload) { sent.push(payload); }
  };
  try {
    assert.equal(await command._test.finishSoloTimeout(api, {
      threadId, type: 2, data: { uidFrom: "timeout-player", dName: "Timeout Player" }
    }, session), true);
    assert.equal(gameService.get(threadId), null);
    assert.equal(undoCalls.length, 1);
    assert.match(sent[0].msg, /Hết giờ/);
    assert.match(sent[0].msg, /-0⭐/);
    assert.deepEqual(sent[0].mentions, [{ pos: 0, uid: "timeout-player", len: "@Timeout Player".length }]);
  } finally {
    command._test.stopNoituGames(threadId);
  }
});

test("Solo prompt replacement recalls the previous bot message and timer reaction uses Zalo message ids", async () => {
  const threadId = "solo-recall-reaction";
  const session = command._test.createSoloBotSession(threadId, "recall-player", "Recall Player", () => 0).session;
  gameService.sessions.set(threadId, session);
  session.threadType = 2;
  session.lastBotResponse = { message: { msgId: "old-msg", cliMsgId: "old-client" } };
  const undoCalls = [];
  const reactionCalls = [];
  const api = {
    async undo(payload, tid, type) { undoCalls.push({ payload, tid, type }); },
    async addReaction(icon, destination) { reactionCalls.push({ icon, destination }); }
  };
  try {
    assert.equal(await command._test.recallSoloLastPrompt(api, session), true);
    assert.equal(undoCalls[0].payload.msgId, "old-msg");
    session.lastBotResponse = { message: { msgId: "new-msg", cliMsgId: "new-client" } };
    assert.equal(await command._test.addSoloPromptReaction(api, { type: 2 }, session, Reactions.SLEEPY), true);
    assert.equal(reactionCalls[0].icon, Reactions.SLEEPY);
    assert.deepEqual(reactionCalls[0].destination, {
      data: { msgId: "new-msg", cliMsgId: "new-client" },
      threadId,
      type: 2
    });
  } finally {
    command._test.stopNoituGames(threadId);
  }
});

test("Solo timer starts with a sixty-second turn and uses the prompt message", () => {
  const threadId = "solo-schedule-timer";
  const session = command._test.createSoloBotSession(threadId, "timer-player", "Timer Player", () => 0).session;
  gameService.sessions.set(threadId, session);
  session.lastBotResponse = { message: { msgId: "timer-msg", cliMsgId: "timer-client" } };
  try {
    command._test.scheduleSoloTurn({ addReaction() {} }, {
      threadId, type: 2, data: { uidFrom: "timer-player" }
    }, session);
    assert.equal(session.soloTurnEndsAt - session.soloTurnStartedAt, 60000);
  } finally {
    command._test.stopNoituGames(threadId);
  }
});

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


test("nt go limits malformed-answer hints to once per solo session", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: false, prefix: "/" };
  const session = command._test.createSoloBotSession("solo-invalid-hint", "p1", "Player", () => 0).session;
  const sent = [];
  const context = content => ({
    api: { async sendMessage(payload) { sent.push(payload); } },
    event: {
      threadId: "solo-invalid-hint",
      type: 1,
      data: { uidFrom: "p1", content }
    },
    eventType: "message"
  });

  try {
    assert.equal(await command._test.handleNoiTuText(context("hello")), true);
    assert.equal(await command._test.handleNoiTuText(context("hi")), true);
    assert.equal(sent.length, 1, "repeated malformed text in one turn must not spam the hint");
    assert.match(sent[0].msg, /2–4 tiếng/);

    session.moves += 1;
    assert.equal(await command._test.handleNoiTuText(context("again")), true);
    assert.equal(await command._test.handleNoiTuText(context("still chatting")), true);
    assert.equal(
      sent.filter(item => item.msg.includes("Hãy trả lời bằng một cụm từ tiếng Việt gồm 2–4 tiếng")).length,
      1,
      "the format reminder must not repeat on later turns in the same solo session"
    );
  } finally {
    gameService.sessions.delete("solo-invalid-hint");
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});


test("Nối Từ help advertises Solo and Classic score controls", () => {
  const guide = command._test.help("/");
  assert.match(guide, /nt classic/);
  assert.match(guide, /bxh \[solo \| classic/);
  assert.match(guide, /reset \[solo \| classic/);
});

test("Solo scores appear in their own leaderboard", async () => {
  const Users = makeNoituUsers({
    solo: { name: "Solo Player", noitu: { points: 8, botWins: 1, modes: { solo: 8 }, months: {} } },
    other: { name: "Other", noitu: { points: 4, modes: { gc: 4 }, months: {} } }
  });
  const sent = [];
  const previousConfig = global.config;
  global.config = { prefix: "/" };
  try {
    await command.run({
      args: ["bxh", "solo"],
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId: "solo-rank-command", type: 2, data: { uidFrom: "viewer" } },
      Users,
      Threads: { getCachedData() { return { data: { noitu_enabled: true } }; } }
    });
    assert.match(sent[0].msg, /BẢNG XẾP HẠNG NỐI TỪ SOLO/);
    assert.match(sent[0].msg, /Solo Player — 8 điểm/);
    assert.doesNotMatch(sent[0].msg, /Other — 4 điểm/);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("reset Solo clears its points and AI wins while preserving other modes", async () => {
  const Users = makeNoituUsers({
    player: {
      name: "Player",
      noitu: {
        points: 15,
        botWins: 2,
        moves: 7,
        modes: { solo: 8, gc: 7 },
        months: { "2026-11": { solo: 8, gc: 7, all: 15 } }
      }
    }
  });
  const previousConfig = global.config;
  const previousUsers = global.users;
  global.config = { prefix: "/" };
  global.users = { admin: ["admin"], support: [] };
  const sent = [];
  try {
    await command.run({
      args: ["reset", "solo"],
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId: "solo-reset-command", type: 2, data: { uidFrom: "admin" } },
      Users,
      Threads: { getCachedData() { return { data: { noitu_enabled: true } }; } }
    });
    const profile = Users.records.get("player").noitu;
    assert.equal(profile.points, 7);
    assert.equal(profile.modes.solo, 0);
    assert.equal(profile.modes.gc, 7);
    assert.equal(profile.botWins, 0);
    assert.equal(profile.moves, 7);
    assert.equal(profile.months["2026-11"].all, 7);
    assert.match(sent[0].msg, /SOLO/);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
  if (previousUsers === undefined) delete global.users;
  else global.users = previousUsers;
});

test("nt start without a waiting PvP room does not create a classic game implicitly", async () => {
  const sent = [];
  const threadId = "start-without-room";
  const previousConfig = global.config;
  global.config = { prefix: "/" };
  try {
    await command.run({
      args: ["start"],
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId, type: 2, data: { uidFrom: "player-1" } },
      Threads: { getCachedData() { return { data: { noitu_enabled: true } }; } }
    });
    assert.match(sent[0].msg, /nt room/);
    assert.equal(gameService.get(threadId), null);
  } finally {
    gameService.sessions.delete(threadId);
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("nt classic remains available as the explicit legacy turn-based mode", async () => {
  const sent = [];
  const threadId = "classic-start-command";
  const previousConfig = global.config;
  global.config = { prefix: "/" };
  try {
    await command.run({
      args: ["classic"],
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: { threadId, type: 2, data: { uidFrom: "player-1", dName: "Player" } },
      Threads: { getCachedData() { return { data: { noitu_enabled: true } }; } }
    });
    assert.ok(gameService.get(threadId));
    assert.match(sent[0].msg, /ĐÃ BẮT ĐẦU GAME NỐI TỪ/);
  } finally {
    gameService.stop(threadId);
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});
