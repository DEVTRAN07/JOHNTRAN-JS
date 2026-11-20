"use strict";

const ROUND_SECONDS = 90;
const CORRECT_POINTS = 10;
const API_BASE = "https://dict.minhqnd.com/api/v1";
const API_TIMEOUT_MS = 1800;
const API_PREFIX_ATTEMPTS = 4;
const API_LOOKUP_BATCH = 8;
const API_POOL_MAX = 160;
const API_CACHE_TTL_MS = 10 * 60 * 1000;
const LOOKUP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const HINT_TEXT = "Chữ cái VIẾT HOA là chữ cái đầu tiên của từ cần tìm!";

const FALLBACK_WORD_BANK = Object.freeze([
  { answer: "trí tuệ", definition: "Khả năng suy nghĩ, hiểu biết và nhận thức." },
  { answer: "học sinh", definition: "Người học tập tại trường phổ thông." },
  { answer: "mặt trời", definition: "Ngôi sao chiếu sáng và sưởi ấm Trái Đất." },
  { answer: "bầu trời", definition: "Khoảng không gian rộng lớn phía trên chúng ta." },
  { answer: "máy tính", definition: "Thiết bị dùng để xử lý thông tin và dữ liệu." },
  { answer: "bông hoa", definition: "Bộ phận thường có màu sắc đẹp của cây." },
  { answer: "cây xanh", definition: "Thực vật có thân, cành và lá." },
  { answer: "tình bạn", definition: "Mối quan hệ thân thiết giữa những người quý mến nhau." },
  { answer: "sáng tạo", definition: "Tạo ra ý tưởng hoặc sản phẩm mới mẻ." },
  { answer: "kiên trì", definition: "Bền bỉ theo đuổi mục tiêu, không dễ bỏ cuộc." },
  { answer: "thành công", definition: "Đạt được kết quả tốt như mong muốn." },
  { answer: "hạnh phúc", definition: "Trạng thái vui vẻ và hài lòng trong cuộc sống." },
  { answer: "đại dương", definition: "Vùng biển rộng lớn bao phủ phần lớn Trái Đất." },
  { answer: "quả bóng", definition: "Dụng cụ hình tròn thường dùng trong thể thao." },
  { answer: "cánh đồng", definition: "Khu đất rộng dùng để trồng lúa hoặc hoa màu." },
  { answer: "đồng hồ", definition: "Vật dụng dùng để xem giờ." },
  { answer: "ngôi sao", definition: "Thiên thể phát sáng trên bầu trời đêm." },
  { answer: "mùa hè", definition: "Mùa nóng nhất trong năm ở miền Bắc Việt Nam." },
  { answer: "việt nam", definition: "Tên đất nước hình chữ S." },
  { answer: "trường học", definition: "Nơi thầy cô dạy và học sinh học tập." },
  { answer: "gia đình", definition: "Nơi có những người thân yêu cùng gắn bó." },
  { answer: "bình minh", definition: "Khoảnh khắc mặt trời bắt đầu mọc." },
  { answer: "hoàng hôn", definition: "Khoảnh khắc mặt trời lặn cuối ngày." },
  { answer: "âm nhạc", definition: "Nghệ thuật sử dụng âm thanh và giai điệu." },
  { answer: "thư viện", definition: "Nơi lưu giữ và cho mượn sách." },
  { answer: "bảo vệ", definition: "Giữ gìn để tránh bị tổn hại." },
  { answer: "lòng tốt", definition: "Sự tử tế và sẵn lòng giúp đỡ người khác." },
  { answer: "ước mơ", definition: "Điều đẹp đẽ mà mỗi người mong muốn đạt được." },
  { answer: "khám phá", definition: "Tìm hiểu điều mới lạ chưa biết." },
  { answer: "môi trường", definition: "Không gian sống của con người và sinh vật." }
]);

const PREFIXES = Object.freeze([
  "trí", "học", "mặt", "bầu", "máy", "bông", "cây", "tình", "sáng",
  "kiên", "thành", "hạnh", "đại", "quả", "cánh", "đồng", "ngôi", "mùa",
  "việt", "trường", "gia", "bình", "hoàng", "âm", "thư", "bảo", "lòng",
  "ước", "khám", "môi", "sinh", "đất", "nước", "con", "người", "văn",
  "lịch", "thiên", "nhiên", "tâm", "phong", "đẹp", "yêu", "quê", "hương",
  "sức", "khỏe", "thể", "thao", "học", "tập", "lao", "động", "hữu",
  "bạn", "bè", "chăm", "chỉ", "trung", "thực", "dũng", "cảm", "tự", "tin",
  "khoa", "học", "kỹ", "thuật", "công", "nghệ", "điện", "thoại", "phần", "mềm",
  "động", "vật", "thực", "vật", "núi", "rừng", "sông", "suối", "biển", "đảo",
  "mưa", "nắng", "gió", "bão", "mây", "sấm", "chớp", "lửa", "đá", "cát"
]);

const sessions = new Map();
const suggestionCache = new Map();
const lookupCache = new Map();
const termLookupCache = new Map();
const apiWordPool = new Map();
let refreshPromise = null;

function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}]/gu, "");
}

function normalizePhrase(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlayablePhrase(value) {
  const phrase = normalizePhrase(value);
  const words = phrase.split(" ").filter(Boolean);
  const letters = Array.from(phrase.replace(/\s/g, ""));
  return words.length >= 2 &&
    words.length <= 3 &&
    letters.length >= 5 &&
    letters.length <= 14 &&
    words.every(word => Array.from(word).length >= 1 && Array.from(word).length <= 9);
}

function formatPuzzleLetters(answer) {
  const words = normalizePhrase(answer).split(" ").filter(Boolean);
  const marked = [];
  for (const word of words) {
    const chars = Array.from(word);
    if (!chars.length) continue;
    marked.push(chars[0].toLocaleUpperCase("vi-VN"));
    marked.push(...chars.slice(1));
  }
  return marked;
}

function shuffleLetters(answer, random = Math.random) {
  const letters = formatPuzzleLetters(answer);
  if (letters.length < 2) return letters;

  let shuffled = letters.slice();
  for (let attempt = 0; attempt < 16; attempt++) {
    shuffled = letters.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.join("") !== letters.join("")) return shuffled;
  }
  return letters.slice(1).concat(letters[0]);
}

function randomize(items, random = Math.random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function extractSuggestionWords(payload) {
  const containers = [
    payload,
    payload?.suggestions,
    payload?.results,
    payload?.words,
    payload?.items,
    payload?.data,
    payload?.data?.suggestions,
    payload?.data?.results,
    payload?.data?.words,
    payload?.data?.items
  ];
  const values = [];
  for (const container of containers) {
    if (!Array.isArray(container)) continue;
    for (const item of container) {
      const value = typeof item === "string"
        ? item
        : item?.word ?? item?.term ?? item?.value ?? item?.text ?? item?.label ?? item?.suggestion;
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    }
  }
  return [...new Set(values.map(normalizePhrase).filter(isPlayablePhrase))];
}

function getHttpJson(options = {}) {
  if (typeof options.getJson === "function") return options.getJson;
  return require("../../../../core/runtime/queuedHttp").getJson;
}

function getApiTimeout(options = {}) {
  const requested = Number(options.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return API_TIMEOUT_MS;
  return Math.max(250, Math.min(API_TIMEOUT_MS, requested));
}

async function fetchSuggestions(prefix, options = {}) {
  const timeout = getApiTimeout(options);
  const key = normalizePhrase(prefix);
  const cached = suggestionCache.get(key);
  const now = Number(options.now) || Date.now();
  if (cached && cached.expiresAt > now) return cached.words;

  const url = API_BASE + "/suggest?q=" + encodeURIComponent(key) + "&limit=20";
  const response = await getHttpJson(options)(url, {
    timeout,
    retries: 0,
    headers: { Accept: "application/json" }
  });
  const payload = response?.data ?? response;
  const words = extractSuggestionWords(payload);
  suggestionCache.set(key, { words, expiresAt: now + API_CACHE_TTL_MS });
  return words;
}

async function lookupVietnameseWord(word, options = {}) {
  const timeout = getApiTimeout(options);
  const key = normalizePhrase(word);
  const now = Number(options.now) || Date.now();
  const cached = lookupCache.get(key);
  if (cached && cached.expiresAt > now) return cached.entry;

  const url = API_BASE + "/lookup?word=" + encodeURIComponent(key) +
    "&lang=vi&def_lang=vi";
  const response = await getHttpJson(options)(url, {
    timeout,
    retries: 0,
    headers: { Accept: "application/json" }
  });
  const payload = response?.data ?? response;
  if (!payload?.exists || !Array.isArray(payload.results)) {
    lookupCache.set(key, { entry: null, expiresAt: now + API_CACHE_TTL_MS });
    return null;
  }

  const vietnamese = payload.results.find(item => String(item?.lang_code || "").toLowerCase() === "vi");
  const meaning = (vietnamese?.meanings || []).find(item =>
    String(item?.definition_lang || "vi").toLowerCase() === "vi" &&
    typeof item?.definition === "string" &&
    item.definition.trim()
  );
  if (!vietnamese || !meaning) {
    lookupCache.set(key, { entry: null, expiresAt: now + API_CACHE_TTL_MS });
    return null;
  }

  const entry = {
    answer: normalizePhrase(payload.word || key),
    definition: meaning.definition.trim(),
    dictionarySource: meaning.source || "dict.minhqnd.com",
    source: "api"
  };
  if (!isPlayablePhrase(entry.answer)) return null;

  lookupCache.set(key, { entry, expiresAt: now + LOOKUP_CACHE_TTL_MS });
  return entry;
}

async function refreshApiWordPool(options = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const random = options.random || Math.random;
    const prefixes = randomize(PREFIXES, random).slice(0, API_PREFIX_ATTEMPTS);

    // Search several Vietnamese prefixes concurrently so the first round does
    // not wait for a serial chain of network requests.
    const suggestionGroups = await Promise.all(prefixes.map(async prefix => {
      try {
        return await fetchSuggestions(prefix, options);
      } catch (error) {
        options.onApiError?.(error);
        return [];
      }
    }));
    const suggestions = [...new Set(suggestionGroups.flat())];
    const candidates = randomize(
      suggestions.filter(word => !apiWordPool.has(normalizeAnswer(word))),
      random
    ).slice(0, API_LOOKUP_BATCH);

    const entries = await Promise.all(candidates.map(async candidate => {
      try {
        return await lookupVietnameseWord(candidate, options);
      } catch (error) {
        options.onApiError?.(error);
        return null;
      }
    }));

    let added = 0;
    for (const entry of entries) {
      if (!entry || !isPlayablePhrase(entry.answer)) continue;
      const key = normalizeAnswer(entry.answer);
      if (!apiWordPool.has(key)) {
        apiWordPool.set(key, entry);
        added++;
      }
    }

    while (apiWordPool.size > API_POOL_MAX) {
      apiWordPool.delete(apiWordPool.keys().next().value);
    }
    return added;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function lookupVietnameseTerm(term, options = {}) {
  const key = normalizePhrase(term);
  if (!key) return null;
  const now = Number(options.now) || Date.now();
  const cached = termLookupCache.get(key);
  if (cached && cached.expiresAt > now) return cached.entry;

  const url = API_BASE + "/lookup?word=" + encodeURIComponent(key) +
    "&lang=vi&def_lang=vi";
  const response = await getHttpJson(options)(url, {
    timeout: getApiTimeout(options),
    retries: 0,
    headers: { Accept: "application/json" }
  });
  const payload = response?.data ?? response;
  if (!payload?.exists || !Array.isArray(payload.results)) {
    termLookupCache.set(key, { entry: null, expiresAt: now + API_CACHE_TTL_MS });
    return null;
  }

  const vietnamese = payload.results.find(item => String(item?.lang_code || "").toLowerCase() === "vi");
  const meaning = (vietnamese?.meanings || []).find(item =>
    String(item?.definition_lang || "vi").toLowerCase() === "vi" &&
    typeof item?.definition === "string" &&
    item.definition.trim()
  );
  if (!vietnamese || !meaning) {
    termLookupCache.set(key, { entry: null, expiresAt: now + API_CACHE_TTL_MS });
    return null;
  }

  const entry = {
    answer: normalizePhrase(payload.word || key),
    definition: meaning.definition.trim(),
    dictionarySource: meaning.source || "dict.minhqnd.com",
    source: "api"
  };
  termLookupCache.set(key, { entry, expiresAt: now + LOOKUP_CACHE_TTL_MS });
  return entry;
}

function getDictionaryStats() {
  const fallbackKeys = FALLBACK_WORD_BANK.map(item => normalizeAnswer(item.answer));
  const apiKeys = [...apiWordPool.keys()];
  return {
    apiCached: apiWordPool.size,
    fallbackWords: FALLBACK_WORD_BANK.length,
    totalCached: new Set([...fallbackKeys, ...apiKeys]).size,
    apiPoolLimit: API_POOL_MAX,
    source: "dict.minhqnd.com"
  };
}

function takePuzzleEntry(session, random = Math.random) {
  const available = [...apiWordPool.entries()].filter(([key]) => !session.usedAnswers.has(key));
  if (!available.length) return null;
  const index = Math.max(0, Math.min(available.length - 1, Math.floor(random() * available.length)));
  return available[index][1];
}

function takeFallbackEntry(session, random = Math.random) {
  const available = FALLBACK_WORD_BANK.filter(item => !session.usedAnswers.has(normalizeAnswer(item.answer)));
  const pool = available.length ? available : FALLBACK_WORD_BANK;
  const index = Math.max(0, Math.min(pool.length - 1, Math.floor(random() * pool.length)));
  const item = pool[index];
  return {
    answer: normalizePhrase(item.answer),
    definition: item.definition,
    dictionarySource: "Kho dự phòng JOHNTRAN",
    source: "fallback"
  };
}

async function choosePuzzle(session, options = {}) {
  const random = options.random || Math.random;
  let selected = takePuzzleEntry(session, random);

  // Never block a player's answer or a new round on dictionary network calls.
  // Use the local bank immediately, then warm the API pool in the background.
  if (!selected) selected = takeFallbackEntry(session, random);

  const normalized = normalizeAnswer(selected.answer);
  session.usedAnswers.add(normalized);
  session.puzzle = {
    answer: selected.answer,
    definition: selected.definition || "",
    dictionarySource: selected.dictionarySource || "dict.minhqnd.com",
    source: selected.source || "api",
    letters: shuffleLetters(selected.answer, random),
    clue: HINT_TEXT
  };
  session.round += 1;

  if (apiWordPool.size < API_LOOKUP_BATCH && !refreshPromise) {
    void refreshApiWordPool(options).catch(error => options.onApiError?.(error));
  }
  return session.puzzle;
}

function remainingSeconds(session, now = Date.now()) {
  if (!session) return 0;
  return Math.max(0, Math.ceil((session.endsAt - now) / 1000));
}

async function start(threadId, playerId, playerName = "Người chơi", avatarUrl = "", options = {}) {
  const key = String(threadId || "").trim();
  const uid = String(playerId || "").trim();
  if (!key || !uid) return { ok: false, code: "INVALID_CONTEXT" };

  const existing = sessions.get(key);
  if (existing?.status === "starting" || existing?.processing ||
      (existing?.status === "active" && remainingSeconds(existing, options.now ?? Date.now()) > 0)) {
    return { ok: false, code: "RUNNING", session: existing };
  }

  const now = Number(options.now) || Date.now();
  const session = {
    threadId: key,
    playerId: uid,
    playerName: String(playerName || "Người chơi").slice(0, 32),
    requesterAvatarUrl: String(avatarUrl || ""),
    status: "starting",
    processing: false,
    startedAt: now,
    endsAt: now + ROUND_SECONDS * 1000,
    finishedAt: null,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    skipped: 0,
    wrong: 0,
    round: 0,
    usedAnswers: new Set(),
    puzzle: null
  };

  // Reserve the group before the first await so two rapid /nt gc commands
  // cannot create separate sessions for the same group.
  sessions.set(key, session);
  try {
    await choosePuzzle(session, options);
    if (sessions.get(key) !== session || session.status !== "starting") {
      return { ok: false, code: "CANCELLED", session };
    }
    session.status = "active";
    return { ok: true, session };
  } catch (error) {
    if (sessions.get(key) === session) sessions.delete(key);
    session.status = "failed";
    throw error;
  }
}

function get(threadId) {
  return sessions.get(String(threadId || "")) || null;
}

function isBusy(threadId, now = Date.now()) {
  const session = get(threadId);
  if (!session) return false;
  return session.status === "starting" ||
    (session.status === "active" &&
      (session.processing === true || session.replyPending === true || remainingSeconds(session, now) > 0));
}

async function submit(threadId, playerId, answer, options = {}) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };

  if (session.processing) return { ok: false, code: "BUSY" };
  const now = Number(options.now) || Date.now();
  if (remainingSeconds(session, now) <= 0) {
    finish(threadId, now);
    return { ok: false, code: "TIME_UP", session };
  }

  session.processing = true;
  try {
    if (normalizeAnswer(answer) !== normalizeAnswer(session.puzzle?.answer)) {
      session.wrong += 1;
      session.streak = 0;
      return { ok: false, code: "WRONG", session, remaining: remainingSeconds(session, now) };
    }

    session.correct += 1;
    session.score += CORRECT_POINTS;
    session.streak += 1;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    const completedAnswer = session.puzzle.answer;
    const points = CORRECT_POINTS;
    await choosePuzzle(session, options);
    if (get(threadId) !== session || session.status !== "active") {
      return { ok: false, code: "CANCELLED", session };
    }
    return {
      ok: true,
      code: "CORRECT",
      completedAnswer,
      points,
      session,
      remaining: remainingSeconds(session, now)
    };
  } finally {
    session.processing = false;
  }
}

async function skip(threadId, playerId, options = {}) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };

  if (session.processing) return { ok: false, code: "BUSY" };
  const now = Number(options.now) || Date.now();
  if (remainingSeconds(session, now) <= 0) {
    finish(threadId, now);
    return { ok: false, code: "TIME_UP", session };
  }

  session.processing = true;
  try {
    const skippedAnswer = session.puzzle.answer;
    session.skipped += 1;
    session.streak = 0;
    session.endsAt -= 5000;

    if (remainingSeconds(session, now) <= 0) {
      finish(threadId, now);
      return { ok: true, code: "TIME_UP", skippedAnswer, session, remaining: 0 };
    }

    await choosePuzzle(session, options);
    if (get(threadId) !== session || session.status !== "active") {
      return { ok: false, code: "CANCELLED", session };
    }
    return {
      ok: true,
      code: "SKIPPED",
      skippedAnswer,
      session,
      remaining: remainingSeconds(session, now)
    };
  } finally {
    session.processing = false;
  }
}

function finish(threadId, now = Date.now()) {
  const session = get(threadId);
  if (!session) return null;
  if (session.status !== "active") return session;
  session.status = "finished";
  session.finishedAt = now;
  return session;
}

function stop(threadId, playerId, now = Date.now()) {
  const session = get(threadId);
  if (!session || !["active", "starting"].includes(session.status)) return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };
  session.status = "stopped";
  session.finishedAt = now;
  return { ok: true, session };
}

function remove(threadId) {
  return sessions.delete(String(threadId || ""));
}

function clear() {
  sessions.clear();
}

function clearDictionaryCache() {
  suggestionCache.clear();
  lookupCache.clear();
  termLookupCache.clear();
  apiWordPool.clear();
  refreshPromise = null;
}

module.exports = {
  ROUND_SECONDS,
  CORRECT_POINTS,
  HINT_TEXT,
  FALLBACK_WORD_BANK,
  API_BASE,
  normalizeAnswer,
  normalizePhrase,
  isPlayablePhrase,
  formatPuzzleLetters,
  shuffleLetters,
  extractSuggestionWords,
  fetchSuggestions,
  lookupVietnameseWord,
  getApiTimeout,
  lookupVietnameseTerm,
  getDictionaryStats,
  refreshApiWordPool,
  remainingSeconds,
  start,
  get,
  isBusy,
  submit,
  skip,
  finish,
  stop,
  remove,
  clear,
  clearDictionaryCache
};
