const axios = require("axios");
const http = require("http");
const https = require("https");
const { resolveRequestPolicy } = require("./requestPolicy");

const HTTP_REQUEST_POLICY = resolveRequestPolicy(process.env, {}, "JT_HTTP");

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const pooledAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: HTTP_REQUEST_POLICY.timeoutMs
});

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 1;
const RETRY_DELAY_BASE = HTTP_REQUEST_POLICY.delayMs;

// Enforce a finite timeout even when a caller explicitly passes timeout: 0
// (Axios otherwise waits for the operating system's network timeout).
pooledAxios.interceptors.request.use(config => {
  const requestedTimeout = Number(config.timeout);
  config.timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(Math.floor(requestedTimeout), HTTP_REQUEST_POLICY.timeoutMs)
    : HTTP_REQUEST_POLICY.timeoutMs;

  const requestedRetryLimit = Number.isInteger(config.__retryLimit)
    ? config.__retryLimit
    : HTTP_REQUEST_POLICY.retries;
  config.__retryLimit = Math.max(
    0,
    Math.min(HTTP_REQUEST_POLICY.retries, requestedRetryLimit, MAX_RETRIES)
  );
  return config;
});

function isNetworkError(error) {
  return (
    !error.response &&
    (error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT" ||
      error.code === "ENOTFOUND" ||
      error.code === "ENETUNREACH" ||
      error.code === "EAI_AGAIN" ||
      error.message?.includes("network") ||
      error.message?.includes("timeout"))
  );
}

function shouldRetry(error) {
  if (isNetworkError(error)) return true;
  if (error.response && RETRY_STATUS_CODES.has(error.response.status)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

pooledAxios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config) return Promise.reject(error);

    const method = (config.method || "GET").toUpperCase();
    if (!IDEMPOTENT_METHODS.has(method)) return Promise.reject(error);

    config.__retryCount = config.__retryCount || 0;
    const retryLimit = Number.isInteger(config.__retryLimit)
      ? Math.max(0, Math.min(HTTP_REQUEST_POLICY.retries, MAX_RETRIES, config.__retryLimit))
      : HTTP_REQUEST_POLICY.retries;
    if (config.__retryCount >= retryLimit) return Promise.reject(error);

    if (!shouldRetry(error)) return Promise.reject(error);

    config.__retryCount++;
    const delay = RETRY_DELAY_BASE * Math.pow(2, config.__retryCount - 1);
    await sleep(delay);
    return pooledAxios(config);
  }
);

function installAxiosGuard(instance = pooledAxios) {
  const { installAxiosGuard: originalInstall } = require("./axios");
  const originalAxios = require("axios");

  const originalCreate = originalAxios.create;
  originalAxios.create = () => instance;

  try {
    originalInstall();
  } finally {
    originalAxios.create = originalCreate;
  }
}

module.exports = { pooledAxios, installAxiosGuard, HTTP_REQUEST_POLICY };
