"use strict";

const { performance } = require("node:perf_hooks");
const metrics = require("../metrics");

// The event object itself is the correlation key. WeakMap keeps this
// instrumentation bounded without retaining message contents or user IDs.
const receivedMessages = new WeakMap();

function isObject(value) {
  return Boolean(value && (typeof value === "object" || typeof value === "function"));
}

function markReceived(event) {
  if (!isObject(event)) return false;
  receivedMessages.set(event, {
    receivedAt: performance.now(),
    command: "message",
    firstResponseStarted: false
  });
  return true;
}

function markCommand(event, commandName) {
  if (!isObject(event)) return false;
  const state = receivedMessages.get(event);
  if (!state || state.firstResponseStarted) return false;
  const name = String(commandName || "").trim().toLowerCase();
  if (name) state.command = name.slice(0, 64);
  return true;
}

function startSend(event) {
  const startedAt = performance.now();
  const state = isObject(event) ? receivedMessages.get(event) : null;

  if (state && !state.firstResponseStarted) {
    state.firstResponseStarted = true;
    metrics.trackFirstResponseLatency(
      state.command,
      Math.max(0, startedAt - state.receivedAt)
    );
  }

  return { startedAt };
}

function finishSend(ticket, error = null) {
  if (!ticket || !Number.isFinite(ticket.startedAt)) return false;
  metrics.trackZaloSendLatency(
    Math.max(0, performance.now() - ticket.startedAt),
    !error
  );
  return true;
}

module.exports = { markReceived, markCommand, startSend, finishSend };
