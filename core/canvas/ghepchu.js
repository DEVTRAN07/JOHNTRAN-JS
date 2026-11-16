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

function drawChibiMascot(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);

  // Soft shadow and little shoes.
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.beginPath(); ctx.ellipse(0, 154, 76, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#55352d";
  roundedRect(ctx, -51, 105, 38, 50, 14); ctx.fill();
  roundedRect(ctx, 18, 105, 38, 50, 14); ctx.fill();
  ctx.fillStyle = "#b96a36";
  roundedRect(ctx, -61, 139, 51, 22, 10); ctx.fill();
  roundedRect(ctx, 15, 139, 51, 22, 10); ctx.fill();

  // Jacket and arms.
  const coat = ctx.createLinearGradient(-65, 20, 65, 120);
  coat.addColorStop(0, "#a9552d"); coat.addColorStop(1, "#60311f");
  roundedRect(ctx, -58, 27, 116, 94, 30);
  ctx.fillStyle = coat; ctx.fill();
  ctx.strokeStyle = "#42251d"; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = "#a9552d"; ctx.lineWidth = 22; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-47, 49); ctx.quadraticCurveTo(-90, 27, -92, -5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(45, 48); ctx.quadraticCurveTo(80, 4, 69, -29); ctx.stroke();
  ctx.fillStyle = "#f5c89d";
  ctx.beginPath(); ctx.arc(-91, -7, 15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(68, -31, 14, 0, Math.PI * 2); ctx.fill();

  // Face and hair.
  ctx.fillStyle = "#f6c49b";
  ctx.beginPath(); ctx.ellipse(0, -52, 61, 67, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#7b321d";
  ctx.beginPath(); ctx.moveTo(-58,-53); ctx.bezierCurveTo(-74,-110,-16,-140,36,-111);
  ctx.bezierCurveTo(82,-89,69,-31,47,-13); ctx.bezierCurveTo(40,-53,24,-76,3,-82);
  ctx.bezierCurveTo(-8,-48,-33,-28,-58,-31); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#b84c28";
  ctx.beginPath(); ctx.ellipse(-40,-96,25,31,-.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(17,-116,26,22,.2,0,Math.PI*2); ctx.fill();

  // Happy eyes and smile.
  ctx.strokeStyle = "#44241f"; ctx.lineWidth = 5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-28,-54); ctx.quadraticCurveTo(-18,-69,-9,-54); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12,-54); ctx.quadraticCurveTo(23,-69,32,-53); ctx.stroke();
  ctx.beginPath(); ctx.arc(3,-35,18,.15,Math.PI-.15); ctx.stroke();
  ctx.fillStyle = "#e98779";
  ctx.beginPath(); ctx.ellipse(-40,-35,10,6,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(42,-35,10,6,0,0,Math.PI*2); ctx.fill();

  // Wooden "VUA GHÉP CHỮ" sign.
  ctx.save();
  ctx.translate(73,-120); ctx.rotate(.12);
  roundedRect(ctx,-5,-5,92,67,9);
  ctx.fillStyle="#8b4a24"; ctx.fill();
  roundedRect(ctx,0,0,82,57,7);
  const wood=ctx.createLinearGradient(0,0,0,57);
  wood.addColorStop(0,"#f5c17c"); wood.addColorStop(1,"#c98242");
  ctx.fillStyle=wood; ctx.fill();
  ctx.strokeStyle="#77401f"; ctx.lineWidth=2; ctx.stroke();
  drawText(ctx,"VUA",41,22,{size:13,color:"#5a2e18",weight:"800",align:"center"});
  drawText(ctx,"GHÉP CHỮ",41,40,{size:12,color:"#5a2e18",weight:"800",align:"center"});
  ctx.restore();

  ctx.restore();
}

function drawRobotMascot(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx,cy);
  ctx.fillStyle="rgba(0,0,0,.25)";
  ctx.beginPath();ctx.ellipse(0,124,105,17,0,0,Math.PI*2);ctx.fill();

  // Little leafy accents.
  ctx.fillStyle="#68ad46";
  ctx.beginPath();ctx.ellipse(-74,83,23,48,-.6,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(78,81,23,48,.6,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#d0ef83";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-82,111);ctx.lineTo(-62,56);ctx.stroke();
  ctx.beginPath();ctx.moveTo(88,111);ctx.lineTo(66,55);ctx.stroke();

  // Feet and body.
  ctx.fillStyle="#dbe9f5";ctx.strokeStyle="#7493b3";ctx.lineWidth=4;
  roundedRect(ctx,-55,82,47,27,13);ctx.fill();ctx.stroke();
  roundedRect(ctx,9,82,47,27,13);ctx.fill();ctx.stroke();
  const body=ctx.createLinearGradient(-60,15,60,110);
  body.addColorStop(0,"#ffffff");body.addColorStop(.65,"#d5e7f6");body.addColorStop(1,"#8daeca");
  roundedRect(ctx,-64,20,128,88,32);ctx.fillStyle=body;ctx.fill();ctx.stroke();

  // Arms.
  ctx.strokeStyle="#d8e8f6";ctx.lineWidth=21;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(-58,43);ctx.quadraticCurveTo(-99,59,-94,92);ctx.stroke();
  ctx.beginPath();ctx.moveTo(58,43);ctx.quadraticCurveTo(94,36,101,3);ctx.stroke();
  ctx.fillStyle="#f4fbff";ctx.beginPath();ctx.arc(-94,93,13,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.arc(102,1,13,0,Math.PI*2);ctx.fill();ctx.stroke();

  // Head shell and ears.
  const shell=ctx.createLinearGradient(-85,-112,85,28);
  shell.addColorStop(0,"#ffffff");shell.addColorStop(.55,"#dcecf8");shell.addColorStop(1,"#83aace");
  roundedRect(ctx,-86,-115,172,155,51);ctx.fillStyle=shell;ctx.fill();ctx.stroke();
  ctx.fillStyle="#55b9f2";ctx.beginPath();ctx.ellipse(-85,-47,13,32,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.ellipse(85,-47,13,32,0,0,Math.PI*2);ctx.fill();ctx.stroke();

  // Face screen.
  roundedRect(ctx,-67,-96,134,111,35);
  const screen=ctx.createLinearGradient(0,-96,0,15);
  screen.addColorStop(0,"#173556");screen.addColorStop(1,"#071a30");
  ctx.fillStyle=screen;ctx.fill();ctx.strokeStyle="#9cc7e8";ctx.lineWidth=3;ctx.stroke();
  ctx.strokeStyle="#65dfff";ctx.lineWidth=6;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(-36,-49);ctx.quadraticCurveTo(-28,-64,-17,-48);ctx.stroke();
  ctx.beginPath();ctx.moveTo(17,-49);ctx.quadraticCurveTo(28,-64,36,-48);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-15,-19);ctx.quadraticCurveTo(0,-5,15,-19);ctx.stroke();

  // Antenna.
  ctx.strokeStyle="#d5eaff";ctx.lineWidth=5;
  ctx.beginPath();ctx.moveTo(0,-115);ctx.lineTo(0,-142);ctx.stroke();
  ctx.beginPath();ctx.arc(0,-151,10,0,Math.PI*2);ctx.fillStyle="#2de58a";
  ctx.shadowColor="#28f59a";ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;ctx.stroke();

  // Chest light.
  ctx.beginPath();ctx.arc(0,65,16,0,Math.PI*2);ctx.fillStyle="#1487c8";ctx.fill();
  ctx.beginPath();ctx.arc(0,65,10,0,Math.PI*2);ctx.fillStyle="#66f3ff";ctx.fill();
  ctx.restore();
}

function drawFallbackTemplate(ctx) {
  const background=ctx.createLinearGradient(0,0,WIDTH,HEIGHT);
  background.addColorStop(0,"#07172c");
  background.addColorStop(.52,"#0b2543");
  background.addColorStop(1,"#071b34");
  ctx.fillStyle=background;ctx.fillRect(0,0,WIDTH,HEIGHT);

  // Same layout proportions as the reference screenshot.
  drawChibiMascot(ctx,116,223);
  drawRobotMascot(ctx,1143,421);

  roundedRect(ctx,245,25,790,672,23);
  const panel=ctx.createLinearGradient(245,25,245,697);
  panel.addColorStop(0,"rgba(13,35,62,.98)");
  panel.addColorStop(1,"rgba(8,28,51,.98)");
  ctx.fillStyle=panel;ctx.fill();
  ctx.strokeStyle="#62a8f2";ctx.lineWidth=2;ctx.stroke();

  drawText(ctx,"GHÉP CHỮ TIẾNG VIỆT",640,82,{
    size:42,color:"#91caff",weight:"800",align:"center",shadow:true
  });
  drawText(ctx,"Sắp xếp các mảnh chữ tạo thành từ / ngữ có nghĩa",640,116,{
    size:22,color:"#e7f2ff",weight:"700",align:"center"
  });

  const boxes=[
    {x:305,label:"THỜI GIAN"},
    {x:534,label:"ĐIỂM SỐ"},
    {x:763,label:"CHUỖI ĐÚNG"}
  ];
  for(const box of boxes){
    roundedRect(ctx,box.x,132,211,73,16);
    ctx.fillStyle="rgba(4,20,41,.72)";ctx.fill();
    ctx.strokeStyle="#4f95d9";ctx.lineWidth=1.6;ctx.stroke();
    drawText(ctx,box.label,box.x+105.5,157,{
      size:16,color:"#aebed1",weight:"700",align:"center"
    });
  }

  drawText(ctx,"CÁC MẢNH CHỮ CẦN GHÉP",640,250,{
    size:27,color:"#8fc6ff",weight:"800",align:"center"
  });
  ctx.beginPath();ctx.moveTo(295,260);ctx.lineTo(985,260);
  ctx.strokeStyle="#5a9bd9";ctx.lineWidth=1.4;ctx.stroke();

  // The tile board is repainted on every turn.
  roundedRect(ctx,273,468,735,90,19);
  ctx.fillStyle="rgba(4,23,44,.82)";ctx.fill();
  ctx.strokeStyle="#5ba4e9";ctx.lineWidth=1.2;ctx.stroke();
  drawText(ctx,"MẸO CHƠI:",291,505,{
    size:25,color:"#ffbf32",weight:"800"
  });
  drawText(ctx,"Chữ cái VIẾT HOA là chữ cái đầu tiên của từ cần tìm!",291,533,{
    size:19,color:"#e7f2ff",weight:"600",maxWidth:695
  });

  drawText(ctx,"Gõ đáp án vào chat  •  skip bỏ qua (-5s)  •  stop để dừng",640,680,{
    size:21,color:"#eef5ff",weight:"700",align:"center",shadow:true
  });

  // Player-side identity panel; avatar and player name are drawn per session.
  ctx.beginPath();ctx.arc(120,450,48,0,Math.PI*2);
  ctx.strokeStyle="#efbd35";ctx.lineWidth=4;ctx.stroke();
  drawText(ctx,"NGƯỜI CHƠI",120,565,{
    size:15,color:"#ecf7ff",weight:"800",align:"center"
  });
  roundedRect(ctx,47,548,146,36,18);
  ctx.fillStyle="#3b9fe9";ctx.fill();

  // Brand/version pill at the bottom, replaced with live version data.
  roundedRect(ctx,498,722,286,42,21);
  ctx.fillStyle="rgba(7,25,49,.96)";ctx.fill();
  ctx.strokeStyle="#60a8ef";ctx.lineWidth=1.5;ctx.stroke();

  // Small puzzle decorations around the outer canvas.
  const pieces=[
    [68,66,"#55b9ff"],[1205,64,"#f4b93c"],[1130,656,"#aa8aff"]
  ];
  for(const [x,y,color] of pieces){
    ctx.save();ctx.translate(x,y);ctx.rotate(-.22);
    roundedRect(ctx,-13,-13,26,26,6);
    ctx.fillStyle=color;ctx.fill();ctx.restore();
  }
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
