"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { BotInstance, botDir } = require("../panel/botManager");

function createHarness(name, options = {}) {
  const children = [];
  const bot = new BotInstance(name, {
    ...options,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.pid = 5000 + children.length;
      child.kill = (signal) => {
        child.killed = true;
        queueMicrotask(() => child.emit("close", null, signal));
        return true;
      };
      children.push(child);
      return child;
    }
  });
  return { bot, children };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanup(name) {
  fs.rmSync(botDir(name), { recursive: true, force: true });
}

test("Stop cancels a pending auto-restart timer", async () => {
  const name = "__test_stop_pending_restart__";
  const { bot, children } = createHarness(name, { restartDelayMs: 25 });

  try {
    bot.start();
    children[0].emit("close", 1, null);
    assert.equal(bot.status, "restarting");

    assert.equal(await bot.stop(), true);
    assert.equal(bot.status, "stopped");
    await sleep(45);

    assert.equal(children.length, 1, "a stopped bot must not be respawned");
    assert.equal(bot.restartTimer, null);
  } finally {
    await bot.stop();
    cleanup(name);
  }
});

test("disabling auto-restart cancels an already scheduled restart", async () => {
  const name = "__test_disable_pending_restart__";
  const { bot, children } = createHarness(name, { restartDelayMs: 20 });

  try {
    bot.start();
    children[0].emit("close", 1, null);
    assert.equal(bot.status, "restarting");

    bot.setAutoRestart(false);
    await sleep(35);

    assert.equal(children.length, 1);
    assert.equal(bot.status, "offline");
    assert.equal(bot.restarting, false);
  } finally {
    await bot.stop();
    cleanup(name);
  }
});

test("intentional Stop does not count as a crash", async () => {
  const name = "__test_manual_stop_not_crash__";
  const { bot, children } = createHarness(name);

  try {
    bot.start();
    assert.equal(await bot.stop(), true);
    assert.equal(children.length, 1);
    assert.equal(bot.restarts, 0);
    assert.equal(bot.flapping, false);
  } finally {
    await bot.stop();
    cleanup(name);
  }
});

test("watchdog uses a rolling crash window and spawn errors are recoverable", async () => {
  const name = "__test_rolling_watchdog__";
  const { bot, children } = createHarness(name, {
    restartDelayMs: 5,
    restartWindowMs: 45,
    maxRestartsInWindow: 1
  });

  try {
    bot.start();
    children[0].emit("error", new Error("simulated spawn error"));
    children[0].emit("close", -2, null);
    await sleep(15);

    assert.equal(children.length, 2, "the first unexpected exit should be retried");
    children[1].emit("close", 1, null);

    assert.equal(bot.restarts, 2);
    assert.equal(bot.toJSON().flapping, true, "two crashes exceed the configured window limit");

    await sleep(65);
    assert.equal(bot.toJSON().flapping, false, "flapping clears after old crashes leave the rolling window");
    assert.equal(children.length, 3, "the watchdog should resume after its cooldown expires");
  } finally {
    await bot.stop();
    cleanup(name);
  }
});
