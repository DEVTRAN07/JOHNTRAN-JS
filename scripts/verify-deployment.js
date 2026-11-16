#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const { performance } = require("perf_hooks");

function parseArgs(argv = process.argv) {
  let base = process.env.JT_VERIFY_BASE_URL || "http://localhost:8000";
  let token = process.env.JT_VERIFY_PANEL_TOKEN || null;
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--token") token = argv[++i] || "";
    else if (arg.startsWith("--token=")) token = arg.slice("--token=".length);
    else if (arg === "--help" || arg === "-h") return { help: true, base, token };
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (positional[0]) base = positional[0];
  const normalized = String(base || "").replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(normalized); }
  catch { throw new Error("Base URL không hợp lệ."); }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL chỉ hỗ trợ HTTP hoặc HTTPS.");
  }
  if (parsed.username || parsed.password) throw new Error("Không đặt username/password trong Base URL.");
  return { help: false, base: normalized, token: token ? String(token) : null };
}

function printHelp() {
  console.log("Usage: npm run verify:deployment -- [baseUrl] [--token TOKEN]");
  console.log("  baseUrl  default: JT_VERIFY_BASE_URL or http://localhost:8000");
  console.log("  token    default: JT_VERIFY_PANEL_TOKEN");
  console.log("  All checks are GET-only. No chat message or state-changing action is sent.");
}

function request(base, pathname, { token = null, timeoutMs = 10000 } = {}) {
  const url = new URL(pathname, base + "/");
  const lib = url.protocol === "https:" ? https : http;
  const headers = { Accept: "application/json, */*" };
  if (token) headers.Authorization = "Bearer " + token;

  return new Promise(resolve => {
    const start = performance.now();
    const req = lib.request(url, { method: "GET", headers, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const contentType = String(res.headers["content-type"] || "");
        let json = null;
        if (contentType.includes("json")) {
          try { json = JSON.parse(body.toString("utf8")); } catch {}
        }
        resolve({
          ok: true,
          status: res.statusCode,
          headers: res.headers,
          body,
          json,
          ms: performance.now() - start
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", error => resolve({
      ok: false,
      error: error.message,
      ms: performance.now() - start
    }));
    req.end();
  });
}

function formatMs(ms) { return Math.round(ms) + "ms"; }

async function runVerification(base, token, fetcher = request, output = console.log) {
  const results = [];
  const record = (name, pass, detail, ms, skipped = false) => {
    results.push({ name, pass: Boolean(pass), skipped });
    const tag = skipped ? "SKIP" : pass ? "PASS" : "FAIL";
    const timing = ms != null ? " (" + formatMs(ms) + ")" : "";
    output(tag + "  " + name + timing + (detail ? " - " + detail : ""));
  };
  const get = (pathname, timeoutMs = 10000) => fetcher(base, pathname, { token, timeoutMs });
  const jsonPass = (response, predicate) =>
    Boolean(response?.ok && response.status === 200 && response.json && predicate(response.json));

  // Public liveness only; loggedIn=false is a valid process state while Zalo login is pending.
  const health = await get("/health");
  if (!health.ok) {
    record("GET /health", false, health.error, health.ms);
  } else {
    const valid = health.status === 200 &&
      health.json && ["ok", "starting"].includes(health.json.status) &&
      (typeof health.json.uptimeMs === "number" || typeof health.json.uptimeSeconds === "number");
    record("GET /health", valid,
      valid ? "status=" + health.json.status + ", loggedIn=" + Boolean(health.json.loggedIn) :
        "status=" + health.status + ", invalid health payload", health.ms);
  }

  // Protected APIs must reject anonymous access.
  if (!token) {
    for (const pathname of ["/metrics", "/api/bots", "/api/metrics", "/api/recovery", "/api/errors", "/api/database/health"]) {
      const response = await fetcher(base, pathname, { token: null, timeoutMs: 10000 });
      record("Auth guard " + pathname, response.ok && response.status === 401,
        response.ok ? "anonymous status=" + response.status : response.error, response.ms);
    }
    record("Authenticated production diagnostics", true,
      "Đặt JT_VERIFY_PANEL_TOKEN để kiểm tra Panel, Recovery, Database và bot con.", null, true);
  } else {
    const metrics = await get("/metrics");
    const metricsText = metrics.ok ? metrics.body.toString("utf8") : "";
    const promLooksValid = /(^#\s*(HELP|TYPE)\s)|_bucket|process_cpu|nodejs_/m.test(metricsText);
    const jsonMetricsValid = Boolean(metrics.json && typeof metrics.json.node === "string");
    const metricsValid = metrics.ok && metrics.status === 200 && (promLooksValid || jsonMetricsValid);
    record("GET /metrics", metricsValid,
      metrics.ok ? "prometheus=" + promLooksValid + ", json=" + jsonMetricsValid + ", bytes=" + metrics.body.length : metrics.error, metrics.ms);

    const botsResponse = await get("/api/bots");
    const bots = botsResponse?.json?.bots;
    record("GET /api/bots", jsonPass(botsResponse, data => Array.isArray(data.bots)),
      Array.isArray(bots) ? "bots=" + bots.length : botsResponse.ok ? "invalid bot list/status=" + botsResponse.status : botsResponse.error,
      botsResponse.ms);

    const metricsApi = await get("/api/metrics");
    record("GET /api/metrics", jsonPass(metricsApi, data =>
      typeof data.uptimeMs === "number" && typeof data.node === "string"),
      metricsApi.ok ? "status=" + metricsApi.status : metricsApi.error, metricsApi.ms);

    const recovery = await get("/api/recovery", 15000);
    const recoveryValid = jsonPass(recovery, data =>
      data.master && data.master.process && Array.isArray(data.bots) && Array.isArray(data.alerts));
    record("GET /api/recovery", recoveryValid,
      recoveryValid
        ? "status=" + recovery.json.status + ", childBots=" + recovery.json.bots.length + ", alerts=" + recovery.json.alerts.length
        : recovery.ok ? "invalid payload/status=" + recovery.status : recovery.error,
      recovery.ms);

    const errors = await get("/api/errors");
    const errorsValid = jsonPass(errors, data =>
      data.summary && Array.isArray(data.events) && Array.isArray(data.bots));
    record("GET /api/errors", errorsValid,
      errorsValid ? "events=" + errors.json.events.length + ", botLogs=" + errors.json.bots.length :
        errors.ok ? "invalid payload/status=" + errors.status : errors.error,
      errors.ms);

    const database = await get("/api/database/health", 15000);
    const databaseValid = Boolean(database?.ok && database.status === 200 && database.json && typeof database.json === "object");
    record("GET /api/database/health", databaseValid,
      databaseValid
        ? "driver=" + (database.json.driver || "unknown") + ", ok=" + Boolean(database.json.ok)
        : database.ok ? "invalid payload/status=" + database.status : database.error,
      database.ms);

    if (Array.isArray(bots)) {
      const running = bots.filter(bot => bot && bot.loginState === "logged_in");
      record("Bot process visibility", true,
        "loggedIn=" + running.length + "/" + bots.length + "; trạng thái chưa đăng nhập không bị xem là process lỗi.");
    }
  }

  const failed = results.filter(result => !result.pass && !result.skipped).length;
  const passed = results.filter(result => result.pass && !result.skipped).length;
  const skipped = results.filter(result => result.skipped).length;
  output("");
  output("Summary: " + passed + "/" + (results.length - skipped) + " passed" + (skipped ? ", " + skipped + " skipped" : ""));
  return failed === 0 ? 0 : 1;
}

async function main(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }
  console.log("Base URL: " + parsed.base);
  console.log("Panel token: " + (parsed.token ? "provided" : "not provided"));
  console.log("Mode: read-only GET checks");
  console.log("");
  return runVerification(parsed.base, parsed.token);
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error("FAIL  verify-deployment - " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, request, runVerification, main };
