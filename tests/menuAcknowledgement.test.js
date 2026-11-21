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


test("raw Zalo API blocks the obsolete menu acknowledgement and allows normal messages", async () => {
  const { installGlobalSendMessageGuard } = require("../core/message");
  const sent = [];
  const api = {
    sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return Promise.resolve({ ok: true });
    }
  };

  assert.equal(installGlobalSendMessageGuard(api), true);
  assert.equal(
    await api.sendMessage({ msg: "⏳ Đang mở danh mục lệnh..." }, "raw-menu-thread", 2),
    null
  );
  assert.equal(sent.length, 0, "raw sends must be filtered before reaching the SDK");

  const result = await api.sendMessage({ msg: "Menu đã sẵn sàng" }, "raw-menu-thread", 2);
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.length, 1, "ordinary messages must continue to work");
  assert.equal(sent[0].payload.msg, "Menu đã sẵn sàng");
});

test("raw Zalo API guard replaces the SDK lazy accessor without invoking its setter", async () => {
  const { installGlobalSendMessageGuard } = require("../core/message");
  const sent = [];
  let setterCalled = false;
  const api = Object.create(null);

  Object.defineProperty(api, "sendMessage", {
    configurable: true,
    enumerable: true,
    get() {
      return (payload) => {
        sent.push(payload);
        return Promise.resolve(true);
      };
    },
    set() {
      setterCalled = true;
    }
  });

  assert.equal(installGlobalSendMessageGuard(api), true);
  assert.equal(await api.sendMessage({ msg: "⏳ Đang mở danh mục lệnh..." }), null);
  assert.equal(setterCalled, false, "the SDK lazy setter must not be used");
  assert.equal(sent.length, 0);
  assert.equal(await api.sendMessage({ msg: "Bình thường" }), true);
  assert.equal(sent.length, 1);
});
