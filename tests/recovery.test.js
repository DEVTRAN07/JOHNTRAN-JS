"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const recovery = require("../core/runtime/recovery");
const startListening = require("../core/listen");

test("recovery snapshot reports process resources, queues and a safe-only action policy", () => {
  const snapshot = recovery.collectRecoverySnapshot({
    databaseStatus: {
      driver: "supabase",
      ok: false,
      classified: "network",
      syncError: "temporary connection error",
      retryQueueSize: 2,
      consecutiveFailures: 1
    }
  });

  assert.ok(["healthy", "degraded", "critical"].includes(snapshot.status));
  assert.equal(typeof snapshot.process.cpuPercent, "number");
  assert.equal(typeof snapshot.process.memory.rssBytes, "number");
  assert.equal(typeof snapshot.process.memory.limitBytes, "number");
  assert.equal(typeof snapshot.process.eventLoop.p95Ms, "number");
  assert.equal(snapshot.database.retryQueueSize, 2);
  assert.equal(snapshot.policy.automaticActions, "safe-retry-only");
  assert.equal(snapshot.policy.destructiveActions, false);
  assert.equal(snapshot.policy.groupBotStateChanges, false);
  assert.equal(snapshot.policy.processRestartByResourcePressure, false);
  assert.ok(snapshot.alerts.some(alert => alert.code === "database-degraded"));
});

test("component recovery state is visible and stale state is removed", () => {
  recovery.reportComponent("unit-listener", {
    status: "recovering",
    attempt: 3,
    updatedAt: 100,
    message: "test reconnect"
  });

  const current = recovery.getComponentStates(101);
  assert.ok(current.some(item => item.name === "unit-listener" && item.status === "recovering"));

  const expired = recovery.getComponentStates(100 + 5 * 60 * 1000 + 1);
  assert.equal(expired.some(item => item.name === "unit-listener"), false);
});

test("listener reconnect backoff grows exponentially, adds jitter, and respects its cap", () => {
  const delay1 = startListening.computeReconnectDelay(1, 1000, 8000, 0.2, () => 0);
  const delay2 = startListening.computeReconnectDelay(2, 1000, 8000, 0.2, () => 1);
  const capped = startListening.computeReconnectDelay(12, 1000, 8000, 0.2, () => 1);

  assert.equal(delay1, 1000);
  assert.equal(delay2, 2400);
  assert.equal(capped, 8000);
});
