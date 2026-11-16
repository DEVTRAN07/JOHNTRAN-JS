"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { BotInstance, BotManager, botDir, _test: botManagerTest } = require("../panel/botManager");

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


test("unexpected bot exits use exponential restart backoff before the crash-window limit", async () => {
  const name = "__test_exponential_restart_backoff__";
  const { bot, children } = createHarness(name, {
    restartDelayMs: 20,
    maxRestartDelayMs: 80,
    restartWindowMs: 1000,
    maxRestartsInWindow: 4
  });

  try {
    bot.start();
    children[0].emit("close", 1, null);
    const firstDelay = bot.nextRestartAt - Date.now();
    assert.ok(firstDelay <= 20 && firstDelay >= 0);

    await sleep(30);
    assert.equal(children.length, 2, "the first restart should happen after the base delay");
    children[1].emit("close", 1, null);
    const secondDelay = bot.nextRestartAt - Date.now();

    assert.ok(secondDelay >= 30 && secondDelay <= 45,
      "the second restart delay should double while remaining bounded");
    assert.equal(bot.toJSON().restartCountInWindow, 2);
    assert.equal(bot.toJSON().flapping, false);
  } finally {
    await bot.stop();
    cleanup(name);
  }
});


test("a stable bot runtime resets consecutive restart delay but not the rolling crash guard", async () => {
  const name = "__test_stable_runtime_resets_backoff__";
  const { bot, children } = createHarness(name, {
    restartDelayMs: 10,
    maxRestartDelayMs: 80,
    stableRuntimeResetMs: 12,
    restartWindowMs: 1000,
    maxRestartsInWindow: 4
  });

  try {
    bot.start();
    children[0].emit("close", 1, null);
    await sleep(20);
    assert.equal(children.length, 2);

    await sleep(15);
    children[1].emit("close", 1, null);

    assert.equal(bot.restartAttempt, 1, "a stable run starts a fresh consecutive backoff sequence");
    assert.equal(bot.toJSON().restartCountInWindow, 2,
      "both exits still count toward the rolling crash window");
    assert.ok(bot.nextRestartAt - Date.now() <= 10);
  } finally {
    await bot.stop();
    cleanup(name);
  }
});


test("Panel startAll rehydrates every registered bot and skips running instances", async () => {
  const first = createHarness("__test_start_all_main__");
  const second = createHarness("__test_start_all_child__");
  const manager = Object.create(BotManager.prototype);
  manager.bots = new Map([["main", first.bot], ["child", second.bot]]);

  try {
    const started = manager.startAll();
    assert.deepEqual(started.started, ["__test_start_all_main__", "__test_start_all_child__"]);
    assert.deepEqual(started.errors, []);
    assert.equal(first.children.length, 1);
    assert.equal(second.children.length, 1);

    const repeated = manager.startAll();
    assert.deepEqual(repeated.started, []);
    assert.deepEqual(repeated.skipped, ["__test_start_all_main__", "__test_start_all_child__"]);
    assert.equal(first.children.length, 1);
    assert.equal(second.children.length, 1);
  } finally {
    await first.bot.stop();
    await second.bot.stop();
  }
});

test("legacy root Cookie + IMEI session is copied into bots/main without overwriting", () => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "johntran-legacy-login-"));
  const sourceDir = path.join(root, "legacy");
  const targetDir = path.join(root, "bots", "main");
  const sourceAccount = path.join(sourceDir, "account.json");
  const sourceCookie = path.join(sourceDir, "private", "session.json");
  const targetAccount = path.join(targetDir, "account.json");
  const targetCookie = path.join(targetDir, "private", "session.json");

  try {
    fs.mkdirSync(path.dirname(sourceCookie), { recursive: true });
    fs.writeFileSync(sourceAccount, JSON.stringify({
      imei: "test-imei",
      userAgent: "test-agent",
      cookie: "private/session.json"
    }));
    fs.writeFileSync(sourceCookie, JSON.stringify([{ name: "test", value: "not-a-real-session" }]));

    const copied = botManagerTest.migrateLegacyMainSession({
      dir: targetDir,
      accountFile: targetAccount
    }, { sourceAccountFile: sourceAccount });

    assert.ok(copied.includes("account.json"));
    assert.ok(copied.includes(path.join("private", "session.json")));
    assert.equal(JSON.parse(fs.readFileSync(targetAccount, "utf8")).imei, "test-imei");
    assert.equal(fs.readFileSync(targetCookie, "utf8"), fs.readFileSync(sourceCookie, "utf8"));
    assert.ok(fs.existsSync(sourceAccount), "migration must preserve the legacy account source");

    fs.writeFileSync(targetAccount, JSON.stringify({ imei: "new-child-imei", cookie: "cookie.json" }));
    const second = botManagerTest.migrateLegacyMainSession({
      dir: targetDir,
      accountFile: targetAccount
    }, { sourceAccountFile: sourceAccount });
    assert.deepEqual(second, []);
    assert.equal(JSON.parse(fs.readFileSync(targetAccount, "utf8")).imei, "new-child-imei");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
