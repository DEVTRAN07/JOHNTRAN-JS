"use strict";

const http = require("node:http");

function createBridgeHealthProbe(options = {}) {
  const request = options.request || http.request;
  const now = options.now || Date.now;
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 1200);
  const positiveCacheMs = Math.max(0, Number(options.positiveCacheMs) || 1800);
  const negativeCacheMs = Math.max(0, Number(options.negativeCacheMs) || 500);
  const cache = new Map();

  function clear(name) {
    if (name == null) cache.clear();
    else cache.delete(String(name));
  }

  function probe(bot, bridgeToken = "") {
    const name = String(bot?.name || "");
    const port = Number(bot?.bridgePort);
    if (!name || !Number.isInteger(port) || port < 1 || port > 65535) {
      return Promise.resolve(null);
    }

    const cached = cache.get(name);
    if (cached?.promise) return cached.promise;
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);

    const entry = { expiresAt: now() + timeoutMs + 250, value: null, promise: null };
    entry.promise = new Promise(resolve => {
      let settled = false;
      let body = "";

      const finish = value => {
        if (settled) return;
        settled = true;
        entry.value = value;
        entry.promise = null;
        entry.expiresAt = now() + (value?.reachable ? positiveCacheMs : negativeCacheMs);
        resolve(value);
      };

      let req;
      try {
        req = request({
          hostname: "127.0.0.1",
          port,
          path: "/health",
          method: "GET",
          headers: bridgeToken ? { "x-bridge-token": String(bridgeToken) } : {}
        }, response => {
          response.setEncoding?.("utf8");
          response.on("data", chunk => {
            body += String(chunk);
            if (body.length > 16384) {
              req.destroy(new Error("Bridge health response too large"));
            }
          });
          response.on("end", () => {
            if (Number(response.statusCode) !== 200) return finish(null);
            try {
              const payload = JSON.parse(body || "{}");
              finish({
                reachable: true,
                loggedIn: payload.loggedIn === true,
                pid: Number(payload.pid) || null,
                bot: String(payload.bot || name)
              });
            } catch {
              finish(null);
            }
          });
          response.on("error", () => finish(null));
        });
        req.setTimeout?.(timeoutMs, () => req.destroy(new Error("Bridge health timeout")));
        req.on("error", () => finish(null));
        req.end?.();
      } catch {
        finish(null);
      }
    });

    cache.set(name, entry);
    return entry.promise;
  }

  return { probe, clear };
}

const defaultProbe = createBridgeHealthProbe();

module.exports = {
  createBridgeHealthProbe,
  probeBridgeHealth: defaultProbe.probe,
  clearBridgeHealthCache: defaultProbe.clear
};
