"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");

function makeContext({ groupId, content, flags, api, uid = "member-1" }) {
  return {
    event: {
      threadId: groupId,
      type: ThreadType.Group,
      data: { uidFrom: uid, dName: "Member", content, msgId: "msg-1", cliMsgId: "cli-1" }
    },
    eventType: "message",
    isSelf: false,
    api,
    Threads: {
      getCachedData() {
        return { threadId: groupId, data: { bot_enabled: true, ...flags } };
      }
    }
  };
}

test("Anti does not query the bot group role for harmless text when Anti-Link is enabled", async () => {
  let ownIdCalls = 0;
  let groupInfoCalls = 0;
  const api = {
    async getOwnId() { ownIdCalls++; return "bot-id"; },
    async getGroupInfo() { groupInfoCalls++; return { gridInfoMap: {} }; }
  };

  await anti._test.handleAntiEvent(makeContext({
    groupId: "anti-fast-harmless",
    content: "xin chao moi nguoi",
    flags: { anti_link: true, anti_word: true },
    api
  }));

  assert.equal(ownIdCalls, 0);
  assert.equal(groupInfoCalls, 0);
});

test("Anti-Spam counts normal messages locally without querying group role before the threshold", async () => {
  global.spamCache = {};
  let groupInfoCalls = 0;
  const api = {
    async getOwnId() { return "bot-id"; },
    async getGroupInfo() { groupInfoCalls++; return { gridInfoMap: {} }; }
  };

  for (let index = 0; index < 5; index++) {
    await anti._test.handleAntiEvent(makeContext({
      groupId: "anti-fast-spam-counter",
      content: "tin nhan thu " + index,
      flags: { anti_spam: true },
      api
    }));
  }

  assert.equal(groupInfoCalls, 0);
});

test("Anti still verifies the bot group role before enforcing a detected link violation", async () => {
  let ownIdCalls = 0;
  let groupInfoCalls = 0;
  let sendCalls = 0;
  const groupId = "anti-fast-link-violation";
  const api = {
    async getOwnId() { ownIdCalls++; return "bot-id"; },
    async getGroupInfo(id) {
      groupInfoCalls++;
      return { gridInfoMap: { [id]: { creatorId: "owner-id", adminIds: [] } } };
    },
    async sendMessage() { sendCalls++; }
  };

  await anti._test.handleAntiEvent(makeContext({
    groupId,
    content: "https://example.com/invite",
    flags: { anti_link: true },
    api
  }));

  assert.equal(ownIdCalls, 1);
  assert.equal(groupInfoCalls, 1);
  assert.equal(sendCalls, 0, "moderation must remain disabled when the bot is not a group admin");
});


test("a slow Anti danger-link scan does not block the next ordinary group message", async () => {
  let releaseScanStarted;
  const scanStarted = new Promise(resolve => { releaseScanStarted = resolve; });
  const api = {
    async getOwnId() { return "bot-id"; },
    async getGroupInfo(id) {
      return { gridInfoMap: { [id]: { creatorId: "owner-id", adminIds: ["bot-id"] } } };
    },
    scanURL() {
      releaseScanStarted();
      return new Promise(() => {});
    }
  };
  const groupId = "anti-no-head-of-line";
  const first = anti.handleEvent(makeContext({
    groupId,
    content: "https://example.com/suspicious",
    flags: { anti_danger_link: true },
    api
  }));

  await scanStarted;
  const second = anti.handleEvent(makeContext({
    groupId,
    content: "tin nhan binh thuong",
    flags: { anti_danger_link: true },
    api,
    uid: "member-2"
  }));

  let timeout;
  try {
    await Promise.race([
      second,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("second message waited behind the stalled scan")), 250);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(first && typeof first.then === "function");
});


test("Anti QR decoding delegates CPU work to the bounded worker pool", async () => {
  const input = Buffer.from("sample-image");
  let captured = null;
  const decoded = await anti._test.decodeQrFromImageBuffer(input, {
    async runInWorker(name, payload, options) {
      captured = { name, payload, options };
      return "https://example.com/qr";
    }
  });

  assert.equal(decoded, "https://example.com/qr");
  assert.equal(captured.name, "qrWorker");
  assert.equal(captured.payload.buffer, input);
  assert.equal(captured.options.timeout, 8000);
  assert.equal(captured.options.size, 1);
  assert.equal(captured.options.maxPending, 8);

  let called = false;
  const ignored = await anti._test.decodeQrFromImageBuffer(Buffer.alloc(0), {
    async runInWorker() { called = true; return null; }
  });
  assert.equal(ignored, null);
  assert.equal(called, false);
});


test("Anti-Link URL scan coalesces concurrent requests for the same URL", async () => {
  const { createUrlScanCache } = anti._test;
  const cache = createUrlScanCache({ safeTtlMs: 1000, unsafeTtlMs: 2000 });
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const scanner = async () => {
    calls++;
    await gate;
    return { isSafe: false };
  };

  const first = cache.scan("https://example.com/repeated", scanner);
  const second = cache.scan("https://example.com/repeated", scanner);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls, 1);
  assert.deepEqual(cache.stats(), { cached: 1, pending: 0, maxEntries: 1000 });
});

test("Anti-Link URL scan caches safe and unsafe decisions with separate TTLs", async () => {
  const { createUrlScanCache } = anti._test;
  let now = 1000;
  const cache = createUrlScanCache({
    now: () => now,
    safeTtlMs: 100,
    unsafeTtlMs: 250
  });
  let safeCalls = 0;
  let unsafeCalls = 0;

  const safeScanner = async () => { safeCalls++; return { isSafe: true }; };
  const unsafeScanner = async () => { unsafeCalls++; return { isSafe: false }; };

  assert.equal(await cache.scan("https://safe.example", safeScanner), false);
  assert.equal(await cache.scan("https://safe.example", safeScanner), false);
  assert.equal(safeCalls, 1);

  assert.equal(await cache.scan("https://bad.example", unsafeScanner), true);
  assert.equal(await cache.scan("https://bad.example", unsafeScanner), true);
  assert.equal(unsafeCalls, 1);

  now += 101;
  assert.equal(await cache.scan("https://safe.example", safeScanner), false);
  assert.equal(safeCalls, 2);
  assert.equal(await cache.scan("https://bad.example", unsafeScanner), true);
  assert.equal(unsafeCalls, 1, "unsafe verdict remains cached for its longer TTL");
});

test("Anti-Link scan transport errors are not cached", async () => {
  const { createUrlScanCache } = anti._test;
  let calls = 0;
  let errors = 0;
  const cache = createUrlScanCache({
    onError() { errors++; },
    safeTtlMs: 100,
    unsafeTtlMs: 200
  });
  const scanner = async () => {
    calls++;
    if (calls === 1) throw new Error("temporary scan outage");
    return { isSafe: false };
  };

  assert.equal(await cache.scan("https://retry.example", scanner), false);
  assert.equal(await cache.scan("https://retry.example", scanner), true);
  assert.equal(calls, 2);
  assert.equal(errors, 1);
});
