// ===== Thẻ nhạc — dùng theme chung (core/canvas/theme.js) =====
// Kích thước viết theo cỡ 750 rồi scale theo theme.WIDTH (config canvas.width).
const theme = require("./theme");

// Số lượt nghe gọn: 12345 → 12K, 1234567 → 1.2M
function shortPlays(n) {
  const value = Number(n) || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(value);
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
}

async function fetchThumb(url) {
  if (!url) return null;
  try {
    const { buffer } = await require("../http").getBuffer(url, { timeout: 10000, retries: 1 });
    return await require("canvas").loadImage(buffer);
  } catch {
    return null;
  }
}

// ===== Lưới kết quả tìm kiếm (lưới thẻ 3 cột như menu) =====
// ===== Lưới kết quả tìm kiếm (thẻ: artwork lớn + tiêu đề + tag) =====
async function renderSearchGrid(query, tracks, { page = 1, totalPages = 1, source }) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const { PALETTE, panel, button, text, label, foil } = theme;

  // ===== Bố cục: 9 bài/trang, 3 cột =====
  const perPage = 9;
  const cols = 3;
  const shown = tracks.slice(0, perPage);
  const rows = Math.ceil(Math.max(1, shown.length) / cols);
  const gapX = S(22);
  const gapY = S(16);
  const cardW = (W - S(50) - gapX * (cols - 1)) / cols;
  const art = S(190);              // artwork lớn ở trên
  const cardH = art + S(98);       // art + title area + tag
  const headerH = S(104);
  const footerH = S(126);
  const H = headerH + rows * cardH + Math.max(0, rows - 1) * gapY + footerH;

  const { ctx, canvas } = theme.newCanvas(W, H);
  await theme.paintBackground(ctx, W, H);

  // ===== Header =====
  label(ctx, `TÌM NHẠC • ${source || "SOUNDCLOUD"}`, W / 2, S(34), { align: "center", size: 13 });
  text(ctx, theme.truncate(ctx, query, W - S(130)), W / 2, S(68), {
    size: 28, family: "JT-Display-Bold", color: PALETTE.ink, align: "center", maxWidth: W - S(130)
  });
  foil(ctx, W / 2 - S(70), S(80), S(140));
  text(
    ctx,
    `🎵 ${shown.length} bài  •  📡 ${source || "SoundCloud"}  •  🔥 nghe nhiều nhất`,
    W / 2, S(96),
    { size: 15, family: "JT-Mono", color: PALETTE.ink2, align: "center" }
  );

  const covers = [];
  for (const track of shown) covers.push(await fetchThumb(track.thumbnail));

  shown.forEach((track, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = S(25) + col * (cardW + gapX);
    const y = headerH + row * (cardH + gapY);
    panel(ctx, x, y, cardW, cardH, S(16));

    const artX = x + (cardW - art) / 2;
    const artY = y + S(10);
    if (covers[index]) {
      ctx.save();
      theme.roundRect(ctx, artX, artY, art, art, S(16));
      ctx.clip();
      ctx.drawImage(covers[index], artX, artY, art, art);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(56, 189, 248, .14)";
      theme.roundRect(ctx, artX, artY, art, art, S(16));
      ctx.fill();
      text(ctx, "🎵", artX + art / 2, artY + art / 2 + S(22), { size: 54, color: PALETTE.accent, align: "center" });
    }
    ctx.fillStyle = "rgba(7, 10, 20, .82)";
    theme.roundRect(ctx, artX + S(8), artY + S(8), S(34), S(26), S(8));
    ctx.fill();
    text(ctx, String(index + 1), artX + S(25), artY + S(26), { size: 16, family: "JT-Bold", color: PALETTE.accent, align: "center" });

    const titleY = artY + art + S(26);
    text(ctx, theme.truncate(ctx, track.title, cardW - S(22)), x + cardW / 2, titleY, {
      size: 16, family: "JT-Round-Bold", color: PALETTE.ink, align: "center", maxWidth: cardW - S(22)
    });
    text(ctx, theme.truncate(ctx, track.artist || "", cardW - S(22)), x + cardW / 2, titleY + S(20), {
      size: 12, family: "JT-Mono", color: PALETTE.ink2, align: "center", maxWidth: cardW - S(22)
    });

    const tagY = y + cardH - S(30);
    const tagH = S(22);
    const plays = Number(track.plays) || 0;
    const likes = Number(track.likes) || 0;
    const tagLabel = plays >= likes
      ? `👤 ${shortPlays(plays)} lượt nghe`
      : `❤️ ${shortPlays(likes)} thích`;
    const tagColor = plays >= likes ? "rgba(34, 197, 94, .18)" : "rgba(239, 68, 68, .18)";
    const tagStroke = plays >= likes ? PALETTE.green : PALETTE.red;
    ctx.save();
    ctx.font = theme.font(S(12), "JT-Bold");
    const tagW = Math.min(cardW - S(16), ctx.measureText(tagLabel).width + S(18));
    ctx.restore();
    const tagX = x + (cardW - tagW) / 2;
    ctx.fillStyle = tagColor;
    theme.roundRect(ctx, tagX, tagY - tagH / 2 - S(4), tagW, tagH, S(11));
    ctx.fill();
    ctx.strokeStyle = tagStroke;
    ctx.lineWidth = S(1.5);
    theme.roundRect(ctx, tagX, tagY - tagH / 2 - S(4), tagW, tagH, S(11));
    ctx.stroke();
    text(ctx, tagLabel, x + cardW / 2, tagY + S(2), {
      size: 12, family: "JT-Bold", color: tagStroke, align: "center", maxWidth: tagW - S(8)
    });
  });

  const footY = H - footerH + S(4);
  const btnW = (W - S(50) - S(20)) / 3;
  const navColors = { prev: PALETTE.accent, out: PALETTE.ink2, next: PALETTE.accent2 };
  text(ctx, `Trang ${page}/${totalPages}`, W / 2, footY + S(24), { size: 20, family: "JT-Bold", color: PALETTE.ink, align: "center" });
  const btnY = footY + S(38);
  button(ctx, S(25), btnY, btnW, S(42), "◀ PREV", navColors.prev);
  button(ctx, S(25) + btnW + S(10), btnY, btnW - S(10), S(42), "✕ OUT", navColors.out);
  button(ctx, S(25) + btnW * 2 + S(20), btnY, btnW, S(42), "NEXT ▶", navColors.next);
  text(
    ctx,
    `» ${global.config.prefix}scl <số> để tải bài  •  gõ trần next / prev / out`,
    W / 2, footY + S(92),
    { size: 14, family: "JT-Mono", color: PALETTE.ink2, align: "center" }
  );
  return theme.save(canvas, "music_grid");
}

// ===== Thẻ ĐANG PHÁT =====
async function renderNowPlaying(track, sourceLabel) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const { PALETTE, panel, text } = theme;

  const coverSize = S(300);
  const H = S(470);
  const { ctx, canvas } = theme.newCanvas(W, H);
  await theme.paintBackground(ctx, W, H);

  text(ctx, "🎶", S(24), S(56), { size: 34, color: PALETTE.accent });
  text(ctx, "ĐANG PHÁT", W / 2, S(56), { size: 32, family: "JT-Display-Bold", color: PALETTE.ink, align: "center" });

  const cover = await fetchThumb(track.thumbnail);
  const cx = (W - coverSize) / 2;
  const cy = S(74);
  if (cover) {
    ctx.save();
    theme.roundRect(ctx, cx, cy, coverSize, coverSize, S(20));
    ctx.clip();
    ctx.drawImage(cover, cx, cy, coverSize, coverSize);
    ctx.restore();
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = S(3);
    theme.roundRect(ctx, cx, cy, coverSize, coverSize, S(20));
    ctx.stroke();
  } else {
    panel(ctx, cx, cy, coverSize, coverSize, S(20));
    text(ctx, "🎵", cx + coverSize / 2, cy + coverSize / 2 + S(22), { size: 70, color: PALETTE.accent, align: "center" });
  }

  text(ctx, track.title, W / 2, cy + coverSize + S(52), { size: 26, family: "JT-Display-Bold", color: PALETTE.ink, align: "center", maxWidth: W - S(60) });
  text(ctx, `♫ ${track.artist}  •  ⏱ ${formatDuration(track.duration)}`, W / 2, cy + coverSize + S(84), {
    size: 18, family: "JT-Mono", color: PALETTE.ink2, align: "center", maxWidth: W - S(60)
  });
  text(ctx, `📡 ${sourceLabel || track.source}${track.plays ? `  •  👤 ${shortPlays(track.plays)} lượt nghe` : ""}`, W / 2, cy + coverSize + S(114), {
    size: 16, family: "JT-Bold", color: PALETTE.accent, align: "center", maxWidth: W - S(60)
  });
  text(ctx, "➜ Đang tải file nhạc, vui lòng chờ...", W / 2, H - S(34), { size: 15, color: PALETTE.ink2, align: "center" });

  return theme.save(canvas, "music_now");
}

module.exports = { renderSearchGrid, renderNowPlaying };
