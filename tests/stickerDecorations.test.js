"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SOURCE,
  buildCatalog,
  createDecorationCatalog,
  safeRawUrl
} = require("../core/stickerDecorations");

function fixtureTree() {
  return [
    { type: "blob", path: "shop/anime/in_love.png" },
    { type: "blob", path: "archive/spring/apng/blossom1.png" },
    { type: "blob", path: "archive/spring/gif/blossom1.gif" },
    { type: "blob", path: "archive/halloween/ghosts.png" },
    { type: "blob", path: "etc/aprilfools/get_clowned_static.png" },
    { type: "blob", path: "etc/aprilfools/get_clowned.webp" },
    { type: "blob", path: "etc/default_old/discordred.png" },
    { type: "blob", path: "archive/spring/gif/desktop.ini" },
    { type: "tree", path: "shop/anime" }
  ];
}

test("Discord decoration catalog builds stable IDs and pairs static/animated assets", () => {
  const catalog = buildCatalog(fixtureTree(), "test-sha", 1234);
  assert.equal(catalog.sourceSha, "test-sha");
  assert.equal(catalog.total, 3);

  const shop = catalog.items.find(item => item.id === "shop-anime-in-love");
  assert.equal(shop.name, "In Love");
  assert.equal(shop.animated, false);
  assert.match(shop.staticUrl, /shop\/anime\/in_love\.png$/);
  assert.equal(shop.animatedUrl, null);

  const spring = catalog.items.find(item => item.id === "archive-spring-blossom1");
  assert.equal(spring.animated, true);
  assert.match(spring.animatedUrl, /archive\/spring\/gif\/blossom1\.gif$/);
  assert.match(spring.staticUrl, /archive\/spring\/apng\/blossom1\.png$/);

  const april = catalog.items.find(item => item.id === "etc-aprilfools-get-clowned");
  assert.match(april.staticUrl, /get_clowned_static\.png$/);
  assert.match(april.animatedUrl, /get_clowned\.webp$/);
  assert.equal(april.animated, true);
});

test("Discord decoration URLs are locked to the configured public asset repository", () => {
  assert.match(safeRawUrl("shop/anime/in_love.png"), /^https:\/\/raw\.githubusercontent\.com\/uhidontkno\/DiscordAvatarDecorations\/main\//);
  assert.equal(safeRawUrl("../secrets.png"), null);
  assert.equal(safeRawUrl("other/repo/file.png"), null);
  assert.equal(safeRawUrl("shop/anime/file.exe"), null);
  assert.equal(SOURCE.repositoryUrl, "https://github.com/uhidontkno/DiscordAvatarDecorations");
});

test("decoration catalog fetches once, persists the result, and supports filters and pagination", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-decoration-catalog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, "catalog.json");
  let requests = 0;
  const fetchImpl = async url => {
    requests += 1;
    assert.equal(url, SOURCE.treeUrl);
    return {
      ok: true,
      status: 200,
      async json() { return { sha: "catalog-sha", tree: fixtureTree() }; }
    };
  };
  const catalog = createDecorationCatalog({ fetchImpl, cacheFile, ttlMs: 1000, now: () => 2000 });
  const first = await catalog.getDecorations({ limit: 2 });
  assert.equal(requests, 1);
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.sourceSha, "catalog-sha");

  const page = await catalog.getDecorations({ query: "clowned", limit: 5 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, "etc-aprilfools-get-clowned");

  const animated = await catalog.getDecorations({ animated: true, limit: 10 });
  assert.equal(animated.total, 2);
  const selected = await catalog.getDecoration("shop-anime-in-love");
  assert.equal(selected.name, "In Love");
  assert.equal(requests, 1);
  assert.ok(fs.existsSync(cacheFile));
});

test("decoration catalog serves stale cache immediately while refreshing in background", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-decoration-stale-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, "catalog.json");
  let now = 1000;
  let requests = 0;
  let releaseRefresh;
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) {
      return { ok: true, async json() { return { sha: "old", tree: fixtureTree() }; } };
    }
    await new Promise(resolve => { releaseRefresh = resolve; });
    return { ok: true, async json() { return { sha: "new", tree: fixtureTree() }; } };
  };
  const catalog = createDecorationCatalog({ fetchImpl, cacheFile, ttlMs: 10, now: () => now });
  await catalog.getDecorations();
  now = 2000;
  const stale = await catalog.getDecorations();
  assert.equal(stale.stale, true);
  assert.equal(stale.sourceSha, "old");
  assert.equal(requests, 2);
  releaseRefresh();
  await new Promise(resolve => setImmediate(resolve));
  const fresh = await catalog.getDecorations();
  assert.equal(fresh.sourceSha, "new");
  assert.equal(fresh.stale, false);
});
