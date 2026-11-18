"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const soundcloud = require("../core/music/soundcloud");

const clientId = "0123456789abcdef0123456789abcdef";

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

test("SoundCloud client_id discovery scans script bundles concurrently and cancels slow lookups", async () => {
  const urls = [
    "https://a-v2.sndcdn.com/slow.js",
    "https://a-v2.sndcdn.com/fast.js",
    "https://a-v2.sndcdn.com/unused.js"
  ];
  const pending = new Set();
  const started = [];
  const request = (url, options) => new Promise((resolve, reject) => {
    started.push(url);
    pending.add(url);
    const timer = setTimeout(() => {
      pending.delete(url);
      resolve({ data: url.includes("fast.js") ? "client_id=" + clientId : "no client id" });
    }, url.includes("fast.js") ? 20 : 250);
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      pending.delete(url);
      reject(new Error("aborted"));
    }, { once: true });
  });
  const startedAt = Date.now();
  const found = await soundcloud._test.discoverClientIdFromScripts(urls, request);
  assert.equal(found, clientId);
  assert.ok(Date.now() - startedAt < 150);
  assert.equal(started.length, 3);
  assert.equal(pending.size, 0);
});
