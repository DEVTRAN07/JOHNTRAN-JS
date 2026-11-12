const assert = require("assert");
const fs = require("fs");
const http = require("../core/http");
const command = require("../plugins/commands/hon");

async function main() {
  const originalGetBuffer = http.getBuffer;
  const sent = [];
  let attachmentExistsWhenSent = false;
  let profileRequested = false;

  http.getBuffer = async (url) => {
    assert.ok(url.startsWith("https://i.imgur.com/"));
    return { buffer: Buffer.from("gif"), contentType: "image/gif" };
  };

  try {
    await command.run({
      event: {
        threadId: "test-thread",
        type: 1,
        data: { mentions: [{ uid: "123456789" }] }
      },
      api: {
        async getUserInfo(uid) {
          profileRequested = uid === "123456789";
          return {
            changed_profiles: {
              [`${uid}_0`]: { displayName: "Tagged User" }
            }
          };
        },
        async sendMessage(message) {
          sent.push(message);
          if (message.attachments) attachmentExistsWhenSent = fs.existsSync(message.attachments);
        }
      }
    });
  } finally {
    http.getBuffer = originalGetBuffer;
  }

  assert.strictEqual(profileRequested, true);
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].msg.startsWith("Tagged User "));
  assert.strictEqual(attachmentExistsWhenSent, true);
  assert.strictEqual(fs.existsSync(require("path").dirname(sent[0].attachments)), false);
  console.log("✓ hon tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
