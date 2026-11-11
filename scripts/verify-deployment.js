#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const { performance } = require("perf_hooks");

function parseArgs(argv) {
  let base = "http://localhost:8000";
  let token = null;
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token") {
      token = argv[++i] || "";
    } else if (a.startsWith("--token=")) {
      token = a.slice("--token=".length);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  if (positional[0]) base = positional[0];
  return { base: base.replace(/\/+$/, ""), token };
}

function printHelp() {
  console.log("Usage: verify-deployment.js [baseUrl] [--token TOKEN]");
  console.log("  baseUrl  default: http://localhost:8000");
  console.log("  --token  token for authenticated endpoints");
}

function request(base, pathname, { method = "GET", token = null, body = null, timeoutMs = 10000 } = {}) {
  const url = new URL(pathname, base + "/");
  const lib = url.protocol === "https:" ? https : http;
  const headers = { "Accept": "application/json, */*" };
  let payload = null;
  if (token) headers.Authorization = "Bearer " + token;
  if (body != null) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const req = lib.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const ms = performance.now() - start;
        let json = null;
        const ct = String(res.headers["content-type"] || "");
        if (ct.includes("json")) {
          try { json = JSON.parse(buf.toString("utf8")); } catch { json = null; }
        }
        resolve({ ok: true, status: res.statusCode, headers: res.headers, body: buf, json, ms });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ ok: false, error: error.message, ms: performance.now() - start }));
    if (payload) req.write(payload);
    req.end();
  });
}

function fmtMs(ms) { return Math.round(ms) + "ms"; }
const results = [];
function record(name, pass, detail, ms) {
  results.push({ name, pass: !!pass });
  const tag = pass ? "PASS" : "FAIL";
  const timing = ms != null ? " (" + fmtMs(ms) + ")" : "";
  const extra = detail ? " - " + detail : "";
  console.log(tag + "  " + name + timing + extra);
}

async function main() {
  const { base, token } = parseArgs(process.argv);
  console.log("Base URL: " + base);
  if (token) console.log("Token: provided");
  console.log("");

  {
    const r = await request(base, "/health", { timeoutMs: 10000 });
    if (!r.ok) record("GET /health", false, r.error, r.ms);
    else {
      const okStatus = r.json && r.json.status === "ok";
      const pass = r.status === 200 && okStatus;
      record("GET /health", pass, pass ? 'status="ok"' : "status=" + r.status + ", body.status=" + JSON.stringify(r.json && r.json.status), r.ms);
    }
  }
  {
    const r = await request(base, "/metrics", { timeoutMs: 10000 });
    if (!r.ok) record("GET /metrics", false, r.error, r.ms);
    else {
      const text = r.body.toString("utf8");
      const looksProm = /(^#\s*(HELP|TYPE)\s)|_bucket|process_cpu|nodejs_/m.test(text);
      const pass = r.status === 200 && (looksProm || text.length > 0);
      record("GET /metrics", pass, pass ? "prometheus=" + looksProm : "status=" + r.status, r.ms);
    }
  }
  let botsData = null;
  {
    const r = await request(base, "/api/bots", { token, timeoutMs: 10000 });
    if (!r.ok) record("GET /api/bots", false, r.error, r.ms);
    else {
      botsData = r.json;
      const count = r.json && Array.isArray(r.json.bots) ? r.json.bots.length : "?";
      record("GET /api/bots", r.status === 200, r.status === 200 ? "bots=" + count : "status=" + r.status, r.ms);
    }
  }
  {
    const r = await request(base, "/api/metrics", { token, timeoutMs: 10000 });
    if (!r.ok) record("GET /api/metrics", false, r.error, r.ms);
    else record("GET /api/metrics", r.status === 200, r.status === 200 ? "ok" : "status=" + r.status, r.ms);
  }
  {
    const r = await request(base, "/qr?bot=main", { timeoutMs: 10000 });
    if (!r.ok) record("GET /qr?bot=main", false, r.error, r.ms);
    else record("GET /qr?bot=main", (r.status === 200 || r.status === 404), "status=" + r.status, r.ms);
  }
  {
    const start = performance.now();
    try {
      const bots = botsData && Array.isArray(botsData.bots) ? botsData.bots : null;
      if (!bots) {
        record("Bot command via panel API", false, "no bot list available", performance.now() - start);
      } else {
        const running = bots.find((b) => b && (b.loginState === "logged_in" || b.displayStatus === "online" || b.status === "running"));
        if (!running) {
          record("Bot command via panel API", false, "no running/logged-in bot", performance.now() - start);
        } else {
          const name = running.name || "main";
          const health = await request(base, "/api/chat/" + encodeURIComponent(name) + "/health", { token, timeoutMs: 10000 });
          if (!health.ok || health.status !== 200) {
            record("Bot command via panel API", false, "chat health failed (" + (health.ok ? "status=" + health.status : health.error) + ")", performance.now() - start);
          } else {
            const threads = await request(base, "/api/chat/" + encodeURIComponent(name) + "/threads", { token, timeoutMs: 15000 });
            if (!threads.ok || threads.status !== 200) {
              record("Bot command via panel API", false, "threads failed (" + (threads.ok ? "status=" + threads.status : threads.error) + ")", performance.now() - start);
            } else {
              const friends = threads.json && threads.json.friends && Array.isArray(threads.json.friends.list) ? threads.json.friends.list : [];
              const groups = threads.json && threads.json.groups && Array.isArray(threads.json.groups.list) ? threads.json.groups.list : [];
              let target = null;
              if (friends.length) target = { threadId: friends[0].uid || friends[0].id, type: 0 };
              else if (groups.length) target = { threadId: groups[0].gid || groups[0].id, type: 1 };
              if (!target || !target.threadId) {
                record("Bot command via panel API", true, "bot=" + name + ", bridge reachable (no thread to send)", performance.now() - start);
              } else {
                const send = await request(base, "/api/chat/" + encodeURIComponent(name) + "/send", { token, method: "POST", body: { threadId: String(target.threadId), type: target.type, msg: "[verify-deployment] ping" }, timeoutMs: 15000 });
                const pass = send.ok && send.status === 200;
                record("Bot command via panel API", pass, pass ? "bot=" + name + ", sent type=" + target.type : "send failed (" + (send.ok ? "status=" + send.status : send.error) + ")", performance.now() - start);
              }
            }
          }
        }
      }
    } catch (error) {
      record("Bot command via panel API", false, error.message, performance.now() - start);
    }
  }
  const failed = results.filter((r) => !r.pass).length;
  const passed = results.length - failed;
  console.log("");
  console.log("Summary: " + passed + "/" + results.length + " passed");
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((error) => { console.error("FAIL  verify-deployment - " + error.message); process.exit(1); });
