"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas } = require("canvas");
const { getAvatar } = require("./avatarCache");

const WIDTH = 1000;
const ROW_HEIGHT = 94;

function rounded(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function fitText(ctx, text, maxWidth) {
  let value = String(text || "");
  while (value.length && ctx.measureText(value).width > maxWidth) value = value.slice(0, -1);
  return value.length < String(text || "").length ? value.slice(0, -1) + "…" : value;
}

function drawAvatar(ctx, item, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Never await remote avatar downloads while rendering a ranking card.
  // getAvatar returns a cached Canvas image synchronously and warms misses
  // in the background; a placeholder keeps the card responsive on cold cache.
  const image = getAvatar(item.avatar);
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#dce4e7";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(item.name || "?").trim().charAt(0).toUpperCase(), x + size / 2, y + size / 2 + 10);
  }

  ctx.restore();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.stroke();
}

async function renderTopChat({ title, subtitle, ranking }) {
  const rows = Array.isArray(ranking) ? ranking.slice(0, 10) : [];
  const height = 470 + rows.length * ROW_HEIGHT;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, WIDTH, height);
  bg.addColorStop(0, "#fffaf4");
  bg.addColorStop(1, "#eef3f8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, height);
  rounded(ctx, 22, 22, WIDTH - 44, height - 44, 28, "#ffffff", "#20252b");

  ctx.textAlign = "left";
  ctx.fillStyle = "#24201d";
  ctx.font = "bold 42px Arial";
  ctx.fillText("☆", 54, 95);
  ctx.fillText(title || "TOP CHAT HÔM NAY", 112, 95);
  ctx.fillStyle = "#d99a19";
  ctx.font = "bold 24px Arial";
  ctx.fillText("🏆 " + (subtitle || "VINH DANH TOP 3"), 60, 145);

  const podium = [rows[1], rows[0], rows[2]].filter(Boolean);
  const centers = [235, 500, 765];
  const podiumY = [210, 180, 210];
  for (let i = 0; i < podium.length; i++) {
    const item = podium[i];
    const x = centers[i];
    const y = podiumY[i];
    const medal = ["🥈", "🥇", "🥉"][i];
    rounded(ctx, x - 105, y, 210, 190, 18, "#17191e", "#8c6b4c");
    ctx.textAlign = "center";
    ctx.font = "bold 30px Arial";
    ctx.fillStyle = "#f5c451";
    ctx.fillText(medal, x, y + 34);
    drawAvatar(ctx, item, x - 38, y + 48, 76);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px Arial";
    ctx.fillText(fitText(ctx, item.name, 180), x, y + 151);
    ctx.font = "17px Arial";
    ctx.fillStyle = "#e7e7e7";
    ctx.fillText(item.count + " tin", x, y + 177);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#27211c";
  ctx.font = "bold 27px Arial";
  ctx.fillText("▥  BẢNG XẾP HẠNG HÔM NAY", 58, 455);

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const y = 480 + i * ROW_HEIGHT;
    const fills = ["#c9f8e8", "#e9edf2", "#f3e1d5"];
    const strokes = ["#00a47b", "#8294a6", "#9b6a45"];
    const fill = i < 3 ? fills[i] : "#f1f1f1";
    const stroke = i < 3 ? strokes[i] : "#30343b";
    rounded(ctx, 48, y, WIDTH - 96, 78, 18, fill, stroke);

    ctx.fillStyle = i === 0 ? "#d49a00" : i === 1 ? "#8294a6" : i === 2 ? "#c17a35" : "#d49a00";
    ctx.font = "bold 27px Arial";
    ctx.fillText(String(i + 1) + ".", 68, y + 48);

    drawAvatar(ctx, item, 116, y + 12, 54);
    ctx.textAlign = "left";
    ctx.fillStyle = "#28221e";
    ctx.font = "bold 23px Arial";
    ctx.fillText(fitText(ctx, item.name, 470), 188, y + 34);
    ctx.fillStyle = "#817267";
    ctx.font = "17px Arial";
    ctx.fillText(i === 0 ? "Hạng: Vàng" : i === 1 ? "Hạng: Bạc" : i === 2 ? "Hạng: Đồng" : "Hạng: Thành viên", 188, y + 59);

    rounded(ctx, 790, y + 19, 90, 40, 20, i === 0 ? "#f2a000" : i === 1 ? "#91a5b9" : i === 2 ? "#bd5c00" : "#75808c");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold 19px Arial";
    ctx.fillText(item.count + " tin", 835, y + 46);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_topchat_"));
  const output = path.join(tmpDir, "topchat.png");
  fs.writeFileSync(output, canvas.toBuffer("image/png"));
  const timer = setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }, 120000);
  timer.unref?.();
  return output;
}

module.exports = { renderTopChat };
