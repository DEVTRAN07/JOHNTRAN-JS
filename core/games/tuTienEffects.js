"use strict";

const DEFAULT_PHASE_DELAY_MS = 520;
const FALLBACK_PHASE_DELAY_MS = 140;
const MAX_PHASE_DELAY_MS = 2200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDelay(value, fallback = DEFAULT_PHASE_DELAY_MS) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return fallback;
  return Math.max(0, Math.min(MAX_PHASE_DELAY_MS, delay));
}

function progressBar(value, max, width = 14) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, Number(value) / Number(max))) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Real Zalo chat effects:
 * - changes the reaction on the command message while the action runs;
 * - calls Zalo's typing endpoint before each staged chat message;
 * - sends actual chat messages (not a local preview or image);
 * - finalizes the reaction as OK/CRY.
 */
function createTuTienEffects({ api, event, reply, delayScale = 1 } = {}) {
  let started = false;
  let finished = false;
  let typingSupported = typeof api?.sendTypingEvent === "function";

  async function setReaction(method) {
    if (typeof reply?.[method] !== "function") return false;
    try {
      return await reply[method]();
    } catch (error) {
      console.warn("[tutien-effects] reaction failed:", error?.message || error);
      return false;
    }
  }

  async function start() {
    if (started || finished) return;
    started = true;
    await setReaction("working");
  }

  async function typing(delayMs) {
    let active = false;
    if (typingSupported) {
      try {
        const response = await api.sendTypingEvent(event.threadId, event.type);
        active = response?.status !== 0;
      } catch (error) {
        typingSupported = false;
        console.warn("[tutien-effects] typing event unavailable; text stages continue:", error?.message || error);
      }
    }
    const scaled = normalizeDelay(delayMs) * Math.max(0, Math.min(2, Number(delayScale) || 0));
    await sleep(active ? scaled : Math.min(FALLBACK_PHASE_DELAY_MS, scaled));
    return active;
  }

  async function phase(message, options = {}) {
    if (finished) throw new Error("Tu Tien effect session is already finished");
    await start();
    await typing(options.delayMs ?? options.delay ?? DEFAULT_PHASE_DELAY_MS);
    return api.sendMessage({ msg: String(message ?? "") }, event.threadId, event.type);
  }

  async function sequence(phases = []) {
    if (!Array.isArray(phases)) throw new TypeError("Effect phases must be an array");
    await start();
    const responses = [];
    for (const item of phases) {
      if (!item || item.message == null) continue;
      responses.push(await phase(item.message, { delayMs: item.delay ?? item.delayMs }));
    }
    return responses;
  }

  async function result(message) {
    if (finished) throw new Error("Tu Tien effect session is already finished");
    await start();
    const response = await api.sendMessage({ msg: String(message ?? "") }, event.threadId, event.type);
    await finish();
    return response;
  }

  async function respond(message, delayMs = DEFAULT_PHASE_DELAY_MS) {
    await phase(message, { delayMs });
    await finish();
  }

  async function finish() {
    if (finished) return;
    finished = true;
    await setReaction("done");
  }

  async function fail() {
    if (finished) return;
    finished = true;
    await setReaction("failed");
  }

  return {
    start,
    phase,
    sequence,
    result,
    respond,
    finish,
    fail,
    progressBar,
    get state() {
      return { started, finished, typingSupported };
    }
  };
}

module.exports = {
  DEFAULT_PHASE_DELAY_MS,
  FALLBACK_PHASE_DELAY_MS,
  MAX_PHASE_DELAY_MS,
  normalizeDelay,
  progressBar,
  createTuTienEffects
};
