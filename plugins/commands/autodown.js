const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const { ThreadType } = require("zalo-client");

module.exports.config = {
  name: "autodown",
  aliases: ["autodl"],
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tự động tải media từ link trong nhóm (pure JS)",
  category: "Tiện ích",
  usage: "autodown on|off|status",
  cooldowns: 3,
  dependencies: {}
};

const DEFAULTS = {
  enabled: true,
  rate_limit_max: 5,
  rate_limit_window_ms: 300000,
  circuit_fail_threshold: 3,
  circuit_cooldown_ms: 600000,
  url_dedup_ttl_ms: 120000,
  cache_ttl_ms: 600000,
  max_concurrent_downloads: 3,
  max_video_mb: 200
};

function cfg() {
  return Object.assign({}, DEFAULTS, global.config?.autodown || {});
}

const rateBuckets = new Map();
const dedupMap = new Map();
const cacheMap = new Map();
const circuitMap = new Map();
let activeDownloads = 0;

function now() { return Date.now(); }

function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    u.hash = "";
    return u.toString();
  } catch {
    return String(raw || "").trim();
  }
}

function urlKey(raw) {
  try {
    const u = new URL(normalizeUrl(raw));
    ["_r", "_t", "is_from_webapp", "sender_device", "web_id"].forEach((k) => u.searchParams.delete(k));
    u.hash = "";
    return u.toString().toLowerCase();
  } catch {
    return normalizeUrl(raw).toLowerCase();
  }
}

function hostOf(raw) {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return ""; }
}

function isHttpUrl(raw) {
  return /^https?:\/\//i.test(String(raw || ""));
}

function safeFilename(s, fallback = "media") {
  return String(s || fallback).replace(/[^\w.\-]+/g, "_").slice(0, 80) || fallback;
}

function extFrom(contentType, url, fallback = "mp4") {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/gif")) return "gif";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("video/mp4")) return "mp4";
  if (ct.includes("video/webm")) return "webm";
  if (ct.includes("audio/mpeg")) return "mp3";
  if (ct.includes("audio/mp4") || ct.includes("audio/aac")) return "m4a";
  const m = String(url || "").split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : fallback;
}

function fmtBytes(n) {
  const mb = n / 1048576;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)}MB`;
}

function consumeRate(threadId) {
  const c = cfg();
  const t = now();
  let b = rateBuckets.get(threadId);
  if (!b || t >= b.resetAt) b = { tokens: c.rate_limit_max, resetAt: t + c.rate_limit_window_ms };
  if (b.tokens <= 0) { rateBuckets.set(threadId, b); return false; }
  b.tokens -= 1;
  rateBuckets.set(threadId, b);
  return true;
}

function isDeduped(threadId, key) {
  const c = cfg();
  const k = `${threadId}::${key}`;
  const exp = dedupMap.get(k);
  if (exp && exp > now()) return true;
  dedupMap.set(k, now() + c.url_dedup_ttl_ms);
  return false;
}

function cacheGet(key) {
  const item = cacheMap.get(key);
  if (!item) return null;
  if (item.expireAt <= now()) { cacheMap.delete(key); return null; }
  return item.value;
}

function cacheSet(key, value, ttlMs) {
  const c = cfg();
  cacheMap.set(key, { expireAt: now() + (ttlMs ?? c.cache_ttl_ms), value });
}

function circuitOpen(platform) {
  const st = circuitMap.get(platform);
  return !!(st && st.openUntil > now());
}

function circuitFail(platform) {
  const c = cfg();
  const st = circuitMap.get(platform) || { fails: 0, openUntil: 0 };
  st.fails += 1;
  if (st.fails >= c.circuit_fail_threshold) {
    st.openUntil = now() + c.circuit_cooldown_ms;
  }
  circuitMap.set(platform, st);
}

function circuitSuccess(platform) {
  circuitMap.delete(platform);
}

function acquireSlot() {
  const c = cfg();
  if (activeDownloads >= c.max_concurrent_downloads) return false;
  activeDownloads += 1;
  return true;
}

function releaseSlot() {
  activeDownloads = Math.max(0, activeDownloads - 1);
}

function collectStrings(value, out, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out, depth + 1); return; }
  if (typeof value === "object") {
    for (const k of ["href", "url", "link", "src", "oriUrl", "ori_url", "text", "title", "content", "msg", "description"]) {
      if (k in value) collectStrings(value[k], out, depth + 1);
    }
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string" || typeof v === "object") collectStrings(v, out, depth + 1);
    }
  }
}

function extractUrls(content, event) {
  const strings = [];
  collectStrings(content, strings, 0);
  collectStrings(event?.data?.content, strings, 0);
  collectStrings(event?.data?.propertyExt, strings, 0);
  collectStrings(event?.data?.quote, strings, 0);
  collectStrings(event?.data?.href, strings, 0);
  collectStrings(event?.data?.msg, strings, 0);

  const found = new Set();
  const re = /https?:\/\/[^\s<>"')\]}]+/gi;
  for (const s of strings) {
    const text = String(s || "");
    let m;
    while ((m = re.exec(text)) !== null) {
      let u = m[0].replace(/[.,;:!?]+$/g, "");
      if (isHttpUrl(u)) found.add(normalizeUrl(u));
    }
  }
  return [...found];
}

function detectPlatform(url) {
  const h = hostOf(url);
  if (/(^|\.)tiktok\.com$|vm\.tiktok\.com|vt\.tiktok\.com|(^|\.)douyin\.com$/.test(h)) return "tiktok";
  if (/(^|\.)youtube\.com$|youtu\.be$|(^|\.)googlevideo\.com$/.test(h)) return "youtube";
  if (/(^|\.)facebook\.com$|fb\.watch$|(^|\.)fbcdn\.net$/.test(h)) return "facebook";
  if (/(^|\.)instagram\.com$|(^|\.)cdninstagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)twitter\.com$|(^|\.)x\.com$/.test(h)) return "twitter";
  return "generic";
}

function getHttp() { return require("../../core/http"); }
function getQueuedHttp() { return require("../../core/runtime/queuedHttp"); }

async function fetchText(url, options = {}) {
  const http = getQueuedHttp();
  const res = await http.request(url, Object.assign({ timeout: 30000, retries: 1 }, options));
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url, options = {}) {
  const http = getQueuedHttp();
  const res = await http.getJson(url, Object.assign({ timeout: 30000, retries: 1 }, options));
  if (res.status >= 400 || !res.data) throw new Error(`HTTP ${res.status || "?"}`);
  return res.data;
}

function canFetchHost(url) {
  try {
    const http = getHttp();
    return !!http.hostAllowed(url, global.config || {}).allowed;
  } catch { return false; }
}

async function extractTikTok(url) {
  const candidates = [];
  const u = normalizeUrl(url);
  candidates.push(u);
  try {
    const clean = new URL(u);
    ["_r", "_t", "is_from_webapp", "sender_device", "web_id", "checksum", "sec_user_id", "share_app_id", "share_link_id", "share_item_id", "u_code", "timestamp", "user_id"].forEach((k) => clean.searchParams.delete(k));
    const cleaned = clean.toString();
    if (cleaned !== u) candidates.push(cleaned);
  } catch {}

  const configured = global.config?.services?.tiktok_api_url;
  const bases = [...new Set([configured, "https://www.tikwm.com/api/", "https://api.tikwm.com/api/"].filter(Boolean))];
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.tikwm.com/"
  };
  const tkCookies = global.config?.media?.tiktok_cookies || process.env.TIKTOK_COOKIES;
  if (tkCookies) headers.Cookie = tkCookies;

  const errors = [];
  for (const target of candidates) {
    for (const base of bases) {
      try {
        const endpoint = `${base}?url=${encodeURIComponent(target)}&hd=1`;
        const data = await fetchJson(endpoint, { headers, timeout: 45000, retries: 0 });
        const ok = data && (data.code === 0 || data.code === 200) && data.data;
        if (!ok) {
          errors.push(`${base}: ${data?.msg || data?.message || "no data"}`);
          continue;
        }
        const d = data.data;
        const videoUrl = d.hdplay || d.play || d.wmplay || null;
        const audioUrl = d.music || d.music_info?.play || null;
        if (!videoUrl && !audioUrl) {
          errors.push(`${base}: missing media url`);
          continue;
        }
        return {
          platform: "tiktok",
          source: base,
          title: d.title || "TikTok video",
          author: d.author?.nickname || d.author?.unique_id || "TikTok",
          duration: Number(d.duration) || 0,
          thumbnail: d.cover || d.origin_cover || d.ai_dynamic_cover || "",
          videoUrl,
          audioUrl,
          pageUrl: target
        };
      } catch (e) {
        errors.push(`${base}: ${e.message}`);
      }
    }
  }
  throw new Error(`TikTok extraction failed (${errors.slice(0, 4).join(" | ").slice(0, 220)})`);
}

function extractMeta(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, "\x22");
  }
  return "";
}

async function extractOgMedia(url, platform) {
  if (!canFetchHost(url)) throw new Error(`host not allowed: ${hostOf(url)}`);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml"
  };
  const cookies = platform === "facebook" ? (global.config?.media?.facebook_cookies || process.env.FACEBOOK_COOKIES)
    : platform === "instagram" ? (global.config?.media?.facebook_cookies || process.env.FACEBOOK_COOKIES)
    : "";
  if (cookies) headers.Cookie = cookies;

  const html = await fetchText(url, { headers, timeout: 30000, retries: 1 });
  const videoUrl = extractMeta(html, [
    /<meta[^>]+property=["\x27]og:video:secure_url["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:video:secure_url["\x27]/i,
    /<meta[^>]+property=["\x27]og:video:url["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:video:url["\x27]/i,
    /<meta[^>]+property=["\x27]og:video["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:video["\x27]/i,
    /<meta[^>]+name=["\x27]twitter:player:stream["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+name=["\x27]twitter:player:stream["\x27]/i
  ]);
  const thumbnail = extractMeta(html, [
    /<meta[^>]+property=["\x27]og:image["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:image["\x27]/i
  ]);
  const title = extractMeta(html, [
    /<meta[^>]+property=["\x27]og:title["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
    /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:title["\x27]/i,
    /<title[^>]*>([^<]+)<\/title>/i
  ]);
  if (!videoUrl) throw new Error(`no og:video found for ${platform}`);
  return {
    platform,
    source: "og-meta",
    title: title || `${platform} media`,
    author: platform,
    duration: 0,
    thumbnail,
    videoUrl,
    audioUrl: null,
    pageUrl: url
  };
}

async function extractYouTube(url) {
  let title = "YouTube video";
  let author = "YouTube";
  let thumbnail = "";
  try {
    const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { timeout: 20000 });
    title = o?.title || title;
    author = o?.author_name || author;
    thumbnail = o?.thumbnail_url || thumbnail;
  } catch {}
  if (!title || title === "YouTube video") {
    try {
      const n = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, { timeout: 20000 });
      title = n?.title || title;
      author = n?.author_name || author;
      thumbnail = n?.thumbnail_url || thumbnail;
    } catch {}
  }
  try {
    if (canFetchHost(url)) {
      const html = await fetchText(url, {
        timeout: 25000,
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
      });
      const m = html.match(/https:\/\/[a-zA-Z0-9.\\-]*googlevideo\.com\/videoplayback[^"'\\\s]+/);
      if (m && m[0]) {
        const media = m[0].replace(/\\u0026/g, "&").replace(/\\/g, "");
        return { platform: "youtube", source: "page-scan", title, author, duration: 0, thumbnail, videoUrl: media, audioUrl: null, pageUrl: url };
      }
      const og = extractMeta(html, [
        /<meta[^>]+property=["\x27]og:video(?::url|:secure_url)?["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i,
        /<meta[^>]+content=["\x27]([^"\x27]+)["\x27][^>]+property=["\x27]og:video(?::url|:secure_url)?["\x27]/i
      ]);
      if (og && canFetchHost(og)) {
        return { platform: "youtube", source: "og-meta", title, author, duration: 0, thumbnail, videoUrl: og, audioUrl: null, pageUrl: url };
      }
    }
  } catch {}
  throw new Error(`YouTube direct media unavailable in pure-JS mode (${title})`);
}

async function extractGeneric(url) {
  if (!canFetchHost(url)) throw new Error(`host not allowed: ${hostOf(url)}`);
  return extractOgMedia(url, "generic");
}

async function extractByPlatform(platform, url) {
  if (circuitOpen(platform === "facebook" || platform === "instagram" ? "meta" : platform)) {
    throw new Error(`circuit open: ${platform}`);
  }
  try {
    let result;
    if (platform === "tiktok") result = await extractTikTok(url);
    else if (platform === "facebook") result = await extractOgMedia(url, "facebook");
    else if (platform === "instagram") result = await extractOgMedia(url, "instagram");
    else if (platform === "youtube") result = await extractYouTube(url);
    else if (platform === "twitter") result = await extractOgMedia(url, "twitter");
    else result = await extractGeneric(url);

    circuitSuccess(platform === "facebook" || platform === "instagram" ? "meta" : platform);
    return result;
  } catch (e) {
    circuitFail(platform === "facebook" || platform === "instagram" ? "meta" : platform);
    throw e;
  }
}

async function downloadAndSend({ api, threadId, type, info }) {
  const c = cfg();
  const mediaUrl = info.videoUrl || info.audioUrl;
  if (!mediaUrl) throw new Error("no media url");
  if (!canFetchHost(mediaUrl)) throw new Error(`media host not allowed: ${hostOf(mediaUrl)}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_autodown_"));
  try {
    const http = getQueuedHttp();
    const { buffer, contentType } = await http.getBuffer(mediaUrl, {
      timeout: 180000,
      retries: 1,
      headers: { "User-Agent": "Mozilla/5.0", Referer: info.pageUrl || mediaUrl }
    });
    const size = buffer?.length || 0;
    if (!size) throw new Error("empty media");
    const maxBytes = Math.max(1, Number(c.max_video_mb || 200)) * 1048576;
    if (info.videoUrl && size > maxBytes) {
      throw new Error(`video quá lớn (${fmtBytes(size)} > ${c.max_video_mb}MB)`);
    }
    const ext = extFrom(contentType, mediaUrl, info.videoUrl ? "mp4" : "mp3");
    const filePath = path.join(tmpDir, `${safeFilename(info.platform)}_${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, buffer);

    const captionParts = [];
    captionParts.push(`⬇️ AutoDown [${info.platform}]`);
    if (info.title) captionParts.push(String(info.title).slice(0, 180));
    if (info.author && info.author !== info.platform) captionParts.push(`👤 ${info.author}`);
    captionParts.push(`📦 ${fmtBytes(size)} • ${ext.toUpperCase()} • ${info.source || "extract"}`);
    const msg = captionParts.join("\n");

    await api.sendMessage({ msg, attachments: [filePath] }, threadId, type);
    return true;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function getPrefix(event) {
  return global.config?.prefix || "/";
}

function isCommandMessage(content, event) {
  const prefix = getPrefix(event);
  const text = typeof content === "string" ? content : (content?.title || content?.href || "");
  return String(text || "").trimStart().startsWith(prefix);
}

module.exports.handleEvent = async function ({ api, event, eventType, isSelf, Threads }) {
  try {
    if (eventType && eventType !== "message") return;
    if (isSelf) return;

    const threadId = event?.threadId;
    const type = event?.type ?? ThreadType.Group;
    if (!threadId) return;
    if (type !== ThreadType.Group && type !== 1) return;

    const c = cfg();
    if (c.enabled === false) return;

    if (isCommandMessage(event?.data?.content, event)) return;

    const threadData = (await Threads.getData(threadId)).data || {};
    const enabled = threadData?.autodown === true || threadData?.autodown?.enabled === true;
    if (!enabled) return;

    const urls = extractUrls(event?.data?.content, event);
    if (!urls.length) return;

    let eventErrorSent = false;
    let attemptedSupported = false;

    for (const rawUrl of urls) {
      const platform = detectPlatform(rawUrl);
      const supported = ["tiktok", "facebook", "instagram", "youtube", "twitter"].includes(platform);
      if (!supported) continue;
      attemptedSupported = true;

      const key = `${platform}:${urlKey(rawUrl)}`;
      const cached = cacheGet(key);
      if (cached) {
        if (cached.ok && cached.info) {
          if (!acquireSlot()) break;
          try {
            await downloadAndSend({ api, threadId, type, info: cached.info });
          } catch (e) {
            if (!eventErrorSent) {
              eventErrorSent = true;
              await api.sendMessage({ plain: true, msg: `❌ AutoDown: không gửi được media (${e.message})` }, threadId, type).catch(() => {});
            }
          } finally {
            releaseSlot();
          }
        }
        continue;
      }

      if (isDeduped(threadId, key)) continue;
      if (circuitOpen(platform === "facebook" || platform === "instagram" ? "meta" : platform)) continue;
      if (!consumeRate(threadId)) break;
      if (!acquireSlot()) break;

      try {
        const info = await extractByPlatform(platform, rawUrl);
        cacheSet(key, { ok: true, info });
        await downloadAndSend({ api, threadId, type, info });
      } catch (e) {
        cacheSet(key, { ok: false, error: e.message }, 60000);
        if (!eventErrorSent) {
          eventErrorSent = true;
          await api.sendMessage(
            { plain: true, msg: `❌ AutoDown: không lấy được media từ link ${platform}.\n${String(e.message || e).slice(0, 180)}` },
            threadId,
            type
          ).catch(() => {});
        }
      } finally {
        releaseSlot();
      }
    }

    void attemptedSupported;
  } catch (err) {
    try { console.error("[autodown.handleEvent]", err?.message || err); } catch {}
  }
};

module.exports.run = async function ({ api, event, args = [], Threads, reply }) {
  const { threadId, type } = event || {};
  const action = String(args[0] || "status").toLowerCase();
  const send = (msg) => reply ? reply.text(msg) : api.sendMessage({ plain: true, msg }, threadId, type);

  if (type !== ThreadType.Group && type !== 1) {
    return send("❌ /autodown chỉ dùng trong nhóm.");
  }

  const c = cfg();
  const threadData = (await Threads.getData(threadId)).data || {};
  const current = threadData?.autodown === true || threadData?.autodown?.enabled === true;

  if (action === "on" || action === "off") {
    const next = action === "on";
    threadData.autodown = { enabled: next };
    await Threads.setData(threadId, threadData);
    return send(`✅ AutoDown đã ${next ? "BẬT" : "TẮT"} cho nhóm này.`);
  }

  if (action === "status" || !action) {
    const circuitStates = ["tiktok", "youtube", "meta", "twitter", "generic"].map((p) => {
      const st = circuitMap.get(p);
      return st?.openUntil > now() ? `${p}:OPEN` : `${p}:ok`;
    }).join(", ");
    return send(
      `📥 AutoDown status\n` +
      `• Nhóm: ${current ? "BẬT" : "TẮT"}\n` +
      `• Global enabled: ${c.enabled !== false}\n` +
      `• Rate: ${c.rate_limit_max}/${Math.round(c.rate_limit_window_ms / 1000)}s\n` +
      `• Circuit: fail ${c.circuit_fail_threshold}, cooldown ${Math.round(c.circuit_cooldown_ms / 1000)}s\n` +
      `• Cache TTL: ${Math.round(c.cache_ttl_ms / 1000)}s | Dedup: ${Math.round(c.url_dedup_ttl_ms / 1000)}s\n` +
      `• Max concurrent: ${c.max_concurrent_downloads} | Max video: ${c.max_video_mb}MB\n` +
      `• Active downloads: ${activeDownloads}\n` +
      `• Circuits: ${circuitStates}`
    );
  }

  return send(`Dùng: ${global.config?.prefix || "/"}autodown on|off|status`);
};

module.exports._test = {
  extractTikTok,
  extractByPlatform,
  extractUrls,
  detectPlatform,
  urlKey
};
