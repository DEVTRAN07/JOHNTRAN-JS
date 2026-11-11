"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas } = require("canvas");

const WIDTH = 900;
const HEIGHT = 1120;
const GOLD = "#f3cf83";
const CREAM = "#f7f2e6";

function rounded(ctx, x, y, w, h, radius = 22) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fit(ctx, value, width) {
  let text = String(value ?? "");
  if (ctx.measureText(text).width <= width) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > width) text = text.slice(0, -1);
  return text + "…";
}

function drawBackground(ctx, accent = "#d4ad68") {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#071426");
  sky.addColorStop(0.48, "#142d43");
  sky.addColorStop(1, "#050b15");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const aura = ctx.createRadialGradient(690, 220, 10, 690, 220, 430);
  aura.addColorStop(0, accent + "66");
  aura.addColorStop(1, accent + "00");
  ctx.fillStyle = aura;
  ctx.fillRect(230, 0, 670, 720);

  ctx.fillStyle = "#f6e6bc";
  ctx.beginPath();
  ctx.arc(690, 210, 78, 0, Math.PI * 2);
  ctx.fill();

  const mountainLayers = [
    { color: "#28485a", points: [[0,610],[130,430],[245,590],[390,370],[545,585],[715,410],[900,620]] },
    { color: "#173447", points: [[0,730],[145,540],[270,695],[435,485],[590,700],[760,530],[900,725]] },
    { color: "#0c2030", points: [[0,845],[130,670],[265,820],[430,620],[580,825],[755,665],[900,845]] }
  ];
  for (const layer of mountainLayers) {
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT);
    ctx.lineTo(0, layer.points[0][1]);
    for (const [x, y] of layer.points) ctx.lineTo(x, y);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
  }

  for (let i = 0; i < 90; i++) {
    const x = (i * 139) % WIDTH;
    const y = (i * 79) % 520;
    ctx.globalAlpha = 0.2 + ((i * 13) % 60) / 100;
    ctx.fillStyle = i % 6 === 0 ? accent : "#dcecff";
    ctx.beginPath();
    ctx.arc(x, y, i % 8 === 0 ? 2.3 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const mist = ctx.createLinearGradient(0, 560, 0, 940);
  mist.addColorStop(0, "rgba(180,218,225,0)");
  mist.addColorStop(0.5, "rgba(180,218,225,.10)");
  mist.addColorStop(1, "rgba(5,11,21,.16)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 560, WIDTH, 400);
}

function drawFrame(ctx, kind) {
  rounded(ctx, 24, 24, WIDTH - 48, HEIGHT - 48, 30);
  ctx.strokeStyle = "rgba(243,207,131,.7)";
  ctx.lineWidth = 3;
  ctx.stroke();
  rounded(ctx, 39, 39, WIDTH - 78, HEIGHT - 78, 25);
  ctx.strokeStyle = "rgba(243,207,131,.2)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = GOLD;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("✦  JOHNTRAN • TIÊN ĐẠO VÔ HẠN  ✦", WIDTH / 2, 83);
  ctx.textAlign = "left";
}

function drawTitle(ctx, title, subtitle) {
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(243,207,131,.55)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = CREAM;
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(fit(ctx, title || "TIÊN ĐẠO", WIDTH - 100), WIDTH / 2, 165);
  ctx.shadowBlur = 0;
  ctx.fillStyle = GOLD;
  ctx.font = "22px sans-serif";
  ctx.fillText(fit(ctx, subtitle || "Hành trình nghịch thiên cải mệnh", WIDTH - 120), WIDTH / 2, 205);
  ctx.textAlign = "left";
}

function drawPanel(ctx, x, y, w, h) {
  rounded(ctx, x, y, w, h, 22);
  ctx.fillStyle = "rgba(5,13,25,.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(243,207,131,.42)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawMetric(ctx, x, y, label, value, width = 340) {
  ctx.fillStyle = "#9bb4c7";
  ctx.font = "17px sans-serif";
  ctx.fillText(String(label).toUpperCase(), x, y);
  ctx.fillStyle = CREAM;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(fit(ctx, value, width), x, y + 38);
}

function drawProgress(ctx, x, y, width, value, max) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  rounded(ctx, x, y, width, 18, 9);
  ctx.fillStyle = "rgba(255,255,255,.15)";
  ctx.fill();
  if (ratio > 0) {
    rounded(ctx, x, y, Math.max(18, width * ratio), 18, 9);
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, "#d99a4e");
    gradient.addColorStop(1, "#ffe6a8");
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

function drawLines(ctx, lines, yStart = 650) {
  const entries = Array.isArray(lines) ? lines.slice(0, 6) : [];
  let y = yStart;
  for (const line of entries) {
    ctx.fillStyle = "#f5ead1";
    ctx.font = "23px sans-serif";
    ctx.fillText(fit(ctx, "✦  " + line, WIDTH - 130), 75, y);
    y += 55;
  }
}

function drawSeal(ctx, symbol, y = 360) {
  ctx.save();
  ctx.translate(WIDTH / 2, y);
  ctx.strokeStyle = "rgba(243,207,131,.85)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 105, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(243,207,131,.38)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 85, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 92px sans-serif";
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = 24;
  ctx.fillText(symbol || "☯", 0, 0);
  ctx.restore();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function renderProfile(ctx, data) {
  drawTitle(ctx, "HỒ SƠ TU SĨ", data.subtitle || "Mệnh cách đã được Thiên Đạo ghi nhận");
  drawSeal(ctx, data.symbol || "☯", 360);

  drawPanel(ctx, 70, 510, 760, 500);
  drawMetric(ctx, 105, 575, "Đạo hữu", data.name || "Vô danh", 650);
  drawMetric(ctx, 105, 675, "Cảnh giới", data.realm || "Phàm Nhân", 650);
  drawMetric(ctx, 105, 775, "Linh thạch", data.stones ?? 0, 280);
  drawMetric(ctx, 490, 775, "Sinh lực", data.hp || "100/100", 270);
  ctx.fillStyle = "#9bb4c7";
  ctx.font = "18px sans-serif";
  ctx.fillText("TU VI TÍCH LŨY", 105, 890);
  ctx.fillStyle = CREAM;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(String(data.cultivation || "0") + " / " + String(data.required || "100"), 105, 925);
  drawProgress(ctx, 105, 945, 680, Number(data.cultivation) || 0, Number(data.required) || 100);
  ctx.fillStyle = GOLD;
  ctx.font = "20px sans-serif";
  ctx.fillText("CÔNG " + (data.attack || 0) + "     •     THỦ " + (data.defense || 0), 105, 985);
}

function renderScene(ctx, data) {
  drawTitle(ctx, data.title || "DỊ TƯỢNG THIÊN ĐỊA", data.subtitle || "Cơ duyên đang chờ đợi");
  drawSeal(ctx, data.symbol || "✧", 385);
  drawPanel(ctx, 70, 555, 760, 420);
  ctx.textAlign = "center";
  ctx.fillStyle = GOLD;
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(fit(ctx, data.badge || "THIÊN ĐẠO HIỂN LINH", 680), WIDTH / 2, 625);
  ctx.textAlign = "left";
  const lines = Array.isArray(data.lines) ? data.lines.slice(0, 5) : [];
  let y = 710;
  for (const line of lines) {
    ctx.fillStyle = CREAM;
    ctx.font = "25px sans-serif";
    ctx.fillText(fit(ctx, "✦  " + line, 670), 115, y);
    y += 58;
  }
  if (data.reward) {
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.font = "bold 25px sans-serif";
    ctx.fillText(fit(ctx, data.reward, 650), WIDTH / 2, 920);
    ctx.textAlign = "left";
  }
}

function renderPet(ctx, data) {
  drawTitle(ctx, "LINH THÚ KHẾ ƯỚC", data.subtitle || "Một sinh linh đã chọn đồng hành cùng ngươi");
  const symbol = data.symbol || "🐉";
  drawSeal(ctx, symbol, 390);
  drawPanel(ctx, 70, 555, 760, 400);
  ctx.textAlign = "center";
  ctx.fillStyle = GOLD;
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(fit(ctx, data.name || "Linh thú", 650), WIDTH / 2, 635);
  ctx.fillStyle = CREAM;
  ctx.font = "24px sans-serif";
  ctx.fillText(fit(ctx, "Phẩm chất: " + (data.rarity || "Linh"), 650), WIDTH / 2, 700);
  ctx.fillText(fit(ctx, "Cấp độ: " + (data.level || 1), 650), WIDTH / 2, 755);
  ctx.fillText(fit(ctx, "Công kích: " + (data.attack || 0) + "  •  Phòng ngự: " + (data.defense || 0), 680), WIDTH / 2, 810);
  ctx.fillStyle = "#9bb4c7";
  ctx.font = "20px sans-serif";
  ctx.fillText(fit(ctx, data.description || "Linh thú và ngươi đã lập khế ước.", 680), WIDTH / 2, 885);
  ctx.textAlign = "left";
}

function render(data = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.quality = "best";
  drawBackground(ctx, data.accent || "#d4ad68");
  drawFrame(ctx);
  if (data.kind === "profile") renderProfile(ctx, data);
  else if (data.kind === "pet") renderPet(ctx, data);
  else renderScene(ctx, data);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(220,230,240,.7)";
  ctx.font = "16px sans-serif";
  ctx.fillText(String(data.footer || "JOHNTRAN-JS • CULTIVATION WORLD"), WIDTH / 2, 1065);
  ctx.textAlign = "left";

  const output = path.join(os.tmpdir(), "jt_tutien_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(output, canvas.toBuffer("image/png"));
  return output;
}

module.exports = { render, WIDTH, HEIGHT };
