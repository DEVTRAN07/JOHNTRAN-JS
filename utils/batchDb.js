const BATCH_SIZE = 100;
const FLUSH_MS = 500;

function createBatchDb(db) {
  const queues = new Map(); // table -> [{op, key, data, resolve, reject}]
  let flushTimer = null;
  let isShuttingDown = false;

  function enqueue(table, op, key, data) {
    return new Promise((resolve, reject) => {
      if (isShuttingDown) {
        try {
          let result;
          switch (op) {
            case "set": result = db.set(table, "id", key, data); break;
            case "get": result = db.get(table, "id", key); break;
            case "del": result = db.delete(table, "id", key); break;
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
        return;
      }
      if (!queues.has(table)) queues.set(table, []);
      queues.get(table).push({ op, key, data, resolve, reject });
      scheduleFlush();
    });
  }

  function scheduleFlush() {
    if (flushTimer || isShuttingDown) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await flushAll();
      if (totalPending() > 0) scheduleFlush();
    }, FLUSH_MS);
    flushTimer.unref?.();
  }

  async function flushAll() {
    for (const [table, items] of queues.entries()) {
      if (items.length === 0) continue;
      const batch = items.splice(0, BATCH_SIZE);
      await flushBatch(table, batch);
    }
  }

  async function flushBatch(table, items) {
    for (const item of items) {
      try {
        let result;
        switch (item.op) {
          case "set": result = db.set(table, "id", item.key, item.data); break;
          case "get": result = db.get(table, "id", item.key); break;
          case "del": result = db.delete(table, "id", item.key); break;
        }
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      }
    }
  }

  function totalPending() {
    let n = 0;
    for (const q of queues.values()) n += q.length;
    return n;
  }

  async function shutdown() {
    isShuttingDown = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    while (totalPending() > 0) {
      await flushAll();
    }
  }

  process.on("exit", () => { shutdown(); });
  process.on("SIGINT", () => { shutdown().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { shutdown().then(() => process.exit(0)); });

  return {
    saveData: (table, idField, id, data) => enqueue(table, "set", id, data),
    getData: (table, idField, id) => enqueue(table, "get", id, null),
    delData: (table, idField, id) => enqueue(table, "del", id, null),
    hasData: (table, idField, id) => db.has(table, idField, id),
    allData: (table) => db.all(table),
    flush: shutdown,
    _queues: queues,
    _db: db
  };
}

module.exports = { createBatchDb };
