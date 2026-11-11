"use strict";

/**
 * Lazy loader for heavy modules using dynamic import().
 * Non-blocking preload via setImmediate, cached module promises.
 */

const HEAVY_MODULES = [
  "jimp",
  "cheerio",
  "canvas",
  "axios",
  "fluent-ffmpeg",
  "qrcode",
];

const moduleCache = new Map();
let preloadStarted = false;
let preloadInProgress = false;

function importModule(name) {
  if (moduleCache.has(name)) {
    return moduleCache.get(name);
  }

  const promise = import(name)
    .then((mod) => {
      moduleCache.set(name, mod);
      return mod;
    })
    .catch((err) => {
      moduleCache.delete(name);
      throw err;
    });

  moduleCache.set(name, promise);
  return promise;
}

function preloadHeavy() {
  if (preloadStarted) return;
  preloadStarted = true;

  const run = () => {
    if (preloadInProgress) return;
    preloadInProgress = true;

    // Load modules sequentially in background to avoid event-loop block
    const queue = [...HEAVY_MODULES];

    const next = () => {
      const name = queue.shift();
      if (!name) {
        preloadInProgress = false;
        return;
      }
      importModule(name).finally(() => setImmediate(next));
    };

    setImmediate(next);
  };

  setImmediate(run);
}

function getModule(name) {
  if (!name || typeof name !== "string") {
    return Promise.reject(new Error("Module name must be a non-empty string"));
  }
  return importModule(name);
}

function isPreloading() {
  return preloadInProgress;
}

function clearCache(name) {
  if (name) {
    moduleCache.delete(name);
  } else {
    moduleCache.clear();
  }
}

module.exports = {
  preloadHeavy,
  getModule,
  isPreloading,
  clearCache,
  HEAVY_MODULES,
};
