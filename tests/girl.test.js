const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("../core/http");
const command = require("../plugins/commands/girl");

async function main() {
  const originalGetBuffer = http.getBuffer;
  const messages = [];
  const sentPaths = [];
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
  let downloadCalls = 0;

  http.getBuffer = async (url) => {
    downloadCalls++;
    assert.strictEqual(command.config.name, "girl");
    assert.ok(url.startsWith("https://"));
    return { status: 200, buffer: jpeg, contentType: "image/jpeg" };
  };

  try {
    const api = {
      async sendMessage(message) {
        messages.push(message);
        assert.ok(Array.isArray(message.attachments));
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
    http.getBuffer = originalGetBuffer;
  }

  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].msg, "📷 Ảnh ngẫu nhiên");
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
