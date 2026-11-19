// ===== THẺ TEXT CÓ STYLE (thay ảnh canvas) =====
// Ảnh card canvas mất 0.5-2s render + 1 upload CDN. Zalo lại hỗ trợ style
// text thẳng trong API (bold, màu, cỡ chữ, list) — phản hồi TỨC THÌ (0ms,
// đúng 1 API call) mà vẫn đẹp. Bot dùng style làm mặc định.
const { TextStyle } = require("zalo-client");
const { performance } = require("node:perf_hooks");
const nativeRuntime = require("../native");

// Màu theo loại tin (Zalo chỉ có 4 màu cố định + 2 cỡ chữ)
// Emoji phải là BMP 1 đơn vị UTF-16 (❌ ✅ ◆ ▲) — offset style tính theo
// đơn vị UTF-16, emoji 2 đơn vị (⚠️ 💠) sẽ làm lệch vùng in đậm/màu.
const THEMES = {
  error:   { icon: "❌", label: "LỖI",       color: TextStyle.Red },
  success: { icon: "✅", label: "HOÀN THÀNH", color: TextStyle.Green },
  info:    { icon: "◆", label: "THÔNG TIN",  color: TextStyle.Orange },
  warn:    { icon: "▲", label: "CẢNH BÁO",   color: TextStyle.Yellow }
};

const WIDTH = 26; // độ rộng vùng tiêu đề
// Zalo chỉ hỗ trợ bốn màu chữ cho tin nhắn thường. Chọn màu theo từng từ
// để tạo hiệu ứng nhiều màu mà không đụng vào mention hoặc đoạn được format.
const RANDOM_TEXT_COLORS = Object.freeze([
  TextStyle.Red,
  TextStyle.Orange,
  TextStyle.Yellow,
  TextStyle.Green
]);
const RANDOM_TEXT_COLOR_SET = new Set(RANDOM_TEXT_COLORS);
function overlapsRange(start, end, ranges) {
  return ranges.some(range => {
    const rangeStart = Number(range?.start);
    const rangeLength = Number(range?.len);
    const rangeEnd = Number.isFinite(Number(range?.end))
      ? Number(range.end)
      : rangeStart + rangeLength;
    return Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) &&
      start < rangeEnd && rangeStart < end;
  });
}

function normalizeExcludedRanges(ranges, textLength) {
  if (!Array.isArray(ranges)) return [];
  return ranges.map(range => {
    const start = Number(range?.pos ?? range?.start);
    const explicitEnd = Number(range?.end);
    const length = Number(range?.len ?? range?.length);
    if (!Number.isInteger(start) || start < 0 || start >= textLength) return null;
    const end = Number.isInteger(explicitEnd) && explicitEnd > start
      ? Math.min(textLength, explicitEnd)
      : Number.isInteger(length) && length > 0
        ? Math.min(textLength, start + length)
        : start;
    return end > start ? { start, end } : null;
  }).filter(Boolean);
}

function randomColorStylesJs(message, options = {}) {
  const text = String(message ?? "");
  if (!text) return [];

  const random = typeof options.random === "function" ? options.random : Math.random;
  const excludedRanges = normalizeExcludedRanges(options.excludeRanges, text.length);
  const styles = [];
  let previousColor = null;

  // Mentions are rendered by Zalo's mentionInfo metadata. Do not overlap
  // textProperties with mention spans: some clients suppress adjacent caption
  // styling when a style range collides with a tagged member. Offsets are UTF-16.
  for (const match of text.matchAll(/\S+/gu)) {
    const start = match.index ?? 0;
    const len = match[0].length;
    if (excludedRanges.some(range => start < range.end && range.start < start + len)) {
      continue;
    }
    const available = RANDOM_TEXT_COLORS.filter(color => color !== previousColor);
    const sample = Number(random());
    const normalized = Number.isFinite(sample)
      ? Math.max(0, Math.min(0.999999999, sample))
      : Math.random();
    const color = available[Math.floor(normalized * available.length)];
    styles.push({ start, len, st: color });
    previousColor = color;
  }

  return styles;
}

function randomColorStyles(message, options = {}) {
  const text = String(message ?? "");
  if (!text) return [];

  const excludedRanges = normalizeExcludedRanges(options.excludeRanges, text.length);
  const startedAt = performance.now();
  let styles = null;
  let backend = "js";

  // Normal message delivery uses the Rust N-API tokenizer. Injected RNGs
  // stay on JavaScript to preserve deterministic tests and caller contracts.
  if (typeof options.random !== "function") {
    try {
      styles = nativeRuntime.randomColorStyles(text, RANDOM_TEXT_COLORS, excludedRanges);
      if (Array.isArray(styles)) backend = "rust";
    } catch {
      styles = null;
    }
  }

  if (!Array.isArray(styles)) {
    styles = randomColorStylesJs(text, { ...options, excludeRanges: excludedRanges });
  }

  try {
    require("./metrics").trackListenerStageLatency?.(
      "style-colorize:" + backend,
      performance.now() - startedAt
    );
  } catch {
    // Colorization telemetry must never affect message delivery.
  }
  return styles;
}

function randomize(messageContent, options = {}) {
  if (options.enabled === false) return messageContent;

  const source = typeof messageContent === "string"
    ? { msg: messageContent }
    : messageContent;
  if (!source || typeof source !== "object" || typeof source.msg !== "string" || !source.msg) {
    return messageContent;
  }

  const excludedRanges = normalizeExcludedRanges(source.mentions, source.msg.length);
  const currentStyles = Array.isArray(source.styles) ? source.styles : [];
  const generatedStyles = randomColorStyles(source.msg, {
    random: options.random,
    excludeRanges: excludedRanges
  });
  const preservedStyles = currentStyles.filter(style => {
    const start = Number(style?.start);
    const len = Number(style?.len);
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(len) || len <= 0) return false;
    const end = start + len;
    if (RANDOM_TEXT_COLOR_SET.has(style?.st)) return false;
    return !overlapsRange(start, end, generatedStyles);
  });

  const styles = [...preservedStyles, ...generatedStyles]
    .sort((a, b) => Number(a.start) - Number(b.start) || Number(a.len) - Number(b.len));
  return { ...source, styles };
}

function pad(label, width) {
  const plain = String(label).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  const fill = Math.max(2, width - plain.length);
  return String(label) + " ".repeat(fill);
}

/**
 * Dựng tin nhắn có style.
 * @param {string|string[]} body  nội dung (xuống dòng = mảng hoặc \n)
 * @param {object} opts  { kind, title, botName, bullets }
 * @returns {{msg: string, styles: Array}} sẵn sàng truyền api.sendMessage
 */
function frame(body, opts = {}) {
  const theme = THEMES[opts.kind] || THEMES.info;
  const lines = Array.isArray(body) ? body : String(body ?? "").split("\n");

  const header = `${theme.icon} ${pad(theme.label, WIDTH)}`;
  const footer = "▔".repeat(header.length + 4);
  const msgLines = [header, "─".repeat(header.length + 4), ...lines, footer];
  const msg = msgLines.join("\n");

  // Style: tiêu đề = màu theo loại (mỗi đoạn 1 style — màu + đậm không chồng được)
  const styles = [{ start: 0, len: header.length, st: theme.color }];

  // Dòng chủ đề (dòng body đầu tiên) in đậm để nổi bật
  if (lines.length > 0 && lines[0].length > 0 && lines[0].length <= 80) {
    styles.push({ start: msgLines[0].length + 1 + msgLines[1].length + 1, len: lines[0].length, st: TextStyle.Bold });
  }

  // Các dòng "Nhãn: giá trị" → in đậm phần nhãn (đến dấu ":" đầu tiên)
  let offset = msgLines[0].length + 1 + msgLines[1].length + 1;
  const firstLineBold = lines.length > 0 && lines[0].length > 0 && lines[0].length <= 80;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Dòng đầu đã in đậm CẢ DÒNG → bỏ qua nhãn của dòng đó
    const colon = line.indexOf(":");
    if (colon > 0 && colon <= 30 && !(i === 0 && firstLineBold)) {
      styles.push({ start: offset, len: colon + 1, st: TextStyle.Bold });
    }
    offset += line.length + 1;
  }

  return { msg, styles };
}

/**
 * Tin thuần tự nhiên: không khung, chỉ in đậm "Nhãn:" và nhấn số liệu.
 */
function plain(body) {
  const lines = Array.isArray(body) ? body : String(body ?? "").split("\n");
  const msg = lines.join("\n");
  const styles = [];

  let offset = 0;
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0 && colon <= 30) {
      styles.push({ start: offset, len: colon + 1, st: TextStyle.Bold });
    }
    offset += line.length + 1;
  }

  return { msg, styles };
}

module.exports = { frame, plain, randomize, randomColorStyles, RANDOM_TEXT_COLORS, THEMES };
