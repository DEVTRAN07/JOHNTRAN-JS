const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const FRAME_DIR = path.join(__dirname, "..", "khung-stk");
const CACHE_DIR = path.join(__dirname, "..", "assets", "cache", "sticker");

// Bộ khung premium được vẽ bằng vector/canvas ở độ phân giải gốc.
// Tâm ảnh luôn trong suốt; chỉ giữ viền mảnh và họa tiết ở vành ngoài.
const FRAMES = [
  { id: 1, name: "Mộng Vuốt Rồng", colors: ["#f6d98b", "#a96b25", "#fff0bd"], accent: "#ffe7a3", motif: "dragon" },
  { id: 2, name: "Nguyệt Quang", colors: ["#d9e8ff", "#6179b8", "#f5f7ff"], accent: "#c9dcff", motif: "moon" },
  { id: 3, name: "Kim Long", colors: ["#fff0a8", "#b77a19", "#fff8d8"], accent: "#ffe18a", motif: "gold" },
  { id: 4, name: "Tinh Tú", colors: ["#e4c8ff", "#7652a8", "#f8eaff"], accent: "#e5c6ff", motif: "stars" },
  { id: 5, name: "Hoa Anh Đào", colors: ["#ffd9e7", "#c36d91", "#fff0f5"], accent: "#ffc5dc", motif: "blossom" }
];

function frameList() {
  return FRAMES.map(({ id, name }) => ({ id, name }));
}

function drawStar(ctx, x, y, radius, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? radius * 0.38 : radius;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMotif(ctx, frame, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = frame.accent;
  ctx.fillStyle = frame.accent;
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.9;

  if (frame.motif === "blossom") {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 4.5, 7, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else if (frame.motif === "stars") {
    drawStar(ctx, 0, 0, 10, frame.accent);
    drawStar(ctx, 14, -12, 3.5, "#ffffff");
  } else if (frame.motif === "moon") {
    ctx.beginPath(); ctx.arc(0, 0, 9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(5, -1, 8, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    drawStar(ctx, 15, -12, 3, "#ffffff");
  } else if (frame.motif === "dragon") {
    ctx.beginPath();
    ctx.moveTo(-11, 7); ctx.quadraticCurveTo(-2, -15, 10, -4);
    ctx.quadraticCurveTo(16, 4, 5, 12); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, -5, 2.2, 0, Math.PI * 2); ctx.fill();
  } else {
    drawStar(ctx, 0, 0, 8, frame.accent);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function renderFrame(frameId) {
  const frame = FRAMES.find((item) => item.id === Number(frameId));
  if (!frame) throw new Error(`Mẫu khung phải từ 1 đến ${FRAMES.length}`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const framePath = path.join(CACHE_DIR, `premium-frame-${frame.id}.png`);
  const canvas = createCanvas(480, 480);
  const ctx = canvas.getContext("2d");
  const cx = 240, cy = 240;

  // Viền kép mảnh ôm sát ảnh, không phủ vào vùng chủ thể.
  const ring = ctx.createLinearGradient(45, 55, 430, 430);
  ring.addColorStop(0, frame.colors[2]);
  ring.addColorStop(0.48, frame.colors[0]);
  ring.addColorStop(1, frame.colors[1]);
  ctx.save();
  ctx.shadowColor = frame.colors[1];
  ctx.shadowBlur = 12;
  ctx.strokeStyle = ring;
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(cx, cy, 207, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = frame.colors[2];
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 216, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = frame.colors[1];
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 197, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;

  // Bốn điểm nhấn nhỏ, tránh làm khung nặng và rối mắt.
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 4 + i * Math.PI / 2;
    const x = cx + Math.cos(a) * 211;
    const y = cy + Math.sin(a) * 211;
    ctx.fillStyle = frame.colors[2];
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = frame.colors[1];
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    drawMotif(ctx, frame, cx + Math.cos(a) * 232, cy + Math.sin(a) * 232, 0.72);
  }

  // Các chấm sáng rất nhỏ tạo cảm giác cao cấp nhưng không gây nhiễu.
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const x = cx + Math.cos(a) * 230;
    const y = cy + Math.sin(a) * 230;
    ctx.fillStyle = frame.accent;
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  fs.writeFileSync(framePath, canvas.toBuffer("image/png"));
  return framePath;
}

function resolveFramePath(frameId) {
  return renderFrame(frameId);
}

module.exports = { frameList, resolveFramePath };
