"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("canvas");

const SIZE = 512;
const CACHE_DIR = path.join(__dirname, "..", "assets", "cache", "sticker");

const FRAMES = Object.freeze([
  { id: 1, name: "Discord Classic", tag: "CLASSIC", colors: ["#5865F2", "#8295FF", "#C9D1FF"], accent: "#FFFFFF", glow: "#5865F2", style: "classic" },
  { id: 2, name: "Discord Nitro", tag: "NITRO", colors: ["#7B4DFF", "#E35BFF", "#FF9ACB"], accent: "#FFE8FF", glow: "#A855F7", style: "nitro" },
  { id: 3, name: "Midnight Discord", tag: "MIDNIGHT", colors: ["#15264F", "#3478F6", "#65D8FF"], accent: "#B9EFFF", glow: "#287BFF", style: "midnight" },
  { id: 4, name: "Discord Neon", tag: "NEON", colors: ["#00C2FF", "#6558FF", "#D84DFF"], accent: "#EAFBFF", glow: "#00C2FF", style: "neon" },
  { id: 5, name: "Discord Hologram", tag: "HOLOGRAM", colors: ["#B8A7FF", "#7F8EFF", "#9EF1FF"], accent: "#FFFFFF", glow: "#A99CFF", style: "hologram" }
]);

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawDiscordGlyph(ctx, x, y, color, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.quadraticCurveTo(8, 0, 13, 0);
  ctx.lineTo(42, 0);
  ctx.quadraticCurveTo(47, 0, 47, 5);
  ctx.lineTo(47, 23);
  ctx.quadraticCurveTo(47, 28, 42, 28);
  ctx.lineTo(23, 28);
  ctx.lineTo(13, 36);
  ctx.lineTo(14, 28);
  ctx.lineTo(8, 28);
  ctx.quadraticCurveTo(3, 28, 3, 23);
  ctx.lineTo(3, 8);
  ctx.quadraticCurveTo(3, 4, 8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#22243D";
  ctx.beginPath(); ctx.arc(18, 14, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(33, 14, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawSparkle(ctx, x, y, radius, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.quadraticCurveTo(radius * 0.17, -radius * 0.17, radius, 0);
  ctx.quadraticCurveTo(radius * 0.17, radius * 0.17, 0, radius);
  ctx.quadraticCurveTo(-radius * 0.17, radius * 0.17, -radius, 0);
  ctx.quadraticCurveTo(-radius * 0.17, -radius * 0.17, 0, -radius);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function makeGradient(ctx, frame, x1 = 20, y1 = 20, x2 = SIZE - 20, y2 = SIZE - 20) {
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  gradient.addColorStop(0, frame.colors[2]);
  gradient.addColorStop(0.48, frame.colors[0]);
  gradient.addColorStop(1, frame.colors[1]);
  return gradient;
}

function drawBadge(ctx, frame) {
  ctx.save();
  ctx.shadowColor = frame.glow;
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(18, 20, 38, 0.82)";
  roundedRect(ctx, 163, 452, 186, 39, 19);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = makeGradient(ctx, frame, 163, 452, 349, 491);
  ctx.lineWidth = 2;
  roundedRect(ctx, 163, 452, 186, 39, 19);
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DISCORD  •  " + frame.tag, 256, 472);
  ctx.restore();
}

function drawFrame(frameId, outputPath) {
  const frame = FRAMES.find(item => item.id === Number(frameId));
  if (!frame) throw new RangeError("Mẫu khung Discord phải từ 1 đến " + FRAMES.length);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const target = outputPath || path.join(CACHE_DIR, "discord-frame-" + frame.id + ".png");
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);

  // The centre deliberately stays transparent: the user's media remains visible.
  ctx.save();
  ctx.shadowColor = frame.glow;
  ctx.shadowBlur = 22;
  ctx.strokeStyle = makeGradient(ctx, frame, 16, 16, 496, 496);
  ctx.lineWidth = 20;
  roundedRect(ctx, 24, 24, 464, 464, 108);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 3;
  roundedRect(ctx, 42, 42, 428, 428, 91);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 2;
  roundedRect(ctx, 12, 12, 488, 488, 122);
  ctx.stroke();
  ctx.restore();

  // Small Discord-inspired identity plate and status accents sit on the edge only.
  ctx.save();
  ctx.shadowColor = frame.glow;
  ctx.shadowBlur = 14;
  ctx.fillStyle = "rgba(25, 27, 54, 0.88)";
  roundedRect(ctx, 48, 37, 92, 47, 20);
  ctx.fill();
  ctx.restore();
  drawDiscordGlyph(ctx, 68, 47, frame.colors[2], 0.78);

  ctx.save();
  ctx.fillStyle = "rgba(24, 26, 48, 0.85)";
  roundedRect(ctx, 385, 42, 78, 30, 15);
  ctx.fill();
  ctx.fillStyle = frame.colors[2];
  ctx.beginPath(); ctx.arc(402, 57, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("ONLINE", 414, 57);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = makeGradient(ctx, frame, 50, 440, 462, 440);
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(95, 437); ctx.lineTo(153, 437); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(359, 437); ctx.lineTo(417, 437); ctx.stroke();
  ctx.restore();

  drawBadge(ctx, frame);
  drawSparkle(ctx, 63, 119, 8, frame.accent);
  drawSparkle(ctx, 449, 119, 7, frame.accent);
  drawSparkle(ctx, 64, 395, 6, frame.colors[2]);
  drawSparkle(ctx, 448, 395, 6, frame.colors[2]);

  if (frame.style === "nitro" || frame.style === "hologram") {
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = frame.colors[2];
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(256, 26, 12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(256, 486, 12, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  fs.writeFileSync(target, canvas.toBuffer("image/png"));
  return target;
}

async function renderSamplePreview(frameId, outputPath) {
  const frame = FRAMES.find(item => item.id === Number(frameId));
  if (!frame) throw new RangeError("Mẫu khung Discord phải từ 1 đến " + FRAMES.length);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, "#171A35");
  bg.addColorStop(0.55, "#35417F");
  bg.addColorStop(1, "#171B29");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = frame.colors[1];
  ctx.beginPath(); ctx.arc(355, 176, 130, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = frame.colors[2];
  ctx.beginPath(); ctx.arc(164, 330, 112, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.font = "bold 42px Arial";
  ctx.fillText("JOHNTRAN", 256, 251);
  ctx.font = "16px Arial";
  ctx.fillText("DISCORD STICKER PREVIEW", 256, 279);

  const framePath = drawFrame(frameId, outputPath ? outputPath + ".overlay.png" : undefined);
  try {
    const overlay = await loadImage(framePath);
    ctx.drawImage(overlay, 0, 0, SIZE, SIZE);
    const target = outputPath || path.join(CACHE_DIR, "discord-frame-preview-" + frame.id + ".png");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, canvas.toBuffer("image/png"));
    return target;
  } finally {
    if (outputPath) {
      try { fs.unlinkSync(framePath); } catch {}
    }
  }
}

function frameList() {
  return FRAMES.map(({ id, name, tag }) => ({ id, name, tag }));
}

function getFrame(frameId) {
  return FRAMES.find(item => item.id === Number(frameId)) || null;
}

function normalizeFrameId(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return fallback;
  const id = Number(value);
  return Number.isInteger(id) && FRAMES.some(frame => frame.id === id) ? id : null;
}

module.exports = {
  SIZE,
  frameList,
  getFrame,
  normalizeFrameId,
  renderFrame: drawFrame,
  renderSamplePreview
};
