"use strict";

const nativeCore = require("../../native");

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 0;
const MAX_RETRIES = 1;

function parseSafeInteger(value) {
  const parsed = Number(value);
  const valid = Number.isSafeInteger(parsed);
  return { parsed: valid ? parsed : 0, valid };
}

function boundedIntegerFromParsed(input, min, max, fallback) {
  if (!input.valid) return fallback;
  return Math.max(min, Math.min(max, input.parsed));
}

function boundedIntegerFallback(value, min, max, fallback) {
  return boundedIntegerFromParsed(parseSafeInteger(value), min, max, fallback);
}

function boundedInteger(value, min, max, fallback) {
  // Preserve JavaScript Number() coercion and exceptions (notably Symbols)
  // before crossing the N-API boundary.
  const input = parseSafeInteger(value);
  if ([min, max, fallback].every(value => typeof value === "number" && Number.isFinite(value))) {
    const result = nativeCore.tryRequestBoundedInteger([
      input.parsed, input.valid, min, max, fallback
    ]);
    if (result.used && typeof result.value === "number") return result.value;
  }
  return boundedIntegerFromParsed(input, min, max, fallback);
}

function resolveRequestPolicyFallback(parsed, methods = ["GET", "HEAD"]) {
  const configuredTimeout = boundedIntegerFromParsed(
    parsed.configuredTimeout, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS
  );
  const timeoutMs = boundedIntegerFromParsed(
    parsed.environmentTimeout, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, configuredTimeout
  );

  const configuredRetries = boundedIntegerFromParsed(
    parsed.configuredRetries, 0, MAX_RETRIES, DEFAULT_RETRIES
  );
  const retries = boundedIntegerFromParsed(
    parsed.environmentRetries, 0, MAX_RETRIES, configuredRetries
  );

  const configuredDelay = boundedIntegerFromParsed(
    parsed.configuredDelay, 50, 1000, 250
  );
  const delayMs = boundedIntegerFromParsed(
    parsed.environmentDelay, 50, 1000, configuredDelay
  );

  return {
    timeoutMs,
    retries,
    delayMs,
    maxDelayMs: Math.min(1500, Math.max(delayMs, delayMs * 2)),
    methods
  };
}

function resolveRequestPolicy(env = process.env, configured = {}, prefix = "JT_HTTP") {
  const timeoutKey = prefix + "_TIMEOUT_MS";
  const retriesKey = prefix + "_RETRIES";
  const delayKey = prefix + "_RETRY_DELAY_MS";

  // Keep the legacy property-read and Number() coercion order. The runtime
  // still reads env/config; Rust only applies the deterministic clamp policy.
  const parsed = {
    configuredTimeout: parseSafeInteger(configured?.timeoutMs),
    environmentTimeout: parseSafeInteger(env?.[timeoutKey]),
    configuredRetries: parseSafeInteger(configured?.limit),
    environmentRetries: parseSafeInteger(env?.[retriesKey]),
    // In the legacy nested call, the env delay property is read first, then
    // configured.delayMs is coerced, and only afterwards is the env value
    // passed through Number(). Preserve both getter and valueOf ordering.
    environmentDelayRaw: env?.[delayKey],
    configuredDelay: parseSafeInteger(configured?.delayMs)
  };
  parsed.environmentDelay = parseSafeInteger(parsed.environmentDelayRaw);
  delete parsed.environmentDelayRaw;

  const nativeResult = nativeCore.tryResolveHttpRequestPolicy([
    parsed.configuredTimeout.parsed, parsed.configuredTimeout.valid,
    parsed.environmentTimeout.parsed, parsed.environmentTimeout.valid,
    parsed.configuredRetries.parsed, parsed.configuredRetries.valid,
    parsed.environmentRetries.parsed, parsed.environmentRetries.valid,
    parsed.environmentDelay.parsed, parsed.environmentDelay.valid,
    parsed.configuredDelay.parsed, parsed.configuredDelay.valid
  ]);

  if (nativeResult.used && nativeResult.value) {
    const value = nativeResult.value;
    const timeoutMs = value.timeoutMs ?? value.timeout_ms;
    const retries = value.retries;
    const delayMs = value.delayMs ?? value.delay_ms;
    const maxDelayMs = value.maxDelayMs ?? value.max_delay_ms;
    if ([timeoutMs, retries, delayMs, maxDelayMs].every(item => typeof item === "number" && Number.isFinite(item))) {
      return {
        timeoutMs,
        retries,
        delayMs,
        maxDelayMs,
        // Never automatically retry non-idempotent Zalo mutations.
        methods: ["GET", "HEAD"]
      };
    }
  }

  return resolveRequestPolicyFallback(parsed);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_RETRIES,
  MAX_RETRIES,
  boundedInteger,
  resolveRequestPolicy,
  getNativeDiagnostics: nativeCore.getHttpRequestPolicyDiagnostics,
  __test: { parseSafeInteger, boundedIntegerFallback, resolveRequestPolicyFallback }
};
