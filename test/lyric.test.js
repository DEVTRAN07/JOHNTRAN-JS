const assert = require("assert");
const http = require("../core/http");
const music = require("../core/music");
const command = require("../plugins/commands/lyric");

async function main() {
  const originalGetJson = http.getJson;
  const originalSearch = music.search;
  const requested = [];
  const messages = [];
  let completed = false;

  http.getJson = async (url) => {
    requested.push(url);
    return {
      status: 200,
      data: [{ plainLyrics: "[00:01.00]First line\nSecond line" }]
    };
  };
  music.search = async (provider, query, limit) => {
    assert.strictEqual(provider, "scl");
    assert.strictEqual(query, "test song");
    assert.strictEqual(limit, 1);
    return [{ id: "track-1", title: "Test Song", artist: "Test Artist" }];
  };

  try {
    await command.run({
      args: ["test", "song"],
      event: { threadId: "test-thread", data: { uidFrom: "user-1" } },
      reply: {
        async working() {},
        async failed() {},
        async card(card) { messages.push(card); },
        async done() { completed = true; },
        async error(message) { messages.push(message); }
      }
    });
  } finally {
    http.getJson = originalGetJson;
    music.search = originalSearch;
  }

  assert.strictEqual(requested.length, 1);
  assert.ok(requested[0].startsWith("https://lrclib.net/api/search?"));
  assert.deepStrictEqual(messages[0].rows[0].lines, ["First line", "Second line"]);
  assert.strictEqual(completed, true);
  assert.strictEqual(await music.getProvider("soundcloud"), await music.getProvider("scl"));
  console.log("✓ lyric tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
