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

function getTranscodingCandidates(transcodings) {
  const list = Array.isArray(transcodings) ? transcodings.filter(Boolean) : [];
  const isHls = (item) => item?.format?.protocol === "hls";
  const isAacHls = (item) => isHls(item) && /aac|m4a/i.test([
    item?.url,
    item?.preset,
    item?.format?.mime_type
  ].filter(Boolean).join(" "));

  const qualityRank = (item) => {
    const value = [item?.url, item?.preset, item?.format?.mime_type].filter(Boolean).join(" ");
    const match = value.match(/(?:aac|m4a)[_-]?(256|160|96)|(?:^|[^0-9])(256|160|96)(?:k|kbps)?/i);
    const quality = Number(match?.[1] || match?.[2] || 0);
    return quality || 0;
  };

  const aac = list.filter(isAacHls).sort((left, right) => qualityRank(right) - qualityRank(left));
  const otherHls = list.filter((item) => isHls(item) && !isAacHls(item));
  const progressive = list.filter((item) => item?.format?.protocol === "progressive");
  return [
    ...aac.map((item) => ({ item, protocol: "hls" })),
    ...otherHls.map((item) => ({ item, protocol: "hls" })),
    ...progressive.map((item) => ({ item, protocol: "progressive" }))
  ];
}

function pickTranscoding(transcodings) {
  return getTranscodingCandidates(transcodings)[0] || null;
}

function getResponseHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function extractResolvedStreamUrl(response, requestUrl) {
  if (!response) return null;
  const status = Number(response.status) || 0;
  const location = getResponseHeader(response.headers, "location");

  if ([301, 302, 303, 307, 308].includes(status) && location) {
    const redirected = new URL(String(location), requestUrl);
    return /^https?:$/.test(redirected.protocol) ? redirected.toString() : null;
  }

  let payload = response.data;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    try { payload = JSON.parse(trimmed); } catch { /* có thể là playlist trực tiếp */ }
  }

  const candidates = [
    payload?.url,
    payload?.data?.url,
    payload?.location,
    payload?.data?.location,
    payload?.redirect_url,
    payload?.data?.redirect_url
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const resolved = new URL(candidate.trim(), requestUrl);
      if (/^https?:$/.test(resolved.protocol)) return resolved.toString();
    } catch { /* thử trường URL kế tiếp */ }
  }

  const contentType = String(getResponseHeader(response.headers, "content-type")).toLowerCase();
  const textBody = typeof payload === "string" ? payload.trim() : "";
  if (status >= 200 && status < 300 && (
    /^(audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl)/i.test(contentType) ||
    textBody.startsWith("#EXTM3U")
  )) {
    // Một số response trả thẳng audio/playlist thay vì JSON hoặc redirect.
    return requestUrl;
  }
  return null;
}

async function resolveTranscodingUrl(transcoding, clientId, retryAuth = true) {
  let streamUrl;
  try {
    streamUrl = new URL(transcoding.url);
    streamUrl.searchParams.set("client_id", clientId);

    const response = await pooledAxios.get(streamUrl.toString(), {
      timeout: 25000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { Accept: "application/json, application/vnd.apple.mpegurl, audio/*, */*" }
    });

    const resolvedUrl = extractResolvedStreamUrl(response, streamUrl.toString());
    if (!resolvedUrl) {
      const contentType = getResponseHeader(response.headers, "content-type") || "không rõ";
      throw new Error(`HTTP ${response.status}: SoundCloud không trả URL stream (Content-Type: ${contentType}).`);
    }
    return resolvedUrl;
  } catch (err) {
    const status = Number(err?.response?.status || err?.status || 0);
    if (retryAuth && (status === 401 || status === 403)) {
      clearCachedClientId();
      const refreshedClientId = await discoverClientId();
      if (refreshedClientId && refreshedClientId !== clientId) {
        return resolveTranscodingUrl(transcoding, refreshedClientId, false);
      }
    }

    const apiMessage = err?.response?.data?.errors?.[0]?.error_message ||
      err?.response?.data?.message || err?.message || String(err);
    const error = new Error(
      status
        ? `SoundCloud không lấy được stream (HTTP ${status}): ${apiMessage}`
        : `SoundCloud không lấy được stream: ${apiMessage}`
    );
    error.notAvailable = true;
    error.status = status || undefined;
    throw error;
  }
}

async function resolve(track) {
  const clientId = await discoverClientId();
  const data = await apiGet("/tracks/" + encodeURIComponent(track.id));
  const transcodings = data && data.media && data.media.transcodings ? data.media.transcodings : [];
  const candidates = getTranscodingCandidates(transcodings);
  if (!candidates.length) {
    const error = new Error("Bài hát này không có luồng phát được (có thể bị giới hạn bản quyền hoặc khu vực).");
    error.notAvailable = true;
    throw error;
  }

  const resolvedHls = [];
  const resolveErrors = [];
  for (const candidate of candidates) {
    try {
      const url = await resolveTranscodingUrl(candidate.item, clientId);
      if (candidate.protocol === "hls") {
        resolvedHls.push(url);
        // Cần giữ thêm URL chất lượng thấp hơn để thử khi playlist 160k lỗi.
        continue;
      }
      if (!resolvedHls.length) return url;
    } catch (error) {
      resolveErrors.push(error?.message || String(error));
    }
  }

  if (resolvedHls.length) {
    return {
      url: resolvedHls[0],
      protocol: "hls",
      fallbackUrls: [...new Set(resolvedHls.slice(1))]
    };
  }

  const error = new Error(resolveErrors[0] || "SoundCloud không cung cấp URL stream hợp lệ.");
  error.notAvailable = true;
  throw error;
}

module.exports = {
  name: "scl",
  label: SOURCE,
  search,
  resolve,
  _test: { isValidClientId, scriptUrlsFromHtml, extractClientId, getTranscodingCandidates, pickTranscoding, extractResolvedStreamUrl }
};