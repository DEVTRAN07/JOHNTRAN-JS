const http = require("http");
const https = require("https");
const zlib = require("zlib");
const { promisify } = require("node:util");
const { URL } = require("url");

const gunzipAsync = promisify(zlib.gunzip);
const inflateAsync = promisify(zlib.inflate);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);
const logger = require("../../utils/logger");
const { resolveWithDoH } = require("./dns");
const { resolveRequestPolicy } = require("./requestPolicy");

const HTTP_REQUEST_POLICY = resolveRequestPolicy(process.env, {}, "JT_HTTP");
const DEFAULT_TIMEOUT = HTTP_REQUEST_POLICY.timeoutMs;
const DEFAULT_RETRIES = HTTP_REQUEST_POLICY.retries;
const MAX_REDIRECTS = 5;
const SENSITIVE_QUERY = /(^|[?&])(st|e|sig|sign|token|key|apikey|api_key|secret|password|client_secret|access_token)=([^&]*)/gi;

function redactUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const params = new URLSearchParams(parsed.search);
    for (const key of [...params.keys()]) {
      if (SENSITIVE_QUERY.test(key + "=")) {
        params.set(key, "***");
      }
      SENSITIVE_QUERY.lastIndex = 0;
    }
    parsed.search = params.toString();
    let output = parsed.toString();
    output = output.replace(SENSITIVE_QUERY, "$1$2=***");
    return output;
  } catch {
    return String(rawUrl).replace(SENSITIVE_QUERY, "$1$2=***");
  }
}

function hostAllowed(rawUrl, config) {
  const privacy = config?.privacy || {};
  if (privacy.allow_all_hosts === true) return { allowed: true };
  let host;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return { allowed: false, reason: "URL không hợp lệ" };
  }
  const allowlist = Array.isArray(privacy.allowed_hosts) ? privacy.allowed_hosts : [];
  const matched = allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (matched) return { allowed: true };
  return { allowed: false, reason: `Host '${host}' không nằm trong danh sách cho phép (privacy)` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Giải nén body khi server trả gzip/deflate/brotli (vd stickers.zaloapp.com
// luôn gzip dù client không gửi Accept-Encoding)
async function decodeBody(raw, contentEncoding) {
  const encoding = String(contentEncoding || "").toLowerCase();
  if (!encoding || encoding === "identity") return raw;
  try {
    // These responses may contain large media payloads. Synchronous zlib
    // decompression blocks the same event loop that receives Zalo messages,
    // even though the download itself is already isolated in an HTTP queue.
    // Use Node's async zlib APIs so decompression runs in libuv's worker pool.
    if (encoding.includes("gzip")) return await gunzipAsync(raw);
    if (encoding.includes("deflate")) return await inflateAsync(raw);
    if (encoding.includes("br")) return await brotliDecompressAsync(raw);
  } catch (error) {
    logger.log(`Giải nén phản hồi (${encoding}) thất bại: ${error.message}`, "warn");
  }
  return raw;
}

function rawRequestOnce(rawUrl, options = {}, redirectsLeft = MAX_REDIRECTS, forceIp = null) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      return reject(new Error(`URL không hợp lệ: ${rawUrl}`));
    }

    const transport = parsed.protocol === "http:" ? http : https;
    const method = (options.method || "GET").toUpperCase();
    const headers = {
      "User-Agent": options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      ...(options.headers || {})
    };
    if (forceIp) headers.Host = parsed.hostname;

    const targetHost = forceIp || parsed.hostname;
    const req = transport.request(
      {
        hostname: targetHost,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: options.timeout || DEFAULT_TIMEOUT,
        servername: parsed.hostname
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0 && method === "GET") {
          res.resume();
          const nextUrl = new URL(res.headers.location, rawUrl).toString();
          const guard = hostAllowed(nextUrl, global.config || {});
          if (!guard.allowed) {
            return reject(Object.assign(new Error(guard.reason), { privacyBlocked: true }));
          }
          return resolve(rawRequest(nextUrl, options, redirectsLeft - 1));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          void decodeBody(raw, res.headers["content-encoding"])
            .then(body => resolve({
              status: res.statusCode,
              headers: res.headers,
              body,
              json() {
                try {
                  return JSON.parse(body.toString("utf8"));
                } catch {
                  return null;
                }
              },
              text() {
                return body.toString("utf8");
              }
            }))
            .catch(reject);
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error(`Timeout sau ${options.timeout || DEFAULT_TIMEOUT}ms`)));
    req.on("error", reject);

    if (options.body) {
      const payload = typeof options.body === "string" || Buffer.isBuffer(options.body) ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

function isDnsError(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || err);
  // ECONNREFUSED/ENAMETOOLONG are not name-resolution failures; retrying DoH
  // for them added up to 40 seconds without changing the failed destination.
  return ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "EAI_NODATA"].includes(code) ||
    /GETADDRINFO|DNS lookup failed/i.test(msg);
}

async function rawRequest(rawUrl, options = {}, redirectsLeft = MAX_REDIRECTS) {
  try {
    return await rawRequestOnce(rawUrl, options, redirectsLeft);
  } catch (err) {
    if (!isDnsError(err)) throw err;
    const parsed = new URL(rawUrl);
    const ips = await resolveWithDoH(parsed.hostname);
    if (!ips || !ips.length) throw err;
    return rawRequestOnce(rawUrl, options, redirectsLeft, ips[0]);
  }
}

function normalizeRequestOptions(options = {}) {
  const requestedTimeout = Number(options.timeout);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(Math.floor(requestedTimeout), DEFAULT_TIMEOUT)
    : DEFAULT_TIMEOUT;
  const requestedRetries = options.retries == null
    ? DEFAULT_RETRIES
    : Number(options.retries);
  const retries = Number.isSafeInteger(requestedRetries)
    ? Math.max(0, Math.min(DEFAULT_RETRIES, requestedRetries))
    : DEFAULT_RETRIES;
  return { ...options, timeout, retries };
}

async function request(rawUrl, options = {}) {
  // Clamp call-site overrides to the shared policy so a stale per-command
  // timeout cannot silently restore 20-60 second waits.
  options = normalizeRequestOptions(options);
  const config = global.config || {};
  const guard = hostAllowed(rawUrl, config);
  if (!guard.allowed) {
    const error = new Error(guard.reason);
    error.privacyBlocked = true;
    logger.log(`[privacy] Đã chặn request tới ${redactUrl(rawUrl)}: ${guard.reason}`, "warn");
    throw error;
  }

  const method = (options.method || "GET").toUpperCase();
  const maxRetries = options.retries !== undefined ? options.retries : DEFAULT_RETRIES;
  const idempotent = method === "GET" || method === "HEAD";

  let lastError = null;
  for (let attempt = 0; attempt <= (idempotent ? maxRetries : 0); attempt++) {
    try {
      if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 4000));
      const response = await rawRequest(rawUrl, options);
      if (response.status >= 500 && idempotent && attempt < maxRetries) {
        lastError = new Error(`Server trả về ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!idempotent || attempt >= maxRetries) break;
    }
  }
  throw lastError || new Error("Request thất bại");
}

async function getJson(rawUrl, options = {}) {
  const response = await request(rawUrl, options);
  const data = response.json();
  if (data === null) throw new Error(`Phản hồi không phải JSON từ ${redactUrl(rawUrl)}`);
  return { status: response.status, data };
}

async function getBuffer(rawUrl, options = {}) {
  const response = await request(rawUrl, options);
  return { status: response.status, buffer: response.body, contentType: response.headers["content-type"] || "" };
}

module.exports = {
  request, getJson, getBuffer, redactUrl, hostAllowed, normalizeRequestOptions,
  HTTP_REQUEST_POLICY, isDnsError,
  _test: { decodeBody }
};
