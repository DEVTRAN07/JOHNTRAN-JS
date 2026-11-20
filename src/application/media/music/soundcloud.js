const fs = require("fs");
const path = require("path");
const { pooledAxios } = require("../../../../core/http/pooledAxios");
const { createTrack } = require("./models");
const db = require("../../../../utils/db");

const SOURCE = "SoundCloud";
// Official API is preferred when OAuth credentials are configured.
// The legacy api-v2 path remains as a compatibility fallback for existing
// installations that have only a public client_id configured.
const API_BASE = "https://api-v2.soundcloud.com";
const OFFICIAL_API_BASE = "https://api.soundcloud.com";
const OAUTH_TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const HOME_URL = "https://soundcloud.com/";
const CLIENT_ID_CACHE = path.resolve(__dirname, "../../../../data/soundcloud_client_id.txt");
const CLIENT_ID_TTL = 24 * 60 * 60 * 1000;
const CLIENT_ID_NEGATIVE_TTL = 5 * 60 * 1000;
const CLIENT_ID_KEY = "soundcloud_client_id";
const OAUTH_TOKEN_KEY = "soundcloud_oauth_token";
const OAUTH_EXPIRY_SKEW_MS = 60 * 1000;

let cachedClientId = null;
let discovering = null;
let negativeUntil = 0;
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;
let cachedRefreshToken = null;
let tokenDiscovering = null;

function getOAuthCredentials() {
  const musicConfig = global.config?.music || {};
  return {
    clientId: String(
      musicConfig.soundcloud_client_id ||
      process.env.SOUNDCLOUD_CLIENT_ID ||
      process.env.JT_MUSIC__SOUNDCLOUD_CLIENT_ID ||
      ""
    ).trim(),
    clientSecret: String(
      musicConfig.soundcloud_client_secret ||
      process.env.SOUNDCLOUD_CLIENT_SECRET ||
      process.env.JT_MUSIC__SOUNDCLOUD_CLIENT_SECRET ||
      ""
    ).trim()
  };
}

function hasOAuthCredentials() {
  const credentials = getOAuthCredentials();
  return Boolean(credentials.clientId && credentials.clientSecret);
}

function readCachedOAuthToken() {
  try {
    const row = db.getData("BotStats", "name", OAUTH_TOKEN_KEY);
    const data = row?.data || {};
    if (typeof data.accessToken === "string" &&
        data.accessToken.length > 10 &&
        Number.isFinite(Number(data.expiresAt))) {
      return {
        accessToken: data.accessToken,
        expiresAt: Number(data.expiresAt),
        refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : ""
      };
    }
  } catch { /* token cache is optional */ }
  return null;
}

function writeCachedOAuthToken(token) {
  if (!token?.accessToken) return;
  try {
    db.saveData("BotStats", "name", OAUTH_TOKEN_KEY, {
      accessToken: token.accessToken,
      expiresAt: Number(token.expiresAt) || 0,
      refreshToken: token.refreshToken || ""
    });
  } catch { /* authentication still works for the current process */ }
}

async function requestOAuthToken(credentials, refreshToken = "") {
  const authorization = Buffer.from(
    credentials.clientId + ":" + credentials.clientSecret,
    "utf8"
  ).toString("base64");
  const fields = refreshToken
    ? { grant_type: "refresh_token", refresh_token: refreshToken }
    : { grant_type: "client_credentials" };

  const response = await pooledAxios.post(
    OAUTH_TOKEN_URL,
    new URLSearchParams(fields).toString(),
    {
      timeout: 15000,
      __retryLimit: 0,
      headers: {
        Authorization: "Basic " + authorization,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  const body = response?.data || {};
  const accessToken = String(body.access_token || "").trim();
  if (!accessToken) {
    throw new Error(
      "SoundCloud OAuth không trả access_token. " +
      String(body.error_description || body.error || "Kiểm tra Client ID/Client Secret.")
    );
  }
  const expiresIn = Math.max(60, Number(body.expires_in) || 3600);
  return {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: String(body.refresh_token || (refreshToken || "")).trim()
  };
}

async function discoverAccessToken(forceRefresh = false) {
  const credentials = getOAuthCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    const error = new Error(
      "Thiếu SoundCloud API credentials. Hãy cấu hình music.soundcloud_client_id " +
      "và music.soundcloud_client_secret trong config.yml hoặc biến môi trường JT_MUSIC__SOUNDCLOUD_CLIENT_ID / JT_MUSIC__SOUNDCLOUD_CLIENT_SECRET."
    );
    error.needCredentials = true;
    error.notAvailable = true;
    throw error;
  }

  if (!forceRefresh && cachedAccessToken &&
      accessTokenExpiresAt - Date.now() > OAUTH_EXPIRY_SKEW_MS) {
    return cachedAccessToken;
  }
  if (tokenDiscovering) return tokenDiscovering;

  tokenDiscovering = (async () => {
    let previous = null;
    if (!forceRefresh) {
      previous = readCachedOAuthToken();
      if (previous && previous.expiresAt - Date.now() > OAUTH_EXPIRY_SKEW_MS) {
        cachedAccessToken = previous.accessToken;
        accessTokenExpiresAt = previous.expiresAt;
        cachedRefreshToken = previous.refreshToken || null;
        return cachedAccessToken;
      }
    } else {
      previous = readCachedOAuthToken();
    }

    // Refresh tokens are single-use. Reuse the most recently persisted value;
    // when the provider does not issue one, request a new client-credentials token.
    const refreshToken = previous?.refreshToken || cachedRefreshToken || "";
    let next;
    try {
      next = await requestOAuthToken(credentials, refreshToken);
    } catch (error) {
      if (!refreshToken) throw error;
      // A stale/rotated refresh token must not prevent a fresh client-credentials grant.
      next = await requestOAuthToken(credentials);
    }

    cachedAccessToken = next.accessToken;
    accessTokenExpiresAt = next.expiresAt;
    cachedRefreshToken = next.refreshToken || null;
    writeCachedOAuthToken(next);
    return cachedAccessToken;
  })();

  try {
    return await tokenDiscovering;
  } finally {
    tokenDiscovering = null;
  }
}

function clearCachedOAuthToken() {
  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
  // Keep the last refresh token so a 401 can rotate it on the next request.
}

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

// Resolve a rotating SoundCloud client_id from current web bundles in parallel.
// The old serial scan could spend 25s × 25 scripts before a search failed.
const CLIENT_ID_SCRIPT_LIMIT = 8;
const CLIENT_ID_SCRIPT_TIMEOUT_MS = 8000;
const CLIENT_ID_HOME_TIMEOUT_MS = 9000;

async function discoverClientIdFromScripts(scriptUrls, request = pooledAxios.get) {
  const urls = [...new Set(Array.isArray(scriptUrls) ? scriptUrls : [])]
    .slice(0, CLIENT_ID_SCRIPT_LIMIT);
  if (!urls.length) return null;
  const controller = new AbortController();
  const attempts = urls.map(async scriptUrl => {
    const response = await request(scriptUrl, {
      timeout: CLIENT_ID_SCRIPT_TIMEOUT_MS,
      signal: controller.signal,
      __retryLimit: 0,
      responseType: "text",
      transformResponse: [(body) => body],
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
    });
    const js = typeof response.data === "string"
      ? response.data
      : Buffer.from(response.data || []).toString("utf8");
    const clientId = extractClientId(js) || extractClientId(scriptUrl);
    if (!clientId) throw new Error("SoundCloud bundle không chứa client_id.");
    return clientId;
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  } finally {
    controller.abort();
  }
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
          timeout: CLIENT_ID_HOME_TIMEOUT_MS,
          __retryLimit: 0,
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
      const scriptClientId = await discoverClientIdFromScripts(scriptUrlsFromHtml(html));
      if (scriptClientId) {
        cachedClientId = scriptClientId;
        writeCachedClientId(scriptClientId);
        negativeUntil = 0;
        return scriptClientId;
      }
      try {
        const response = await pooledAxios.get("https://w.soundcloud.com/player/api.js", {
          timeout: 8000,
          __retryLimit: 0,
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
    const response = await pooledAxios.get(url, {
      timeout: 12000,
      __retryLimit: 1,
      headers: { Accept: "application/json" }
    });
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

async function officialApiGet(apiPath, params = {}, retry = true) {
  const accessToken = await discoverAccessToken();
  const url = new URL(apiPath.replace(/^\/+/, ""), OFFICIAL_API_BASE + "/");
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await pooledAxios.get(url.toString(), {
      timeout: 15000,
      __retryLimit: 1,
      headers: {
        Accept: "application/json",
        Authorization: "OAuth " + accessToken
      }
    });
    const status = Number(response?.status || 0);
    const data = response?.data;
    if (status === 401 && retry) {
      clearCachedOAuthToken();
      await discoverAccessToken(true);
      return officialApiGet(apiPath, params, false);
    }
    if (status >= 400) {
      const message = data?.errors?.[0]?.error_message ||
        data?.message || data?.error || "HTTP " + status;
      const error = new Error("SoundCloud API chính thức lỗi HTTP " + status + ": " + message);
      error.status = status;
      error.notAvailable = true;
      throw error;
    }
    if (data && Array.isArray(data.errors) && data.errors.length) {
      const error = new Error(String(data.errors[0].error_message || data.errors[0]));
      error.notAvailable = true;
      throw error;
    }
    return data;
  } catch (error) {
    const status = Number(error?.response?.status || error?.status || 0);
    if (retry && status === 401) {
      clearCachedOAuthToken();
      await discoverAccessToken(true);
      return officialApiGet(apiPath, params, false);
    }
    if (error.notAvailable || error.status || error.response) throw error;
    throw error;
  }
}

function toTrack(item) {
  return createTrack({
    id: item.id,
    urn: item.urn || (item.id ? "soundcloud:tracks:" + item.id : ""),
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
  const maxResults = Math.max(wanted, 40);
  const data = hasOAuthCredentials()
    ? await officialApiGet("/tracks", {
      q: query,
      limit: maxResults,
      access: "playable",
      linked_partitioning: "true"
    })
    : await apiGet("/search/tracks", { q: query, limit: maxResults });
  const collection = Array.isArray(data) ? data : (data ? data.collection : []);
  const tracks = collection
    .filter((item) => item && item.id &&
      item.access !== "blocked" &&
      !(item.policy || "").toUpperCase().includes("BLOCK"))
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

async function resolveTranscodingUrl(transcoding, clientId, retryAuth = true, accessToken = null) {
  let streamUrl;
  try {
    streamUrl = new URL(transcoding.url);
    if (clientId) streamUrl.searchParams.set("client_id", clientId);

    const response = await pooledAxios.get(streamUrl.toString(), {
      timeout: 12000,
      __retryLimit: 0,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Accept: "application/json, application/vnd.apple.mpegurl, audio/*, */*",
        ...(accessToken ? { Authorization: "OAuth " + accessToken } : {})
      }
    });

    const resolvedUrl = extractResolvedStreamUrl(response, streamUrl.toString());
    if (!resolvedUrl) {
      const contentType = getResponseHeader(response.headers, "content-type") || "không rõ";
      throw new Error(`HTTP ${response.status}: SoundCloud không trả URL stream (Content-Type: ${contentType}).`);
    }
    return resolvedUrl;
  } catch (err) {
    const status = Number(err?.response?.status || err?.status || 0);
    if (retryAuth && accessToken && status === 401) {
      clearCachedOAuthToken();
      const refreshedToken = await discoverAccessToken(true);
      return resolveTranscodingUrl(transcoding, null, false, refreshedToken);
    }
    if (retryAuth && !accessToken && (status === 401 || status === 403)) {
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

function selectResolveCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  // Resolve only the best HLS stream plus one fallback; don't request every
  // HLS/progressive variant serially for each selected song.
  const hls = list.filter(item => item?.protocol === "hls").slice(0, 2);
  if (hls.length) return hls;
  const progressive = list.find(item => item?.protocol === "progressive");
  return progressive ? [progressive] : [];
}

function getOfficialTranscodingCandidates(streams) {
  const source = streams && typeof streams === "object" ? streams : {};
  // SoundCloud removed progressive MP3 and is migrating its catalogue to AAC.
  // Keep HLS MP3 as a fallback for older tracks that have not been retranscoded.
  return [
    ["hls_aac_160_url", "aac_160"],
    ["hls_aac_96_url", "aac_96"],
    ["hls_mp3_128_url", "mp3_128"]
  ].flatMap(([field, quality]) => {
    const url = source[field];
    if (typeof url !== "string" || !/^https:\/\//i.test(url)) return [];
    return [{ item: { url }, protocol: "hls", quality }];
  });
}

async function resolveOfficialTrack(track) {
  const urn = String(track?.urn || (track?.id ? "soundcloud:tracks:" + track.id : "")).trim();
  if (!urn) throw new Error("SoundCloud không trả track URN để lấy luồng phát.");

  const streams = await officialApiGet(
    "/tracks/" + encodeURIComponent(urn) + "/streams"
  );
  const candidates = getOfficialTranscodingCandidates(streams);
  if (!candidates.length) {
    const error = new Error(
      "Bài hát này chưa có luồng AAC HLS/MP3 HLS hoặc bị giới hạn quyền phát trên SoundCloud."
    );
    error.notAvailable = true;
    throw error;
  }

  const accessToken = await discoverAccessToken();
  const attempts = await Promise.all(candidates.map(async candidate => {
    try {
      return {
        candidate,
        url: await resolveTranscodingUrl(candidate.item, null, true, accessToken)
      };
    } catch (error) {
      return { candidate, error };
    }
  }));
  const successful = attempts.filter(item => item.url);
  if (!successful.length) {
    const error = attempts[0]?.error ||
      new Error("SoundCloud không trả được địa chỉ AAC HLS hợp lệ.");
    error.notAvailable = true;
    throw error;
  }

  return {
    url: successful[0].url,
    protocol: "hls",
    fallbackUrls: [...new Set(successful.slice(1).map(item => item.url))]
  };
}

async function resolve(track) {
  if (hasOAuthCredentials()) return resolveOfficialTrack(track);

  const clientId = await discoverClientId();
  const data = await apiGet("/tracks/" + encodeURIComponent(track.id));
  const transcodings = data && data.media && data.media.transcodings ? data.media.transcodings : [];
  const candidates = selectResolveCandidates(getTranscodingCandidates(transcodings));
  if (!candidates.length) {
    const error = new Error(
      "Bài hát không có luồng phát trên API SoundCloud cũ. " +
      "Nên cấu hình music.soundcloud_client_secret để chuyển sang API chính thức (AAC HLS)."
    );
    error.notAvailable = true;
    throw error;
  }

  const attempts = await Promise.all(candidates.map(async candidate => {
    try {
      return { candidate, url: await resolveTranscodingUrl(candidate.item, clientId) };
    } catch (error) {
      return { candidate, error };
    }
  }));
  const successful = attempts.filter(item => item.url);
  if (successful.length) {
    if (successful[0].candidate.protocol !== "hls") return successful[0].url;
    return {
      url: successful[0].url,
      protocol: "hls",
      fallbackUrls: [...new Set(successful.slice(1).map(item => item.url))]
    };
  }
  const error = attempts[0]?.error ||
    new Error("SoundCloud không cung cấp URL stream hợp lệ.");
  error.notAvailable = true;
  throw error;
}

module.exports = {
  name: "scl",
  label: SOURCE,
  search,
  resolve,
  _test: {
    isValidClientId,
    scriptUrlsFromHtml,
    extractClientId,
    getTranscodingCandidates,
    getOfficialTranscodingCandidates,
    selectResolveCandidates,
    discoverClientIdFromScripts,
    getOAuthCredentials,
    hasOAuthCredentials,
    requestOAuthToken,
    discoverAccessToken,
    clearCachedOAuthToken,
    resetAuthCache() {
      cachedClientId = null;
      discovering = null;
      negativeUntil = 0;
      cachedAccessToken = null;
      accessTokenExpiresAt = 0;
      cachedRefreshToken = null;
      tokenDiscovering = null;
    },
    pickTranscoding,
    extractResolvedStreamUrl,
    CLIENT_ID_SCRIPT_LIMIT,
    CLIENT_ID_SCRIPT_TIMEOUT_MS
  }
};