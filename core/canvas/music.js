"use strict";

const theme = require("./theme");

function shortPlays(n) {
  const value = Number(n) || 0;
  if (value >= 1e9) return (value / 1e9).toFixed(1) + "B";
  if (value >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (value >= 1e3) return (value / 1e3).toFixed(0) + "K";
  return String(value);
}
function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  return Math.floor(total / 60) + ":" + String(Math.floor(total % 60)).padStart(2, "0");
}
async function fetchThumb(url) {
  if (!url) return null;
  try {
    const { buffer } = await require("../http").getBuffer(url, { timeout: 10000, retries: 1 });
    return await require("canvas").loadImage(buffer);
  } catch { return null; }
}

function drawFallbackCover(ctx, x, y, size, index) {
  const S = theme.S;
  const colors = [
    ["#163e68", "#356b9d", "#61d8f2"],
    ["#32275d", "#67489a", "#d6a7ff"],
    ["#13534f", "#1f887d", "#7ce0b5"],
    ["#633b31", "#ad6545", "#ffd18c"],
    ["#47294d", "#965078", "#ff9fc5"],
    ["#173e51", "#286e80", "#a4eff7"]
  ];
  const set = colors[index % colors.length];
  ctx.save();
  theme.roundRect(ctx, x, y, size, size, S(15)); ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, set[0]); g.addColorStop(.55, set[1]); g.addColorStop(1, "#0a1829");
  ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  const glow = ctx.createRadialGradient(x + size * .72, y + size * .25, S(3),
    x + size * .72, y + size * .25, size * .72);
  glow.addColorStop(0, set[2] + "88"); glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(x, y, size, size);

  const cx = x + size * .68, cy = y + size * .52, radius = size * .36;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(5,12,24,.62)"; ctx.fill();
  [0.78, 0.57, 0.35].forEach(r => {
    ctx.beginPath(); ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.20)"; ctx.lineWidth = S(1); ctx.stroke();
  });
  ctx.beginPath(); ctx.arc(cx, cy, radius * .16, 0, Math.PI * 2);
  ctx.fillStyle = set[2]; ctx.fill();
  ctx.font = theme.font(42, "JT-Display-Bold"); ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("♫", x + S(18), y + size * .72);
  theme.drawMulticolorText(ctx, "JOHNTRAN  /  MUSIC", x + S(18), y + size - S(18), {
    size: 8, family: "JT-Mono-Bold", color: "rgba(255,255,255,.72)", multicolor: true
  });
  ctx.restore();
}

async function renderSearchGrid(query, tracks, { page = 1, totalPages = 1, source } = {}) {
  theme.initFonts();
  const S = theme.S, W = theme.WIDTH, p = theme.PALETTE;
  const perPage = 9, cols = 3;
  const shown = (Array.isArray(tracks) ? tracks : []).slice(0, perPage);
  const rows = Math.ceil(Math.max(1, shown.length) / cols);
  const gapX = S(16), gapY = S(14), pad = S(24);
  const cardW = (W - pad * 2 - gapX * (cols - 1)) / cols;
  const art = S(176), cardH = S(292), headerH = S(112), footerH = S(106);
  const H = headerH + rows * cardH + Math.max(0, rows - 1) * gapY + footerH;
  const { ctx, canvas } = theme.newCanvas(W, H);
  await theme.paintBackground(ctx, W, H);

  theme.label(ctx, "JOHNTRAN MUSIC  /  SEARCH", pad, S(28), { size: 10 });
  theme.text(ctx, theme.truncate(ctx, query || "Kết quả tìm kiếm", W - pad * 2), pad, S(67), {
    size: 27, family: "JT-Display-Bold", color: p.ink, maxWidth: W - pad * 2
  });
  theme.text(ctx, shown.length + " BÀI HÁT  ·  " + (source || "SOUNDCLOUD") +
    "  ·  TRANG " + page + "/" + totalPages, pad, S(91), {
      size: 10, family: "JT-Mono", color: p.ink2
    });

  const covers = [];
  for (const track of shown) covers.push(await fetchThumb(track.thumbnail));
  shown.forEach((track, index) => {
    const col = index % cols, row = Math.floor(index / cols);
    const x = pad + col * (cardW + gapX), y = headerH + row * (cardH + gapY);
    theme.panel(ctx, x, y, cardW, cardH, S(16), p.accent);
    const artX = x + (cardW - art) / 2, artY = y + S(10);
    if (covers[index]) {
      ctx.save(); theme.roundRect(ctx, artX, artY, art, art, S(15)); ctx.clip();
      ctx.drawImage(covers[index], artX, artY, art, art); ctx.restore();
    } else drawFallbackCover(ctx, artX, artY, art, index);
    theme.roundRect(ctx, x + S(11), y + S(11), S(30), S(25), S(8));
    ctx.fillStyle = "rgba(3,10,22,.72)"; ctx.fill();
    theme.text(ctx, String(index + 1).padStart(2, "0"), x + S(26), y + S(28), {
      size: 10, family: "JT-Mono-Bold", color: "#ffffff", align: "center"
    });
    theme.text(ctx, String(track.title || "Không rõ tên bài hát"),
      x + cardW / 2, artY + art + S(30), {
        size: 15, family: "JT-Bold", color: p.ink, align: "center", maxWidth: cardW - S(18)
      });
    theme.text(ctx, String(track.artist || "Nghệ sĩ chưa rõ"),
      x + cardW / 2, artY + art + S(52), {
        size: 11, color: p.ink2, align: "center", maxWidth: cardW - S(18)
      });
    const duration = track.duration ? formatDuration(track.duration) : "";
    const stats = duration + (duration ? "   ·   " : "") + shortPlays(track.plays || track.likes || 0) + " lượt nghe";
    const tagY = y + cardH - S(28);
    theme.roundRect(ctx, x + S(12), tagY - S(15), cardW - S(24), S(24), S(10));
    ctx.fillStyle = "rgba(97,216,242,.10)"; ctx.fill();
    theme.text(ctx, stats, x + cardW / 2, tagY + S(1), {
      size: 9, family: "JT-Mono-Bold", color: p.accent, align: "center",
      maxWidth: cardW - S(40)
    });
  });

  const footY = H - footerH;
  theme.text(ctx, "TRANG " + page + " / " + totalPages, W / 2, footY + S(24), {
    size: 16, family: "JT-Bold", color: p.ink, align: "center"
  });
  const btnW = (W - pad * 2 - S(20)) / 3;
  theme.button(ctx, pad, footY + S(37), btnW, S(37), "◀ PREV", p.accent);
  theme.button(ctx, pad + btnW + S(10), footY + S(37), btnW, S(37), "✕ OUT", p.mute);
  theme.button(ctx, pad + (btnW + S(10)) * 2, footY + S(37), btnW, S(37), "NEXT ▶", p.accent2);
  theme.text(ctx, "Dùng " + String(global.config?.prefix || "/") + "scl <số> để tải bài hát",
    W / 2, footY + S(91), { size: 10, color: p.ink2, align: "center" });
  return theme.save(canvas, "music_grid");
}

async function renderNowPlaying(track = {}, sourceLabel) {
  theme.initFonts();
  const S = theme.S, W = theme.WIDTH, p = theme.PALETTE;
  const coverSize = S(280), H = S(570);
  const { ctx, canvas } = theme.newCanvas(W, H);
  await theme.paintBackground(ctx, W, H);
  theme.label(ctx, "JOHNTRAN MUSIC  /  PLAYER", S(28), S(30), { size: 10 });
  theme.text(ctx, "ĐANG PHÁT", W / 2, S(68), {
    size: 30, family: "JT-Display-Bold", color: p.ink, align: "center"
  });
  const cover = await fetchThumb(track.thumbnail);
  const x = (W - coverSize) / 2, y = S(92);
  if (cover) {
    ctx.save(); theme.roundRect(ctx, x, y, coverSize, coverSize, S(20)); ctx.clip();
    ctx.drawImage(cover, x, y, coverSize, coverSize); ctx.restore();
  } else drawFallbackCover(ctx, x, y, coverSize, 1);
  theme.roundRect(ctx, x, y, coverSize, coverSize, S(20));
  ctx.strokeStyle = "rgba(255,255,255,.24)"; ctx.lineWidth = S(1.2); ctx.stroke();

  theme.text(ctx, String(track.title || "Đang tải bài hát"), W / 2, y + coverSize + S(42), {
    size: 26, family: "JT-Display-Bold", color: p.ink, align: "center",
    maxWidth: W - S(60)
  });
  theme.text(ctx, String(track.artist || "Nghệ sĩ chưa rõ"), W / 2,
    y + coverSize + S(69), {
      size: 15, color: p.ink2, align: "center", maxWidth: W - S(60)
    });
  const duration = formatDuration(track.duration);
  const meta = (sourceLabel || track.source || "Music").toUpperCase() +
    (duration !== "0:00" ? "  ·  " + duration : "") +
    (track.plays ? "  ·  " + shortPlays(track.plays) + " lượt nghe" : "");
  theme.roundRect(ctx, S(80), y + coverSize + S(91), W - S(160), S(36), S(18));
  ctx.fillStyle = "rgba(97,216,242,.11)"; ctx.fill();
  theme.text(ctx, meta, W / 2, y + coverSize + S(114), {
    size: 10, family: "JT-Mono-Bold", color: p.accent, align: "center",
    maxWidth: W - S(190)
  });
  theme.panel(ctx, S(38), H - S(58), W - S(76), S(34), S(12), p.accent);
  theme.text(ctx, "Đang chuẩn bị tệp âm thanh...", W / 2, H - S(36), {
    size: 11, family: "JT-Bold", color: p.ink2, align: "center"
  });
  return theme.save(canvas, "music_now");
}

module.exports = { renderSearchGrid, renderNowPlaying };
