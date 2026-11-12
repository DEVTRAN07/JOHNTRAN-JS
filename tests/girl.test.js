const assert = require("assert");
const fs = require("fs");
const http = require("../core/http");
const { mediaCache } = require("../core/mediaCache");
const command = require("../plugins/commands/girl");

async function main() {
  const originalGetBuffer = http.getBuffer;
  const originalGet = mediaCache.get;
  const originalGetUrl = mediaCache.getUrl;
  const originalWriteLocal = mediaCache._writeLocal;
  const originalRequest = mediaCache.r2 ? mediaCache.r2.request : null;
  const messages = [];
  let downloadCalls = 0;
  let writeLocalCalls = 0;

  http.getBuffer = async (url) => {
    downloadCalls++;
    assert.ok(command.config.name === "girl");
    assert.ok(url.startsWith("https://"));
    return { buffer: Buffer.from("image"), contentType: "image/jpeg" };
  };
  mediaCache.get = async () => null;
  mediaCache._writeLocal = async (...args) => {
    writeLocalCalls++;
    return originalWriteLocal.apply(mediaCache, args);
  };
  mediaCache.getUrl = () => "https://cache.example/gai.jpg";
  if (mediaCache.r2) mediaCache.r2.request = async () => ({});

  try {
    await command.run({
      event: { threadId: "test-thread", type: 1 },
      api: {
        async sendMessage(message) {
          messages.push(message);
        }
      }
    });
  } finally {
    http.getBuffer = originalGetBuffer;
    mediaCache.get = originalGet;
    mediaCache.getUrl = originalGetUrl;
    mediaCache._writeLocal = originalWriteLocal;
    if (mediaCache.r2 && originalRequest) mediaCache.r2.request = originalRequest;
  }

  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0].attachments, ["https://cache.example/gai.jpg"]);
  assert.strictEqual(messages[0].ttlKind, "media");
  assert.strictEqual(downloadCalls, 1);
  assert.strictEqual(writeLocalCalls, 1);
  console.log("✓ girl tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
