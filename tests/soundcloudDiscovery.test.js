"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const soundcloud = require("../core/music/soundcloud");

const clientId = "0123456789abcdef0123456789abcdef";
const olderClientId = "abcdef0123456789abcdef0123456789";

test("SoundCloud resolves only the preferred two HLS variants", () => {
  const candidates = [
    { item: { preset: "aac_320" }, protocol: "hls" },
    { item: { preset: "aac_160" }, protocol: "hls" },
    { item: { preset: "aac_96" }, protocol: "hls" },
    { item: { preset: "progressive" }, protocol: "progressive" }
  ];
  const selected = soundcloud._test.selectResolveCandidates(candidates);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(item => item.item.preset), ["aac_320", "aac_160"]);
});

test("SoundCloud bundle parser prioritizes the latest sndcdn asset", () => {
  const urls = soundcloud._test.scriptUrlsFromHtml(`
    <script src="https://a-v2.sndcdn.com/assets/old-app.js"></script>
    <script src="https://a-v2.sndcdn.com/assets/new-app.js"></script>
    <script src="https://example.com/untrusted.js"></script>
  `);

  assert.deepEqual(urls, [
    "https://a-v2.sndcdn.com/assets/new-app.js",
    "https://a-v2.sndcdn.com/assets/old-app.js"
  ]);
});

test("SoundCloud parser accepts the client_id marker used in current bundles", () => {
  assert.equal(
    soundcloud._test.extractClientId(`window.config={client_id:"${clientId}"}`),
    clientId
  );
});

test("SoundCloud bundle discovery scans recent bundles in priority order", async () => {
  const urls = [
    "https://a-v2.sndcdn.com/assets/new-app.js",
    "https://a-v2.sndcdn.com/assets/old-app.js"
  ];
  const requests = [];
  const found = await soundcloud._test.discoverClientIdFromScripts(urls, async (url, options) => {
    requests.push({ url, range: options.headers.Range });
    return {
      data: url.includes("new-app.js")
        ? `window.config={client_id:"${clientId}"}`
        : `window.config={client_id:"${olderClientId}"}`
    };
  });

  assert.equal(found, clientId);
  assert.deepEqual(requests.map(item => item.url), urls);
  assert.ok(requests.every(item => item.range === "bytes=0-50000"));
});

test("SoundCloud bundle discovery returns null when no bundle exposes a client ID", async () => {
  const found = await soundcloud._test.discoverClientIdFromScripts([
    "https://a-v2.sndcdn.com/assets/empty.js"
  ], async () => ({ data: "window.config={version:'test'};" }));

  assert.equal(found, null);
});
