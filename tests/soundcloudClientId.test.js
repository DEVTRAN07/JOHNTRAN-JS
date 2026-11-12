const assert = require("assert");
const soundcloud = require("../core/music/soundcloud");
const { isValidClientId, extractClientId, scriptUrlsFromHtml } = soundcloud._test;

function main() {
  const id = "0123456789abcdef0123456789abcdef";

  assert.strictEqual(isValidClientId(id), true);
  assert.strictEqual(isValidClientId("short"), false);
  assert.strictEqual(extractClientId("https://api-v2.soundcloud.com/search?client_id=" + id), id);
  assert.strictEqual(extractClientId('{"client_id":"' + id + '"}'), id);
  assert.strictEqual(extractClientId('clientId = "' + id + '"'), id);
  assert.strictEqual(extractClientId("client_id\\u0026value=" + id), id);

  const html = [
    '<script defer src="/assets/app.js"></script>',
    '<script type="module" src="https://a-v2.sndcdn.com/assets/chunk.mjs?v=4"></script>',
    '<script src="https://example.org/not-soundcloud.js"></script>'
  ].join("");
  const urls = scriptUrlsFromHtml(html);
  assert.strictEqual(urls.length, 2);
  assert.ok(urls.some((url) => url === "https://soundcloud.com/assets/app.js"));
  assert.ok(urls.some((url) => url.includes("a-v2.sndcdn.com/assets/chunk.mjs")));

  console.log("✓ SoundCloud client_id parser tests passed");
}

main();
