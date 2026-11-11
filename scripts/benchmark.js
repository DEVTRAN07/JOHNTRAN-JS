/**
 * Benchmark script for measuring bot command response latency.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const TEST_DB = path.join(os.tmpdir(), "jt_bench_" + Date.now() + ".json");

process.env.JT_DB_FILE = TEST_DB;
process.env.JT_DB_DRIVER = "json";
process.env.NODE_ENV = "benchmark";

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(latencies) {
  if (!latencies.length) return { avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0 };
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round(sum / latencies.length),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    min: Math.min(...latencies),
    max: Math.max(...latencies),
    count: latencies.length
  };
}

function mockApi() {
  const state = { responses: [] };
  const handler = {
    get(target, prop) {
      if (prop === "__state") return state;
      if (state[prop]) return state[prop];
      const fn = async (...args) => {
        state.responses.push({ op: String(prop), args: args.slice(0, 1) });
        return null;
      };
      state[prop] = fn;
      return fn;
    }
  };
  return new Proxy({}, handler);
}

function makeEvent(overrides = {}) {
  return {
    threadId: "BENCH_THREAD_" + Math.random().toString(36).slice(2, 8),
    type: 1,
    data: {
      uidFrom: "BENCH_USER",
      msgId: "M" + Date.now(),
      cliMsgId: "C" + Date.now(),
      content: "",
      ...overrides.data
    },
    ...overrides
  };
}

async function runCommand(commandName, args = {}) {
  const api = mockApi();
  const handleCommand = require(path.join(ROOT, "core/handle/handleCommand"));
  const event = makeEvent();
  const prefix = global.config.prefix;
  const argStr = typeof args === "string" ? args : (args.join ? args.join(" ") : "");
  const start = process.hrtime.bigint();
  await handleCommand(prefix + commandName + " " + argStr, event, api, {}, prefix);
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
}

async function main() {
  console.log("=== JOHN TRAN BOT LATENCY BENCHMARK ===");
  console.log("Node: " + process.version);
  console.log("Platform: " + os.platform() + " " + os.arch());
  console.log("CPU: " + os.cpus()[0].model + " (" + os.cpus().length + " cores)");
  console.log("Memory: " + Math.round(os.totalmem() / 1e9) + " GB");

  process.env.JT_DB_FILE = TEST_DB;

  // Mock canvas worker to avoid timeout (MUST be before loading any modules)
  const workerPoolPath = path.join(ROOT, "core/workerPool.js");
  let originalRunInWorker = null;
  if (fs.existsSync(workerPoolPath)) {
    const workerModule = require(workerPoolPath);
    originalRunInWorker = workerModule.runInWorker;
    workerModule.runInWorker = async (workerName, data, options = {}) => {
      if (workerName === "canvasWorker") {
        await new Promise(r => setTimeout(r, 10));
        return {
          buffer: Buffer.from("mock canvas"),
          width: 1000,
          height: 500,
          format: "png"
        };
      }
      return originalRunInWorker(workerName, data, options);
    };
  }

  const configSystem = require(path.join(ROOT, "core/config"));
  global.config = configSystem.load();

  const { installAxiosGuard } = require(path.join(ROOT, "core/http/axios"));
  installAxiosGuard();

  global.client = new Object({ commands: new Map(), events: new Map(), cooldowns: new Map() });
  global.users = { admin: ["BENCH_USER"], support: [] };
  global.api = null;

  const logger = require(path.join(ROOT, "utils/logger"));
  logger.log("Loading commands...", "info");

  const loaderCommand = require(path.join(ROOT, "core/loader/loaderCommand"));
  const loaderEvent = require(path.join(ROOT, "core/loader/loaderEvent"));

  await loaderCommand();
  await loaderEvent();

  console.log("Loaded " + global.client.commands.size + " commands");

  const results = [];
  const RUNS = 10;

  async function benchmark(name, runs, fn) {
    const latencies = [];
    console.log("\n[benchmark] Running " + name + " (" + runs + " iterations)...");

    for (let i = 0; i < runs; i++) {
      try {
        const latency = await fn(i);
        latencies.push(latency);
        if ((i + 1) % 5 === 0) {
          console.log("  " + (i + 1) + "/" + runs + " - last: " + latency.toFixed(1) + "ms");
        }
      } catch (error) {
        console.error("  Iteration " + i + " failed:", error.message);
        latencies.push(null);
      }
    }

    const valid = latencies.filter(l => l !== null);
    return { name, ...stats(valid), errors: latencies.length - valid.length };
  }

  results.push(await benchmark("menu (simple)", RUNS, async () => {
    return runCommand("menu");
  }));

  results.push(await benchmark("id (simple)", RUNS, async () => {
    return runCommand("id");
  }));

  results.push(await benchmark("stats (DB-heavy)", RUNS, async () => {
    return runCommand("stats");
  }));

  // Mock sticker worker for stk command
  const workerPoolPath2 = path.join(ROOT, "core/workerPool.js");
  let originalRunInWorker2 = null;
  if (fs.existsSync(workerPoolPath2)) {
    const workerModule = require(workerPoolPath2);
    originalRunInWorker2 = workerModule.runInWorker;
    workerModule.runInWorker = async (workerName, data, options = {}) => {
      if (workerName === "canvasWorker") {
        // Keep canvas mock
        await new Promise(r => setTimeout(r, 10));
        return {
          buffer: Buffer.from("mock canvas"),
          width: 1000,
          height: 500,
          format: "png"
        };
      }
      // Mock sticker worker
      await new Promise(r => setTimeout(r, 50));
      return {
        buffer: Buffer.from("mock"),
        width: 512,
        height: 512,
        format: "webp"
      };
    };
  }

  results.push(await benchmark("stk (CPU-heavy, mocked)", RUNS, async (i) => {
    const event = makeEvent({
      data: {
        quote: {
          msgId: "Q" + i,
          cliMsgId: "CQ" + i,
          attachments: [{ type: "image", hdUrl: "https://mock.url/image.jpg" }]
        }
      }
    });

    const api = mockApi();
    api.uploadStickerImage = async () => ({ data: { normalUrl: "https://mock.cdn/sticker.webp" } });
    api.sendCustomStickerUrl = async () => ({ message: { msgId: 1, cliMsgId: 1 } });
    api.getGroupInfo = async () => ({ gridInfoMap: {} });
    api.getUserInfo = async () => ({ changed_profiles: { "BENCH_USER": { displayName: "Test" } } });

    const handleCommand = require(path.join(ROOT, "core/handle/handleCommand"));
    const prefix = global.config.prefix;
    const start = process.hrtime.bigint();
    await handleCommand(prefix + "stk 1", event, api, {}, prefix);
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e6;
  }));

  // Restore original worker
  if (originalRunInWorker2 && fs.existsSync(workerPoolPath2)) {
    const workerModule = require(workerPoolPath2);
    workerModule.runInWorker = originalRunInWorker2;
  }

  const music = require(path.join(ROOT, "core/music"));

  const originalSearch = music.search;
  const originalResolve = music.resolve;
  const mockTracks = Array.from({ length: 20 }, (_, i) => ({
    id: "track_" + i,
    title: "Test Track " + i,
    artist: "Test Artist",
    duration: 180000,
    artworkUrl: "https://mock.url/art.jpg",
    permalink_url: "https://soundcloud.com/test/track_" + i
  }));

  music.search = async (provider, query) => {
    await new Promise(r => setTimeout(r, 10));
    return mockTracks;
  };

  music.resolve = async (provider, track) => {
    await new Promise(r => setTimeout(r, 5));
    return "https://mock.stream/audio.mp3";
  };

  results.push(await benchmark("scl search (music, mocked)", RUNS, async () => {
    return runCommand("scl", "test query");
  }));

  music.search = originalSearch;
  music.resolve = originalResolve;

  results.push(await benchmark("menu next (DB write)", RUNS, async (i) => {
    const api1 = mockApi();
    const event1 = makeEvent();
    const handleCommand = require(path.join(ROOT, "core/handle/handleCommand"));
    const prefix = global.config.prefix;
    await handleCommand(prefix + "menu", event1, api1, {}, prefix);

    const api2 = mockApi();
    const event2 = makeEvent({ data: { ...event1.data, content: "next" } });
    const start = process.hrtime.bigint();
    await handleCommand(prefix + "menu next", event2, api2, {}, prefix);
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e6;
  }));

  console.log("\n=== BENCHMARK RESULTS ===");
  console.log(JSON.stringify({
    metadata: {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: os.platform() + " " + os.arch(),
      cpu: os.cpus()[0].model,
      runs: RUNS,
      dbDriver: "json"
    },
    results
  }, null, 2));

  console.log("\n=== MARKDOWN TABLE ===");
  console.log("| Command | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Min | Max | Errors |");
  console.log("|---------|----------|----------|----------|----------|-----|-----|--------|");
  for (const r of results) {
    console.log("| " + r.name + " | " + r.avg + " | " + r.p50 + " | " + r.p95 + " | " + r.p99 + " | " + r.min + " | " + r.max + " | " + r.errors + " |");
  }

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  const comparison = "\n| Language/Framework | Simple Cmd | DB Cmd | CPU Cmd | Music Search |\n|--------------------|------------|--------|---------|--------------|\n| Node.js (this bot) | " + (results[0]?.avg || "N/A") + "ms | " + (results[2]?.avg || "N/A") + "ms | " + (results[3]?.avg || "N/A") + "ms | " + (results[4]?.avg || "N/A") + "ms |\n| Rust (serenity/twilight) | 1-5ms | 2-10ms | 5-20ms | 10-50ms* |\n| Go (discordgo) | 1-3ms | 2-8ms | 3-15ms | 10-40ms* |\n| Python (discord.py) | 5-15ms | 10-30ms | 20-60ms | 20-80ms* |\n\n* Network-bound (external API calls dominate)\n  ";
  console.log("\n=== COMPARISON WITH TYPICAL RUST/GO BOTS ===" + comparison);
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.exit(1);
});
