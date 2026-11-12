const fs = require("fs");
const path = require("path");
const { pooledAxios } = require("../http/pooledAxios");
const { createTrack } = require("./models");
const db = require("../../utils/db");

const SOURCE = "SoundCloud";
const API_BASE = "https://api-v2.soundcloud.com";
const HOME_URL = "https://soundcloud.com/";
const CLIENT_ID_CACHE = path.join(__dirname, "..", "..", "data", "soundcloud_client_id.txt");
const CLIENT_ID_TTL = 24 * 60 * 60 * 1000;
const CLIENT_ID_NEGATIVE_TTL = 5 * 60 * 1000;
const CLIENT_ID_KEY = "soundcloud_client_id";

let cachedClientId = null;
let discovering = null;
let negativeUntil = 0;

function readCachedClientId() {
  try {
    const raw = fs.readFileSync(CLIENT_ID_CACHE, "utf8").trim();
    const [clientId, timestamp] = raw.split("|");
    if (isValidClientId(clientId) && timestamp && Number.isFinite(Number(timestamp)) &&
        Date.now() - Number(timestamp) < CLIENT_ID_TTL) return clientId;
  } catch { /* bo qua */ }
  return null;
}

function writeCachedClientId(clientId) {
  try {
    fs.mkdirSync(path.dirname(CLIENT_ID_CACHE), { recursive: true });
    fs.writeFileSync(CLIENT_ID_CACHE, clientId + "|" + Date.now(), "utf8");
  } catch { /* bo qua */ }
  try {
    db.saveData("BotStats", "name", CLIENT_ID_KEY, { value: clientId });
  } catch { /* bo qua */ }
}

function clearCachedClientId() {
  cachedClientId = null;
  negativeUntil = 0;
  try { fs.unlinkSync(CLIENT_ID_CACHE); } catch { /* bo qua */ }
  try { db.saveData("BotStats", "name", CLIENT_ID_KEY, { value: "" }); } catch { /* bo qua */ }
}

function isValidClientId(value) {
  return /^[A-Za-z0-9]{32}$/.test(String(value || "").trim());
}

function scriptUrlsFromHtml(html) {
  const urls = [];
  const re = /<script\b[^>]*?\b(?:src|data-src)\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    const src = String(match[2] || "").trim();
    if (!src || !/\.m?js(?:[?#]|$)/i.test(src)) continue;
    try {
      const url = new URL(src, HOME_URL);
      const host = url.hostname.toLowerCase();
      if (host === "soundcloud.com" || host.endsWith(".soundcloud.com") ||
          host === "sndcdn.com" || host.endsWith(".sndcdn.com")) {
        urls.push(url.toString());
      }
    } catch { /* bỏ URL script không hợp lệ */ }
  }
  return [...new Set(urls)].sort((a, b) => {
    const score = (url) => /sndcdn\.com/i.test(url) ? 2 : /soundcloud\.com/i.test(url) ? 1 : 0;
    return score(b) - score(a);
  });
}

function extractClientId(source) {
  const text = String(source || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x3d/gi, "=")
    .replace(/&amp;/gi, "&");
  const patterns = [
    /[?&]client_id=([A-Za-z0-9]{32})/i,
    /(?:client_id|clientId)\s*[=:]\s*["']?([A-Za-z0-9]{32})/i,
    /["'](?:client_id|clientId)["']\s*:\s*["']([A-Za-z0-9]{32})["']/i,
    /client_id%3[dD]([A-Za-z0-9]{32})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && isValidClientId(match[1])) return match[1];
  }
  return null;
}

async function discoverClientId() {
  const configured = String(
    global.config?.music?.soundcloud_client_id ||
    process.env.SOUNDCLOUD_CLIENT_ID ||
    process.env.JT_MUSIC__SOUNDCLOUD_CLIENT_ID ||
    ""
  ).trim();
  if (isValidClientId(configured)) return configured;
  if (cachedClientId) return cachedClientId;

  const cached = readCachedClientId();
  if (cached) {
    cachedClientId = cached;
    return cached;
  }

  try {
    const row = db.getData("BotStats", "name", CLIENT_ID_KEY);
    const stored = row?.data?.value;
    if (isValidClientId(stored)) {
      cachedClientId = stored;
      return stored;
    }
  } catch { /* bo qua */ }

  if (discovering) return discovering;
  if (Date.now() < negativeUntil) {
    const error = new Error("Dich vu SoundCloud tam thoi khong kha dung (khong lay duoc client_id), vui long thu lai sau hoac dat music.soundcloud_client_id.");
    error.notAvailable = true;
    throw error;
  }

  discovering = (async () => {
    try {
      let home;
      try {
        const response = await pooledAxios.get(HOME_URL, {
          timeout: 25000,
          responseType: "text",
          transformResponse: [(body) => body],
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          }
        });
        const rawHtml = typeof response.data === "string" ? response.data : Buffer.from(response.data || []).toString("utf8");
        home = { status: response.status, body: Buffer.from(rawHtml) };
      } catch (error) {
        const err = new Error("Khong ket noi duoc trang chu SoundCloud de lay client_id: " + (error && error.message ? error.message : error));
        err.notAvailable = true;
        err.cause = error;
        throw err;
      }
      if (home && home.status >= 400) {
        const err = new Error("Trang chu SoundCloud tra ve loi " + home.status + " khi lay client_id.");
        err.notAvailable = true;
        throw err;
      }
      const html = home && home.body ? home.body.toString("utf8") : "";
      const fromHtml = extractClientId(html);
      if (fromHtml) {
        cachedClientId = fromHtml;
        writeCachedClientId(fromHtml);
        negativeUntil = 0;
        return fromHtml;
      }
      const scriptUrls = scriptUrlsFromHtml(html).slice(0, 25);
      for (const scriptUrl of scriptUrls) {
        try {
          const response = await pooledAxios.get(scriptUrl, {
            timeout: 25000,
            responseType: "text",
            transformResponse: [(body) => body],
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
          });
          const js = typeof response.data === "string" ? response.data : Buffer.from(response.data || []).toString("utf8");
          const clientId = extractClientId(js) || extractClientId(scriptUrl);
          if (clientId) {
            cachedClientId = clientId;
            writeCachedClientId(clientId);
            negativeUntil = 0;
            return clientId;
          }
        } catch {
          continue;
        }
      }
      try {
        const response = await pooledAxios.get("https://w.soundcloud.com/player/api.js", {
          timeout: 20000,
          responseType: "text",
          transformResponse: [(body) => body],
          headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
        });
        const wjs = typeof response.data === "string" ? response.data : Buffer.from(response.data || []).toString("utf8");
        const wid = extractClientId(wjs);
        if (wid) {
          cachedClientId = wid;
          writeCachedClientId(wid);
          negativeUntil = 0;
          return wid;
        }
      } catch { /* bo qua */ }
      negativeUntil = Date.now() + CLIENT_ID_NEGATIVE_TTL;
      const error = new Error("Khong tim thay client_id cua SoundCloud (trang web da thay doi cau truc). Thu dat music.soundcloud_client_id trong config.");
      error.notAvailable = true;
      throw error;
    } finally {
      discovering = null;
    }
  })();
  return discovering;
}

async function apiGet(apiPath, params = {}, retry = true) {
  const clientId = await discoverClientId();
  const query = new URLSearchParams({ ...params, client_id: clientId });
  const url = API_BASE + apiPath + "?" + query.toString();
  try {
    const response = await pooledAxios.get(url, { headers: { Accept: "application/json" } });
    const status = response.status;
    const data = response.data;
    if ((status === 401 || status === 403) && retry) {
      clearCachedClientId();
      return apiGet(apiPath, params, false);
    }
    if (status >= 400) {
      const msg = data && (data.errors && data.errors[0] && data.errors[0].error_message || data.message || data.error)
        ? ((data.errors && data.errors[0] && data.errors[0].error_message) || data.message || data.error)
        : ("SoundCloud API loi " + status);
      const error = new Error(String(msg));
      if (status === 401 || status === 403 || status === 429) error.notAvailable = true;
      error.status = status;
      throw error;
    }
    if (data && Array.isArray(data.errors) && data.errors.length) {
      const error = new Error(String(data.errors[0].error_message || data.errors[0] || "Loi SoundCloud API"));
      error.notAvailable = true;
      throw error;
    }
    return data;
  } catch (error) {
    const status = Number(error?.response?.status || error?.status || 0);
    if (retry && (status === 401 || status === 403)) {
      clearCachedClientId();
      return apiGet(apiPath, params, false);
    }
    if (error.notAvailable || error.status || error.response) throw error;
    throw error;
  }
}

function toTrack(item) {
  return createTrack({
    id: item.id,
    title: item.title,
    artist: item.user ? item.user.username : null,
    duration: Math.round((item.duration || item.full_duration || 0) / 1000),
    thumbnail: (item.artwork_url || "").replace("-large.", "-t500x500."),
    source: SOURCE,
    sourceUrl: item.permalink_url,
    plays: item.playback_count || 0,
    likes: item.likes_count || item.favoritings_count || 0,
    previewUrl: item.media && item.media.transcodings ? (item.media.transcodings.find((t) => t.format && t.format.protocol === "hls") || {}).url || "" : ""
  });
}

function popularity(item) {
  return (item.playback_count || 0) + (item.likes_count || item.favoritings_count || 0) * 3;
}

async function search(query, limit) {
  const wanted = Math.max(Number(limit) || 20, 20);
  const data = await apiGet("/search/tracks", { q: query, limit: Math.max(wanted, 40) });
  const collection = data ? data.collection : [];
  const tracks = collection
    .filter((item) => item && item.id && !(item.policy || "").includes("BLOCK"))
    .sort((a, b) => popularity(b) - popularity(a))
    .slice(0, wanted)
    .map(toTrack);
  return tracks;
}

function pickTranscoding(transcodings) {
  const list = Array.isArray(transcodings) ? transcodings : [];
  const progressive = list.find((item) => item && item.format && item.format.protocol === "progressive");
  if (progressive) return { item: progressive, protocol: "progressive" };
  const hlsAac = list.find((item) => item && item.format && item.format.protocol === "hls" && /aac/i.test(item.format.mime_type || item.preset || ""));
  if (hlsAac) return { item: hlsAac, protocol: "hls" };
  const hlsAny = list.find((item) => item && item.format && item.format.protocol === "hls");
  if (hlsAny) return { item: hlsAny, protocol: "hls" };
  return null;
}

async function resolveTranscodingUrl(transcoding, clientId) {
  try {
    const streamUrl = new URL(transcoding.url);
    streamUrl.searchParams.set("client_id", clientId);
    const response = await pooledAxios.get(streamUrl.toString(), { timeout: 25000 });
    const stream = response.data;
    if (!stream || !stream.data || !stream.data.url) {
      const error = new Error("Khong lay duoc link stream tu SoundCloud");
      error.notAvailable = true;
      throw error;
    }
    return stream.data.url;
  } catch (err) {
    const error = new Error("Khong lay duoc link stream tu SoundCloud: " + (err && err.message ? err.message : err));
    error.notAvailable = true;
    throw error;
  }
}

async function resolve(track) {
  const clientId = await discoverClientId();
  const data = await apiGet("/tracks/" + encodeURIComponent(track.id));
  const transcodings = data && data.media && data.media.transcodings ? data.media.transcodings : [];
  const picked = pickTranscoding(transcodings);
  if (!picked) {
    const error = new Error("Bai hat nay khong co ban tai xuong (co the la Go+ hoac bi gioi han vung/ban quyen)");
    error.notAvailable = true;
    throw error;
  }
  try {
    const url = await resolveTranscodingUrl(picked.item, clientId);
    if (picked.protocol === "hls") return { url, protocol: "hls" };
    return url;
  } catch (err) {
    if (picked.protocol === "progressive") {
      const hlsAac = transcodings.find((item) => item && item.format && item.format.protocol === "hls" && /aac/i.test(item.format.mime_type || item.preset || ""));
      const hlsAny = transcodings.find((item) => item && item.format && item.format.protocol === "hls");
      const hls = hlsAac || hlsAny;
      if (hls) {
        try {
          const url = await resolveTranscodingUrl(hls, clientId);
          return { url, protocol: "hls" };
        } catch { }
      }
    }
    throw err;
  }
}

module.exports = {
  name: "scl",
  label: SOURCE,
  search,
  resolve,
  _test: { isValidClientId, scriptUrlsFromHtml, extractClientId }
};