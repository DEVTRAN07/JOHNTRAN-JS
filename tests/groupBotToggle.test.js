"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const command = require("../plugins/commands/bot");

global.config = { prefix: "/" };

function createContext(initialEnabled = true) {
  const data = { bot_enabled: initialEnabled };
  const messages = [];
  return {
    data,
    messages,
    Threads: {
      getData: async () => ({ data: { ...data } }),
      setData: async (_id, next) => Object.assign(data, next)
    },
    reply: {
      success: message => messages.push({ type: "success", message }),
      info: message => messages.push({ type: "info", message }),
      error: message => messages.push({ type: "error", message })
    }
  };
}

test("/bot off disables the current group only", async () => {
  const ctx = createContext(true);
  await command.run({
    event: { threadId: "group-1", type: ThreadType.Group },
    args: ["off"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, false);
  assert.equal(ctx.messages.at(-1).type, "success");
});

test("/bot on restores a group previously switched off", async () => {
  const ctx = createContext(false);
  await command.run({
    event: { threadId: "group-2", type: ThreadType.Group },
    args: ["on"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, true);
  assert.match(ctx.messages.at(-1).message, /bật bot/i);
});

test("/bot status reports the current group state without changing it", async () => {
  const ctx = createContext(false);
  await command.run({
    event: { threadId: "group-3", type: ThreadType.Group },
    args: ["status"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, false);
  assert.equal(ctx.messages.at(-1).type, "info");
  assert.match(ctx.messages.at(-1).message, /TẮT/);
});

test("/bot refuses private conversations", async () => {
  const ctx = createContext(true);
  await command.run({
    event: { threadId: "user-1", type: ThreadType.User },
    args: ["off"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, true);
  assert.equal(ctx.messages.at(-1).type, "error");
});
