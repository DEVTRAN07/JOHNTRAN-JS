"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const game = require("../core/runtime/services/games/ghepchuService");

async function mockDictionary(url) {
  const request = new URL(url);
  if (request.pathname.endsWith("/suggest")) {
    return {
      data: {
        suggestions: ["trí tuệ", "học sinh", "mặt trời", "bầu trời", "máy tính"]
      }
    };
  }

  const word = request.searchParams.get("word");
  return {
    data: {
      exists: true,
      word,
      results: [{
        lang_code: "vi",
        meanings: [{
          definition: "Nghĩa tiếng Việt của " + word,
          definition_lang: "vi",
          source: "Test Dictionary"
        }]
      }]
    }
  };
}

async function startRound(options = {}) {
  const getJson = options.getJson || mockDictionary;
  if (options.preloadApi !== false) {
    await game.refreshApiWordPool({ now: 1000, random: () => 0, getJson });
  }
  return game.start(
    "thread-1",
    "user-1",
    "Wuang",
    "https://example.com/avatar.png",
    {
      now: 1000,
      random: () => 0,
      getJson
    }
  );
}

afterEach(() => {
  game.clear();
  game.clearDictionaryCache();
});

test("starts a 90-second round from Vietnamese dictionary API and shuffles initial-letter tiles", async () => {
  const result = await startRound();

  assert.equal(result.ok, true);
  assert.equal(result.session.playerName, "Wuang");
  assert.equal(result.session.puzzle.source, "api");
  assert.equal(result.session.puzzle.dictionarySource, "Test Dictionary");
  assert.equal(game.remainingSeconds(result.session, 1000), 90);
  assert.deepEqual(game.formatPuzzleLetters("trí tuệ"), ["T", "r", "í", "T", "u", "ệ"]);
  assert.ok(result.session.puzzle.letters.length > 2);
  assert.notEqual(
    result.session.puzzle.letters.join(""),
    result.session.puzzle.answer.replace(/\\s+/g, ""),
    "scrambled letters should not reveal the answer in its original order"
  );
});

test("suggest endpoint accepts phrases with multiple words and rejects single words", () => {
  const words = game.extractSuggestionWords({
    suggestions: ["trí tuệ", "học sinh", "xin", "a", "mặt trời"]
  });

  assert.deepEqual(words, ["trí tuệ", "học sinh", "mặt trời"]);
});

test("lookup endpoint requires a Vietnamese definition before adding a phrase", async () => {
  const entry = await game.lookupVietnameseWord("trí tuệ", { getJson: mockDictionary });

  assert.equal(entry.answer, "trí tuệ");
  assert.equal(entry.definition, "Nghĩa tiếng Việt của trí tuệ");
  assert.equal(entry.dictionarySource, "Test Dictionary");
  assert.equal(entry.source, "api");
});

test("accepts a correct answer, adds points and advances to another API phrase", async () => {
  const { session } = await startRound();
  const firstAnswer = session.puzzle.answer;

  const result = await game.submit("thread-1", "user-1", firstAnswer, {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });

  assert.equal(result.ok, true);
  assert.equal(result.completedAnswer, firstAnswer);
  assert.equal(session.score, 10);
  assert.equal(session.correct, 1);
  assert.equal(session.streak, 1);
  assert.equal(session.bestStreak, 1);
  assert.notEqual(session.puzzle.answer, firstAnswer);
});

test("rejects a wrong answer without awarding points", async () => {
  const { session } = await startRound();

  const result = await game.submit("thread-1", "user-1", "đáp án sai", { now: 2000 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "WRONG");
  assert.equal(session.score, 0);
  assert.equal(session.correct, 0);
  assert.equal(session.streak, 0);
});

test("skip consumes five seconds and resets the active streak", async () => {
  const { session } = await startRound();
  await game.submit("thread-1", "user-1", session.puzzle.answer, {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });

  const before = game.remainingSeconds(session, 2000);
  const result = await game.skip("thread-1", "user-1", {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "SKIPPED");
  assert.equal(session.skipped, 1);
  assert.equal(session.streak, 0);
  assert.equal(game.remainingSeconds(session, 2000), before - 5);
});

test("only the player who opened the round can submit or skip", async () => {
  await startRound();

  assert.equal((await game.submit("thread-1", "other", "trí tuệ", { now: 2000 })).code, "NOT_PLAYER");
  assert.equal((await game.skip("thread-1", "other", { now: 2000 })).code, "NOT_PLAYER");
});

test("falls back to the local phrase bank when the dictionary API is unavailable", async () => {
  const result = await startRound({
    getJson: async () => { throw new Error("dictionary unavailable"); }
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.puzzle.source, "fallback");
  assert.ok(result.session.puzzle.answer.includes(" "));
});

test("round automatically becomes finished after its deadline", async () => {
  const { session } = await startRound();

  const result = await game.submit("thread-1", "user-1", session.puzzle.answer, { now: 91001 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "TIME_UP");
  assert.equal(session.status, "finished");
  assert.equal(game.remainingSeconds(session, 91001), 0);
});



test("repeated wrong Ghép Chữ answers are notified only once in the same puzzle round", async () => {
  const command = require("../plugins/commands/noitu");
  const threadId = "ghepchu-wrong-notice-throttle";
  const started = await game.start(threadId, "gc-player", "GC Player", "", {
    getJson: async () => ({ data: { suggestions: [] } })
  });
  assert.equal(started.ok, true);
  const sent = [];
  const context = content => ({
    api: { async sendMessage(payload) { sent.push(payload); } },
    event: { threadId, type: 2, data: { uidFrom: "gc-player", content } },
    eventType: "message"
  });
  try {
    await command._test.handleGhepChuText(context("đáp án sai một"));
    await command._test.handleGhepChuText(context("đáp án sai hai"));
    await command._test.handleGhepChuText(context("đáp án sai ba"));
    assert.equal(sent.filter(item => /Chưa đúng rồi/.test(item.msg)).length, 1,
      "one puzzle round should produce at most one wrong-answer notice");
  } finally {
    game.remove(threadId);
    game.clearDictionaryCache();
  }
});

test("term lookup supports a single Vietnamese word for nt check", async () => {
  const entry = await game.lookupVietnameseTerm("xin", { getJson: mockDictionary });
  assert.equal(entry.answer, "xin");
  assert.equal(entry.definition, "Nghĩa tiếng Việt của xin");
  assert.equal(entry.dictionarySource, "Test Dictionary");
});

test("dictionary statistics clearly report only loaded cache and fallback words", () => {
  const stats = game.getDictionaryStats();
  assert.equal(stats.fallbackWords, game.FALLBACK_WORD_BANK.length);
  assert.equal(stats.apiCached, 0);
  assert.ok(stats.totalCached >= stats.fallbackWords);
  assert.equal(stats.source, "dict.minhqnd.com");
});


test("two rapid starts reserve only one Ghép Chữ session", async () => {
  const first = game.start("double-start", "user-1", "Player", "", {
    now: 1000,
    random: () => 0,
    getJson: mockDictionary
  });
  const second = await game.start("double-start", "user-2", "Other", "", {
    now: 1000,
    random: () => 0,
    getJson: mockDictionary
  });
  const started = await first;

  assert.equal(started.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "RUNNING");
  assert.equal(game.get("double-start").playerId, "user-1");
  assert.equal(game.get("double-start").status, "active");
});

test("simultaneous correct submissions award points and advance only once", async () => {
  const { session } = await startRound();
  const answer = session.puzzle.answer;

  const first = game.submit("thread-1", "user-1", answer, {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });
  const second = await game.submit("thread-1", "user-1", answer, {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });
  const accepted = await first;

  assert.equal(accepted.ok, true);
  assert.equal(second.code, "BUSY");
  assert.equal(session.score, 10);
  assert.equal(session.correct, 1);
  assert.equal(session.round, 2);
});

test("simultaneous skips consume time and advance only once", async () => {
  const { session } = await startRound();
  const first = game.skip("thread-1", "user-1", {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });
  const second = await game.skip("thread-1", "user-1", {
    now: 2000,
    random: () => 0,
    getJson: mockDictionary
  });
  const accepted = await first;

  assert.equal(accepted.ok, true);
  assert.equal(second.code, "BUSY");
  assert.equal(session.skipped, 1);
  assert.equal(session.round, 2);
});

test("new Ghép Chữ round uses fallback immediately while dictionary API is still pending", async () => {
  game.clearDictionaryCache();
  let release;
  const pendingApi = new Promise(resolve => { release = resolve; });
  const started = await game.start("fast-start", "user-1", "Player", "", {
    now: 1000,
    random: () => 0,
    getJson: () => pendingApi
  });

  assert.equal(started.ok, true);
  assert.equal(started.session.status, "active");
  assert.equal(started.session.puzzle.source, "fallback");
  release({ data: { suggestions: [] } });
  await new Promise(resolve => setImmediate(resolve));
});


test("an obsolete Ghép Chữ timer cannot replace the timer of a new round", async () => {
  const command = require("../plugins/commands/noitu");
  const threadId = "ghepchu-stale-timer";
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };
  const api = { async sendMessage() {} };
  const event = { threadId, type: 2, data: { uidFrom: "gc-player" } };
  const options = { getJson: mockDictionary, random: () => 0 };

  try {
    const first = await game.start(threadId, "gc-player", "Old Player", "", options);
    assert.equal(first.ok, true);
    command._test.scheduleGhepChuExpiry(api, event, threadId);
    const oldTimer = scheduled.at(-1);

    game.finish(threadId);
    const second = await game.start(threadId, "gc-player-2", "New Player", "", options);
    assert.equal(second.ok, true);
    command._test.scheduleGhepChuExpiry(api, { ...event, data: { uidFrom: "gc-player-2" } }, threadId);
    const newTimer = scheduled.at(-1);
    const newSession = game.get(threadId);

    await oldTimer.callback();

    assert.equal(game.get(threadId), newSession, "the new Ghép Chữ round must remain active");
    assert.equal(command._test.ghepChuTimers.get(threadId), newTimer,
      "the stale callback must not replace the new timer");
    assert.equal(newTimer.cleared, false, "the active round's timer must remain scheduled");
  } finally {
    command._test.clearGhepChuTimer(threadId);
    game.remove(threadId);
    game.clearDictionaryCache();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("Ghép Chữ answer completion is cancelled when the session is stopped during processing", async () => {
  const threadId = "ghepchu-stop-during-submit";
  const options = { getJson: mockDictionary, random: () => 0 };
  const started = await game.start(threadId, "user-1", "Player", "", options);
  const answer = started.session.puzzle.answer;

  const pending = game.submit(threadId, "user-1", answer, options);
  const stopped = game.stop(threadId, "user-1");
  assert.equal(stopped.ok, true);
  game.remove(threadId);
  const replacement = await game.start(threadId, "user-2", "Replacement", "", options);
  assert.equal(replacement.ok, true);

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANCELLED");
  assert.equal(game.get(threadId).playerId, "user-2");
});
