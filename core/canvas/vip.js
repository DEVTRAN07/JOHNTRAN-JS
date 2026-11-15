// ===== Thẻ VIP (reply.card / reply.text / reply.error...) — dùng theme chung =====
// Mọi ảnh bot gửi ra đều CÙNG một kiểu: nền, font, bo góc, bóng (xem theme.js).
// Kích thước viết theo cỡ 750 rồi scale theo theme.WIDTH (config canvas.width).
const theme = require("./theme");

const WIDTH = theme.WIDTH;
const PADDING = theme.S(30);
const S = theme.S;

// Emoji → ký tự an toàn khi máy không có font emoji (Linux minimal)
const EMOJI_FALLBACK = {
  "🎵": "♪", "🎧": "♫", "❤️": "❤", "✅": "✔", "❌": "✘", "⚠️": "!",
  "⏳": "...", "🚫": "×", "💡": "i", "🔎": "?", "📡": "#", "🎯": ">",
  "🤖": "AI", "🖼️": "[img]", "⏱": "⏱", "🔍": "?", "📺": "▶", "🌐": "@",
  "👉": ">", "📎": "♦", "💬": "☰", "⏰": "◷", "🏆": "★", "💰": "$",
  "🎲": "?", "🎮": ">", "⭐": "*", "💎": "◆", "🧩": "▤", "📌": "•",
  "🛠️": "+", "📊": "▥", "🔧": "+", "🧠": "◔", "📥": "↓", "🎬": "▶",
  "🚀": ">", "🔥": "^", "😉": "‿", "😁": "^", "😋": "~", "😴": "z",
  "🎉": "*", "🚿": "~", "🍚": "=", "📴": "×", "🛌": "_", "🌙": ")", "💤": "z",
  "👋": ">", "🚪": "→", "🏆": "★", "😍": "♥", "⌨️": "#", "📄": "▤", "⬅": "<", "➡": ">"
};

let emojiReady = false;
let hasEmojiFont = false;

function sanitizeEmoji(text) {
  if (emojiReady) return text;
  let out = "";
  for (const ch of String(text)) out += hasEmojiFont ? ch : (EMOJI_FALLBACK[ch] || ch);
  return out;
}

// Đo chiều cao thẻ theo nội dung (mỗi ảnh cao vừa đủ — không dư khoảng trắng)
function measure(spec) {
  const { ctx } = theme.newCanvas(100, 100);
  ctx.font = theme.font(16);
  let height = S(120) /* header */ + (spec.subtitle ? S(52) : 0) + S(22);

  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  for (const row of rows) {
    const lines = Array.isArray(row.lines) ? row.lines : [String(row.lines || "")];
    let rowH = S(34);
    for (const line of lines) {
      const wrapped = Math.max(1, Math.ceil(ctx.measureText(sanitizeEmoji(line)).width / (WIDTH - PADDING * 2 - S(46))));
      rowH += wrapped * S(26) + S(6);
    }
    height += rowH + S(18);
  }
  return { height: Math.max(height + S(96), S(260)) };
}

async function renderVipCard(spec = {}) {
  theme.ensureTheme();
  const palette = theme.PALETTE;
  // Use the same selected accent as /menu; semantic states retain their meaning.
  const accent = spec.theme === "success" ? palette.green
    : spec.theme === "error" ? palette.red
      : spec.theme === "warn" ? palette.gold
        : palette.accent;
  const accent2 = palette.accent2 || accent;

  const { height } = measure(spec);
  const { ctx, canvas } = theme.newCanvas(WIDTH, height);

  await theme.paintBackground(ctx, WIDTH, height);

  // Nền ảnh riêng (avatar người dùng...) — phủ lên, giữ overlay để chữ rõ
  if (spec.background) {
    try {
      const { buffer } = await require("../http").getBuffer(spec.background, { timeout: 10000, retries: 1 });
      const bg = await require("canvas").loadImage(buffer);
      const scale = Math.max(WIDTH / bg.width, height / bg.height);
      const dw = bg.width * scale;
      const dh = bg.height * scale;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(bg, (WIDTH - dw) / 2, (height - dh) / 2, dw, dh);
      ctx.restore();
      // overlay tối cho chữ luôn đọc được
      const shade = ctx.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, "rgba(7, 10, 20, .6)");
      shade.addColorStop(1, "rgba(7, 10, 20, .9)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, WIDTH, height);
    } catch { /* hỏng ảnh nền thì thôi, vẫn có nền mặc định */ }
  }

  let y = S(74);

  // ===== Kicker + Tiêu đề + vệt nhũ =====
  const icon = spec.icon || (spec.theme === "error" ? "❌" : spec.theme === "success" ? "✅" : spec.theme === "music" ? "🎵" : spec.theme === "info" ? "💡" : "⚡");
  theme.label(ctx, "JOHN TRAN", PADDING, y - S(28), { size: 13, color: accent });
  theme.text(ctx, sanitizeEmoji(icon), PADDING, y, { size: 34, color: accent });
  theme.text(ctx, String(spec.title || "").toUpperCase(), PADDING + S(52), y, {
    size: 33, family: "JT-Display-Bold", color: palette.ink, maxWidth: WIDTH - PADDING * 2 - S(110)
  });
  theme.foil(ctx, PADDING, y + S(14), S(90));

  y += S(42);

  // ===== Mô tả ngắn =====
  if (spec.subtitle) {
    theme.text(ctx, sanitizeEmoji(String(spec.subtitle)), PADDING, y + S(4), {
      size: 18, color: palette.ink2, maxWidth: WIDTH - PADDING * 2
    });
    y += S(50);
  }

  // ===== Các khối nội dung =====
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  for (const row of rows) {
    if (!row) continue;
    const lines = Array.isArray(row.lines) ? row.lines : [String(row.lines || "")];
    theme.panel(ctx, PADDING, y - S(18), WIDTH - PADDING * 2, S(32) + lines.length * S(26), S(12), row.tone === "error" ? palette.red : accent);
    y += S(2);

    if (row.label) {
      theme.text(ctx, sanitizeEmoji(row.label), WIDTH - PADDING - S(170), y, {
        size: 14, color: palette.mute, maxWidth: S(150)
      });
    }
    if (row.icon) {
      theme.text(ctx, sanitizeEmoji(row.icon), PADDING + S(16), y + S(4), { size: 20, color: row.tone === "error" ? palette.red : accent2 });
    }

    let ly = y;
    for (const line of lines) {
      ly += S(26);
      theme.text(ctx, sanitizeEmoji(String(line)), PADDING + S(44), ly, {
        size: row.strong ? 17 : 16,
        family: row.strong ? "JT-Bold" : "JT",
        color: row.strong ? palette.ink : palette.ink2,
        maxWidth: WIDTH - PADDING * 2 - S(62)
      });
    }
    y = ly + S(26);
  }

  // ===== Footer thương hiệu =====
  theme.text(ctx, String(spec.footer || "JOHN TRAN"), WIDTH / 2, height - S(30), {
    size: 15, family: "JT-Bold", color: palette.mute, align: "center"
  });

  return theme.save(canvas, "card");
}

module.exports = { renderVipCard, WIDTH, EMOJI_FALLBACK };
