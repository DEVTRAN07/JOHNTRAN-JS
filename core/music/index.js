const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const http = require("../http");
const { pooledAxios } = require("../http/pooledAxios");
const db = require("../../utils/db");
const { caches } = require("../cache");
const { runInWorker } = require("../workerPool");
const { enqueue } = require("../jobQueue");

const providers = new Map();

const SEARCH_TTL = 10 * 60 * 1000;
const RESOLVE_TTL = 30 * 60 * 1000;

const searchCache = caches.musicSearch;
const resolveCache = caches.musicResolve;
const pendingCache = caches.musicPending;
const searchInFlight = new Map();
const resolveInFlight = new Map();

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

  if (searchInFlight.has(cacheKey)) return searchInFlight.get(cacheKey);
  const task = Promise.resolve().then(() => provider.search(query, maxResults)).then((tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      const error = new Error(`Không tìm thấy bài hát nào cho '${query}' trên ${provider.label}`);
      error.noResults = true;
      throw error;
    }
    searchCache.set(cacheKey, { tracks }, SEARCH_TTL);
    return tracks;
  }).finally(() => searchInFlight.delete(cacheKey));
  searchInFlight.set(cacheKey, task);
  return task;
}

async function resolve(providerName, track, options = {}) {
  const cacheKey = `${providerName}|${track?.id}`;
  const hit = resolveCache.get(cacheKey);
  if (hit !== undefined) return hit.url;

  if (resolveInFlight.has(cacheKey)) return resolveInFlight.get(cacheKey);
  const provider = getProvider(providerName);
  const task = enqueue("music-resolve", () => provider.resolve(track, options), {
    key: cacheKey,
    label: `Resolve nhạc: ${String(track?.title || track?.id || "bài hát").slice(0, 32)}`
  }).then((url) => {
    if (url) resolveCache.set(cacheKey, { url }, RESOLVE_TTL);
    return url;
  }).finally(() => resolveInFlight.delete(cacheKey));
  resolveInFlight.set(cacheKey, task);
  return task;
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

function assertSoundCloudStreamUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || "")); } catch {
    throw new Error("URL stream SoundCloud không hợp lệ.");
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = host === "sndcdn.com" || host.endsWith(".sndcdn.com") ||
    host === "soundcloud.cloud" || host.endsWith(".soundcloud.cloud");
  if (parsed.protocol !== "https:" || !allowed) {
    throw new Error("SoundCloud trả về host stream không được hỗ trợ.");
  }
  return parsed.toString();
}

function redactStreamDiagnostics(value) {
  return String(value || "")
    .replace(/https?:\\/\\/[^\\s"'<>]+/g, (raw) => {
      try {
        const parsed = new URL(raw);
        parsed.search = parsed.search ? "?[query]" : "";
        return parsed.toString();
      } catch {
        return "[stream URL]";
      }
    })
    .replace(/(client_id|token|secret|sig|signature)=([^&\\s]+)/gi, "$1=[redacted]");
}

function downloadHlsToMp3(streamUrl, filePath, quality = 128) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error("Không tìm thấy FFmpeg để xử lý luồng AAC/HLS."));
    }

    const bitrate = Number(quality) === 320 ? 320 : 160;
    const args = [
      "-hide_banner", "-loglevel", "warning", "-y",
      "-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
      "-allowed_extensions", "ALL",
      "-rw_timeout", "30000000",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "-headers", "Referer: https://soundcloud.com/\\r\\nOrigin: https://soundcloud.com\\r\\n",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-i", streamUrl,
      "-vn", "-c:a", "libmp3lame", "-b:a", `${bitrate}k`,
      "-f", "mp3", filePath
    ];

    execFile(ffmpegPath, args, {
      timeout: 15 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    }, (error, _stdout, stderr) => {
      if (error) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
        const diagnostic = redactStreamDiagnostics(stderr).split(/\\r?\\n/).filter(Boolean).slice(-8).join(" | ");
        const code = error.code ? `code=${error.code}` : "";
        const signal = error.signal ? `signal=${error.signal}` : "";
        const detail = diagnostic || [code, signal, error.errno, error.syscall].filter(Boolean).join(", ") || "FFmpeg không trả stderr";
        return reject(new Error("FFmpeg AAC/HLS thất bại: " + detail));
      }

      try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) {
          throw new Error("FFmpeg không tạo được file âm thanh hợp lệ.");
        }
        resolve(filePath);
      } catch (validationError) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
        reject(validationError);
      }
    });
  });
}

async function downloadToFile(streamUrl, extension, options = {}) {
  const { quality = null } = options;
  const tempDir = path.join(__dirname, "..", "..", "plugins", "commands", "temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `music_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`);

  // SoundCloud AAC streams are HLS playlists. Try 160k first, then the
  // 96k alternative supplied by SoundCloud when available for this track.
  if (streamUrl && typeof streamUrl === "object" && streamUrl.protocol === "hls") {
    const candidates = [...new Set([
      streamUrl.url,
      ...(Array.isArray(streamUrl.fallbackUrls) ? streamUrl.fallbackUrls : [])
    ].filter(Boolean))];
    const errors = [];

    for (let index = 0; index < candidates.length; index++) {
      const candidateUrl = assertSoundCloudStreamUrl(candidates[index]);
      try {
        return await enqueue("music-audio", () => downloadHlsToMp3(candidateUrl, filePath, quality), {
          key: `audio-hls|${candidateUrl}`,
          label: index === 0 ? "Tải AAC/HLS SoundCloud" : "Thử luồng AAC/HLS dự phòng"
        });
      } catch (error) {
        errors.push(error?.message || String(error));
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }

    throw new Error(
      candidates.length > 1
        ? "Không tải được các luồng AAC/HLS của SoundCloud: " + errors.join(" || ")
        : (errors[0] || "SoundCloud không có luồng HLS khả dụng.")
    );
  }

  const directUrl = assertSoundCloudStreamUrl(streamUrl);
  const attemptDownload = async (url) => {
    const { buffer, status, contentType } = await enqueue("music-audio", () => http.getBuffer(url, { timeout: 60000, retries: 1 }), {
      key: `audio-download|${url}`,
      label: "Tải audio stream"
    });
    if (status < 200 || status >= 300 || !buffer?.length ||
        (contentType && !/^(audio\\/|application\\/octet-stream)/i.test(contentType))) {
      throw new Error(`SoundCloud trả dữ liệu audio không hợp lệ (HTTP ${status || "không rõ"}, Content-Type: ${contentType || "không rõ"}).`);
    }
    fs.writeFileSync(filePath, buffer);
    return filePath;
  };

  try {
    return await attemptDownload(directUrl);
  } catch (error) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw error;
  }
}

async function processAudioInWorker(audioPath, threadId, type, api = null) {
  const result = await enqueue("music-audio", () => runInWorker("audioWorker", { audioPath, threadId, type, api }, {
    timeout: 120000,
    size: 2
  }), {
    key: `audio-process|${audioPath}`,
    label: "Chuyển mã audio"
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