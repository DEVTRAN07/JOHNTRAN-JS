"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadImage } = require("canvas");
const { getBuffer } = require("../runtime/queuedHttp");

const THEME_DIR = path.resolve(__dirname, "..", "..", "theme");
const SELECTION_FILE = path.join(THEME_DIR, "selection.json");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 8500;

const BACKGROUNDS = Object.freeze([
  Object.freeze({
    id: "1",
    key: "27",
    name: "Aurora Muse 01",
    file: "hinh-nen-gai-xinh-sexy-27.jpg",
    url: "https://thoitietmiennam.edu.vn/wp-content/uploads/2026/08/hinh-nen-gai-xinh-sexy-27.jpg"
  }),
  Object.freeze({
    id: "2",
    key: "18",
    name: "Aurora Muse 02",
    file: "hinh-nen-gai-xinh-sexy-18.jpg",
    url: "https://thoitietmiennam.edu.vn/wp-content/uploads/2026/08/hinh-nen-gai-xinh-sexy-18.jpg"
  }),
  Object.freeze({
    id: "3",
    key: "16",
    name: "Aurora Muse 03",
    file: "hinh-nen-gai-xinh-sexy-16.jpg",
    url: "https://thoitietmiennam.edu.vn/wp-content/uploads/2026/08/hinh-nen-gai-xinh-sexy-16.jpg"
  })
]);

const loaded = new Map();
const pending = new Map();
const failedUntil = new Map();
const FAILURE_RETRY_MS = 60 * 1000;
let activeImage = null;
let activeBackgroundId = "";
let renderSeed = Math.floor(Math.random() * 0x7fffffff);

function ensureDirectory() {
  fs.mkdirSync(THEME_DIR, { recursive: true });
}

function resolveStoredSelection(value) {
  const selected = String(value?.selected || "random");
  // Upgrade older persisted choices to random once. A numbered photo is
  // considered an intentional lock only when it was saved by the new schema.
  if (value?.mode !== "manual") return "random";
  return BACKGROUNDS.some(item => item.id === selected) ? selected : "random";
}

function readSelection() {
  try {
    const value = JSON.parse(fs.readFileSync(SELECTION_FILE, "utf8"));
    return resolveStoredSelection(value);
  } catch {
    return "random";
  }
}

function getCurrent() {
  const selected = readSelection();
  const background = BACKGROUNDS.find(item => item.id === selected);
  return {
    selected,
    random: selected === "random",
    name: background?.name || "Ngẫu nhiên · Aurora Mix",
    backgrounds: BACKGROUNDS.map(item => ({ ...item, selected: item.id === selected }))
  };
}

function normalizeSelection(input, current = readSelection()) {
  const value = String(input || "").trim().toLowerCase();
  if (["random", "rand", "ngau-nhien", "ngẫu nhiên", "reset", "default"].includes(value)) {
    return "random";
  }
  if (["next", "tiep", "tiếp", "ke-tiep", "kế-tiếp"].includes(value)) {
    const index = BACKGROUNDS.findIndex(item => item.id === current);
    return BACKGROUNDS[(index + 1 + BACKGROUNDS.length) % BACKGROUNDS.length].id;
  }
  const match = BACKGROUNDS.find(item =>
    item.id === value || item.key === value || item.file === value
  );
  return match?.id || null;
}

function setSelection(input) {
  const selected = normalizeSelection(input);
  if (!selected) {
    throw new Error("Theme không hợp lệ. Dùng /theme, /theme 1, /theme 2, /theme 3, /theme random hoặc /theme next.");
  }

  ensureDirectory();
  const temporary = SELECTION_FILE + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify({
      selected,
      mode: selected === "random" ? "random" : "manual",
      updatedAt: new Date().toISOString()
    }, null, 2), "utf8");
    fs.renameSync(temporary, SELECTION_FILE);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
    throw new Error("Không thể lưu nền theme: " + error.message);
  }
  return getCurrent();
}

function getCandidateOrder(selected = "random", randomStart) {
  if (selected !== "random") {
    const fixed = BACKGROUNDS.find(item => item.id === String(selected));
    // Fixed mode must never substitute another cached photo: every renderer
    // either displays the requested image or uses the neutral fallback.
    return fixed ? [fixed] : [];
  }

  const rawStart = Number.isInteger(randomStart)
    ? randomStart
    : Math.floor(Math.random() * BACKGROUNDS.length);
  const start = ((rawStart % BACKGROUNDS.length) + BACKGROUNDS.length) % BACKGROUNDS.length;
  return [
    ...BACKGROUNDS.slice(start),
    ...BACKGROUNDS.slice(0, start)
  ];
}

function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

async function loadBackground(definition) {
  if (loaded.has(definition.id)) return loaded.get(definition.id);
  if (pending.has(definition.id)) return pending.get(definition.id);
  if ((failedUntil.get(definition.id) || 0) > Date.now()) return null;

  const task = (async () => {
    try {
      ensureDirectory();
      const filePath = path.join(THEME_DIR, definition.file);
      let buffer = null;

      if (fs.existsSync(filePath)) {
        try {
          const local = fs.readFileSync(filePath);
          if (isJpeg(local) && local.length <= MAX_IMAGE_BYTES) buffer = local;
          else fs.rmSync(filePath, { force: true });
        } catch {
          try { fs.rmSync(filePath, { force: true }); } catch { /* ignored */ }
        }
      }

      if (!buffer) {
        const response = await getBuffer(definition.url, {
          timeout: DOWNLOAD_TIMEOUT_MS,
          retries: 1,
          headers: {
            "User-Agent": "Mozilla/5.0 JOHNTRAN-JS Canvas",
            Accept: "image/jpeg,image/webp,image/png,image/*;q=0.8"
          }
        });
        const remote = response?.buffer;
        if (!Buffer.isBuffer(remote) || !isJpeg(remote) || remote.length > MAX_IMAGE_BYTES) {
          throw new Error("Ảnh nền không phải JPEG hợp lệ hoặc vượt quá 8MB");
        }
        buffer = remote;
        const temporary = filePath + "." + process.pid + "." + Date.now() + ".tmp";
        fs.writeFileSync(temporary, buffer);
        try {
          fs.renameSync(temporary, filePath);
        } catch (error) {
          try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
          if (!fs.existsSync(filePath)) throw error;
          buffer = fs.readFileSync(filePath);
        }
      }

      const image = await loadImage(buffer);
      loaded.set(definition.id, image);
      return image;
    } catch (error) {
      failedUntil.set(definition.id, Date.now() + FAILURE_RETRY_MS);
      console.warn("[CANVAS_THEME] Không tải được " + definition.file + ": " + (error?.message || error));
      return null;
    } finally {
      pending.delete(definition.id);
    }
  })();

  pending.set(definition.id, task);
  return task;
}

function settleWithin(promise, timeoutMs) {
  const waitMs = Math.max(0, Number(timeoutMs) || 0);
  if (!waitMs) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value ?? null);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    Promise.resolve(promise).then(finish, () => finish(null));
  });
}

async function prepare(options = {}) {
  renderSeed = Math.floor(Math.random() * 0x7fffffff);
  const current = getCurrent();
  const defaultWaitMs = current.random ? 1400 : 2200;
  const requestedWaitMs = options.waitMs === undefined
    ? defaultWaitMs
    : Number(options.waitMs);
  const waitMs = Math.max(0, Math.min(2200,
    Number.isFinite(requestedWaitMs) ? requestedWaitMs : defaultWaitMs
  ));
  const candidate = getCandidateOrder(current.selected);

  // Start remote downloads immediately, but never hold a normal Canvas
  // response for the full network timeout. Download tasks continue in the
  // background and their decoded bitmaps are reused on the next render.
  const first = candidate[0];
  const firstTask = first
    ? (loaded.get(first.id) ? Promise.resolve(loaded.get(first.id)) : loadBackground(first))
    : Promise.resolve(null);

  let galleryTasks = [];
  if (options.preloadAll === true) {
    galleryTasks = BACKGROUNDS.map(item =>
      loaded.get(item.id) ? Promise.resolve(loaded.get(item.id)) : loadBackground(item)
    );
  } else {
    // Warm alternate photos without making the active image wait for them.
    for (const item of candidate.slice(1)) void loadBackground(item);
  }

  const preferredImage = await settleWithin(firstTask, waitMs);
  // Only random mode may use a different already-cached photo as a
  // fallback. In numbered mode the requested ID is authoritative across
  // menu, folder, status, games and every other Canvas renderer.
  const readyFallback = current.random
    ? candidate
      .map(item => ({ id: item.id, image: loaded.get(item.id) }))
      .find(item => item.image)
    : null;

  activeImage = preferredImage || readyFallback?.image || null;
  activeBackgroundId = preferredImage
    ? first.id
    : readyFallback?.id || "";

  if (options.preloadAll === true && galleryTasks.length) {
    // Gallery thumbnails use any images already loaded before this deadline;
    // slower downloads remain in flight and populate the cache for next time.
    await settleWithin(Promise.all(galleryTasks), waitMs);
    if (activeImage) {
      const active = BACKGROUNDS.find(item => item.id === activeBackgroundId);
      if (active && !loaded.has(active.id)) {
        activeImage = loaded.get(active.id) || activeImage;
      }
    }
  }

  return {
    selected: current.selected,
    activeId: activeBackgroundId,
    activeName: BACKGROUNDS.find(item => item.id === activeBackgroundId)?.name || "Aurora gradient while images load",
    loaded: loaded.size,
    pending: pending.size,
    available: BACKGROUNDS.length
  };
}

function getActiveImage() {
  return activeImage;
}

function getImage(id) {
  return loaded.get(String(id || ""));
}

function getRenderSeed() {
  return renderSeed;
}

function getBackgrounds() {
  return BACKGROUNDS.map(item => ({
    id: item.id,
    key: item.key,
    name: item.name,
    file: item.file,
    url: item.url
  }));
}

module.exports = {
  THEME_DIR,
  SELECTION_FILE,
  BACKGROUNDS,
  MAX_IMAGE_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  prepare,
  getCurrent,
  setSelection,
  normalizeSelection,
  getCandidateOrder,
  resolveStoredSelection,
  getActiveImage,
  getImage,
  getRenderSeed,
  getBackgrounds,
  FAILURE_RETRY_MS,
  settleWithin
};
