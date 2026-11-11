#!/usr/bin/env node
/**
 * Renders 3 visual /scl menu design previews to design-samples/.
 * Uses mock data (no SoundCloud API). Does NOT modify existing source files.
 *
 * Run: node scripts/design_scl_samples.js
 */
process.env.JT_DB_FILE = process.env.JT_DB_FILE || require("path").join(require("os").tmpdir(), "jt_scl_samples.json");

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

global.config = require(path.join(ROOT, "core/config")).load();

const theme = require(path.join(ROOT, "core/canvas/theme"));
const { withMacWindow } = require(path.join(ROOT, "core/canvas/macWindow"));
theme.initFonts();

const tracks = [
  { title: "Running Up That Hill", artist: "Kate Bush", duration: 240, plays: 12500000, likes: 890000, thumbnail: "" },
  { title: "Blinding Lights", artist: "The Weeknd", duration: 200, plays: 3500000000, likes: 22000000, thumbnail: "" },
  { title: "Flowers", artist: "Miley Cyrus", duration: 206, plays: 1800000000, likes: 9500000, thumbnail: "" },
  { title: "Levitating", artist: "Dua Lipa", duration: 213, plays: 2200000000, likes: 13000000, thumbnail: "" },
  { title: "As It Was", artist: "Harry Styles", duration: 222, plays: 2800000000, likes: 17000000, thumbnail: "" }
];

const { PALETTE, S, WIDTH, newCanvas, paintBackground, panel, button, text, label, foil, roundRect, randomAccent, THEME_STYLE } = theme;

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function drawCover(ctx, x, y, size) {
  roundRect(ctx, x, y, size, size, S(THEME_STYLE.panelRadius ? 10 : 0));
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, "rgba(212,175,55,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0.04)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = PALETTE.accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(1, S(1));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = theme.font(Math.max(18, Math.round(size * 0.62 / (WIDTH / 750))), "JT-Bold");
  ctx.fillStyle = PALETTE.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♪", x + size / 2, y + size / 2 + S(2));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawChip(ctx, x, y, str, color) {
  ctx.font = theme.font(14, "JT-Mono");
  const tw = ctx.measureText(str).width;
  const pw = tw + S(14);
  const ph = S(22);
  roundRect(ctx, x, y, pw, ph, S(4));
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1, S(1));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(str, x + pw / 2, y + ph / 2 + S(1));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return pw;
}

function drawPlayBtn(ctx, x, y, size) {
  roundRect(ctx, x, y, size, size, S(6));
  ctx.fillStyle = `${PALETTE.accent}2e`;
  ctx.fill();
  ctx.strokeStyle = PALETTE.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, S(1.2));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.accent;
  ctx.beginPath();
  const cx = x + size / 2 + S(2);
  const cy = y + size / 2;
  const r = size * 0.22;
  ctx.moveTo(cx - r * 0.6, cy - r);
  ctx.lineTo(cx - r * 0.6, cy + r);
  ctx.lineTo(cx + r, cy);
  ctx.closePath();
  ctx.fill();
}

function renderSample({ name, cols, coverSize, perPage, pageLabel, filePath }) {
  const list = tracks.slice(0, perPage);
  const margin = S(18);
  const gap = S(12);
  const headerH = S(112);
  const footerH = S(86);
  const cardW = Math.floor((WIDTH - margin * 2 - gap * (cols - 1)) / cols);
  const pad = S(12);
  const cover = S(coverSize);
  const titleSize = coverSize >= 180 ? 22 : coverSize <= 120 ? 16 : 19;
  const artistSize = coverSize >= 180 ? 17 : coverSize <= 120 ? 13 : 15;
  const chipY = cover + pad * 2 + S(titleSize) * 2.45 + S(artistSize) * 1.2 + S(10);
  const cardH = chipY + S(30) + pad;
  const rows = Math.ceil(list.length / cols);
  const gridH = rows * cardH + (rows - 1) * gap;
  const height = headerH + gridH + footerH + margin;

  const { canvas, ctx } = newCanvas(WIDTH, height);
  paintBackground(ctx, WIDTH, height);

  // Header
  const hx = margin;
  const hy = S(14);
  panel(ctx, hx, hy, WIDTH - margin * 2, headerH - S(20), S(THEME_STYLE.panelRadius || 0));
  label(ctx, "TÌM NHẠC • SOUNDCLOUD", hx + S(16), hy + S(28), { size: 15, color: PALETTE.accent });
  text(ctx, `"lofi chill"`, hx + S(16), hy + S(56), { size: 28, family: "JT-Bold", color: PALETTE.ink, maxWidth: WIDTH - margin * 2 - S(40) });
  foil(ctx, hx + S(16), hy + S(64), S(180));
  text(ctx, `${tracks.length} kết quả • mẫu ${name}`, hx + S(16), hy + S(84), { size: 15, family: "JT", color: PALETTE.mute, maxWidth: WIDTH - margin * 2 - S(40) });

  // Grid
  const gridTop = headerH;
  list.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gap);
    const y = gridTop + row * (cardH + gap);
    panel(ctx, x, y, cardW, cardH, S(THEME_STYLE.panelRadius || 0));
    const cx = x + pad;
    const cy = y + pad;

    // Index badge
    const badge = String(i + 1);
    ctx.font = theme.font(14, "JT-Mono-Bold");
    const bw = Math.max(S(22), ctx.measureText(badge).width + S(10));
    roundRect(ctx, cx, cy, bw, S(20), S(3));
    ctx.fillStyle = `${PALETTE.accent}33`;
    ctx.fill();
    ctx.fillStyle = PALETTE.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, cx + bw / 2, cy + S(10) + S(1));
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Cover (centered horizontally in card)
    const coverX = x + Math.round((cardW - cover) / 2);
    const coverY = cy + S(24);
    drawCover(ctx, coverX, coverY, cover);

    // Title (2-line clamp)
    const tx = cx;
    let ty = coverY + cover + S(18);
    ctx.font = theme.font(titleSize, "JT-Bold");
    const titleMax = cardW - pad * 2;
    const words = t.title.split(/\s+/);
    let line1 = "";
    let wi = 0;
    for (; wi < words.length; wi++) {
      const test = line1 ? line1 + " " + words[wi] : words[wi];
      if (ctx.measureText(test).width <= titleMax) line1 = test;
      else break;
    }
    if (!line1) { line1 = words[0] || ""; wi = 1; }
    let line2 = "";
    for (; wi < words.length; wi++) {
      const test = line2 ? line2 + " " + words[wi] : words[wi];
      if (ctx.measureText(test).width <= titleMax) line2 = test;
      else { line2 = (line2 ? line2 + " " : "") + words.slice(wi).join(" "); break; }
    }
    ctx.font = theme.font(titleSize, "JT-Bold");
    let l1 = line1, l2 = line2;
    if (ctx.measureText(l1).width > titleMax) { while (l1.length > 1 && ctx.measureText(l1 + "…").width > titleMax) l1 = l1.slice(0, -1); l1 += "…"; }
    if (ctx.measureText(l2).width > titleMax) { while (l2.length > 1 && ctx.measureText(l2 + "…").width > titleMax) l2 = l2.slice(0, -1); l2 += "…"; }
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(l1, tx, ty);
    ty += S(titleSize) * 1.22;
    if (l2) ctx.fillText(l2, tx, ty);

    // Artist + duration
    const ay = ty + S(artistSize) * 1.15;
    text(ctx, `${t.artist} • ${fmtDur(t.duration)}`, tx, ay, { size: artistSize, family: "JT", color: PALETTE.ink2, maxWidth: titleMax });

    // Chips
    const cy2 = ay + S(10);
    const pw = drawChip(ctx, tx, cy2, `▶ ${fmtNum(t.plays)}`, PALETTE.accent);
    drawChip(ctx, tx + pw + S(6), cy2, `♥ ${fmtNum(t.likes)}`, PALETTE.red);

    // Play button (bottom-right of card)
    const pbs = S(coverSize >= 180 ? 34 : coverSize <= 120 ? 26 : 30);
    drawPlayBtn(ctx, x + cardW - pad - pbs, y + cardH - pad - pbs, pbs);
  });

  // Footer
  const fy = height - footerH + S(4);
  panel(ctx, margin, fy, WIDTH - margin * 2, footerH - S(14), S(THEME_STYLE.panelRadius || 0));
  text(ctx, pageLabel, margin + S(16), fy + S(32), { size: 18, family: "JT-Mono-Bold", color: PALETTE.ink });
  text(ctx, "Gõ số để chọn • next/prev/out", margin + S(16), fy + S(54), { size: 14, family: "JT", color: PALETTE.mute });
  const accent = randomAccent();
  const bw = S(110);
  const bh = S(38);
  const bx = WIDTH - margin - S(12) - bw * 3 - S(8) * 2;
  const by = fy + S(12);
  button(ctx, bx, by, bw, bh, "◀ PREV", accent.prev);
  button(ctx, bx + bw + S(8), by, bw, bh, "OUT", accent.out);
  button(ctx, bx + (bw + S(8)) * 2, by, bw, bh, "NEXT ▶", accent.next);

  // Save exact target path using macWindow wrapper (same as theme.save does)
  const wrapped = withMacWindow(canvas, "Music Search");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, wrapped.toBuffer("image/png"));
  return { filePath, width: wrapped.width, height: wrapped.height };
}

(async () => {
  const outDir = path.join(ROOT, "design-samples");
  const samples = [
    { name: "A (3-col, current)", cols: 3, coverSize: 150, perPage: 5, pageLabel: "Trang 1/2", filePath: path.join(outDir, "sample-A-grid3.png") },
    { name: "B (2-col, large)", cols: 2, coverSize: 200, perPage: 4, pageLabel: "Trang 1/2", filePath: path.join(outDir, "sample-B-grid2.png") },
    { name: "C (4-col, compact)", cols: 4, coverSize: 110, perPage: 8, pageLabel: "Trang 1/1", filePath: path.join(outDir, "sample-C-grid4.png") }
  ];

  for (const s of samples) {
    const r = await renderSample(s);
    const stat = fs.statSync(r.filePath);
    console.log(`CREATED ${path.relative(ROOT, r.filePath)}  ${stat.size} bytes  ${r.width}x${r.height}`);
  }

  const missing = samples.filter((s) => !fs.existsSync(s.filePath));
  if (missing.length) {
    console.error("MISSING:", missing.map((m) => path.relative(ROOT, m.filePath)).join(", "));
    process.exit(1);
  }
  console.log(`OK: ${samples.length}/3 samples created.`);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
