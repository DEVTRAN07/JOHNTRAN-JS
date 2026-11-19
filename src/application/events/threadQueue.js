"use strict";

const queues = new Map();

function runThreadQueue(threadId, operation) {
  const key = String(threadId || "");
  if (!key || typeof operation !== "function") {
    return Promise.reject(new TypeError("runThreadQueue requires threadId and operation"));
  }
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.then(operation, operation);
  const settled = current.then(() => undefined, () => undefined);
  queues.set(key, settled);
  settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return current;
}

module.exports = { runThreadQueue, queues };
