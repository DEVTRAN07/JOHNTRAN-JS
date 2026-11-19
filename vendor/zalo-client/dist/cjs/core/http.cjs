'use strict';

const { performance } = require('node:perf_hooks');

var toughCookie = require('tough-cookie');
var context = require('./context.cjs');
var errors = require('./errors.cjs');
var logger = require('./logger.cjs');

/**
 * HTTP engine: cookie-aware `fetch` wrapper used by every API call.
 *
 * Requests go through a retry policy (exponential backoff with jitter, only
 * for idempotent methods by default) and a per-request timeout, so a flaky
 * network fails fast instead of hanging the process.
 */
const ZALO_ORIGIN = "https://chat.zalo.me";
const LOGIN_REFERER = "https://id.zalo.me/";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
function recordRequestTiming(ctx, phase, elapsedMs) {
    try {
        if (typeof ctx?.options?.onRequestTiming === "function") {
            ctx.options.onRequestTiming(phase, Math.max(0, Number(elapsedMs) || 0));
        }
    }
    catch {
        // Timing hooks are optional and must never change API delivery.
    }
}
function resolvePolicy(options) {
    return Object.assign(Object.assign({}, context.DEFAULT_RETRY_OPTIONS), options);
}
function isAbortError(error) {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Exponential backoff with full jitter, honouring a `Retry-After` header when
 * the server sent one.
 */
function retryDelay(policy, attempt, retryAfter) {
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, policy.maxDelayMs);
        }
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) {
            return Math.min(Math.max(date - Date.now(), 0), policy.maxDelayMs);
        }
    }
    const exponential = Math.min(policy.delayMs * 2 ** attempt, policy.maxDelayMs);
    return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}
/**
 * Builds a Zalo API URL, appending query params and (by default) the API
 * version/type markers.
 */
function makeURL(ctx, baseURL, params = {}, apiVersion = true) {
    const url = new URL(baseURL);
    for (const key in params) {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            url.searchParams.append(key, String(params[key]));
        }
    }
    if (apiVersion) {
        if (!url.searchParams.has("zpw_ver"))
            url.searchParams.set("zpw_ver", String(ctx.API_VERSION));
        if (!url.searchParams.has("zpw_type"))
            url.searchParams.set("zpw_type", String(ctx.API_TYPE));
    }
    return url.toString();
}
/**
 * Builds the default browser-like headers, injecting the session cookie for the
 * request origin.
 */
async function getDefaultHeaders(ctx, origin = ZALO_ORIGIN) {
    if (!ctx.cookie)
        throw new errors.ZaloApiError("Cookie is not available");
    if (!ctx.userAgent)
        throw new errors.ZaloApiError("User agent is not available");
    return {
        Accept: "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        Cookie: await ctx.cookie.getCookieString(origin),
        Origin: ZALO_ORIGIN,
        Referer: `${ZALO_ORIGIN}/`,
        "User-Agent": ctx.userAgent,
    };
}
async function applySetCookies(ctx, response, origin) {
    const setCookieRaw = response.headers.get("set-cookie");
    if (!setCookieRaw || !ctx.cookie)
        return;
    // getSetCookie() (Node.js 18+) must be used to parse multi-cookie headers:
    // splitting on ", " breaks cookies whose Expires attribute contains a
    // comma (e.g. "Expires=Wed, 18 Mar 2026 ..."), which would drop critical
    // cookies such as zpsid and zpw_sek during the QR login flow.
    const cookieStrings = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : setCookieRaw.split(", ");
    for (const cookieString of cookieStrings) {
        const parsed = toughCookie.Cookie.parse(cookieString);
        try {
            if (parsed) {
                const domain = parsed.domain && parsed.domain !== "zalo.me" ? `https://${parsed.domain}` : origin;
                await ctx.cookie.setCookie(parsed, domain);
            }
        }
        catch (error) {
            logger.logger(ctx).error(error);
        }
    }
}
/**
 * Performs a single request attempt (with redirect following).
 */
async function dispatch(ctx, url, options, raw, timeoutMs) {
    var _a, _b, _c;
    const requestStartedAt = performance.now();
    const controller = timeoutMs > 0 ? new AbortController() : null;
    let timer = null;
    const timeoutPromise = controller ? new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            const timeoutError = new errors.ZaloApiError(`Zalo request timed out after ${timeoutMs}ms (per-request timeout)`, "ETIMEDOUT");
            timeoutError.name = "TimeoutError";
            controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    }) : null;

    const operation = (async () => {
        if (!ctx.cookie)
            ctx.cookie = new toughCookie.CookieJar();
        const origin = new URL(url).origin;
        const requestOptions = options ? Object.assign({}, options) : {};
        if (!raw) {
            const headersStartedAt = performance.now();
            try {
                const headers = new Headers(await getDefaultHeaders(ctx, origin));
                if (options === null || options === void 0 ? void 0 : options.headers) {
                    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
                }
                requestOptions.headers = headers;
            }
            finally {
                recordRequestTiming(ctx, "cookie-headers", performance.now() - headersStartedAt);
            }
        }
        if (controller?.signal.aborted) {
            throw new errors.ZaloApiError(`Zalo request timed out after ${timeoutMs}ms (per-request timeout)`, "ETIMEDOUT");
        }
        const transportOptions = Object.assign(Object.assign(Object.assign({}, requestOptions), (controller ? { signal: controller.signal } : {})), (typeof Bun !== "undefined"
            ? { proxy: (_b = (_a = ctx.options.agent) === null || _a === void 0 ? void 0 : _a.proxy) === null || _b === void 0 ? void 0 : _b.href }
            : { agent: ctx.options.agent }));
        const fetchStartedAt = performance.now();
        let response;
        try {
            response = await ((_c = ctx.options.polyfill) !== null && _c !== void 0 ? _c : fetch)(url, transportOptions);
        }
        finally {
            recordRequestTiming(ctx, "fetch", performance.now() - fetchStartedAt);
        }
        if (!raw) {
            const cookieStartedAt = performance.now();
            try {
                await applySetCookies(ctx, response, origin);
            }
            finally {
                recordRequestTiming(ctx, "response-cookies", performance.now() - cookieStartedAt);
            }
        }
        const redirectURL = response.headers.get("location");
        if (redirectURL) {
            const redirectOptions = Object.assign(Object.assign({}, requestOptions), { method: "GET" });
            if (!raw && redirectOptions.headers) {
                const headers = new Headers(redirectOptions.headers);
                headers.set("Referer", LOGIN_REFERER);
                redirectOptions.headers = headers;
            }
            return dispatch(ctx, redirectURL, redirectOptions, raw, timeoutMs);
        }
        // fetch() resolves when response headers arrive, but response.json()
        // consumes the body later. Buffer the body inside this timed operation so
        // a stalled response stream cannot bypass the per-request deadline.
        if (typeof response?.arrayBuffer === "function") {
            const bodyStartedAt = performance.now();
            let body;
            try {
                body = await response.arrayBuffer();
            }
            finally {
                recordRequestTiming(ctx, "response-body", performance.now() - bodyStartedAt);
            }
            const responseHeaders = new Headers(response.headers);
            // Fetch has already decoded the body; do not retain wire-size headers
            // on the reconstructed in-memory response.
            responseHeaders.delete("content-encoding");
            responseHeaders.delete("content-length");
            return new Response(body.byteLength > 0 ? body : null, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
        }
        return response;
    })();

    try {
        return await (timeoutPromise ? Promise.race([operation, timeoutPromise]) : operation);
    }
    finally {
        if (timer) clearTimeout(timer);
        recordRequestTiming(ctx, "total", performance.now() - requestStartedAt);
    }
}
/**
 * Performs a request with the session cookie jar, default headers, redirect
 * following, timeout and the configured retry policy.
 *
 * @param raw When `true`, bypasses header injection and cookie persistence
 * (used for raw HTML/navigation requests such as the login page).
 */
async function request(ctx, url, options, raw = false) {
    const requestOptions = options ? Object.assign({}, options) : {};
    const timeoutOverride = Number.isFinite(requestOptions.timeoutMs)
      ? Math.max(0, Math.floor(requestOptions.timeoutMs))
      : undefined;
    const retriesOverride = Number.isSafeInteger(requestOptions.retries)
      ? Math.max(0, requestOptions.retries)
      : undefined;
    delete requestOptions.timeoutMs;
    delete requestOptions.retries;

    const policy = {
      ...resolvePolicy(ctx.options.retry),
      ...(timeoutOverride !== undefined ? { timeoutMs: timeoutOverride } : {}),
      ...(retriesOverride !== undefined ? { limit: retriesOverride } : {})
    };
    const method = String(requestOptions.method || "GET").toUpperCase();
    const retryable = policy.methods.some((allowed) => allowed.toUpperCase() === method);
    for (let attempt = 0;; attempt++) {
        try {
            const response = await dispatch(ctx, url, requestOptions, raw, policy.timeoutMs);
            const exhausted = attempt >= policy.limit;
            if (!retryable || exhausted || response.ok || !RETRYABLE_STATUS.has(response.status)) {
                return response;
            }
            const waitMs = retryDelay(policy, attempt, response.headers.get("retry-after"));
            logger.logger(ctx).warn(`Request to ${url} failed with status ${response.status}, retrying in ${waitMs}ms (${attempt + 1}/${policy.limit})`);
            await sleep(waitMs);
        }
        catch (error) {
            const exhausted = attempt >= policy.limit;
            if (!retryable || exhausted)
                throw error;
            const waitMs = retryDelay(policy, attempt, null);
            logger.logger(ctx).warn(`Request to ${url} failed (${isAbortError(error) ? "timeout" : describeError(error)}), retrying in ${waitMs}ms (${attempt + 1}/${policy.limit})`);
            await sleep(waitMs);
        }
    }
}

exports.getDefaultHeaders = getDefaultHeaders;
exports.makeURL = makeURL;
exports.request = request;
