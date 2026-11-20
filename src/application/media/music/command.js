const fs = require("fs");
const music = require("./index");
const models = require("./models");
const ui = require("./ui");
const logger = require("../../../../utils/logger");
const { renderCanvas } = require("../../../../core/canvas/workerRender");
const Threads = require("../../../../core/controller/controllerThreads");
const { enqueue } = require("../../../../core/jobQueue");
const { performance } = require("node:perf_hooks");

function recordMusicStageMetric(name, durationMs) {
  try {
    require("../../../../core/metrics").trackListenerStageLatency?.("music:" + name, durationMs);
  } catch {
    // Metrics must never block audio playback or music search.
  }
}

async function measureMusicStage(name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    recordMusicStageMetric(name, performance.now() - startedAt);
  }
}

let nextPageCursor = null; // "zing|2"

function send(api, threadId, type, msg) {
  return api.sendMessage({ msg }, threadId, type);
}

function usage(provider, reply) {
  return reply.card({
    theme: "music",
    title: `Nhạc • ${provider.label}`,
    subtitle: "Bài nhiều người nghe nhất lên đầu",
    rows: [{
      icon: "list",
      label: "Cách dùng",
      lines: [
        `${global.config.prefix}${provider.name} <từ khóa> — tìm bài`,
        `${global.config.prefix}${provider.name} <số> — tải bài đã tìm`,
        `${global.config.prefix}${provider.name} next | prev — chuyển trang`,
        `${global.config.prefix}${provider.name} out — đóng danh sách`
      ]
    }],
    footer: models.BRAND
  });
}

function friendlyError(error, reply) {
  if (error?.privacyBlocked) {
    return reply.error("Bot bị chặn gọi API này bởi chính sách bảo mật nội bộ.");
  }
  if (error?.needCredentials || error?.noResults || error?.notAvailable) {
    return reply.error(error.message);
  }
  return reply.error(`Lỗi khi xử lý nhạc: ${error.message || error}`);
}

const sendingLock = new Map();

async function sendTrack(reply, threadId, type, track, providerName, api, quality = null) {
  const lockKey = `${threadId}:${providerName}`;
  if (sendingLock.has(lockKey)) {
    return reply.error("Đang phát bài khác, vui lòng chờ hoặc dùng `out`");
  }
  const release = () => { sendingLock.delete(lockKey); };
  sendingLock.set(lockKey, true);
  try {
    const provider = music.getProvider(providerName);

    // Selecting a result can spend seconds resolving, downloading and
    // transcoding audio. Send an explicit first response before starting those
    // stages so the user never sees a silent command while media is prepared.
    try {
      await send(
        api,
        threadId,
        type,
        "⏳ Đã nhận lựa chọn \"" + String(track?.title || "bài hát").slice(0, 100) +
          "\" trên " + provider.label + ". Bot đang chuẩn bị âm thanh..."
      );
    } catch (ackError) {
      logger.log("[music] Không gửi được tin báo chuẩn bị phát: " +
        (ackError?.message || ackError), "warn");
    }
    // The dispatcher owns delayed progress feedback; avoid an extra Zalo
    // reaction request before resolving or starting the audio pipeline.

    let filePath = null;
    try {
      const streamUrl = await measureMusicStage("resolve", () => music.resolve(providerName, track));
      filePath = await measureMusicStage("download", () => music.downloadToFile(streamUrl, "mp3", { fallbackUrl: track.sourceUrl || track.permalink_url || track.permalinkUrl || "", quality }));
      
      // Use worker pool for CPU-intensive audio conversion
      // Worker audioWorker hiện chỉ nhận videoPath, không xử lý audioPath hoặc upload Zalo.
      // Dùng pipeline processAudio hiện hành để chuyển AAC + upload và nhận voiceUrl.
      const voiceUrl = await measureMusicStage("process-audio", () => require("../../../../utils").processAudio(filePath, threadId, type, api));
      filePath = null;

      // Audio is the primary result. Never wait for a decorative card.
      await measureMusicStage("send-voice", () => api.sendVoice({ voiceUrl }, threadId, type));
      void Promise.resolve(reply.done?.()).catch(() => {});

      setImmediate(() => {
        enqueue("canvas", async () => {
          const key = `np|${providerName}|${track.id}`;
          const cardPath = await renderCached(key, () =>
            renderCanvas("music-nowplaying", {
              track,
              sourceLabel: provider.label.toUpperCase()
            })
          );
          if (cardPath) await api.sendMessage({ msg: "", attachments: cardPath }, threadId, type);
          else await api.sendMessage({ ...ui.nowPlaying(track, provider.label.toUpperCase()) }, threadId, type);
        }, { priority: -1 }).catch((error) => logger.log("[music] Now Playing nền lỗi: " + error.message, "warn"));
      });
    } catch (error) {
      logger.log(`[music:${providerName}] ${error?.stack || error?.message || error}`, "error", { source: "music-playback", commandName: providerName });
      await friendlyError(error, reply);
      void Promise.resolve(reply.failed?.()).catch(() => {});
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  } finally {
    release();
  }
}

const CARD_TTL = 10 * 60 * 1000;
const CARD_MAX = 40;
const cardCache = new Map();

async function renderCached(key, renderFn) {
  const hit = cardCache.get(key);
  if (hit && Date.now() - hit.at < CARD_TTL && fs.existsSync(hit.path)) {
    hit.at = Date.now();
    return hit.path;
  }
  const filePath = await renderFn();
  if (!filePath) return null;
  if (cardCache.size >= CARD_MAX) {
    const oldest = [...cardCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) {
      try { fs.unlinkSync(oldest[1].path); } catch { /* ignore */ }
      cardCache.delete(oldest[0]);
    }
  }
  cardCache.set(key, { path: filePath, at: Date.now() });
  return filePath;
}

async function showResults(api, threadId, type, provider, query, tracks, page) {
  const perPage = 7;
  const totalPages = Math.max(1, Math.ceil(tracks.length / perPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const slice = tracks.slice((safePage - 1) * perPage, safePage * perPage);

  // Search results use Zalo's native styled text: one API call, no Canvas
  // worker wait or temporary image upload. The decorative Now Playing card
  // remains a separate low-priority background task after the audio is sent.
  const styled = ui.searchList({
    providerLabel: provider.label.toUpperCase(),
    query,
    tracks: slice,
    page: safePage,
    totalPages
  });
  return api.sendMessage({ ...styled }, threadId, type);
}

function parseOptions(args) {
  const options = {};
  const rest = [];
  for (const arg of args) {
    if (/^(128|320)$/.test(arg)) options.quality = Number(arg);
    else if (/^(-q|--quality)$/i.test(arg)) options.qualityFlag = true;
    else rest.push(arg);
  }
  const qIdx = args.findIndex((a) => /^(-q|--quality)$/i.test(a));
  if (qIdx !== -1 && /^(128|320)$/.test(args[qIdx + 1])) options.quality = Number(args[qIdx + 1]);
  options.queryArgs = rest;
  return options;
}

async function runMusic(providerName, { api, event, args, reply, Threads: threadStore = Threads, threadData = null }) {
  const { threadId, type, data } = event;
  const provider = music.getProvider(providerName);
  const key = music.pickKey(threadId, data.uidFrom);
  const options = parseOptions(args);

  if (/^\d{1,2}$/.test(args[0] || "")) {
    const pending = music.getPending(key);
    if (!pending || pending.providerName !== providerName) {
      return reply.error(`Bạn chưa tìm kiếm trên ${provider.label} gần đây. Hãy dùng ${global.config.prefix}${provider.name} <từ khóa> trước.`);
    }
    const pageSize = 7;
    const pageOffset = (Math.max(1, Number(pending.page) || 1) - 1) * pageSize;
    const pageTracks = pending.tracks.slice(pageOffset, pageOffset + pageSize);
    const index = pageOffset + parseInt(args[0], 10) - 1;
    const track = pending.tracks[index];
    if (!track) {
      return reply.error(`Số thứ tự không hợp lệ (1 - ${pageTracks.length}) ở trang ${pending.page || 1}.`);
    }
    music.clearPending(key);
    const selectedQuality = options.quality || pending.quality || null;
    return sendTrack(reply, threadId, type, track, providerName, api, selectedQuality);
  }

  const nav = (args[0] || "").toLowerCase();
  if (["next", "prev", "previous", "back", "out", "exit", "close"].includes(nav)) {
    const pending = music.getPending(key);
    if (!pending || pending.providerName !== providerName) {
      return reply.error(`Bạn chưa tìm nhạc trên ${provider.label}. Gõ ${global.config.prefix}${provider.name} <từ khóa> trước.`);
    }

    if (["out", "exit", "close"].includes(nav)) {
      music.clearPending(key);
      return reply.success(`Đã đóng danh sách nhạc "${pending.query || ""}". Gõ ${global.config.prefix}${provider.name} <từ khóa> để tìm lại.`);
    }

    const perPage = 7;
    const totalPages = Math.max(1, Math.ceil(pending.tracks.length / perPage));
    const current = pending.page || 1;
    const page = nav === "next"
      ? (current >= totalPages ? 1 : current + 1)
      : (current <= 1 ? totalPages : current - 1);

    music.setPending(key, providerName, pending.tracks, pending.query, page, {
      quality: pending.quality
    });
    return showResults(api, threadId, type, provider, pending.query, pending.tracks, page);
  }

  if (!options.queryArgs.length) {
    return usage(provider, reply);
  }

  const query = options.queryArgs.join(" ");

  // A first SoundCloud search can require a cold client_id discovery against
  // the home page and JS bundles. Acknowledge before queueing any remote work.
  try {
    await send(api, threadId, type, `🔎 Đang tìm "${query}" trên ${provider.label}...`);
  } catch (ackError) {
    logger.log("[music] Không gửi được tin báo tìm kiếm: " + (ackError?.message || ackError), "warn");
  }

  let tracks;
  try {
    tracks = await measureMusicStage("search-total", () =>
      enqueue("music-search", () => music.search(providerName, query), {
        key: `${providerName}|${query.toLowerCase()}|40`,
        label: `Tìm nhạc: ${query.slice(0, 36)}`,
        retries: 1,
        retryDelayMs: 450,
        retryOn: error => !error?.privacyBlocked && !error?.needCredentials &&
          !error?.noResults && !error?.notAvailable
      })
    );
  } catch (error) {
    logger.log(
      "[music:" + providerName + "] Search failed: " +
        String(error?.stack || error?.message || error),
      "error",
      { source: "music-search", commandName: providerName }
    );
    return friendlyError(error, reply);
  }

  music.setPending(key, providerName, tracks, query, 1);

  // Listener đã nạp sẵn record nhóm. Không chờ một lượt đọc Supabase lạnh
  // trước khi gửi danh sách kết quả SoundCloud.
  try {
    const record = threadData || threadStore.getCachedData?.(threadId) || null;
    if (record?.data?.menu_page) {
      const nextData = { ...record.data };
      delete nextData.menu_page;
      Promise.resolve(threadStore.setData(threadId, nextData)).catch(() => {});
    }
  } catch { /* không để storage chặn việc gửi kết quả */ }
  if (options.quality) {
    const entry = music.getPending(key);
    if (entry) entry.quality = options.quality;
  }

  // Prefetch stream URLs for top 3 results in background
  // Chỉ làm nóng luồng bài đầu tiên; prefetch ba bài cùng lúc tranh queue với
  // yêu cầu chọn bài thực tế và các tác vụ media khác.
  setImmediate(() => {
    const firstTrack = tracks[0];
    if (firstTrack) music.resolve(providerName, firstTrack).catch(() => { /* ignore */ });
  });

  return showResults(api, threadId, type, provider, query, tracks, 1);
}

function createMusicCommand(providerName, meta = {}) {
  let label = providerName;
  try { label = music.getProvider(providerName).label; } catch { /* provider chưa đăng ký */ }
  return {
    config: {
      name: providerName,
      version: "3.0.0",
      role: 0,
      author: models.BRAND,
      description: `Tìm và tải nhạc từ ${label}`,
      category: "Nhạc",
      usage: `${providerName} <từ khóa | số thứ tự | next>`,
      cooldowns: 5,
      dependencies: meta.dependencies || {},
      // Search/playback can take longer than a normal text command. Give
      // Reply's delayed acknowledgement a fallback if the first status send
      // itself cannot be accepted by Zalo.
      backgroundExecution: true
    },
    run: (context) => runMusic(providerName, context)
  };
}

async function select(providerName, number, context) {
  return runMusic(providerName, { ...context, args: [String(number)] });
}

module.exports = { createMusicCommand, runMusic, select };
