const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("../core/http");
const { mediaCache } = require("../core/mediaCache");
const command = require("../plugins/commands/girl");

async function main() {
  const originalGetBuffer = http.getBuffer;
  const originalGet = require("../core/runtime/queuedMediaCache").get;
  const originalWriteLocal = mediaCache._writeLocal;
  const originalRequest = mediaCache.r2 ? mediaCache.r2.request : null;
  const messages = [];
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
  let downloadCalls = 0;
  let writeLocalCalls = 0;
  let sentPath = null;

  http.getBuffer = async (url) => {
    downloadCalls++;
    assert.strictEqual(command.config.name, "girl");
    assert.ok(url.startsWith("https://"));
    return { status: 200, buffer: jpeg, contentType: "image/jpeg" };
  };
  require("../core/runtime/queuedMediaCache").get = async () => null;
  mediaCache._writeLocal = async (...args) => {
    writeLocalCalls++;
    return originalWriteLocal.apply(mediaCache, args);
  };
  if (mediaCache.r2) mediaCache.r2.request = async () => ({});

  try {
    await command.run({
      event: { threadId: "test-thread", type: 1 },
      api: {
        async sendMessage(message) {
          messages.push(message);
          assert.ok(Array.isArray(message.attachments));
          assert.strictEqual(message.attachments.length, 1);
          sentPath = message.attachments[0];
          assert.ok(path.isAbsolute(sentPath));
          assert.ok(fs.existsSync(sentPath), "local image must exist while SDK uploads it");
          assert.ok(/\.jpg$/i.test(sentPath), "Zalo SDK must receive an image extension");
          assert.deepStrictEqual(fs.readFileSync(sentPath), jpeg);
        }
      }
    });
  } finally {
    http.getBuffer = originalGetBuffer;
    require("../core/runtime/queuedMediaCache").get = originalGet;
    mediaCache._writeLocal = originalWriteLocal;
    if (mediaCache.r2 && originalRequest) mediaCache.r2.request = originalRequest;
  }

  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].msg, "📷 Ảnh ngẫu nhiên");
  assert.strictEqual(messages[0].ttlKind, undefined);
  assert.strictEqual(downloadCalls, 1);
  assert.strictEqual(writeLocalCalls, 1);
  assert.ok(sentPath);
  assert.strictEqual(fs.existsSync(path.dirname(sentPath)), false, "temporary image directory must be removed after send");
  console.log("✓ girl tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
