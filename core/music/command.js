const fs = require("fs");
const music = require("./index");
const models = require("./models");
const ui = require("./ui");
const logger = require("../../utils/logger");
const { renderCanvas } = require("../canvas/workerRender");
const Threads = require("../controller/controllerThreads");

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
    await reply.working();
    return reply.error("Đang phát bài khác, vui lòng chờ hoặc dùng `out`");
  }
  const release = () => { sendingLock.delete(lockKey); };
  sendingLock.set(lockKey, true);
  try {
    const provider = music.getProvider(providerName);
    await reply.working();

    let filePath = null;
    try {
      const streamUrl = await music.resolve(providerName, track);
      filePath = await music.downloadToFile(streamUrl, "mp3", { fallbackUrl: track.sourceUrl || track.permalink_url || track.permalinkUrl || "", quality });
      
      // Use worker pool for CPU-intensive audio conversion
      const voiceUrl = await music.processAudioInWorker(filePath, threadId, type, api);

      try {
        const key = `np|${providerName}|${track.id}`;
        const cardPath = await renderCached(key, () =>
          renderCanvas("music-nowplaying", {
            track,
            sourceLabel: provider.label.toUpperCase()
          })
        );
        if (cardPath) await api.sendMessage({ msg: "", attachments: cardPath }, threadId, type);
        else {
          const styled = ui.nowPlaying(track, provider.label.toUpperCase());
          await api.sendMessage({ ...styled }, threadId, type);
        }
      } catch { /* ignore render errors */ }

      await api.sendVoice({ voiceUrl }, threadId, type);
      await reply.done();
    } catch (error) {
      logger.log(`[music:${providerName}] ${error.message}`, "error");
      await reply.failed();
      await friendlyError(error, reply);
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

  try {
    const key = `${provider.name}|${query}|${safePage}`;
    const gridPath = await renderCached(key, () =>
      renderCanvas("music-grid", {
        query,
        tracks: slice,
        options: { page: safePage, totalPages, source: provider.label.toUpperCase() }
      })
    );
    if (gridPath) return api.sendMessage({ msg: "", attachments: gridPath }, threadId, type);
  } catch (error) {
    console.error("[music] render grid lỗi:", error.message);
  }

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

async function runMusic(providerName, { api, event, args, reply }) {
  const { threadId, type, data } = event;
  const provider = music.getProvider(providerName);
  const key = music.pickKey(threadId, data.uidFrom);
  const options = parseOptions(args);

  if (/^\d{1,2}$/.test(args[0] || "")) {
    const pending = music.getPending(key);
    if (!pending || pending.providerName !== providerName) {
      return reply.error(`Bạn chưa tìm kiếm trên ${provider.label} gần đây. Hãy dùng ${global.config.prefix}${provider.name} <từ khóa> trước.`);
    }
    const index = parseInt(args[0], 10) - 1;
    const track = pending.tracks[index];
    if (!track) {
      return reply.error(`Số thứ tự không hợp lệ (1 - ${pending.tracks.length}).`);
    }
    music.clearPending(key);
    return sendTrack(reply, threadId, type, track, providerName, api, options.quality);
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

    music.setPending(key, providerName, pending.tracks, pending.query, page);
    return showResults(api, threadId, type, provider, pending.query, pending.tracks, page);
  }

  if (!options.queryArgs.length) {
    return usage(provider, reply);
  }

  const query = options.queryArgs.join(" ");
  let tracks;
  try {
    tracks = await music.search(providerName, query);
  } catch (error) {
    return friendlyError(error, reply);
  }

  music.setPending(key, providerName, tracks, query, 1);

  try {
    const threadData = (await Threads.getData(threadId)).data || {};
    if (threadData.menu_page) {
      delete threadData.menu_page;
      await Threads.setData(threadId, threadData);
    }
  } catch { /* ignore */ }
  if (options.quality) {
    const entry = music.getPending(key);
    if (entry) entry.quality = options.quality;
  }

  // Prefetch stream URLs for top 3 results in background
  setImmediate(() => {
    for (const track of tracks.slice(0, 3)) {
      music.resolve(providerName, track).catch(() => { /* ignore */ });
    }
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
      dependencies: meta.dependencies || {}
    },
    run: (context) => runMusic(providerName, context)
  };
}

async function select(providerName, number, context) {
  return runMusic(providerName, { ...context, args: [String(number)] });
}

module.exports = { createMusicCommand, runMusic, select };
