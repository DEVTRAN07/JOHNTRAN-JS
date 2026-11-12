"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

async function loadClueImage(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;
    return await loadImage(bytes);
  } catch {
    return null;
  }
}

function drawCover(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sw = width / scale, sh = height / scale;
  const sx = (image.width - sw) / 2, sy = (image.height - sh) / 2;
  ctx.save();
  roundedRect(ctx, x, y, width, height, 18);
  ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();
}

async function renderQuestion(question, number = 1) {
  const width = 1200, height = 720;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#10172d");
  bg.addColorStop(1, "#263c64");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let x = 30; x < width; x += 60) {
    ctx.fillRect(x, 0, 1, height);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#f8d77b";
  ctx.font = "bold 38px sans-serif";
  ctx.fillText("ĐUỔI HÌNH BẮT CHỮ", width / 2, 72);
  ctx.fillStyle = "#d4def2";
  ctx.font = "24px sans-serif";
  ctx.fillText(`CÂU HỎI #${number} · QUAN SÁT HÌNH ẢNH VÀ ĐOÁN`, width / 2, 118);

  const clues = Array.isArray(question.clues) ? question.clues : [];
  const symbols = Array.isArray(question.symbols) ? question.symbols : [];
  const imageUrls = Array.isArray(question.images) ? question.images : [];
  const count = Math.max(1, clues.length);
  const gap = 28;
  const cardWidth = Math.min(500, (width - 120 - gap * (count - 1)) / count);
  const cardHeight = 390;
  const total = cardWidth * count + gap * (count - 1);
  const startX = (width - total) / 2;
  const loaded = await Promise.all(clues.map((_, i) => loadClueImage(imageUrls[i])));

  for (let i = 0; i < count; i++) {
    const x = startX + i * (cardWidth + gap);
    const y = 175;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    roundedRect(ctx, x, y, cardWidth, cardHeight, 22);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.restore();

    const image = loaded[i];
    if (image) {
      drawCover(ctx, image, x + 12, y + 12, cardWidth - 24, cardHeight - 74);
    } else {
      const fallback = ctx.createLinearGradient(x, y, x + cardWidth, y + cardHeight);
      fallback.addColorStop(0, "#dbeafe");
      fallback.addColorStop(1, "#ede9fe");
      roundedRect(ctx, x + 12, y + 12, cardWidth - 24, cardHeight - 74, 16);
      ctx.fillStyle = fallback;
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = "#243b63";
      ctx.font = `bold ${Math.min(104, Math.floor(cardWidth / 3.2))}px sans-serif`;
      ctx.fillText(symbols[i] || "🖼️", x + cardWidth / 2, y + 220, cardWidth - 45);
      ctx.fillStyle = "#64748b";
      ctx.font = "17px sans-serif";
      ctx.fillText("Chưa có ảnh minh họa", x + cardWidth / 2, y + 275);
    }

    ctx.fillStyle = "#17233c";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`GỢI Ý ${i + 1}`, x + cardWidth / 2, y + cardHeight - 28);
  }

  if (count > 1) {
    ctx.fillStyle = "#f8d77b";
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("+", width / 2, 390);
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 25px sans-serif";
  ctx.fillText("Nhập đáp án trực tiếp vào khung chat", width / 2, 635);
  ctx.fillStyle = "#a9bddf";
  ctx.font = "18px sans-serif";
  ctx.fillText("@Wuang · DHBC", width / 2, 675);

  const file = path.join(os.tmpdir(), `dhbc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await fs.writeFile(file, canvas.toBuffer("image/png"));
  return file;
}

module.exports = { renderQuestion };
