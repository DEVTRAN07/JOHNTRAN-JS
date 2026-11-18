"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/anh");

test("/ảnh is registered with Vietnamese and English aliases", () => {
  assert.equal(command.config.name, "anh");
  assert.ok(command.config.aliases.includes("ảnh"));
  assert.ok(command.config.aliases.includes("image"));
});

test("/ảnh queries Openverse with mature content disabled", () => {
  const url = new URL(command._test.buildImageSearchUrl("mountain sunset"));
  assert.equal(url.origin, "https://api.openverse.org");
  assert.equal(url.pathname, "/v1/images/");
  assert.equal(url.searchParams.get("q"), "mountain sunset");
  assert.equal(url.searchParams.get("mature"), "false");
  assert.equal(url.searchParams.get("filter_dead"), "true");
  assert.equal(url.searchParams.get("page_size"), "20");
});

test("/ảnh uses the Openverse thumbnail proxy and rejects invalid IDs", () => {
  const id = "4bc43a04-ef46-4544-a0c1-63c63f56e276";
  const url = new URL(command._test.getThumbnailUrl({ id }));
  assert.equal(url.origin, "https://api.openverse.org");
  assert.equal(url.pathname, "/v1/images/" + id + "/thumb/");
  assert.equal(command._test.getThumbnailUrl({ id: "not-a-uuid" }), null);
});

test("/ảnh excludes mature and malformed image records", () => {
  const rows = command._test.normalizeImageResults({
    results: [
      { id: "4bc43a04-ef46-4544-a0c1-63c63f56e276", mature: false },
      { id: "5bc43a04-ef46-4544-a0c1-63c63f56e276", mature: true },
      { id: "invalid", mature: false }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mature, false);
});

test("/ảnh attribution includes creator, licence and source link", () => {
  const caption = command._test.formatImageCaption({
    title: "Mountain sunset",
    creator: "Alex",
    license: "by",
    license_version: "4.0",
    foreign_landing_url: "https://example.org/photo/1"
  });
  assert.match(caption, /Mountain sunset/);
  assert.match(caption, /Tác giả: Alex/);
  assert.match(caption, /Giấy phép: by 4\.0/);
  assert.match(caption, /https:\/\/example\.org\/photo\/1/);
  assert.match(caption, /openverse\.org/);
});

test("/ảnh recognizes common image signatures and rejects non-image data", () => {
  assert.equal(command._test.imageExtension(Buffer.from([0xff, 0xd8, 0xff, ...new Array(20).fill(0)])), "jpg");
  assert.equal(command._test.imageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(12).fill(0)])), "png");
  assert.equal(command._test.imageExtension(Buffer.from("RIFF0000WEBP" + "0".repeat(8))), "webp");
  assert.equal(command._test.imageExtension(Buffer.from("not an image buffer")), null);
});
