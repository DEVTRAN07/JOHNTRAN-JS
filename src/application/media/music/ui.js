// ===== GIAO DIỆN NHẠC: styled text (0ms, không canvas) =====
// Danh sách bài / hướng dẫn / NOW PLAYING đều dựng bằng Zalo text style
// (bold + màu) — tức thì, đúng 1 API call, bỏ hẳn ảnh canvas.
const { TextStyle } = require("zalo-client");
const models = require("./models");

const WIDTH = 30;
const RANDOM_TEXT_COLORS = Object.freeze([
  TextStyle.Red, TextStyle.Orange, TextStyle.Yellow, TextStyle.Green
]);
const MAX_RANDOM_COLOR_RUNS = 120;

function randomWordColorStyles(text, startOffset = 0, random = Math.random) {
  const value = String(text ?? "");
  const words = [...value.matchAll(/[\p{L}\p{N}]+/gu)];
  if (!words.length) return [];

  const wordsPerRun = Math.max(1, Math.ceil(words.length / MAX_RANDOM_COLOR_RUNS));
  const ranges = [];
  for (let index = 0; index < words.length; index += wordsPerRun) {
    const first = words[index];
    const last = words[Math.min(words.length - 1, index + wordsPerRun - 1)];
    ranges.push({
      start: startOffset + first.index,
      len: last.index + last[0].length - first.index
    });
  }

  let previousColor = -1;
  return ranges.map(range => {
    const roll = Number(random());
    let colorIndex = Number.isFinite(roll)
      ? Math.floor(Math.max(0, Math.min(0.999999, roll)) * RANDOM_TEXT_COLORS.length)
      : 0;
    if (RANDOM_TEXT_COLORS.length > 1 && colorIndex === previousColor) {
      const nextRoll = Number(random());
      const offset = 1 + (Number.isFinite(nextRoll)
        ? Math.floor(Math.max(0, Math.min(0.999999, nextRoll)) * (RANDOM_TEXT_COLORS.length - 1))
        : 0);
      colorIndex = (previousColor + offset) % RANDOM_TEXT_COLORS.length;
    }
    previousColor = colorIndex;
    return { ...range, st: RANDOM_TEXT_COLORS[colorIndex] };
  });
}

function pad(text, width) {
  const fill = Math.max(2, width - String(text).length);
  return String(text) + " ".repeat(fill);
}

// Vạch kẻ tiêu đề
function rule(len) {
  return "━".repeat(len);
}

// ── Danh sách kết quả tìm kiếm ──
function searchList({ providerLabel, query, tracks, page, totalPages }) {
  const lines = [
    `♪ ${pad("NHẠC · " + providerLabel, WIDTH)}`,
    rule(WIDTH + 8),
    `🔍 "${query}" — ${tracks.length} bài · trang ${page}/${totalPages}`,
    ""
  ];
  const styles = [{ start: 0, len: lines[0].length, st: TextStyle.Bold }];

  // In đậm dòng mô tả tìm kiếm
  styles.push({ start: offsetOf(lines, 3), len: lines[3].length, st: TextStyle.Orange });

  tracks.forEach((track, i) => {
    const num = String(i + 1).padStart(2, " ");
    const dur = models.formatDuration(track.duration);
    const titleAndArtist = `${track.title} — ${track.artist}`;
    const line = `${num}. ♪ ${titleAndArtist}  [${dur}]`;
    lines.push(line);
    const start = offsetOf(lines, lines.length - 1);
    // Keep the number/record marker bold; random colors are applied word-by-word
    // to the title and artist so color and bold styles never overlap.
    styles.push({ start, len: num.length + 4, st: TextStyle.Bold });
    styles.push(...randomWordColorStyles(titleAndArtist, start + num.length + 4));
  });

  lines.push("");
  lines.push(`▸ Gõ SỐ (1-${tracks.length}) để nghe · next/prev đổi trang · out đóng`);

  return { msg: lines.join("\n"), styles };
}

// ── Hướng dẫn dùng ──
function usageList(providerName, providerLabel, prefix) {
  const lines = [
    `♪ ${pad("NHẠC · " + providerLabel, WIDTH)}`,
    rule(WIDTH + 8),
    "Cách dùng:",
    `${prefix}${providerName} <từ khóa>  → tìm bài`,
    `${prefix}${providerName} <số>       → nghe bài đã tìm`,
    "gõ trần số (1-8)         → nghe nhanh, không cần lệnh",
    `${prefix}${providerName} next/prev  → đổi trang`,
    `${prefix}${providerName} out        → đóng danh sách`
  ];
  const styles = [{ start: 0, len: lines[0].length, st: TextStyle.Bold }];
  // in đậm token lệnh/mô tả ở đầu dòng (đến space đầu tiên)
  for (let i = 3; i < lines.length; i++) {
    const space = lines[i].indexOf(" ");
    if (space > 0) styles.push({ start: offsetOf(lines, i), len: space, st: TextStyle.Bold });
  }
  return { msg: lines.join("\n"), styles };
}

// ── NOW PLAYING ──
function nowPlaying(track, providerLabel) {
  const dur = models.formatDuration(track.duration);
  const lines = [
    `♪ ${pad("ĐANG PHÁT · " + providerLabel, WIDTH)}`,
    rule(WIDTH + 8),
    "Bài hát: " + track.title,
    "Nghệ sĩ: " + (track.artist || "—"),
    "Thời lượng: " + dur
  ];
  const styles = [{ start: 0, len: lines[0].length, st: TextStyle.Bold }];
  for (let i = 2; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    styles.push({ start: offsetOf(lines, i), len: colon + 1, st: TextStyle.Bold });
  }
  return { msg: lines.join("\n"), styles };
}

// Tính offset (UTF-16 units) của dòng thứ i trong mảng lines
function offsetOf(lines, i) {
  let offset = 0;
  for (let j = 0; j < i; j++) offset += lines[j].length + 1;
  return offset;
}

module.exports = { searchList, usageList, nowPlaying, randomWordColorStyles };
