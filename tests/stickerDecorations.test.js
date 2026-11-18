"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SOURCE,
  readManifest,
  createDecorationCatalog
} = require("../core/stickerDecorations");

function fixtureManifest() {
  return {
    version: 2,
    sourceCommit: "a".repeat(40),
    generatedAt: "2026-11-18T00:00:00.000Z",
    source: SOURCE.repositoryUrl,
    total: 3,
    items: [
      {
        id: "shop-anime-in-love", name: "In Love", category: "shop", collection: "anime",
        animated: false, staticAvailable: true, staticUrl: "https://cdn.jsdelivr.net/sample/in-love.png",
        staticFallbackUrl: "https://raw.githubusercontent.com/sample/in-love.png",
        animatedUrl: null, animatedFallbackUrl: null, sourcePath: "shop/anime/in_love.png"
      },
      {
        id: "archive-spring-blossom1", name: "Blossom1", category: "archive", collection: "spring",
        animated: true, staticAvailable: false,
        staticUrl: "https://cdn.jsdelivr.net/sample/blossom1.png",
        staticFallbackUrl: "https://raw.githubusercontent.com/sample/blossom1.png",
        animatedUrl: "https://cdn.jsdelivr.net/sample/blossom1.gif",
        animatedFallbackUrl: "https://raw.githubusercontent.com/sample/blossom1.gif",
        sourcePath: "archive/spring/apng/blossom1.png"
      },
      {
        id: "etc-aprilfools-get-clowned", name: "Get Clowned", category: "etc", collection: "aprilfools2024",
        animated: true, staticAvailable: true,
        staticUrl: "https://cdn.jsdelivr.net/sample/get-clowned.png",
        staticFallbackUrl: "https://raw.githubusercontent.com/sample/get-clowned.png",
        animatedUrl: "https://cdn.jsdelivr.net/sample/get-clowned.webp",
        animatedFallbackUrl: "https://raw.githubusercontent.com/sample/get-clowned.webp",
        sourcePath: "etc/aprilfools2024/get_clowned_static.png"
      }
    ]
  };
}

test("bundled Discord catalog is complete and does not depend on the GitHub tree API", async () => {
  const manifest = readManifest();
  assert.equal(manifest.version, 2);
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.items.length, manifest.total);
  assert.ok(manifest.total >= 100);
  assert.ok(manifest.items.every(item =>
    item.id && item.name && item.staticUrl && item.staticFallbackUrl &&
    item.sourcePath && item.source === manifest.source
  ));

  const catalog = createDecorationCatalog();
  const result = await catalog.getDecorations({ limit: 100 });
  assert.equal(result.total, manifest.total);
  assert.equal(result.sourceSha, manifest.sourceCommit);
  assert.equal(result.stale, false);
});

test("decoration catalog filters, paginates and finds an exact ID from local manifest", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-decoration-catalog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "manifest.json");
  fs.writeFileSync(file, JSON.stringify(fixtureManifest()));
  const catalog = createDecorationCatalog({ manifestFile: file });

  const first = await catalog.getDecorations({ limit: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);

  const page = await catalog.getDecorations({ query: "clowned", limit: 5 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, "etc-aprilfools-get-clowned");

  const animated = await catalog.getDecorations({ animated: true, limit: 10 });
  assert.equal(animated.total, 2);
  const inLove = await catalog.getDecoration("shop-anime-in-love");
  assert.equal(inLove.name, "In Love");
  assert.equal(await catalog.getDecoration("not-found"), null);
  assert.equal((await catalog.getRandomDecoration()).id.length > 0, true);
});

test("explicit catalog refresh reloads the bundled manifest without any network request", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-decoration-refresh-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "manifest.json");
  const oldManifest = fixtureManifest();
  fs.writeFileSync(file, JSON.stringify(oldManifest));
  const catalog = createDecorationCatalog({ manifestFile: file });

  await catalog.getDecorations();
  const nextManifest = fixtureManifest();
  nextManifest.sourceCommit = "b".repeat(40);
  fs.writeFileSync(file, JSON.stringify(nextManifest));

  const refreshed = await catalog.refresh();
  assert.equal(refreshed.sourceCommit, "b".repeat(40));
  assert.equal((await catalog.getDecorations()).sourceSha, "b".repeat(40));
});
