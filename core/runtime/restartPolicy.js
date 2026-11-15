"use strict";

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 15000;

function getRestartPlan(history = [], now = Date.now(), options = {}) {
  const windowMs = Number.isFinite(options.windowMs) && options.windowMs > 0
    ? options.windowMs
    : DEFAULT_WINDOW_MS;
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts >= 1
    ? options.maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) && options.baseDelayMs >= 0
    ? options.baseDelayMs
    : DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = Number.isFinite(options.maxDelayMs) && options.maxDelayMs >= 0
    ? options.maxDelayMs
    : DEFAULT_MAX_DELAY_MS;

  const cutoff = now - windowMs;
  const timestamps = (Array.isArray(history) ? history : [])
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= now);
  timestamps.push(now);

  const attempts = timestamps.length;
  if (attempts > maxAttempts) {
    const nextAllowedAt = timestamps[0] + windowMs + 1;
    return {
      timestamps,
      attempts,
      delayMs: Math.max(1000, nextAllowedAt - now),
      cooldown: true
    };
  }

  const exponentialDelay = baseDelayMs * (2 ** Math.max(0, attempts - 1));
  return {
    timestamps,
    attempts,
    delayMs: Math.min(exponentialDelay, maxDelayMs),
    cooldown: false
  };
}

module.exports = { getRestartPlan };
