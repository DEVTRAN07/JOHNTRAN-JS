"use strict";

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 0;
const MAX_RETRIES = 1;

function boundedInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveRequestPolicy(env = process.env, configured = {}, prefix = "JT_HTTP") {
  const timeoutKey = prefix + "_TIMEOUT_MS";
  const retriesKey = prefix + "_RETRIES";
  const delayKey = prefix + "_RETRY_DELAY_MS";

  const configuredTimeout = boundedInteger(
    configured?.timeoutMs,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const timeoutMs = boundedInteger(
    env?.[timeoutKey],
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    configuredTimeout
  );

  // Default to no retries. A single optional retry can be enabled explicitly,
  // but repeated retries must never turn a request into a multi-minute wait.
  const configuredRetries = boundedInteger(
    configured?.limit,
    0,
    MAX_RETRIES,
    DEFAULT_RETRIES
  );
  const retries = boundedInteger(
    env?.[retriesKey],
    0,
    MAX_RETRIES,
    configuredRetries
  );

  const delayMs = boundedInteger(
    env?.[delayKey],
    50,
    1000,
    boundedInteger(configured?.delayMs, 50, 1000, 250)
  );

  return {
    timeoutMs,
    retries,
    delayMs,
    maxDelayMs: Math.min(1500, Math.max(delayMs, delayMs * 2)),
    // Never automatically retry non-idempotent Zalo mutations.
    methods: ["GET", "HEAD"]
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_RETRIES,
  MAX_RETRIES,
  boundedInteger,
  resolveRequestPolicy
};
