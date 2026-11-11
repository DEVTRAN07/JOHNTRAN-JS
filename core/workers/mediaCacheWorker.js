const { parentPort } = require("worker_threads");

const MediaCache = require("../mediaCache").MediaCache;

const IDLE_EXIT_MS = 30000;
const cache = new MediaCache();

let idleTimer = null;
function scheduleIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    try { process.exit(0); } catch (e) {}
  }, IDLE_EXIT_MS);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === "object" && typeof value.byteLength === "number") {
    return Buffer.from(value);
  }
  return null;
}

function send(result) {
  parentPort.postMessage(result);
}

parentPort.on("message", async function (payload) {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    const op = payload && payload.op;
    if (!op) {
      throw new Error("Thieu lenh op");
    }

    if (op === "upload") {
      const buffer = toBuffer(payload.buffer);
      if (!buffer) {
        throw new Error("buffer phai la Buffer");
      }
      const result = await cache.upload(buffer, payload.type, payload.metadata);
      send({ ok: true, data: result });
    } else if (op === "get") {
      const result = await cache.get(payload.key);
      send({ ok: true, data: result });
    } else if (op === "getUrl") {
      const url = cache.getUrl(payload.key);
      send({ ok: true, data: { url: url } });
    } else if (op === "invalidate") {
      const removed = await cache.invalidate(payload.key);
      send({ ok: true, data: { removed: removed } });
    } else if (op === "stats") {
      send({ ok: true, data: cache.stats() });
    } else {
      throw new Error("Op khong ho tro: " + op);
    }
  } catch (err) {
    send({
      ok: false,
      error: err.message || String(err),
      stack: err.stack
    });
  } finally {
    scheduleIdleExit();
  }
});

scheduleIdleExit();
