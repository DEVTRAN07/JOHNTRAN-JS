"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadImage } = require("canvas");
const theme = require("./theme");

const NAVY = "#071b49";
const BLUE = "#087dff";
const LIGHT_BLUE = "#51c8ff";
const WHITE = "#f4f8ff";

async function renderMenuGrid({
  requesterName, requesterAvatarUrl, botVersion, prefix, commands, totalCommands
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 0.71);
  const { ctx, canvas } = theme.newCanvas(W, H);
  const margin = S(12);
  const gap = S(8);
  const headerY = S(8);
  const headerH = S(144);
  const footerH = S(54);
  const gridY = headerY + headerH + S(14);
  const footerBottomGap = S(14);
  const gridBottom = H - footerH - footerBottomGap - S(18);
  const cols = 3;
  const rows = 3;
  const cardW = (W - margin * 2 - gap * 2) / cols;
  const cardH = (gridBottom - gridY - gap * 2) / rows;

  paintBackground(ctx, W, H, S);
  drawHeader(ctx, margin, headerY, W - margin * 2, headerH, S);

  const items = Array.from({ length: 9 }, (_, i) => commands[i] || {
    name: ["Game", "Tools", "Music", "Anti", "Manager", "Admin", "Mybot", "Hidden", "Khác"][i],
    category: ["Giải trí & Game", "Công cụ hỗ trợ", "Nghe nhạc trực tuyến", "Bảo vệ nhóm", "Quản lý nhóm", "Quản trị hệ thống", "Quản lý bot", "Lệnh ẩn", "Thêm tính năng"][i],
    usage: ""
  });

  items.forEach((item, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = margin + col * (cardW + gap);
    const y = gridY + row * (cardH + gap);
    drawCategoryCard(ctx, x, y, cardW, cardH, item, i, S);
  });

  await drawBrandFooter(ctx, margin, H - footerH - footerBottomGap, W - margin * 2, footerH, {
    requesterName, requesterAvatarUrl, botVersion, totalCommands, S
  });

  const filePath = path.join(os.tmpdir(), "johntran_menu_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png");
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

function paintBackground(ctx, w, h, S) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#06153b");
  g.addColorStop(0.5, "#0b2453");
  g.addColorStop(1, "#031438");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const glow = (x, y, r, color) => {
    const radial = ctx.createRadialGradient(x, y, 0, x, y, r);
    radial.addColorStop(0, color);
    radial.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);
  };
  glow(S(30), S(15), S(330), "rgba(0,124,255,.42)");
  glow(w - S(35), h - S(10), S(300), "rgba(0,174,255,.28)");

  ctx.save();
  ctx.strokeStyle = "rgba(56,166,255,.12)";
  ctx.lineWidth = Math.max(1, S(1));
  for (let i = -h; i < w; i += S(42)) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.restore();

  rounded(ctx, S(2), S(2), w - S(4), h - S(4), S(18));
  ctx.strokeStyle = "rgba(67,176,255,.9)";
  ctx.lineWidth = S(2);
  ctx.stroke();
}

function drawHeader(ctx, x, y, w, h, S) {
  rounded(ctx, x, y, w, h, S(22));
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#061744");
  g.addColorStop(.52, "#092d70");
  g.addColorStop(1, "#087fda");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  rounded(ctx, x, y, w, h, S(22));
  ctx.clip();

  const shine = ctx.createLinearGradient(x, y, x + w, y + h);
  shine.addColorStop(0, "rgba(0,120,255,.2)");
  shine.addColorStop(.5, "rgba(2,10,38,.12)");
  shine.addColorStop(1, "rgba(0,205,255,.32)");
  ctx.fillStyle = shine;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "rgba(70,174,255,.24)";
  ctx.lineWidth = S(1);
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(x + S(i * 90), y);
    ctx.lineTo(x + S(i * 90 + 120), y + h);
    ctx.stroke();
  }
  ctx.restore();

  drawCrown(ctx, x + S(54), y + S(50), S(48));
  drawText(ctx, "Danh Sách Tính Năng", x + S(112), y + S(78), 34, WHITE, true, S);
  drawText(ctx, "Chọn danh mục bạn muốn khám phá!", x + S(112), y + S(112), 19, "#dceaff", false, S);

  // Mascot robot minh họa bằng vector để không phụ thuộc asset ngoài.
  drawRobot(ctx, x + w - S(205), y + S(14), S);
  drawClock(ctx, x + w - S(90), y + S(19), S(15));
  drawText(ctx, new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date()), x + w - S(18), y + S(38), 17, "#eaf4ff", false, S, "right");

  rounded(ctx, x, y, w, h, S(22));
  ctx.strokeStyle = "rgba(82,190,255,.9)";
  ctx.lineWidth = S(1.4);
  ctx.stroke();
}

function drawCategoryCard(ctx, x, y, w, h, item, index, S) {
  rounded(ctx, x, y, w, h, S(18));
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, "rgba(39,61,99,.97)");
  bg.addColorStop(1, "rgba(19,36,70,.98)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  rounded(ctx, x, y, w, h, S(18));
  ctx.clip();
  const glow = ctx.createRadialGradient(x + S(30), y + S(8), 0, x + S(30), y + S(8), w * .8);
  glow.addColorStop(0, "rgba(70,151,255,.14)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = "rgba(108,177,255,.62)";
  ctx.lineWidth = S(1.4);
  ctx.stroke();

  drawCategoryIcon(ctx, x + S(51), y + h / 2, S(31), index, S);
  const textX = x + S(91);
  const textMax = w - S(128);
  drawText(ctx, item.name, textX, y + h / 2 - S(2), 23, "#f7faff", true, S, "left", textMax);
  drawText(ctx, item.category || item.description || "", textX, y + h / 2 + S(27), 15, "#c7d8f4", false, S, "left", textMax);
  drawText(ctx, "›", x + w - S(18), y + h / 2 + S(8), 32, "#d9eaff", false, S, "center");
}

function drawCategoryIcon(ctx, cx, cy, r, index, S) {
  const colors = ["#28a8ff", "#64c9ff", "#d28bff", "#35c8ff", "#289bff", "#ffc02e", "#ffca35", "#2daeff", "#ffbd25"];
  const c = colors[index] || "#39aaff";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = S(5);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (index === 0) { // gamepad
    ctx.beginPath(); ctx.moveTo(-r*.95,-r*.25); ctx.quadraticCurveTo(-r*.8,-r*.7,-r*.35,-r*.62); ctx.lineTo(r*.55,-r*.62); ctx.quadraticCurveTo(r*.95,-r*.55,r*.98,-r*.05); ctx.lineTo(r*.82,r*.5); ctx.quadraticCurveTo(r*.65,r*.8,r*.35,r*.45); ctx.lineTo(-r*.35,r*.45); ctx.quadraticCurveTo(-r*.75,r*.85,-r*.9,r*.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle="#07356d"; ctx.fillRect(-r*.58,-r*.16,r*.34,r*.12); ctx.fillRect(-r*.47,-r*.27,r*.12,r*.34);
    ctx.beginPath(); ctx.arc(r*.4,-r*.15,S(3),0,Math.PI*2); ctx.arc(r*.62,r*.05,S(3),0,Math.PI*2); ctx.fill();
  } else if (index === 1) { // tools
    ctx.lineWidth = S(8); ctx.beginPath(); ctx.moveTo(-r*.65,r*.65); ctx.lineTo(r*.5,-r*.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(r*.56,-r*.57,r*.28,-.9,1.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*.6,-r*.55); ctx.lineTo(r*.6,r*.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(-r*.58,-r*.58,r*.2,0,Math.PI*2); ctx.stroke();
  } else if (index === 2) { // music
    ctx.lineWidth=S(7); ctx.beginPath(); ctx.moveTo(r*.2,-r*.8); ctx.lineTo(r*.2,r*.38); ctx.lineTo(r*.8,r*.2); ctx.lineTo(r*.8,-r*.95); ctx.lineTo(r*.2,-r*.8); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-r*.25,r*.45,r*.28,r*.2,-.3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r*.42,r*.25,r*.28,r*.2,-.3,0,Math.PI*2); ctx.fill();
  } else if (index === 3) { // shield
    ctx.beginPath(); ctx.moveTo(0,-r*.9); ctx.lineTo(r*.75,-r*.55); ctx.lineTo(r*.65,r*.3); ctx.quadraticCurveTo(0,r*.95,-r*.65,r*.3); ctx.lineTo(-r*.75,-r*.55); ctx.closePath(); ctx.fill();
    ctx.strokeStyle="#063f7e"; ctx.lineWidth=S(5); ctx.beginPath(); ctx.moveTo(-r*.32,0); ctx.lineTo(-r*.05,r*.28); ctx.lineTo(r*.4,-r*.28); ctx.stroke();
  } else if (index === 4) { // gear
    for(let a=0;a<8;a++){ctx.save();ctx.rotate(a*Math.PI/4);ctx.fillRect(-r*.18,-r*.92,r*.36,r*.34);ctx.restore();}
    ctx.beginPath();ctx.arc(0,0,r*.68,0,Math.PI*2);ctx.fill();ctx.fillStyle="#183968";ctx.beginPath();ctx.arc(0,0,r*.28,0,Math.PI*2);ctx.fill();
  } else if (index === 5) { // crown
    ctx.beginPath();ctx.moveTo(-r*.8,r*.35);ctx.lineTo(-r*.95,-r*.45);ctx.lineTo(-r*.35,-r*.05);ctx.lineTo(0,-r*.78);ctx.lineTo(r*.35,-r*.05);ctx.lineTo(r*.95,-r*.45);ctx.lineTo(r*.8,r*.35);ctx.closePath();ctx.fill();ctx.fillRect(-r*.78,r*.42,r*1.56,r*.22);
  } else if (index === 6) { // lock
    rounded(ctx,-r*.55,-r*.05,r*1.1,r*.95,S(12));ctx.fill();
    ctx.beginPath();ctx.arc(0,-r*.15,r*.38,Math.PI,0);ctx.lineWidth=S(8);ctx.stroke();
    ctx.fillStyle="#85530b";ctx.beginPath();ctx.arc(0,r*.32,S(4),0,Math.PI*2);ctx.fill();
  } else if (index === 7) { // eye
    ctx.beginPath();ctx.moveTo(-r,-r*.02);ctx.quadraticCurveTo(0,-r*.95,r,r*.0);ctx.quadraticCurveTo(0,r*.95,-r,-r*.02);ctx.fill();
    ctx.fillStyle="#07356d";ctx.beginPath();ctx.arc(0,0,r*.38,0,Math.PI*2);ctx.fill();ctx.fillStyle="#9eeaff";ctx.beginPath();ctx.arc(0,0,r*.17,0,Math.PI*2);ctx.fill();
  } else { // star
    ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5;const rr=i%2?r*.42:r*.95;const px=Math.cos(a)*rr,py=Math.sin(a)*rr;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

async function drawBrandFooter(ctx, x, y, w, h, opts) {
  const { requesterName, requesterAvatarUrl, botVersion, S } = opts;
  rounded(ctx, x, y, w, h, S(28));
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "rgba(9,39,91,.98)");
  g.addColorStop(1, "rgba(7,63,119,.98)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#168cff";
  ctx.lineWidth = S(1.5);
  ctx.stroke();

  const avatarSize = S(42);
  const avatarX = x + S(18);
  const avatarY = y + (h - avatarSize) / 2;
  await drawSmallAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize);

  drawText(ctx, requesterName || "Người dùng", x + S(72), y + h / 2 + S(7), 20, "#ffffff", true, S, "left", w - S(250));

  drawLink(ctx, x + w - S(125), y + h / 2, S);
  drawBotIcon(ctx, x + w - S(76), y + h / 2, S);
  drawText(ctx, "v" + (botVersion || "1.0.0"), x + w - S(12), y + h / 2 + S(7), 18, "#edf5ff", true, S, "right");
}

async function drawSmallAvatar(ctx, url, name, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  const fallback = ctx.createLinearGradient(x, y, x + size, y + size);
  fallback.addColorStop(0, "#167cff");
  fallback.addColorStop(1, "#7138d8");
  ctx.fillStyle = fallback;
  ctx.fillRect(x, y, size, size);

  if (url) {
    try {
      const { buffer } = await require("../http").getBuffer(url, { timeout: 5000, retries: 0 });
      const img = await loadImage(buffer);
      ctx.drawImage(img, x, y, size, size);
    } catch {
      drawAvatarInitials(ctx, name, x, y, size);
    }
  } else {
    drawAvatarInitials(ctx, name, x, y, size);
  }

  ctx.restore();
}
function drawAvatarInitials(ctx, name, x, y, size) {
  const initials = String(name || "U").trim().split(/\s+/).slice(-2).map(part => Array.from(part)[0] || "").join("").toUpperCase();
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = theme.font(17, "JT-Round-Bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials || "U", x + size / 2, y + size / 2);
  ctx.restore();
}

function drawMiniCrown(ctx,cx,cy,S){ctx.save();ctx.translate(cx,cy);ctx.fillStyle="#d99aff";ctx.strokeStyle="#f1c5ff";ctx.lineWidth=S(1.5);ctx.beginPath();ctx.moveTo(-S(15),S(6));ctx.lineTo(-S(16),-S(8));ctx.lineTo(-S(6),0);ctx.lineTo(0,-S(15));ctx.lineTo(S(7),0);ctx.lineTo(S(16),-S(8));ctx.lineTo(S(15),S(6));ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
function drawVerified(ctx,x,y,r,S){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle="#1688ff";ctx.fill();ctx.strokeStyle="#d9efff";ctx.lineWidth=S(1);ctx.stroke();ctx.strokeStyle="#fff";ctx.lineWidth=S(1.5);ctx.beginPath();ctx.moveTo(x-r*.5,y);ctx.lineTo(x-r*.12,y+r*.35);ctx.lineTo(x+r*.55,y-r*.4);ctx.stroke();}
function drawLink(ctx,cx,cy,S){ctx.save();ctx.strokeStyle="#d5ebff";ctx.lineWidth=S(2.5);ctx.beginPath();ctx.arc(cx-S(3),cy-S(2),S(7),-.8,1.8);ctx.stroke();ctx.beginPath();ctx.arc(cx+S(3),cy+S(2),S(7),2.3,4.9);ctx.stroke();ctx.restore();}
function drawBotIcon(ctx,cx,cy,S){ctx.save();ctx.strokeStyle="#d9efff";ctx.fillStyle="#d9efff";ctx.lineWidth=S(2);rounded(ctx,cx-S(10),cy-S(7),S(20),S(15),S(4));ctx.stroke();ctx.beginPath();ctx.moveTo(cx,cy-S(7));ctx.lineTo(cx,cy-S(12));ctx.stroke();ctx.beginPath();ctx.arc(cx,cy-S(13),S(2),0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(cx-S(4),cy, S(1.5),0,Math.PI*2);ctx.arc(cx+S(4),cy,S(1.5),0,Math.PI*2);ctx.fill();ctx.restore();}
function drawCrown(ctx,x,y,size){ctx.save();ctx.translate(x,y);ctx.fillStyle="#ffc53d";ctx.strokeStyle="#ffdf83";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-size*.5,size*.25);ctx.lineTo(-size*.62,-size*.35);ctx.lineTo(-size*.2,-size*.02);ctx.lineTo(0,-size*.58);ctx.lineTo(size*.2,-size*.02);ctx.lineTo(size*.62,-size*.35);ctx.lineTo(size*.5,size*.25);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillRect(-size*.5,size*.32,size,size*.16);ctx.restore();}
function drawRobot(ctx,x,y,S){
  ctx.save();
  // tai nghe
  ctx.fillStyle="#168dff";ctx.beginPath();ctx.arc(x+S(55),y+S(48),S(43),Math.PI*.8,Math.PI*2.2);ctx.lineWidth=S(8);ctx.strokeStyle="#61d8ff";ctx.stroke();
  rounded(ctx,x+S(8),y+S(15),S(94),S(94),S(34));ctx.fillStyle="#e8f7ff";ctx.fill();ctx.strokeStyle="#6ccfff";ctx.lineWidth=S(3);ctx.stroke();
  rounded(ctx,x+S(18),y+S(39),S(75),S(52),S(23));ctx.fillStyle="#071638";ctx.fill();
  ctx.fillStyle="#16e7ff";ctx.beginPath();ctx.ellipse(x+S(42),y+S(64),S(6),S(12),0,0,Math.PI*2);ctx.ellipse(x+S(70),y+S(64),S(6),S(12),0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.ellipse(x+S(55),y+S(22),S(27),S(6),0,0,Math.PI*2);ctx.fill();
  // pointing hand
  ctx.strokeStyle="#e8f7ff";ctx.lineWidth=S(12);ctx.lineCap="round";ctx.beginPath();ctx.moveTo(x+S(12),y+S(91));ctx.lineTo(x-S(12),y+S(66));ctx.lineTo(x-S(22),y+S(53));ctx.stroke();
  ctx.restore();
}
function drawClock(ctx,x,y,r){ctx.save();ctx.strokeStyle="#d9eaff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.moveTo(x,y-r*.55);ctx.lineTo(x,y);ctx.lineTo(x+r*.4,y+r*.2);ctx.stroke();ctx.restore();}
function drawText(ctx,str,x,y,size,color,bold,S,align="left",maxWidth){
  ctx.save();
  ctx.font=theme.font(size,bold?"JT-Round-Bold":"JT-Round");
  ctx.fillStyle=color;
  ctx.textAlign=align;
  ctx.textBaseline="alphabetic";
  let value=String(str||"");
  if (maxWidth && align==="left") {
    while (value.length>1 && ctx.measureText(value).width>maxWidth) value=value.slice(0,-2)+"…";
  }
  ctx.fillText(value,x,y);
  ctx.restore();
}
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}


async function renderFolderCard({
  folderName, folderDescription, folderIcon, requesterName, requesterAvatarUrl,
  botVersion, totalCommands
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = S(330);
  const { ctx, canvas } = theme.newCanvas(W, H);
  await theme.paintBackground(ctx, W, H);

  const pad = S(24);
  const x = pad;
  const y = S(22);
  const w = W - pad * 2;
  const h = H - S(44);
  rounded(ctx, x, y, w, h, S(20));
  const panel = ctx.createLinearGradient(x, y, x + w, y + h);
  panel.addColorStop(0, "rgba(27,46,78,.97)");
  panel.addColorStop(1, "rgba(12,27,55,.98)");
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = "rgba(86,174,255,.82)";
  ctx.lineWidth = S(1.5);
  ctx.stroke();

  const groupIndex = ["Game","Tools","Music","Anti","Manager","Admin","Mybot","Hidden","Khác"]
    .findIndex(name => name.toLowerCase() === String(folderName || "").toLowerCase());
  const iconSize = S(58);
  rounded(ctx, x + S(20), y + S(24), iconSize, iconSize, S(15));
  const iconBg = ctx.createLinearGradient(x + S(20), y + S(24), x + S(20) + iconSize, y + S(24) + iconSize);
  iconBg.addColorStop(0, "#168cff");
  iconBg.addColorStop(1, "#684bde");
  ctx.fillStyle = iconBg;
  ctx.fill();
  drawCategoryIcon(ctx, x + S(49), y + S(53), S(22), Math.max(0, groupIndex), S);

  drawText(ctx, "CHI TIẾT CHỨC NĂNG", x + S(94), y + S(42), 13, "#79d2ff", true, S);
  drawText(ctx, folderName || "Danh mục", x + S(94), y + S(76), 27, "#f5f9ff", true, S, "left", w - S(130));
  drawText(ctx, folderDescription || "Các chức năng hỗ trợ", x + S(22), y + S(132), 21, "#e8f1ff", true, S, "left", w - S(44));

  rounded(ctx, x + S(20), y + S(157), w - S(40), S(54), S(12));
  ctx.fillStyle = "rgba(33,127,227,.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(110,190,255,.5)";
  ctx.lineWidth = S(1);
  ctx.stroke();
  drawText(ctx, "ⓘ", x + S(34), y + S(191), 18, "#76caff", true, S);
  drawText(ctx, `Gõ tên lệnh hoặc tag bot để thực thi chức năng ${folderName}`, x + S(60), y + S(191), 15, "#f1f6ff", true, S, "left", w - S(88));

  const avatarSize = S(42);
  const avatarX = x + S(20);
  const avatarY = y + h - S(58);
  await drawSmallAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize);
  drawText(ctx, requesterName || "Người dùng", avatarX + avatarSize + S(12), avatarY + S(27), 16, "#ffffff", true, S, "left", w * .48);
  drawText(ctx, `${Number(totalCommands) || 0} lệnh khả dụng`, avatarX + avatarSize + S(12), avatarY + S(43), 11, "#b9cee9", false, S);
  drawText(ctx, `v${botVersion || "1.0.0"}`, x + w - S(20), avatarY + S(29), 15, "#e7f3ff", true, S, "right");

  const filePath = path.join(os.tmpdir(), "johntran_folder_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

module.exports = { renderMenuGrid, renderFolderCard };
