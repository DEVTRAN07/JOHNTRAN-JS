"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas, loadImage } = require("canvas");
const avatarCache = require("./avatarCache");

const WIDTH = 1280;
const HEIGHT = 780;
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "assets", "games", "ghepchu-template.jpg");
let templatePromise = null;

function getTemplate() {
  if (!templatePromise) {
    // Template artwork is optional at runtime. A missing asset must not make
    // the game unusable; render a native fallback canvas instead.
    templatePromise = loadImage(TEMPLATE_PATH).catch(() => null);
  }
  return templatePromise;
}

function drawFallbackTemplate(ctx) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#071629");
  background.addColorStop(0.52, "#102b4b");
  background.addColorStop(1, "#061321");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  roundedRect(ctx, 24, 24, WIDTH - 48, HEIGHT - 48, 32);
  ctx.fillStyle = "rgba(8, 24, 43, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(100, 178, 239, 0.7)";
  ctx.lineWidth = 3;
  ctx.stroke();

  drawText(ctx, "JOHNTRAN · GAME CENTER", 640, 82, {
    size: 24, color: "#8fcaff", weight: "800", align: "center"
  });
  drawText(ctx, "GHÉP CHỮ", 640, 126, {
    size: 42, color: "#f4f8ff", weight: "800", align: "center", shadow: true
  });
  drawText(ctx, "Sắp xếp các chữ cái để tìm từ tiếng Việt", 640, 164, {
    size: 20, color: "#bad5ee", weight: "600", align: "center"
  });

  const boxes = [
    { x: 250, label: "THỜI GIAN" },
    { x: 520, label: "ĐIỂM SỐ" },
    { x: 790, label: "CHUỖI ĐÚNG" }
  ];
  for (const box of boxes) {
    roundedRect(ctx, box.x, 177, 240, 78, 16);
    ctx.fillStyle = "rgba(20, 54, 88, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(91, 161, 220, 0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
    drawText(ctx, box.label, box.x + 120, 203, {
      size: 16, color: "#9fc9ed", weight: "700", align: "center"
    });
  }

  roundedRect(ctx, 285, 285, 710, 168, 22);
  ctx.fillStyle = "rgba(5, 19, 35, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(84, 155, 219, 0.55)";
  ctx.stroke();
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawText(ctx, value, x, y, options = {}) {
  const {
    size = 22,
    color = "#e9f4ff",
    weight = "600",
    align = "left",
    maxWidth,
    baseline = "alphabetic",
    shadow = false
  } = options;
  ctx.save();
  ctx.font = weight + " " + size + "px Arial, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 2;
  }
  let text = String(value ?? "");
  if (maxWidth && ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
      text = text.slice(0, -1);
    }
    text += "…";
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawStatValue(ctx, x, value, color, maxWidth = 150) {
  // The supplied match screenshot is the master background; only the live
  // value is repainted so the original labels, borders and spacing stay exact.
  ctx.fillStyle = "#0d1c31";
  ctx.fillRect(x - maxWidth / 2, 163, maxWidth, 40);
  drawText(ctx, value, x, 193, {
    size: 29,
    color,
    weight: "800",
    align: "center",
    shadow: true
  });
}

function drawAvatar(ctx, data = {}) {
  const x = 120;
  const y = 450;
  const radius = 42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  const avatar = avatarCache.getAvatar(data.requesterAvatarUrl);
  if (avatar) {
    const side = Math.min(avatar.width, avatar.height);
    const sx = (avatar.width - side) / 2;
    const sy = (avatar.height - side) / 2;
    ctx.drawImage(avatar, sx, sy, side, side, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, "#55baff");
    gradient.addColorStop(1, "#174a91");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    drawText(ctx, String(data.playerName || "J").slice(0, 1).toLocaleUpperCase("vi-VN"),
      x, y + 2, { size: 38, color: "#ffffff", weight: "800", align: "center", baseline: "middle" });
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius + 1, 0, Math.PI * 2);
  ctx.strokeStyle = "#f4bd36";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Replace only the old sample name; keep the original label and badge art.
  ctx.fillStyle = "#10233d";
  ctx.fillRect(38, 500, 164, 43);
  drawText(ctx, data.playerName || "Người chơi", x, 534, {
    size: 27,
    color: "#ffffff",
    weight: "800",
    align: "center",
    maxWidth: 170,
    shadow: true
  });
}

function drawTile(ctx, x, y, size, letter) {
  const marked = String(letter) === String(letter).toLocaleUpperCase("vi-VN");
  const accent = marked ? "#eeb53b" : "#5da9ef";
  const fill = ctx.createLinearGradient(x, y, x, y + 76);
  fill.addColorStop(0, "#194a78");
  fill.addColorStop(1, "#0e2c50");

  roundedRect(ctx, x, y, size, 76, 16);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawText(ctx, letter, x + size / 2, y + 40, {
    size: Math.min(34, size * 0.54),
    color: marked ? "#ffc13f" : "#f4f8ff",
    weight: "800",
    align: "center",
    baseline: "middle"
  });
}

function drawLiveTiles(ctx, letters) {
  // Hide the sample letters from the source image while preserving the
  // original divider, heading and overall central board proportions.
  ctx.fillStyle = "#10203a";
  ctx.fillRect(315, 312, 650, 108);

  const list = Array.isArray(letters) ? letters.slice(0, 14) : [];
  if (!list.length) return;

  const availableWidth = 650;
  const gap = list.length > 9 ? 7 : 12;
  const size = Math.min(76, Math.floor((availableWidth - gap * (list.length - 1)) / list.length));
  const totalWidth = size * list.length + gap * (list.length - 1);
  const startX = Math.round(640 - totalWidth / 2);
  const y = 325;

  list.forEach((letter, index) => {
    drawTile(ctx, startX + index * (size + gap), y, size, String(letter));
  });
}

function drawFooter(ctx, data = {}) {
  // Preserve the original rounded footer pill, replacing its sample values.
  ctx.fillStyle = "#0b1d33";
  ctx.fillRect(515, 729, 260, 27);
  drawText(ctx, "▣  " + (data.version || "1.0.2"), 568, 750, {
    size: 19, color: "#edf6ff", weight: "700", align: "center"
  });
  drawText(ctx, "•", 640, 749, {
    size: 20, color: "#ffc13f", weight: "800", align: "center"
  });
  drawText(ctx, "◉  " + (data.botName || "JOHNTRAN"), 710, 750, {
    size: 18, color: "#edf6ff", weight: "700", align: "center", maxWidth: 130
  });
}

function drawResultState(ctx, data = {}) {
  ctx.fillStyle = "#10203a";
  ctx.fillRect(315, 312, 650, 108);
  const title = data.status === "finished" ? "HẾT GIỜ!" : "ĐÃ DỪNG VÁN";
  drawText(ctx, title, 640, 355, {
    size: 34, color: "#ffc13f", weight: "800", align: "center", shadow: true
  });
  drawText(ctx,
    "Đúng " + (Number(data.correct) || 0) + " câu  •  Bỏ qua " + (Number(data.skipped) || 0) + " câu",
    640, 391,
    { size: 21, color: "#f0f7ff", weight: "700", align: "center" }
  );
}

async function renderGhepChu(data = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const template = await getTemplate();

  // Prefer the supplied master artwork when it is present. Production builds
  // that omit the optional image still get a complete, legible game card.
  if (template) ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  else drawFallbackTemplate(ctx);

  const remaining = Math.max(0, Number(data.remainingSeconds) || 0);
  drawStatValue(ctx, 410, remaining + "s", remaining <= 15 ? "#ff8752" : "#95caff", 150);
  drawStatValue(ctx, 640, (Number(data.score) || 0) + " điểm", "#ffc13f", 166);
  drawStatValue(ctx, 870, "x" + (Number(data.streak) || 0), "#ff8b37", 140);

  if (data.status === "active") {
    drawLiveTiles(ctx, data.letters);
  } else {
    drawResultState(ctx, data);
  }

  drawAvatar(ctx, data);
  drawFooter(ctx, data);

  const outputPath = path.join(
    os.tmpdir(),
    "jt_ghepchu_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png"
  );
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { renderGhepChu, TEMPLATE_PATH };
