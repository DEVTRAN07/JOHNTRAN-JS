"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadImage } = require("canvas");
const theme = require("./theme");

const TEXT_MAIN = "#1e293b";
const TEXT_SUB = "#64748b";
const BURGUNDY = "#7a2e54";
const CARD_BORDER = "#e2e8f0";
const INFO_BG = "#ffffff";
const INFO_BORDER = "#e2e8f0";

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawText(ctx, str, x, y, size, color, bold, S, align = "left", maxWidth) {
  ctx.save();
  ctx.font = theme.font(size, bold ? "JT-Round-Bold" : "JT-Round");
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  let value = String(str || "");
  if (maxWidth && align === "left") {
    while (value.length > 1 && ctx.measureText(value).width > maxWidth) value = value.slice(0, -2) + "…";
  }
  ctx.fillText(value, x, y);
  ctx.restore();
}

async function drawSmallAvatar(ctx, avatarUrl, name, x, y, size, S) {
  ctx.save();
  rounded(ctx, x, y, size, size, S(10));
  ctx.clip();
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.drawImage(img, x, y, size, size);
      ctx.restore();
      return;
    } catch { /* fallthrough */ }
  }
  ctx.restore();
  const bg = ctx.createRadialGradient(x + size / 2, y + size / 2, 0, x + size / 2, y + size / 2, size / 2);
  bg.addColorStop(0, "#cbd5e1");
  bg.addColorStop(1, "#94a3b8");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = theme.font(S(14), "JT-Round-Bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((name || "U").charAt(0).toUpperCase(), x + size / 2, y + size / 2 + S(2));
}

async function renderMenuGrid({
  requesterName, requesterAvatarUrl, botVersion, prefix, commands, totalCommands
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 0.71);
  const { ctx, canvas } = theme.newCanvas(W, H);
  const margin = S(20);
  const gap = S(16);
  const headerY = S(16);
  const headerH = S(60);
  const footerH = S(90);
  const gridY = headerY + headerH + S(20);
  const footerBottomGap = S(16);
  const gridBottom = H - footerH - footerBottomGap - S(20);
  const cols = 3;
  const rows = Math.max(1, Math.ceil(commands.length / cols));
  const cardW = (W - margin * 2 - gap * 2) / cols;
  const cardH = (gridBottom - gridY - gap * (rows - 1)) / rows;

  // Nền trắng
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Viền ngoài nhẹ
  rounded(ctx, 0, 0, W, H, S(16));
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = S(2);
  ctx.stroke();

  // Header: tiêu đề + đồng hồ
  drawText(ctx, "Danh sách tính năng", margin, headerY + S(34), 24, TEXT_MAIN, true, S);
  drawText(ctx, new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date()), W - margin - S(10), headerY + S(34), 16, TEXT_SUB, false, S, "right");

  // Vẽ thẻ danh mục
  commands.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gap);
    const y = gridY + row * (cardH + gap);
    drawCategoryCard(ctx, x, y, cardW, cardH, item, S);
  });

  // Footer: avatar + tên + phiên bản (giống ảnh)
  const footerY = H - footerH + S(10);
  const avatarSize = S(40);
  const avatarX = margin;
  const avatarY = footerY;
  await drawSmallAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, S);

  const nameX = avatarX + avatarSize + S(14);
  const nameY = footerY + avatarSize / 2 + S(2);
  drawText(ctx, requesterName || "Dinh Nghĩa", nameX, nameY, 18, TEXT_MAIN, true, S, "left");

  drawText(ctx, `v${botVersion || "1.0.2"}`, W - margin - S(10), nameY, 15, TEXT_SUB, true, S, "right");

  const filePath = path.join(os.tmpdir(), "johntran_menu_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png");
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

function drawCategoryCard(ctx, x, y, w, h, item, S) {
  // Nền trắng
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);

  // Bo góc + viền đen nhẹ (giống ảnh)
  rounded(ctx, x, y, w, h, S(14));
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = S(1.5);
  ctx.stroke();

  // Icon giống ảnh (màu theo nhóm)
  const iconSize = S(34);
  const iconX = x + S(18);
  const iconY = y + (h - iconSize) / 2;
  const menuIconMap = {
    info: { color: "#22c3ee", idx: 9 },
    public: { color: "#22d3ee", idx: 10 },
    music: { color: "#a855f7", idx: 2 },
    game: { color: "#22c3ee", idx: 0 },
    tools: { color: "#f59e0b", idx: 1 },
    test: { color: "#64748b", idx: 11 },
    anti: { color: "#22d3ee", idx: 3 },
    manager: { color: "#64748b", idx: 4 },
    admin: { color: "#10b981", idx: 12 },
    mybot: { color: "#fbbf24", idx: 6 },
    hidden: { color: "#3b82f6", idx: 7 }
  };
  const key = String(item.slug || item.name || "").toLowerCase();
  const m = menuIconMap[key] || { color: "#3b82f6", idx: 8 };
  drawCategoryIcon(ctx, iconX + iconSize / 2, iconY + iconSize / 2, S(15), m.idx, S, m.color);

  // Tên (in đậm)
  const textX = iconX + iconSize + S(14);
  const textMax = w - S(20) - iconSize - S(14) - S(40);
  drawText(ctx, item.name, textX, y + h / 2 - S(4), 18, TEXT_MAIN, true, S, "left", textMax);

  // Mô tả
  drawText(ctx, item.category || "", textX, y + h / 2 + S(16), 13, TEXT_SUB, false, S, "left", textMax);

  // Mũi tên >
  drawText(ctx, ">", x + w - S(22), y + h / 2 + S(4), 20, TEXT_SUB, false, S, "center");
}

async function renderFolderCard({
  folderName, folderDescription, folderIcon, requesterName, requesterAvatarUrl,
  botVersion, totalCommands
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = S(430);
  const { ctx, canvas } = theme.newCanvas(W, H);

  // Nền burgundy (giống ảnh 1)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, BURGUNDY);
  g.addColorStop(1, "#5a2242");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Viền ngoài nhẹ
  rounded(ctx, 0, 0, W, H, S(16));
  ctx.strokeStyle = "rgba(255,255,255,.15)";
  ctx.lineWidth = S(2);
  ctx.stroke();

  const pad = S(26);
  const x = pad;
  const y = S(20);
  const w = W - pad * 2;

  // Màu badge theo nhóm
  const groupIndex = ["Info","Public","Music","Game","Tools","Test","Anti","Manager","Admin","Mybot","Hidden"]
    .findIndex(name => name.toLowerCase() === String(folderName || "").toLowerCase());
  const iconColors = ["#22c3ee", "#22d3ee", "#a855f7", "#22c3ee", "#f59e0b", "#64748b", "#22d3ee", "#64748b", "#10b981", "#fbbf24", "#3b82f6"];
  const iconColor = groupIndex >= 0 ? iconColors[groupIndex] : "#3b82f6";

  // Icon nhóm bên trái tiêu đề (màu đen như ảnh)
  drawCategoryIcon(ctx, x + S(16), y + S(18), S(16), Math.max(0, groupIndex), S, "#000000");

  // Tiêu đề: "Chi tiết chức năng: Game"
  const titleX = x + S(46);
  drawText(ctx, `Chi tiết chức năng: ${folderName || "Danh mục"}`, titleX, y + S(36), 20, "#ffffff", true, S);

  // Mô tả: "Giải trí & game"
  drawText(ctx, folderDescription || "Các chức năng hỗ trợ", x, y + S(64), 16, "#e2e8f0", false, S, "left", w);

  // Viền phân cách
  ctx.beginPath();
  ctx.moveTo(x, y + S(86));
  ctx.lineTo(x + w, y + S(86));
  ctx.strokeStyle = "rgba(255,255,255,.15)";
  ctx.lineWidth = S(1);
  ctx.stroke();

  // Ô thông báo sử dụng (trắng, viền hồng)
  const infoY = y + S(108);
  const infoH = S(72);
  rounded(ctx, x, infoY, w, infoH, S(10));
  ctx.fillStyle = INFO_BG;
  ctx.fill();
  rounded(ctx, x, infoY, w, infoH, S(10));
  ctx.strokeStyle = "#e879f9";
  ctx.lineWidth = S(1.5);
  ctx.stroke();

  drawText(ctx, "ℹ️", x + S(24), infoY + S(28), 16, TEXT_SUB, false, S);
  drawText(ctx, `Gõ tên lệnh hoặc tag bot để thực thi chức năng ${folderName}`, x + S(52), infoY + S(24), 14, TEXT_MAIN, false, S, "left", w - S(110));
  drawText(ctx, `${Number(totalCommands) || 1} lệnh khả dụng`, x + S(52), infoY + S(50), 12, TEXT_SUB, false, S);

  // Footer: avatar góc dưới phải (góc phải nhất), text icon+version bên trái avatar
  const footerY = H - S(56);
  const avatarSize = S(48);
  const avatarX = W - pad - avatarSize;
  const avatarY = footerY;
  await drawSmallAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, S);

  const textX = avatarX - S(12);
  drawText(ctx, "⚙️   🖼️   v" + (botVersion || "1.0.2"), textX, footerY + S(8), 15, "#e2e8f0", true, S, "right");

  const filePath = path.join(os.tmpdir(), "johntran_folder_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

function drawCategoryIcon(ctx, cx, cy, r, index, S, overrideColor) {
  const c = overrideColor || "#3b82f6";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = S(2.5);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (index === 0) { // gamepad
    ctx.beginPath(); ctx.moveTo(-r*.95,-r*.25); ctx.quadraticCurveTo(-r*.8,-r*.7,-r*.35,-r*.62); ctx.lineTo(r*.55,-r*.62); ctx.quadraticCurveTo(r*.95,-r*.55,r*.98,-r*.05); ctx.lineTo(r*.82,r*.5); ctx.quadraticCurveTo(r*.65,r*.8,r*.35,r*.45); ctx.lineTo(-r*.35,r*.45); ctx.quadraticCurveTo(-r*.75,r*.85,-r*.9,r*.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,.15)"; ctx.fillRect(-r*.58,-r*.16,r*.34,r*.12); ctx.fillRect(-r*.47,-r*.27,r*.12,r*.34);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(r*.4,-r*.15,S(2),0,Math.PI*2); ctx.arc(r*.62,r*.05,S(2),0,Math.PI*2); ctx.fill();
  } else if (index === 1) { // tools
    ctx.lineWidth = S(4);
    ctx.beginPath(); ctx.moveTo(-r*.55,r*.55); ctx.lineTo(r*.45,-r*.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*.4,-r*.4); ctx.lineTo(-r*.15,-r*.65); ctx.stroke();
    ctx.beginPath(); ctx.arc(-r*.2,-r*.5,S(1.5),0,Math.PI*2); ctx.fill();
  } else if (index === 2) { // music note
    ctx.beginPath(); ctx.arc(-r*.35,-r*.35,r*.28,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r*.35,-r*.05); ctx.lineTo(-r*.35,r*.55); ctx.lineTo(r*.4,r*.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*.4,r*.55); ctx.lineTo(r*.55,r*.35); ctx.stroke();
  } else if (index === 3) { // shield (Anti)
    ctx.beginPath(); ctx.moveTo(0,-r*.75); ctx.lineTo(r*.6,-r*.2); ctx.lineTo(r*.65,r*.55); ctx.lineTo(0,r*.85); ctx.lineTo(-r*.65,r*.55); ctx.lineTo(-r*.6,-r*.2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = S(1.5);
    ctx.beginPath(); ctx.moveTo(-r*.25,-r*.1); ctx.lineTo(-r*.05,r*.2); ctx.lineTo(r*.25,-r*.3); ctx.stroke();
  } else if (index === 4) { // gear (Manager)
    ctx.beginPath(); ctx.arc(0,0,r*.6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.15)";
    ctx.beginPath(); ctx.arc(0,0,r*.25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = c;
    for (let i=0;i<8;i++){ const a=(i/8)*Math.PI*2; ctx.beginPath(); ctx.moveTo(r*.45*Math.cos(a),r*.45*Math.sin(a)); ctx.lineTo(r*.75*Math.cos(a),r*.75*Math.sin(a)); ctx.fill(); }
  } else if (index === 5) { // crown (Admin)
    ctx.beginPath(); ctx.moveTo(-r*.5,r*.3); ctx.lineTo(-r*.62,-r*.3); ctx.lineTo(-r*.25,-r*.05); ctx.lineTo(0,-r*.65); ctx.lineTo(r*.25,-r*.05); ctx.lineTo(r*.62,-r*.3); ctx.lineTo(r*.5,r*.3); ctx.closePath(); ctx.fill();
    ctx.fillRect(-r*.5,r*.38,r, r*.18);
  } else if (index === 6) { // lock (Mybot)
    ctx.beginPath(); ctx.roundRect(-r*.5,-r*.3,r,r*.75,S(4)); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,.15)";
    ctx.beginPath(); ctx.arc(0,-r*.05,r*.32,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=c;
    ctx.beginPath(); ctx.moveTo(-r*.1,r*.25); ctx.lineTo(-r*.1,r*.55); ctx.lineTo(r*.1,r*.55); ctx.lineTo(r*.1,r*.25); ctx.fill();
  } else if (index === 7) { // eye (Hidden)
    ctx.beginPath(); ctx.ellipse(0,0,r*.7,r*.42,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,.15)";
    ctx.beginPath(); ctx.arc(0,0,r*.3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=c;
    ctx.beginPath(); ctx.arc(0,0,r*.12,0,Math.PI*2); ctx.fill();
  } else if (index === 8) { // star (Khác)
    const spikes=5, outer=r*.62, inner=r*.24;
    ctx.beginPath();
    for(let i=0;i<spikes*2;i++){
      const rad=(i/ (spikes*2)) * Math.PI * 2;
      const rr = i%2===0?outer:inner;
      ctx.lineTo(Math.cos(rad)*rr, Math.sin(rad)*rr);
    }
    ctx.closePath(); ctx.fill();
  } else if (index === 9) { // info (lightbulb)
    ctx.beginPath(); ctx.arc(0, -r*.2, r*.35, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, r*.15); ctx.lineTo(0, r*.6); ctx.stroke();
  } else if (index === 10) { // public (globe)
    ctx.beginPath(); ctx.arc(0, 0, r*.4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r*.3, 0); ctx.lineTo(r*.3, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r*.3); ctx.lineTo(0, r*.3); ctx.stroke();
  } else if (index === 11) { // test (document lines)
    ctx.beginPath(); ctx.roundRect(-r*.4, -r*.4, r*.8, r*.8, S(4)); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.15)";
    ctx.fillRect(-r*.3, -r*.3, r*.6, r*.1); ctx.fillRect(-r*.3, -r*.1, r*.5, r*.1); ctx.fillRect(-r*.3, r*.1, r*.4, r*.1);
    ctx.fillStyle = c;
  } else if (index === 12) { // admin (building)
    ctx.beginPath(); ctx.roundRect(-r*.4, -r*.4, r*.8, r*.8, S(3)); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.15)";
    ctx.fillRect(-r*.3, -r*.2, r*.6, r*.4);
    ctx.fillStyle = c;
  }
  ctx.restore();
}

module.exports = { renderMenuGrid, renderFolderCard };
