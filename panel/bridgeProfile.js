"use strict";

const http = require("node:http");

function createBridgeProfileProbe(options = {}) {
  const request = options.request || http.request;
  const now = options.now || Date.now;
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 1500);
  const positiveCacheMs = Math.max(1000, Number(options.positiveCacheMs) || 30000);
  const negativeCacheMs = Math.max(250, Number(options.negativeCacheMs) || 15000);
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
      const finish = profile => {
        if (settled) return;
        settled = true;
        entry.value = profile;
        entry.promise = null;
        entry.expiresAt = now() + (profile ? positiveCacheMs : negativeCacheMs);
        resolve(profile);
      };

      let req;
      try {
        req = request({
          hostname: "127.0.0.1",
          port,
          path: "/profile",
          method: "GET",
          headers: bridgeToken ? { "x-bridge-token": String(bridgeToken) } : {}
        }, response => {
          response.setEncoding?.("utf8");
          response.on("data", chunk => {
            body += String(chunk);
            if (body.length > 16384) req.destroy(new Error("Bridge profile response too large"));
          });
          response.on("end", () => {
            if (Number(response.statusCode) !== 200) return finish(null);
            try {
              const payload = JSON.parse(body || "{}");
              const source = payload?.profile;
              if (!source || typeof source !== "object") return finish(null);
              const profile = {
                uid: String(source.uid || ""),
                displayName: String(source.displayName || "").trim(),
                avatar: String(source.avatar || "").trim()
              };
              finish(profile.displayName || profile.avatar || profile.uid ? profile : null);
            } catch {
              finish(null);
            }
          });
          response.on("error", () => finish(null));
        });
        req.setTimeout?.(timeoutMs, () => req.destroy(new Error("Bridge profile timeout")));
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

const defaultProbe = createBridgeProfileProbe();

module.exports = {
  createBridgeProfileProbe,
  probeBridgeProfile: defaultProbe.probe,
  clearBridgeProfileCache: defaultProbe.clear
};
