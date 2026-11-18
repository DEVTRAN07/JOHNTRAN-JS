"use strict";

const theme = require("./theme");
const WIDTH = theme.WIDTH;
const S = theme.S;
const PADDING = theme.S(30);
const EMOJI_FALLBACK = {
  "🎵":"♪","🎧":"♫","❤️":"♥","✅":"✓","❌":"×","⚠️":"!","⏳":"…",
  "🚫":"×","💡":"i","🔎":"?","📡":"#","🎯":">","🤖":"AI","🖼️":"▣",
  "🌐":"@","👉":">","📎":"♦","💬":"◌","⏰":"◷","🏆":"★","💰":"$",
  "🎲":"?","🎮":">","⭐":"★","💎":"◆","🧩":"▤","📌":"•","🛠️":"+",
  "📊":"▥","🔧":"+","🧠":"✦","📥":"↓","🎬":"▶","🚀":">","🔥":"*"
};
function sanitizeEmoji(value) {
  let out = String(value ?? "");
  for (const [emoji, fallback] of Object.entries(EMOJI_FALLBACK)) out = out.split(emoji).join(fallback);
  const named = { check: "OK", success: "OK", alert: "!", warning: "!", info: "i", error: "X" };
  const normalized = out.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(named, normalized)) return named[normalized];
  if (["✓", "✔", "✅"].includes(out.trim())) return "OK";
  if (["❌", "✘"].includes(out.trim())) return "X";
  if (["⚠", "⚠️"].includes(out.trim())) return "!";
  return theme.sanitizeGlyphs(out);
}
function wrap(ctx, value, maxWidth) {
  return theme.wrapText(ctx, sanitizeEmoji(value), maxWidth);
}
function measure(spec = {}) {
  theme.initFonts();
  const { ctx } = theme.newCanvas(WIDTH, 100);
  const maxWidth = WIDTH - PADDING * 2 - S(84);
  ctx.font = theme.font(15, "JT");
  const rows = (Array.isArray(spec.rows) ? spec.rows : []).map(row => {
    const source = Array.isArray(row?.lines) ? row.lines : [String(row?.lines || "")];
    const lines = source.flatMap(line => wrap(ctx, line, maxWidth));
    return { row, lines, height: S(42 + Math.max(1, lines.length) * 24) };
  });
  const subtitleHeight = spec.subtitle ? S(42) : 0;
  const height = S(116) + subtitleHeight +
    rows.reduce((sum, item) => sum + item.height + S(12), 0) + S(52);
  return { height: Math.max(S(230), height), rows };
}
async function renderVipCard(spec = {}) {
  theme.initFonts();
  const p = theme.PALETTE;
  const accent = spec.theme === "success" ? p.green :
    spec.theme === "error" ? p.red :
      spec.theme === "warn" ? p.gold : p.accent;
  const measured = measure(spec), height = measured.height;
  const { ctx, canvas } = theme.newCanvas(WIDTH, height);
  await theme.paintBackground(ctx, WIDTH, height);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, S(7), height);

  const defaultIcon = spec.theme === "success" ? "OK" :
    spec.theme === "error" ? "X" : spec.theme === "warn" ? "!" : "i";
  const icon = sanitizeEmoji(spec.icon || defaultIcon);
  const iconX = PADDING, iconY = S(34), iconSize = S(55);
  theme.roundRect(ctx, iconX, iconY, iconSize, iconSize, S(15));
  ctx.fillStyle = accent + "22"; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = S(1.2); ctx.stroke();
  theme.text(ctx, icon, iconX + iconSize / 2, iconY + S(37), {
    size: 25, family: "JT-Bold", color: accent, align: "center"
  });
  const titleX = PADDING + S(72), titleW = WIDTH - titleX - PADDING;
  theme.label(ctx, "JOHNTRAN  /  " + String(spec.theme || "NOTICE").toUpperCase(),
    titleX, S(42), { size: 9, color: accent });
  theme.text(ctx, String(spec.title || "THÔNG BÁO").toUpperCase(), titleX, S(78), {
    size: 28, family: "JT-Display-Bold", color: p.ink, maxWidth: titleW
  });
  let y = S(106);
  if (spec.subtitle) {
    theme.text(ctx, sanitizeEmoji(spec.subtitle), titleX, y, {
      size: 13, color: p.ink2, maxWidth: titleW
    });
    y += S(48);
  } else y += S(16);

  measured.rows.forEach(({ row, lines, height: rowHeight }) => {
    const x = PADDING, w = WIDTH - PADDING * 2;
    theme.panel(ctx, x, y, w, rowHeight, S(13), row?.tone === "error" ? p.red : accent);
    const railX = x + S(14), railY = y + S(13);
    theme.roundRect(ctx, railX, railY, S(4), rowHeight - S(26), S(2));
    ctx.fillStyle = row?.tone === "error" ? p.red : accent; ctx.fill();
    if (row?.icon) {
      theme.roundRect(ctx, x + S(27), y + S(14), S(28), S(28), S(9));
      ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fill();
      theme.text(ctx, sanitizeEmoji(row.icon), x + S(41), y + S(33), {
        size: 12, family: "JT-Bold", color: accent, align: "center"
      });
    }
    const contentX = x + S(row?.icon ? 68 : 29);
    if (row?.label) theme.label(ctx, sanitizeEmoji(row.label), contentX, y + S(24), {
      size: 8, color: p.mute
    });
    const lineStart = y + S(row?.label ? 49 : 30);
    lines.forEach((line, index) => {
      theme.text(ctx, line, contentX, lineStart + index * S(24), {
        size: row?.strong ? 15 : 13,
        family: row?.strong ? "JT-Bold" : "JT",
        color: row?.strong ? p.ink : p.ink2,
        maxWidth: WIDTH - contentX - PADDING - S(10)
      });
    });
    y += rowHeight + S(12);
  });
  theme.text(ctx, String(spec.footer || "JOHNTRAN").toUpperCase(),
    WIDTH - PADDING, height - S(18), {
      size: 8.5, family: "JT-Mono", color: p.mute, align: "right"
    });
  return theme.save(canvas, "card");
}
module.exports = { renderVipCard, WIDTH, EMOJI_FALLBACK, _test: { measure, wrap } };
