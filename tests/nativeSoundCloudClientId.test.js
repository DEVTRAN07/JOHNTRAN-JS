"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const soundcloud = require("../core/music/soundcloud");
const native = require("../native");

const { extractClientIdFallback, extractClientIdFromSources } = soundcloud._test;

const IDS = {
  a: "0123456789abcdef0123456789abcdef",
  b: "abcdef0123456789abcdef0123456789",
  c: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  d: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  e: "cccccccccccccccccccccccccccccccc",
  f: "dddddddddddddddddddddddddddddddd",
  g: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  h: "ffffffffffffffffffffffffffffffff"
};

const fixtures = [
  {
    name: "query parameter takes priority over an earlier assignment",
    sources: [{
      script: "client_id = '" + IDS.b + "' later ?client_id=" + IDS.a,
      url: "https://cdn.example/script.js"
    }]
  },
  {
    name: "bundle body is checked before its URL",
    sources: [{
      script: "window.clientId = '" + IDS.b + "'",
      url: "https://cdn.example/script.js?client_id=" + IDS.a
    }]
  },
  {
    name: "script URL is checked before moving to the next bundle",
    sources: [
      { script: "window.client = true", url: "https://cdn.example/one.js?client_id=" + IDS.a },
      { script: "client_id='" + IDS.b + "'", url: "https://cdn.example/two.js" }
    ]
  },
  {
    name: "case-insensitive query key",
    sources: [{ script: "https://api.soundcloud.com/search?CLIENT_ID=" + IDS.c, url: "" }]
  },
  {
    name: "escaped ampersand and equals",
    sources: [{ script: "x=1\\u0026client_id\\x3d" + IDS.d, url: "" }]
  },
  {
    name: "HTML entity separator",
    sources: [{ script: "x=1&amp;client_id=" + IDS.e, url: "" }]
  },
  {
    name: "quoted JSON object key",
    sources: [{ script: '{"client_id":"' + IDS.f + '"}', url: "" }]
  },
  {
    name: "percent-encoded equals",
    sources: [{ script: "client_id%3d" + IDS.g, url: "" }]
  },
  {
    name: "quoted JSON keys with legacy independent quote marks",
    sources: [{ script: "'client_id\":\"" + IDS.h + "'", url: "" }]
  },
  {
    name: "invalid and short values are ignored",
    sources: [{ script: "client_id=short clientId='bad-value'", url: "" }]
  }
];

function javascriptBatch(sources) {
  for (const source of sources) {
    const fromScript = source.script
      ? extractClientIdFallback(source.script)
      : null;
    if (fromScript) return fromScript;
    const fromUrl = extractClientIdFallback(source.url);
    if (fromUrl) return fromUrl;
  }
  return null;
}

test("Rust SoundCloud script attribute scanner matches the JavaScript regex fallback", t => {
  if (!native.getSoundCloudParserDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }

  const html = [
    '<script defer src="/assets/app.js"></script>',
    '<script type="module" src="https://a-v2.sndcdn.com/assets/chunk.mjs?v=4"></script>',
    '<link data-src="/assets/deferred.js">',
    '<link href="/assets/player.js">',
    '<script src="https://example.org/not-soundcloud.js"></script>',
    '<script async\n src="https://sndcdn.com/assets/escaped.js?x=1&amp;y=2"></script>',
    '<script src="https:\\/\\/sndcdn.com\\/assets\\/backslash.js"></script>'
  ].join("");

  const expectedAttributes = soundcloud._test.extractScriptAttributesFallback(html);
  const nativeAttributes = native.trySoundCloudExtractScriptAttributes(html);
  assert.equal(nativeAttributes.used, true, "Rust script attribute API was not used");
  assert.deepEqual(nativeAttributes.value, expectedAttributes);

  const previous = process.env.JT_RUST_SOUNDCLOUD_PARSER;
  try {
    process.env.JT_RUST_SOUNDCLOUD_PARSER = "0";
    const fallbackUrls = soundcloud._test.scriptUrlsFromHtml(html);
    process.env.JT_RUST_SOUNDCLOUD_PARSER = "1";
    const rustUrls = soundcloud._test.scriptUrlsFromHtml(html);
    assert.deepEqual(rustUrls, fallbackUrls);
    assert.equal(rustUrls.length, 6,
      "relative URLs and SoundCloud CDN assets are retained while external hosts are rejected");
    assert.ok(rustUrls.some(url => url.includes("chunk.mjs?v=4")));
    assert.ok(rustUrls.some(url => url.includes("deferred.js")));
    assert.ok(rustUrls.some(url => url.includes("player.js")));
    assert.ok(rustUrls.some(url => url.includes("escaped.js?x=1&y=2")));
    assert.ok(rustUrls.some(url => url.includes("backslash.js")));
    assert.ok(rustUrls.every(url => !url.includes("example.org")));
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_SOUNDCLOUD_PARSER;
    else process.env.JT_RUST_SOUNDCLOUD_PARSER = previous;
  }
});

test("Rust SoundCloud client_id parser is active in the built native addon", t => {
  const diagnostics = native.getSoundCloudParserDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "SoundCloud Rust parser is inactive");
  assert.ok(diagnostics.exports.includes("soundcloudExtractClientId"));
});

test("Rust SoundCloud batch parser matches the exact JavaScript search order and extraction patterns", t => {
  if (!native.getSoundCloudParserDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  for (const fixture of fixtures) {
    const expected = javascriptBatch(fixture.sources);
    const result = native.trySoundCloudExtractClientId(fixture.sources);
    assert.equal(result.used, true, fixture.name + ": Rust N-API call was not used");
    assert.equal(result.value, expected, fixture.name);
  }
});

test("SoundCloud adapter keeps JS fallback and uses the Rust batch parser when enabled", t => {
  if (!native.getSoundCloudParserDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_SOUNDCLOUD_PARSER;
  try {
    process.env.JT_RUST_SOUNDCLOUD_PARSER = "0";
    const fallback = fixtures.map(fixture =>
      extractClientIdFromSources(fixture.sources)
    );
    process.env.JT_RUST_SOUNDCLOUD_PARSER = "1";
    const rust = fixtures.map(fixture =>
      extractClientIdFromSources(fixture.sources)
    );
    assert.deepEqual(rust, fallback);
    assert.equal(rust[0], IDS.a);
    assert.equal(rust[1], IDS.b);
    assert.equal(rust[2], IDS.a);
    assert.equal(rust[3], IDS.c);
    assert.equal(rust[4], IDS.d);
    assert.equal(rust[5], IDS.e);
    assert.equal(rust[6], IDS.f);
    assert.equal(rust[7], IDS.g);
    assert.equal(rust[8], IDS.h);
    assert.equal(rust[9], null);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_SOUNDCLOUD_PARSER;
    else process.env.JT_RUST_SOUNDCLOUD_PARSER = previous;
  }
});
