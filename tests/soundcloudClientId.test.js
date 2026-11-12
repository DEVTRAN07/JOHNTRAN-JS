const assert = require("assert");
const soundcloud = require("../core/music/soundcloud");
const { isValidClientId, extractClientId, scriptUrlsFromHtml, pickTranscoding, extractResolvedStreamUrl } = soundcloud._test;

function main() {
  const id = "0123456789abcdef0123456789abcdef";

  assert.strictEqual(isValidClientId(id), true);
  assert.strictEqual(isValidClientId("short"), false);
  assert.strictEqual(extractClientId("https://api-v2.soundcloud.com/search?client_id=" + id), id);
  assert.strictEqual(extractClientId('{"client_id":"' + id + '"}'), id);
  assert.strictEqual(extractClientId('clientId = "' + id + '"'), id);

  const html = [
    '<script defer src="/assets/app.js"></script>',
    '<script type="module" src="https://a-v2.sndcdn.com/assets/chunk.mjs?v=4"></script>',
    '<script src="https://example.org/not-soundcloud.js"></script>'
  ].join("");
  const urls = scriptUrlsFromHtml(html);
  assert.strictEqual(urls.length, 2);
  assert.ok(urls.some((url) => url === "https://soundcloud.com/assets/app.js"));
  assert.ok(urls.some((url) => url.includes("a-v2.sndcdn.com/assets/chunk.mjs")));


  const redirectUrl = "https://cf-hls-media.sndcdn.com/playlist/test/playlist.m3u8?token=abc";
  assert.strictEqual(
    extractResolvedStreamUrl({ status: 302, headers: { location: redirectUrl }, data: "" }, "https://api-v2.soundcloud.com/media/test"),
    redirectUrl
  );
  assert.strictEqual(
    extractResolvedStreamUrl({ status: 200, headers: { "content-type": "application/json" }, data: { url: redirectUrl } }, "https://api-v2.soundcloud.com/media/test"),
    redirectUrl
  );
  assert.strictEqual(
    extractResolvedStreamUrl({ status: 200, headers: { "content-type": "application/json" }, data: { data: { url: redirectUrl } } }, "https://api-v2.soundcloud.com/media/test"),
    redirectUrl
  );

  const picked = pickTranscoding([
    { url: "https://api-v2.soundcloud.com/old-progressive", format: { protocol: "progressive", mime_type: "audio/mpeg" } },
    { url: "https://api-v2.soundcloud.com/hls_aac_160", preset: "aac_160", format: { protocol: "hls", mime_type: "audio/aac" } },
    { url: "https://api-v2.soundcloud.com/hls_aac_96", preset: "aac_96", format: { protocol: "hls", mime_type: "audio/aac" } }
  ]);
  assert.strictEqual(picked.protocol, "hls");
  assert.strictEqual(picked.item.preset, "aac_160");

  console.log("✓ SoundCloud client_id parser tests passed");
}

main();
