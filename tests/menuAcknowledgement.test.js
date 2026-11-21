"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("menu opens without sending the transient opening acknowledgement", () => {
  const menuPath = path.join(__dirname, "..", "plugins", "commands", "menu.js");
  const source = fs.readFileSync(menuPath, "utf8");

  assert.doesNotMatch(source, /Đang mở danh mục lệnh/);
  assert.doesNotMatch(source, /sendFastAcknowledgement/);
});


test("wrapped Zalo API suppresses only the obsolete menu-opening acknowledgement", async () => {
  const { wrapApi } = require("../core/message");
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: 101, cliMsgId: 202 } };
    },
    async undo() {}
  };
  const wrapped = wrapApi(api, "menu-ack-test", 2, "menu", {
    threadId: "menu-ack-test",
    type: 2,
    data: { msgId: 1, cliMsgId: 2 }
  });

  const suppressed = await wrapped.sendMessage({ msg: "⏳ Đang mở danh mục lệnh..." });
  assert.equal(suppressed, null);
  assert.equal(sent.length, 0, "obsolete acknowledgement must never reach Zalo");

  await wrapped.sendMessage({ msg: "📂 DANH MỤC LỆNH", recallAfterMs: 0 });
  assert.equal(sent.length, 1, "the real menu result must still be delivered");
  assert.equal(sent[0].msg, "📂 DANH MỤC LỆNH");
});
