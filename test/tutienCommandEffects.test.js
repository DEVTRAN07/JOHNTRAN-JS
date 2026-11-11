"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/tutien");

test("the live /tutien command uses real typing events and sends staged Zalo replies", async () => {
  const calls = [];
  const api = {
    async sendTypingEvent(threadId, type) {
      calls.push({ kind: "typing", threadId, type });
      return { status: 1 };
    },
    async sendMessage(payload, threadId, type) {
      calls.push({ kind: "message", text: payload.msg, threadId, type });
      return { sent: true };
    }
  };
  const reply = {
    async working() { calls.push({ kind: "reaction", state: "working" }); },
    async done() { calls.push({ kind: "reaction", state: "done" }); },
    async failed() { calls.push({ kind: "reaction", state: "failed" }); }
  };
  const Users = {
    async getData() { return { data: {} }; },
    getAll() { return []; }
  };

  await command.run({
    args: ["tongmon"],
    event: { threadId: "live-group", type: 1, data: { uidFrom: "live-user" } },
    api,
    Users,
    reply
  });

  assert.equal(calls[0].kind, "reaction");
  assert.equal(calls[0].state, "working");
  assert.deepEqual(calls.filter((call) => call.kind === "typing").map((call) => [call.threadId, call.type]), [
    ["live-group", 1], ["live-group", 1]
  ]);
  const messages = calls.filter((call) => call.kind === "message").map((call) => call.text);
  assert.match(messages.at(-1), /DEVTRAN TIÊN TÔNG/);
  assert.ok(messages.length >= 3, "the command sends its staged phases plus a final result");
  assert.equal(calls.some((call) => call.state === "done" || call.state === "failed"), false,
    "the existing handleCommand pipeline finalizes OK/CRY reactions");
});
