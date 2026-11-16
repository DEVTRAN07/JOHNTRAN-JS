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
  return game.start(
    "thread-1",
    "user-1",
    "Wuang",
    "https://example.com/avatar.png",
    {
      now: 1000,
      random: () => 0,
      getJson: options.getJson || mockDictionary
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
