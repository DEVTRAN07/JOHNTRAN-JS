"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas } = require("canvas");
const theme = require("./theme");

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function polygon(ctx, points, fill, stroke, lineWidth = 2) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function drawCorner(ctx, x, y, sx, sy) {
  ctx.save();
  ctx.strokeStyle = "#62caff";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#168dff";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(x, y + 82 * sy);
  ctx.lineTo(x, y);
  ctx.lineTo(x + 82 * sx, y);
  ctx.stroke();
  ctx.restore();
}

function drawBook(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Page block and layered paper edges.
  ctx.shadowColor = "rgba(0,0,0,.58)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 18;
  polygon(ctx, [[18, 128], [250, 48], [366, 105], [116, 194]], "#e8d6b8", "#7f5e43", 5);
  ctx.shadowColor = "transparent";
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = i % 2 ? "#bda789" : "#f6e8d2";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(27 + i * 2, 139 + i * 7);
    ctx.lineTo(119 + i * 2, 203 + i * 3);
    ctx.lineTo(354 - i * 2, 116 + i * 7);
    ctx.stroke();
  }

  // Blue hard cover, deliberately drawn as a perspective object.
  const cover = ctx.createLinearGradient(20, 30, 300, 180);
  cover.addColorStop(0, "#70c9e9");
  cover.addColorStop(.38, "#287da7");
  cover.addColorStop(1, "#16415e");
  polygon(ctx, [[10, 95], [246, 8], [380, 72], [124, 168]], cover, "#67c9ed", 5);
  polygon(ctx, [[124, 168], [380, 72], [374, 125], [120, 219]], "#194e70", "#113a59", 4);
  polygon(ctx, [[10, 95], [124, 168], [120, 219], [4, 148]], "#1b5878", "#113a59", 4);

  // Small title plate.
  const plate = ctx.createLinearGradient(90, 30, 205, 115);
  plate.addColorStop(0, "#fff4da");
  plate.addColorStop(1, "#d9c6a5");
  polygon(ctx, [[105, 54], [224, 12], [286, 42], [163, 87]], plate, "#a58d6f", 3);

  // Ribbon bookmark.
  polygon(ctx, [[47, 149], [82, 164], [76, 248], [48, 232], [22, 248]], "#ff654c", "#b94032", 3);
  ctx.restore();
}

function drawBrain(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;

  const lobes = [
    [-59, -10, 39, 47], [-36, -43, 42, 43], [4, -54, 43, 45],
    [43, -35, 42, 42], [63, 3, 37, 43], [33, 33, 42, 37],
    [-11, 38, 43, 38], [-51, 25, 35, 38]
  ];
  for (const [lx, ly, rx, ry] of lobes) {
    const g = ctx.createRadialGradient(lx - 12, ly - 15, 3, lx, ly, Math.max(rx, ry));
    g.addColorStop(0, "#ffb49e");
    g.addColorStop(.62, "#f27e70");
    g.addColorStop(1, "#bd514d");
    ctx.beginPath();
    ctx.ellipse(lx, ly, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#a84946";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.shadowColor = "transparent";

  // Brain folds.
  ctx.strokeStyle = "rgba(139,53,54,.58)";
  ctx.lineWidth = 3;
  const folds = [
    [-50, -35, -25, -22, -38, 2], [-16, -60, 10, -28, -3, -8],
    [24, -59, 48, -31, 30, -15], [56, -12, 28, 1, 53, 22],
    [11, 4, -15, 9, 1, 37], [-44, 13, -26, 42, -8, 25]
  ];
  for (const [x1, y1, cx, cy, x2, y2] of folds) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
  }
  polygon(ctx, [[-10, 67], [7, 67], [15, 98], [-3, 92]], "#e7b48b", "#966b58", 2);
  ctx.restore();
}

function drawTrophy(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const gold = ctx.createLinearGradient(0, 0, 90, 130);
  gold.addColorStop(0, "#fff3a4");
  gold.addColorStop(.3, "#f5c64d");
  gold.addColorStop(.65, "#bf7e17");
  gold.addColorStop(1, "#70420a");
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  roundedRect(ctx, 25, 103, 70, 20, 5);
  ctx.fillStyle = gold;
  ctx.fill();
  polygon(ctx, [[31, 120], [89, 120], [104, 145], [16, 145]], gold, "#8b5b12", 3);
  polygon(ctx, [[32, 18], [88, 18], [80, 74], [60, 95], [40, 74]], gold, "#8b5b12", 3);
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#d89d2c";
  ctx.beginPath();
  ctx.ellipse(25, 42, 19, 24, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(95, 42, 19, 24, 0, Math.PI / 2, -Math.PI / 2);
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,250,204,.8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(46, 29);
  ctx.lineTo(54, 62);
  ctx.stroke();
  ctx.restore();
}

function renderNoituGuide() {
  const width = 1280;
  const height = 640;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Use the selected JOHNTRAN photo theme instead of painting a solid
  // navy gradient over the whole game guide.
  theme.paintBackground(ctx, width, height, {
    veilAlpha: [0.12, 0.17, 0.25],
    vignetteAlpha: 0.18,
    auroraStrength: 0.14
  });

  // Subtle diagonal technical grid.
  ctx.save();
  ctx.strokeStyle = "rgba(91,164,255,.075)";
  ctx.lineWidth = 1;
  for (let offset = -height; offset < width; offset += 38) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + height, height);
    ctx.stroke();
  }
  ctx.restore();

  // Double electric-blue frame.
  ctx.save();
  ctx.shadowColor = "#167cff";
  ctx.shadowBlur = 16;
  roundedRect(ctx, 16, 16, width - 32, height - 32, 20);
  ctx.strokeStyle = "#287eff";
  ctx.lineWidth = 5;
  ctx.stroke();
  roundedRect(ctx, 29, 29, width - 58, height - 58, 13);
  ctx.strokeStyle = "#8bd9ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  drawCorner(ctx, 32, 32, 1, 1);
  drawCorner(ctx, width - 32, 32, -1, 1);
  drawCorner(ctx, 32, height - 32, 1, -1);
  drawCorner(ctx, width - 32, height - 32, -1, -1);

  // Corner HUD seals.
  const seals = [[78, 78, "✦"], [1202, 78, "◆"], [78, 562, "▤"], [1202, 562, "⚔"]];
  for (const [cx, cy, glyph] of seals) {
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(4,13,32,.34)";
    ctx.fill();
    ctx.strokeStyle = "#2784ff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = "bold 30px Arial";
    ctx.fillStyle = "#58b8ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, cx, cy + 1);
  }

  drawBook(ctx, 168, 220, 1.02);
  drawBrain(ctx, 297, 146, 1.42);
  drawTrophy(ctx, 1114, 220, 1.12);

  // Main title with a blue metallic gradient.
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "900 104px Arial";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0,0,0,.9)";
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 8;
  ctx.strokeText("NỐI TỪ", 830, 310);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  theme.drawMulticolorText(ctx, "NỐI TỪ", 830, 310, {
    font: ctx.font,
    color: "#d8f2ff",
    align: "center",
    multicolor: true
  });
  ctx.restore();

  // Subtitle plate.
  roundedRect(ctx, 592, 370, 474, 62, 16);
  const plate = ctx.createLinearGradient(592, 370, 1066, 432);
  plate.addColorStop(0, "rgba(8,26,58,.34)");
  plate.addColorStop(1, "rgba(8,13,29,.42)");
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.strokeStyle = "#2585ff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  theme.drawMulticolorText(ctx, "ĐẠI CHIẾN TỪ VỰNG TIẾNG VIỆT", 829, 402, {
    font: ctx.font, color: "#e9f5ff", align: "center", multicolor: true
  });

  ctx.font = "bold 15px Arial";
  theme.drawMulticolorText(ctx, "JOHNTRAN  •  VIETNAMESE WORD ARENA", 830, 475, {
    font: ctx.font, color: "rgba(150,203,255,.78)", align: "center", multicolor: true
  });

  const outputPath = path.join(os.tmpdir(), "jt_noitu_guide_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { renderNoituGuide };
