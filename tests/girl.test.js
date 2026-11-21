const assert = require("assert");
const fs = require("fs");
const path = require("path");
const queuedHttp = require("../core/runtime/queuedHttp");

async function main() {
  const originalGetBuffer = queuedHttp.getBuffer;
  const originalRandom = Math.random;
  const commandPath = require.resolve("../plugins/commands/girl");
  const messages = [];
  const sentPaths = [];
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100010000ffd9", "hex");
  let downloadCalls = 0;

  Math.random = () => 0;
  queuedHttp.getBuffer = async (url) => {
    downloadCalls++;
    assert.ok(url.startsWith("https://"));
    return { status: 200, buffer: jpeg, contentType: "image/jpeg" };
  };

  // Load the command after replacing the dependency it captures at require time.
  delete require.cache[commandPath];
  const command = require("../plugins/commands/girl");

  try {
    assert.strictEqual(command.config.name, "girl");
    const api = {
      async sendMessage(message) {
        messages.push(message);
        assert.ok(message && typeof message === "object");
        assert.strictEqual(message.msg, "📷 Ảnh ngẫu nhiên");
        assert.strictEqual(message.attachments.length, 1);
        const filePath = message.attachments[0];
        sentPaths.push(filePath);
        assert.ok(path.isAbsolute(filePath));
        assert.ok(fs.existsSync(filePath), "local image must exist while SDK uploads it");
        assert.ok(/\.jpg$/i.test(filePath), "Zalo SDK must receive an image extension");
        assert.deepStrictEqual(fs.readFileSync(filePath), jpeg);
      }
    };

    await command.run({ event: { threadId: "test-thread", type: 1 }, api });
    await command.run({ event: { threadId: "test-thread", type: 1 }, api });
  } finally {
    queuedHttp.getBuffer = originalGetBuffer;
    Math.random = originalRandom;
    delete require.cache[commandPath];
  }

  const imageMessages = messages.filter(message => Array.isArray(message.attachments));
  assert.strictEqual(imageMessages.length, 2);
  assert.strictEqual(downloadCalls, 1, "second call should reuse the bounded memory cache");
  for (const filePath of sentPaths) {
    assert.strictEqual(fs.existsSync(path.dirname(filePath)), false, "temporary image directory must be removed after send");
  }
  console.log("✓ girl tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
