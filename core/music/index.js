const fs = require("fs");
const path = require("path");
const http = require("../http");
const { pooledAxios } = require("../http/pooledAxios");
const db = require("../../utils/db");
const { caches } = require("../cache");
const { runInWorker } = require("../workerPool");

const providers = new Map();

const SEARCH_TTL = 10 * 60 * 1000;
const RESOLVE_TTL = 30 * 60 * 1000;

const searchCache = caches.musicSearch;
const resolveCache = caches.musicResolve;
const pendingCache = caches.musicPending;

function registerProvider(provider) {
  if (!provider || typeof provider.search !== "function" || typeof provider.resolve !== "function") {
    throw new Error(`Provider không hợp lệ: ${provider?.name}`);
  }
  providers.set(provider.name, provider);
}

const PROVIDER_ALIASES = {
  soundcloud: "scl"
};

function getProvider(name) {
  const provider = providers.get(name) || providers.get(PROVIDER_ALIASES[name]);
  if (!provider) throw new Error(`Nhà cung cấp nhạc '${name}' không tồn tại`);
  return provider;
}

function listProviders() {
  return [...providers.values()].map((provider) => ({ name: provider.name, label: provider.label }));
}

async function search(providerName, query, limit) {
  const provider = getProvider(providerName);
  const maxResults = limit || global.config?.music?.max_results || 40;

  const cacheKey = `${providerName}|${query}|${maxResults}`;
  const hit = searchCache.get(cacheKey);
  if (hit !== undefined) return hit.tracks;

  const tracks = await provider.search(query, maxResults);
  if (!Array.isArray(tracks) || tracks.length === 0) {
    const error = new Error(`Không tìm thấy bài hát nào cho '${query}' trên ${provider.label}`);
    error.noResults = true;
    throw error;
  }
  searchCache.set(cacheKey, { tracks }, SEARCH_TTL);
  return tracks;
}

async function resolve(providerName, track, options = {}) {
  const cacheKey = `${providerName}|${track?.id}`;
  const hit = resolveCache.get(cacheKey);
  if (hit !== undefined) return hit.url;

  const provider = getProvider(providerName);
  const url = await provider.resolve(track, options);
  if (url) resolveCache.set(cacheKey, { url }, RESOLVE_TTL);
  return url;
}

function setPending(key, providerName, tracks, query = "", page = 1) {
  const ttl = global.config?.music?.cache_ttl || 300000;
  pendingCache.set(key, { providerName, tracks, query, page }, ttl);
}

function getPending(key) {
  return pendingCache.get(key);
}

function clearPending(key) {
  pendingCache.delete(key);
}

function pickKey(threadId, userId) {
  return `${threadId}:${userId}`;
}

async function downloadToFile(streamUrl, extension, options = {}) {
  const { fallbackUrl = "", quality = null } = options;
  const tempDir = path.join(__dirname, "..", "..", "plugins", "commands", "temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `music_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`);

  const attemptDownload = async (url) => {
    const { buffer } = await http.getBuffer(url, { timeout: 60000, retries: 1 });
    fs.writeFileSync(filePath, buffer);
    return filePath;
  };

  try {
    return await attemptDownload(streamUrl);
  } catch (primaryErr) {
    if (!fallbackUrl) throw primaryErr;
    try {
      return await attemptDownload(fallbackUrl);
    } catch (fallbackErr) {
      const combined = new Error(`Primary: ${primaryErr.message}; Fallback: ${fallbackErr.message}`);
      combined.primaryErr = primaryErr;
      combined.fallbackErr = fallbackErr;
      throw combined;
    }
  }
}

async function processAudioInWorker(audioPath, threadId, type, api = null) {
  const result = await runInWorker("audioWorker", { audioPath, threadId, type, api }, {
    timeout: 120000,
    size: 2
  });
  return result;
}

for (const provider of [require("./soundcloud")]) {
  registerProvider(provider);
}

module.exports = {
  providers,
  getProvider,
  listProviders,
  search,
  resolve,
  setPending,
  getPending,
  clearPending,
  pickKey,
  downloadToFile,
  processAudioInWorker
};