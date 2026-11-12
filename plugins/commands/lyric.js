const music = require("../../core/music");
const models = require("../../core/music/models");
const http = require("../../core/http");

const MAX_LYRIC_MESSAGE_CHARS = 1800;
const LRCLIB_API = "https://lrclib.net/api/search";

module.exports.config = {
  name: "lyric",
  aliases: ["loibaihat", "lrc"],
  version: "2.1.0",
  role: 0,
  author: models.BRAND,
  description: "Xem lời bài hát",
  category: "Nhạc",
  usage: "lyric <tên bài hát> (không nhập = lấy bài SoundCloud vừa tìm)",
  cooldowns: 5,
  dependencies: {}
};

module.exports.run = async ({ args, event, reply }) => {
  const { threadId, data } = event;
  const key = music.pickKey(threadId, data.uidFrom);

  await reply.working();

  if (!args[0]) {
    const pending = music.getPending(key);
    const track = pending?.tracks?.[0];
    if (!track) {
      await reply.failed();
      return reply.error("Bạn chưa tìm bài nào gần đây. Dùng: /lyric <tên bài hát>");
    }
    return showLyric(reply, track);
  }

  const query = args.join(" ").trim();
  const errors = [];

  // Tìm thẳng trên LRCLIB trước để /lyric vẫn hoạt động ngay cả khi
  // SoundCloud đổi client_id hoặc API tìm nhạc đang gián đoạn.
  try {
    const track = { title: query, artist: "" };
    const lines = await findLyrics(track);
    return showLyric(reply, track, lines);
  } catch (error) {
    errors.push("LRCLIB: " + (error?.message || error));
  }

  // Nếu truy vấn trực tiếp không khớp, dùng SoundCloud để xác định nghệ sĩ
  // và thử một vài kết quả thay vì chỉ thử track đầu tiên.
  try {
    const tracks = await music.search("scl", query, 5);
    const lyricErrors = [];
    for (const track of tracks.slice(0, 5)) {
      try {
        const lines = await findLyrics(track);
        return showLyric(reply, track, lines);
      } catch (error) {
        lyricErrors.push(error?.message || String(error));
      }
    }
    errors.push(lyricErrors[0] || "Không tìm thấy lời cho các kết quả SoundCloud.");
  } catch (error) {
    errors.push("SoundCloud: " + (error?.message || error));
  }

  await reply.failed();
  return reply.error(
    'Không tìm thấy lời bài hát "' + query + '".\n' +
    errors.map((item) => "• " + item).join("\n")
  );
};

async function findLyrics(track) {
  const title = String(track?.title || "").trim();
  const artist = String(track?.artist || "").trim();
  if (!title) throw new Error("Không xác định được tên bài hát để tìm lời.");

  const queries = [];
  const exact = new URLSearchParams({ track_name: title });
  if (artist) exact.set("artist_name", artist);
  queries.push(exact);

  // Khi tên nghệ sĩ trên SoundCloud khác metadata của LRCLIB, thử lại chỉ với tên bài.
  if (artist) queries.push(new URLSearchParams({ track_name: title }));

  let lastError = null;
  for (const params of queries) {
    try {
      const { status, data } = await http.getJson(LRCLIB_API + "?" + params.toString(), {
        timeout: 15000,
        retries: 2,
        headers: { "User-Agent": "JOHNTRAN-JS/2.1.0 (lyrics lookup)" }
      });
      if (status >= 400) throw new Error("LRCLIB trả về HTTP " + status);

      const match = Array.isArray(data) && data.find((item) => item?.plainLyrics || item?.syncedLyrics);
      const lyrics = match?.plainLyrics || match?.syncedLyrics;
      if (!lyrics) continue;

      const lines = String(lyrics)
        .split(/\r?\n/)
        .map((line) => line.replace(/^\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/, "").trim())
        .filter(Boolean);
      if (lines.length) return lines;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error('Không tìm thấy lời bài hát "' + title + '" trên LRCLIB.');
}

function splitLyricText(lines, maxChars = MAX_LYRIC_MESSAGE_CHARS) {
  const chunks = [];
  let current = "";

  for (const rawLine of lines) {
    let line = String(rawLine ?? "");
    while (line.length > maxChars) {
      const part = line.slice(0, maxChars);
      line = line.slice(maxChars);
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(part);
    }

    const candidate = current ? current + "\n" + line : line;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function showLyric(reply, track, existingLines = null) {
  try {
    const lines = existingLines || await findLyrics(track);
    const artist = String(track?.artist || "").trim();
    const title = String(track?.title || "Lời bài hát");
    const header = [
      "♫ " + title,
      artist && artist !== "Không rõ" ? "🎤 " + artist : null,
      "━━━━━━━━━━━━━━━━",
      ""
    ].filter((line) => line !== null);
    const lyricChunks = splitLyricText(lines);
    const sent = [];

    for (let index = 0; index < lyricChunks.length; index++) {
      const chunkHeader = index === 0
        ? header
        : ["♫ " + title + " (tiếp)", "━━━━━━━━━━━━━━━━", ""];
      const footer = index === lyricChunks.length - 1 ? ["", models.BRAND] : [];
      const message = [...chunkHeader, lyricChunks[index], ...footer].join("\n");
      sent.push(message);
      await reply.text(message, { plain: true });
    }

    await reply.done();
    return sent;
  } catch (error) {
    await reply.failed();
    return reply.error(error.message);
  }
}
module.exports._test = { findLyrics, showLyric };
