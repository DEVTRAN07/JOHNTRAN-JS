"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas } = require("canvas");
const avatarCache = require("./avatarCache");

const WIDTH = 1280;
const HEIGHT = 780;

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
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
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

function drawGlow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(7,20,40,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawRobot(ctx, cx, cy, scale = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Soft floor glow.
  drawGlow(ctx, 0, 118, 118, "rgba(28,151,255,.3)");

  // Antenna.
  ctx.strokeStyle = "#a9dfff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, -116);
  ctx.lineTo(0, -148);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -158, 13, 0, Math.PI * 2);
  ctx.fillStyle = "#15e87b";
  ctx.shadowColor = "#35ff99";
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#7dffc0";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Arms behind the body.
  ctx.lineCap = "round";
  ctx.strokeStyle = "#b8d6ed";
  ctx.lineWidth = 25;
  ctx.beginPath();
  ctx.moveTo(-64, 34);
  ctx.quadraticCurveTo(-104, 54, -98, 91);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(64, 34);
  ctx.quadraticCurveTo(105, 25, 112, 61);
  ctx.stroke();

  // Feet.
  ctx.fillStyle = "#d9eafa";
  ctx.strokeStyle = "#5488b4";
  ctx.lineWidth = 5;
  roundedRect(ctx, -66, 105, 56, 27, 13);
  ctx.fill(); ctx.stroke();
  roundedRect(ctx, 10, 105, 56, 27, 13);
  ctx.fill(); ctx.stroke();

  // Body.
  const body = ctx.createLinearGradient(-72, 35, 72, 116);
  body.addColorStop(0, "#f7fbff");
  body.addColorStop(.55, "#b9d6ed");
  body.addColorStop(1, "#6b9bc3");
  roundedRect(ctx, -76, 24, 152, 103, 37);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "#6ba1ce";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Chest light.
  ctx.beginPath();
  ctx.arc(0, 77, 23, 0, Math.PI * 2);
  ctx.fillStyle = "#0874b8";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 77, 15, 0, Math.PI * 2);
  const chest = ctx.createRadialGradient(-5, 70, 1, 0, 77, 16);
  chest.addColorStop(0, "#c2ffff");
  chest.addColorStop(.4, "#39e9ff");
  chest.addColorStop(1, "#0582cf");
  ctx.fillStyle = chest;
  ctx.shadowColor = "#30dfff";
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Head shell.
  const shell = ctx.createLinearGradient(-88, -120, 88, 32);
  shell.addColorStop(0, "#ffffff");
  shell.addColorStop(.48, "#dcecf8");
  shell.addColorStop(1, "#87afd1");
  roundedRect(ctx, -94, -124, 188, 166, 58);
  ctx.fillStyle = shell;
  ctx.fill();
  ctx.strokeStyle = "#6c9fca";
  ctx.lineWidth = 6;
  ctx.stroke();

  // Side ear pads.
  ctx.beginPath();
  ctx.ellipse(-94, -43, 17, 39, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2f9ee5";
  ctx.fill();
  ctx.strokeStyle = "#b7e5ff";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(94, -43, 17, 39, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2f9ee5";
  ctx.fill();
  ctx.stroke();

  // Face screen.
  roundedRect(ctx, -73, -103, 146, 118, 39);
  const screen = ctx.createLinearGradient(0, -103, 0, 15);
  screen.addColorStop(0, "#102a4c");
  screen.addColorStop(1, "#06172f");
  ctx.fillStyle = screen;
  ctx.fill();
  ctx.strokeStyle = "#243d5e";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Happy eyes and smile.
  ctx.strokeStyle = "#63dcff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-42, -48);
  ctx.quadraticCurveTo(-31, -70, -19, -48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(19, -48);
  ctx.quadraticCurveTo(31, -70, 42, -48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-17, -20);
  ctx.quadraticCurveTo(0, -3, 17, -20);
  ctx.stroke();

  // Floating spark marks.
  ctx.strokeStyle = "#ffc45d";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-118, -119); ctx.lineTo(-135, -139);
  ctx.moveTo(-121, -85); ctx.lineTo(-143, -91);
  ctx.moveTo(118, -117); ctx.lineTo(137, -135);
  ctx.stroke();

  ctx.restore();
}

function drawPlayerAvatar(ctx, x, y, radius, avatarUrl) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#163a62";
  ctx.fill();
  ctx.clip();

  const avatar = avatarCache.getAvatar(avatarUrl);
  if (avatar) {
    const size = Math.min(avatar.width, avatar.height);
    const sx = (avatar.width - size) / 2;
    const sy = (avatar.height - size) / 2;
    ctx.drawImage(avatar, sx, sy, size, size, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, "#69caff");
    gradient.addColorStop(1, "#2457bb");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    drawText(ctx, String("✦"), x, y + 2, { size: 42, color: "#ffffff", align: "center", baseline: "middle" });
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffc84a";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawStat(ctx, x, y, width, title, value, valueColor) {
  roundedRect(ctx, x, y, width, 72, 17);
  ctx.fillStyle = "rgba(4,20,41,.62)";
  ctx.fill();
  ctx.strokeStyle = "#4f95d9";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  drawText(ctx, title, x + width / 2, y + 24, {
    size: 16, color: "#aebed1", weight: "700", align: "center"
  });
  drawText(ctx, value, x + width / 2, y + 57, {
    size: 29, color: valueColor, weight: "800", align: "center"
  });
}

function drawTile(ctx, x, y, size, letter, accent) {
  roundedRect(ctx, x, y, size, 76, 16);
  const fill = ctx.createLinearGradient(x, y, x, y + 76);
  fill.addColorStop(0, "rgba(23,65,105,.96)");
  fill.addColorStop(1, "rgba(11,38,70,.98)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  drawText(ctx, letter.toLocaleUpperCase("vi-VN"), x + size / 2, y + 40, {
    size: Math.min(34, size * .54),
    color: accent === "#efb53d" ? "#ffc13f" : "#f4f8ff",
    weight: "800",
    align: "center",
    baseline: "middle"
  });
}

function drawDecor(ctx) {
  // A few small puzzle pieces around the play area.
  const pieces = [
    [70, 65, "#55b9ff"], [1196, 67, "#f4b93c"], [1140, 655, "#a98aff"]
  ];
  for (const [x, y, color] of pieces) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-.22);
    roundedRect(ctx, -13, -13, 26, 26, 6);
    ctx.fillStyle = color;
    ctx.globalAlpha = .85;
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 24; i++) {
    const x = 25 + ((i * 173) % 1230);
    const y = 35 + ((i * 97) % 700);
    ctx.fillStyle = i % 3 === 0 ? "rgba(109,196,255,.8)" : "rgba(115,156,205,.42)";
    ctx.beginPath();
    ctx.arc(x, y, i % 4 === 0 ? 2.3 : 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderGhepChu(data = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#07172c");
  background.addColorStop(.5, "#0b2543");
  background.addColorStop(1, "#071b34");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawGlow(ctx, 210, 350, 330, "rgba(11,101,184,.20)");
  drawGlow(ctx, 1090, 380, 340, "rgba(20,113,201,.18)");
  drawDecor(ctx);

  // Main game board.
  const panelX = 245, panelY = 25, panelW = 790, panelH = 672;
  roundedRect(ctx, panelX, panelY, panelW, panelH, 23);
  const panelFill = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  panelFill.addColorStop(0, "rgba(13,35,62,.97)");
  panelFill.addColorStop(1, "rgba(8,28,51,.98)");
  ctx.fillStyle = panelFill;
  ctx.fill();
  ctx.strokeStyle = "#62a8f2";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = "rgba(98,168,242,.2)";
  ctx.lineWidth = 1;
  roundedRect(ctx, panelX + 9, panelY + 9, panelW - 18, panelH - 18, 18);
  ctx.stroke();

  drawText(ctx, data.status === "active" ? "GHÉP CHỮ TIẾNG VIỆT" : "KẾT THÚC GHÉP CHỮ", 640, 82, {
    size: 42, color: "#91caff", weight: "800", align: "center", shadow: true
  });
  drawText(ctx, data.status === "active"
    ? "Sắp xếp các mảnh chữ tạo thành từ / ngữ có nghĩa"
    : "Tổng kết thử thách từ vựng của bạn", 640, 116, {
    size: 22, color: "#e7f2ff", weight: "700", align: "center"
  });

  const remaining = Math.max(0, Number(data.remainingSeconds) || 0);
  const timerColor = remaining <= 15 ? "#ff6b54" : "#95caff";
  drawStat(ctx, 305, 132, 211, "THỜI GIAN", remaining + "s", timerColor);
  drawStat(ctx, 534, 132, 211, "ĐIỂM SỐ", (Number(data.score) || 0) + " điểm", "#ffc13f");
  drawStat(ctx, 763, 132, 213, "CHUỖI ĐÚNG", "x" + (Number(data.streak) || 0), "#ff8b37");

  drawText(ctx, data.status === "active" ? "CÁC MẢNH CHỮ CẦN GHÉP" : "THÀNH TÍCH CỦA BẠN", 640, 250, {
    size: 27, color: "#8fc6ff", weight: "800", align: "center"
  });
  ctx.beginPath();
  ctx.moveTo(295, 260);
  ctx.lineTo(985, 260);
  ctx.strokeStyle = "#5a9bd9";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (data.status === "active") {
    const letters = Array.isArray(data.letters) ? data.letters : [];
    const count = Math.max(1, letters.length);
    const tileSize = count > 10 ? 48 : count > 8 ? 56 : 76;
    const gap = count > 10 ? 8 : 12;
    const totalWidth = count * tileSize + (count - 1) * gap;
    const startX = 640 - totalWidth / 2;
    letters.forEach((letter, index) => {
      const accent = index % 3 === 1 ? "#efb53d" : "#5da9ef";
      drawTile(ctx, startX + index * (tileSize + gap), 324, tileSize, letter, accent);
    });

    // Hint panel.
    roundedRect(ctx, 273, 468, 735, 90, 19);
    ctx.fillStyle = "rgba(4,23,44,.75)";
    ctx.fill();
    ctx.strokeStyle = "#5ba4e9";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawText(ctx, "MẸO CHƠI:", 291, 505, { size: 25, color: "#ffbf32", weight: "800" });
    drawText(ctx, data.clue || "Hãy sắp xếp các chữ cái để tìm ra từ có nghĩa.", 291, 533, {
      size: 19, color: "#e7f2ff", weight: "600", maxWidth: 695
    });

    drawText(ctx, "Gõ đáp án vào chat  •  skip bỏ qua (-5s)  •  stop để dừng", 640, 680, {
      size: 21, color: "#eef5ff", weight: "700", align: "center", shadow: true
    });
  } else {
    roundedRect(ctx, 273, 306, 735, 206, 20);
    ctx.fillStyle = "rgba(4,23,44,.75)";
    ctx.fill();
    ctx.strokeStyle = "#5ba4e9";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const statusLine = data.status === "finished" ? "HẾT GIỜ!" : "BẠN ĐÃ DỪNG VÁN";
    drawText(ctx, statusLine, 640, 360, { size: 34, color: "#ffbf43", weight: "800", align: "center" });
    drawText(ctx, `Đúng ${Number(data.correct) || 0} câu  •  Bỏ qua ${Number(data.skipped) || 0} câu`, 640, 416, {
      size: 24, color: "#edf6ff", weight: "700", align: "center"
    });
    drawText(ctx, `Tổng điểm: ${Number(data.score) || 0}  •  Chuỗi tốt nhất: ${Number(data.bestStreak) || Number(data.streak) || 0}`, 640, 462, {
      size: 22, color: "#91caff", weight: "700", align: "center"
    });
    drawText(ctx, "Cảm ơn bạn đã tham gia thử thách!", 640, 680, {
      size: 21, color: "#eef5ff", weight: "700", align: "center"
    });
  }

  // Player area on the left.
  drawPlayerAvatar(ctx, 120, 455, 47, data.requesterAvatarUrl);
  drawText(ctx, data.playerName || "Người chơi", 120, 529, {
    size: 27, color: "#ffffff", weight: "800", align: "center", maxWidth: 180, shadow: true
  });
  roundedRect(ctx, 47, 547, 146, 34, 17);
  ctx.fillStyle = "#3b9fe9";
  ctx.fill();
  drawText(ctx, "NGƯỜI CHƠI", 120, 564, {
    size: 15, color: "#ecf7ff", weight: "800", align: "center", baseline: "middle"
  });
  roundedRect(ctx, 56, 92, 128, 42, 10);
  ctx.fillStyle = "rgba(95,153,207,.18)";
  ctx.fill();
  ctx.strokeStyle = "#e6a94c";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawText(ctx, "VUA GHÉP CHỮ", 120, 119, {
    size: 16, color: "#ffdb9d", weight: "800", align: "center"
  });
  drawText(ctx, "✦", 120, 188, { size: 58, color: "#ffca56", align: "center", shadow: true });

  // Robot mascot on the right.
  drawRobot(ctx, 1140, 424, 1.02);
  drawText(ctx, "CỐ LÊN!", 1140, 604, {
    size: 21, color: "#74cbff", weight: "800", align: "center", shadow: true
  });

  // Footer version/build chip.
  roundedRect(ctx, 498, 722, 286, 42, 21);
  ctx.fillStyle = "rgba(7,25,49,.95)";
  ctx.fill();
  ctx.strokeStyle = "#60a8ef";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawText(ctx, "▣  " + (data.version || "1.0.0"), 566, 750, {
    size: 19, color: "#edf6ff", weight: "700", align: "center"
  });
  drawText(ctx, "•", 640, 749, { size: 20, color: "#ffc13f", weight: "800", align: "center" });
  drawText(ctx, "◉  " + (data.botName || "JOHNTRAN"), 708, 750, {
    size: 18, color: "#edf6ff", weight: "700", align: "center"
  });

  const outputPath = path.join(os.tmpdir(), "jt_ghepchu_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

module.exports = { renderGhepChu };
