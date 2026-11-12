"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadImage } = require("canvas");
const avatarCache = require("./avatarCache");
const theme = require("./theme");
const menuPalette = require("./menuPalette");

function rounded(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawText(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save();
  ctx.font = theme.font(size, bold ? "JT-Round-Bold" : "JT-Round");
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  let text = String(value == null ? "" : value);
  if (maxWidth && ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
      text = text.slice(0, -1);
    }
    text += "…";
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function paintBackdrop(ctx, w, h, palette) {
  const colors = palette.background;
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, colors[0]);
  base.addColorStop(0.42, colors[1]);
  base.addColorStop(0.7, colors[2]);
  base.addColorStop(1, colors[3]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.16, h * 0.05, w * 0.5, palette.glow[0]);
  glow(w * 0.88, h * 0.16, w * 0.42, palette.glow[1]);
  glow(w * 0.28, h * 0.98, w * 0.52, palette.glow[1]);
  glow(w * 0.92, h * 0.9, w * 0.5, palette.glow[0]);
}

function drawOuterPanel(ctx, x, y, w, h, radius, colors, borderColor) {
  ctx.save();
  rounded(ctx, x, y, w, h, radius);
  ctx.shadowColor = "rgba(0,0,0,.38)";
  ctx.shadowBlur = theme.S(24);
  ctx.shadowOffsetY = theme.S(10);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, colors[0]);
  fill.addColorStop(1, colors[1]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  rounded(ctx, x, y, w, h, radius);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1, theme.S(1));
  ctx.stroke();
  rounded(ctx, x + theme.S(1), y + theme.S(1), w - theme.S(2), h - theme.S(2), Math.max(0, radius - theme.S(1)));
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = Math.max(1, theme.S(1));
  ctx.stroke();
}

function presenceBadgePosition(x, y, size, radius) {
  const outerRadius = radius + theme.S(1.2);
  const inward = Math.max(0, size / 2 - outerRadius * 0.55);
  const diagonal = inward * Math.SQRT1_2;
  const offset = size / 2 + diagonal;
  return { cx: x + offset, cy: y + offset };
}

function drawAvatar(ctx, url, name, x, y, size, withStatus) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Never wait for a remote avatar while drawing a command card. A cache miss
  // paints the initials now and starts a background download for the next card.
  const image = avatarCache.getAvatar(url);
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  } else {
    drawAvatarFallback(ctx, name, x, y, size);
  }

  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - theme.S(0.7), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = theme.S(1.2);
  ctx.stroke();

  if (withStatus) {
    const radius = theme.S(6.5);
    const { cx, cy } = presenceBadgePosition(x, y, size, radius);

    // Put the presence badge on the same 45-degree anchor of every avatar
    // and draw its shadow separately so it cannot shift the green center.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.42)";
    ctx.shadowBlur = theme.S(2.2);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = theme.S(1);
    ctx.beginPath();
    ctx.arc(cx, cy, radius + theme.S(1.2), 0, Math.PI * 2);
    ctx.fillStyle = "#f5ffff";
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#08c977";
    ctx.fill();
  }
}

function drawAvatarFallback(ctx, name, x, y, size) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, "#d8c8b8");
  gradient.addColorStop(1, "#718c9b");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.font = theme.font(17, "JT-Round-Bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(Array.from(String(name || "U"))[0].toUpperCase(), x + size / 2, y + size / 2);
}

function gear(ctx, cx, cy, radius, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  for (let i = 0; i < 10; i++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 * i) / 10);
    ctx.fillRect(-radius * 0.18, -radius * 1.02, radius * 0.36, radius * 0.38);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGroupIcon(ctx, slug, centerX, centerY, size, monochrome) {
  const colors = monochrome
    ? { main: "#05060a", light: "#05060a", dark: "#05060a", accent: "#05060a" }
    : {
        main: "#20bfd0", light: "#b9f4fb", dark: "#087e9b",
        accent: "#ffca35"
      };
  ctx.save();
  ctx.translate(centerX - size / 2, centerY - size / 2);
  ctx.scale(size / 64, size / 64);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (slug === "info") {
    ctx.fillStyle = "#00b99b";
    rounded(ctx, 5, 15, 54, 39, 7);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, 48); ctx.lineTo(7, 59); ctx.lineTo(8, 43); ctx.closePath(); ctx.fill();
    const bulb = ctx.createRadialGradient(31, 20, 2, 31, 23, 18);
    bulb.addColorStop(0, "#fff36b"); bulb.addColorStop(1, "#f5b900");
    ctx.fillStyle = bulb;
    ctx.beginPath(); ctx.arc(32, 23, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e49a00";
    rounded(ctx, 26, 34, 12, 10, 3); ctx.fill();
    ctx.fillRect(27, 45, 10, 3);
    ctx.strokeStyle = "#ffe65a"; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(32 + Math.cos(a) * 19, 23 + Math.sin(a) * 19);
      ctx.lineTo(32 + Math.cos(a) * 23, 23 + Math.sin(a) * 23);
      ctx.stroke();
    }
  } else if (slug === "public") {
    const g = ctx.createRadialGradient(22, 14, 2, 32, 32, 34);
    g.addColorStop(0, "#8ffaff"); g.addColorStop(1, "#08a9c5");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(32, 32, 29, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,100,130,.45)"; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.ellipse(32, 32, 13, 28, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(32, 32, 25, 12, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(32, 32, 25, 21, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#e9feff"; rounded(ctx, 5, 25, 54, 15, 4); ctx.fill();
    ctx.strokeStyle = "#0b9bb1"; ctx.lineWidth = 2.1; ctx.lineCap = "round";
    // Stable globe/web mark drawn without text glyph dependencies.
    ctx.beginPath();
    ctx.moveTo(13, 32); ctx.lineTo(51, 32);
    ctx.moveTo(18, 28); ctx.lineTo(22, 36);
    ctx.moveTo(28, 28); ctx.lineTo(30, 36);
    ctx.moveTo(39, 28); ctx.lineTo(37, 36);
    ctx.moveTo(47, 28); ctx.lineTo(43, 36);
    ctx.stroke();
  } else if (slug === "music") {
    ctx.strokeStyle = "#f26a77"; ctx.fillStyle = "#f26a77"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(36, 8); ctx.lineTo(36, 43); ctx.lineTo(55, 39); ctx.lineTo(55, 4); ctx.lineTo(36, 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(36, 12); ctx.lineTo(55, 8); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(18, 49, 10, 6, -0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(43, 43, 10, 6, -0.45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#f26a77"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(18, 49); ctx.lineTo(18, 34); ctx.lineTo(36, 30); ctx.stroke();
  } else if (slug === "game") {
    ctx.strokeStyle = monochrome ? "#05060a" : "#03040a";
    ctx.fillStyle = monochrome ? "rgba(0,0,0,0)" : "#080b12";
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(17, 20); ctx.quadraticCurveTo(20, 12, 29, 13);
    ctx.lineTo(47, 13); ctx.quadraticCurveTo(56, 13, 59, 22);
    ctx.lineTo(62, 43); ctx.quadraticCurveTo(63, 54, 54, 54);
    ctx.quadraticCurveTo(49, 54, 43, 45); ctx.lineTo(22, 45);
    ctx.quadraticCurveTo(15, 57, 7, 53); ctx.quadraticCurveTo(1, 50, 4, 41);
    ctx.lineTo(9, 25); ctx.quadraticCurveTo(11, 20, 17, 20); ctx.closePath();
    if (!monochrome) ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = monochrome ? "#05060a" : "#aab2bf";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(17, 27); ctx.lineTo(17, 39); ctx.moveTo(11, 33); ctx.lineTo(23, 33); ctx.stroke();
    ctx.fillStyle = monochrome ? "#05060a" : "#aab2bf";
    ctx.beginPath(); ctx.arc(45, 28, 3.2, 0, Math.PI * 2); ctx.arc(52, 36, 3.2, 0, Math.PI * 2); ctx.fill();
  } else if (slug === "tools") {
    const tiles = [
      { x: 4, y: 5, c: "#00b99b", t: "+" },
      { x: 34, y: 5, c: "#ffc400", t: "÷" },
      { x: 4, y: 34, c: "#f05b72", t: "−" },
      { x: 34, y: 34, c: "#08b6cf", t: "×" }
    ];
    for (const tile of tiles) {
      ctx.fillStyle = tile.c;
      rounded(ctx, tile.x, tile.y, 27, 27, 5);
      ctx.fill();
      // Draw operators as vector paths instead of font glyphs; this avoids
      // tofu/missing characters on minimal Linux/Render font installations.
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 3.8;
      ctx.lineCap = "round";
      const cx = tile.x + 13.5;
      const cy = tile.y + 13.5;
      if (tile.t === "+") {
        ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
      } else if (tile.t === "÷") {
        ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy - 7, 1.8, 0, Math.PI * 2);
        ctx.arc(cx, cy + 7, 1.8, 0, Math.PI * 2); ctx.fill();
      } else if (tile.t === "−") {
        ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6);
        ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6);
        ctx.stroke();
      }
    }
  } else if (slug === "test") {
    ctx.fillStyle = "#9aa1ad"; rounded(ctx, 4, 5, 56, 54, 9); ctx.fill();
    ctx.fillStyle = "#d9dce2";
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * 12;
      rounded(ctx, x, 15, 5, 34, 2); ctx.fill();
      ctx.fillStyle = "#777f8b";
      rounded(ctx, x, [22, 31, 17, 35][i], 5, 12, 2); ctx.fill();
      ctx.fillStyle = "#d9dce2";
    }
  } else if (slug === "anti") {
    ctx.fillStyle = "#20c4df"; rounded(ctx, 4, 8, 56, 46, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(16, 49); ctx.lineTo(9, 60); ctx.lineTo(10, 45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ed5a66";
    ctx.beginPath(); ctx.moveTo(32, 44); ctx.bezierCurveTo(12, 29, 22, 15, 32, 25);
    ctx.bezierCurveTo(42, 15, 53, 29, 32, 44); ctx.fill();
    ctx.fillStyle = "#ffffff"; rounded(ctx, 28, 23, 8, 20, 2); ctx.fill();
    rounded(ctx, 22, 29, 20, 8, 2); ctx.fill();
    ctx.fillStyle = "#e5ffff"; ctx.fillRect(19, 48, 28, 2);
  } else if (slug === "manager") {
    const large = ctx.createLinearGradient(14, 6, 50, 58);
    large.addColorStop(0, "#13bfe7"); large.addColorStop(1, "#087aa9");
    gear(ctx, 43, 24, 14, large);
    gear(ctx, 17, 47, 10, "#16a6d5");
    ctx.fillStyle = "#e8f8ff";
    ctx.beginPath(); ctx.arc(43, 24, 5, 0, Math.PI * 2); ctx.arc(17, 47, 3.5, 0, Math.PI * 2); ctx.fill();
  } else if (slug === "admin") {
    ctx.fillStyle = "#00b997"; rounded(ctx, 5, 7, 54, 52, 7); ctx.fill();
    ctx.fillStyle = "#c9fff1";
    ctx.beginPath(); ctx.moveTo(11, 24); ctx.lineTo(32, 8); ctx.lineTo(53, 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f2fffb";
    ctx.fillRect(14, 26, 36, 4);
    for (let i = 0; i < 4; i++) ctx.fillRect(17 + i * 9, 31, 5, 19);
    ctx.fillRect(12, 51, 40, 4);
    ctx.fillStyle = "#00a989"; ctx.fillRect(14, 56, 36, 2);
  } else if (slug === "mybot") {
    const body = ctx.createLinearGradient(12, 25, 51, 60);
    body.addColorStop(0, "#ffe33f"); body.addColorStop(1, "#f1aa00");
    ctx.strokeStyle = "#f5b500"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(32, 25, 15, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = body; rounded(ctx, 10, 25, 44, 35, 8); ctx.fill();
    ctx.fillStyle = "#e98d00"; rounded(ctx, 14, 29, 36, 27, 5); ctx.fill();
    ctx.fillStyle = "#ffe34d"; rounded(ctx, 15, 30, 34, 27, 5); ctx.fill();
    ctx.fillStyle = "#087c99"; rounded(ctx, 27, 37, 10, 13, 4); ctx.fill();
    ctx.beginPath(); ctx.arc(32, 37, 4, Math.PI, 0); ctx.fill();
  } else if (slug === "hidden") {
    ctx.fillStyle = "#f2f4f5"; rounded(ctx, 4, 5, 56, 54, 8); ctx.fill();
    ctx.save();
    rounded(ctx, 9, 10, 46, 44, 4); ctx.clip();
    ctx.fillStyle = "#15b99a";
    ctx.beginPath(); ctx.moveTo(4, 50); ctx.lineTo(30, 17); ctx.lineTo(61, 49); ctx.lineTo(61, 60); ctx.lineTo(4, 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#9ee9dc";
    ctx.beginPath(); ctx.moveTo(5, 11); ctx.lineTo(19, 11); ctx.lineTo(47, 53); ctx.lineTo(35, 53); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ee6c86";
    ctx.beginPath(); ctx.moveTo(31, 18); ctx.bezierCurveTo(15, 18, 20, 39, 31, 48);
    ctx.bezierCurveTo(42, 39, 47, 18, 31, 18); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(31, 28, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else {
    // Unknown/future folder: always draw a visible fallback instead of a blank
    // icon when a new command category is introduced.
    ctx.fillStyle = "#1cabc0";
    rounded(ctx, 7, 18, 50, 38, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(7, 24); ctx.lineTo(25, 24); ctx.lineTo(30, 18);
    ctx.lineTo(57, 18); ctx.lineTo(57, 54); ctx.lineTo(7, 54); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#d9fbff";
    rounded(ctx, 14, 30, 36, 3, 1.5); ctx.fill();
    rounded(ctx, 14, 38, 29, 3, 1.5); ctx.fill();
    rounded(ctx, 14, 46, 22, 3, 1.5); ctx.fill();
  }
  ctx.restore();
}

// Crisp, font-independent vector icons for the localized folder names.
function drawMenuFolderIcon(ctx, slug, cx, cy, size) {
  const s = size / 64;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const stroke = (color, width = 4) => { ctx.strokeStyle = color; ctx.lineWidth = width; };
  const fill = (color) => { ctx.fillStyle = color; };

  if (slug === "info") {
    fill("#ffd34e"); ctx.beginPath(); ctx.arc(32, 32, 25, 0, Math.PI * 2); ctx.fill();
    fill("#174e67"); ctx.beginPath(); ctx.arc(32, 18, 3.5, 0, Math.PI * 2); ctx.fill();
    stroke("#174e67", 6); ctx.beginPath(); ctx.moveTo(32, 29); ctx.lineTo(32, 46); ctx.stroke();
  } else if (slug === "public") {
    fill("#35d4dc"); ctx.beginPath(); ctx.arc(32, 32, 27, 0, Math.PI * 2); ctx.fill();
    stroke("#075b83", 2.8); ctx.beginPath(); ctx.ellipse(32, 32, 12, 27, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(32, 32, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(32, 32, 26, 20, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (slug === "music") {
    fill("#ff718c"); ctx.beginPath(); ctx.moveTo(37, 9); ctx.lineTo(55, 5); ctx.lineTo(55, 39); ctx.lineTo(37, 43); ctx.closePath(); ctx.fill();
    stroke("#ff718c", 5); ctx.beginPath(); ctx.moveTo(37, 12); ctx.lineTo(37, 47); ctx.stroke();
    fill("#ff718c"); ctx.beginPath(); ctx.ellipse(22, 50, 10, 7, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(44, 44, 10, 7, -0.3, 0, Math.PI * 2); ctx.fill();
  } else if (slug === "game") {
    fill("#202b43"); rounded(ctx, 4, 17, 56, 34, 12); ctx.fill();
    stroke("#eaf7ff", 4); ctx.beginPath(); ctx.moveTo(18, 25); ctx.lineTo(18, 41); ctx.moveTo(10, 33); ctx.lineTo(26, 33); ctx.stroke();
    fill("#ffcf55"); ctx.beginPath(); ctx.arc(43, 29, 3.5, 0, Math.PI * 2); ctx.arc(51, 38, 3.5, 0, Math.PI * 2); ctx.fill();
  } else if (slug === "tools") {
    stroke("#54d6c4", 9); ctx.beginPath(); ctx.moveTo(17, 48); ctx.lineTo(43, 22); ctx.stroke();
    stroke("#e8fbff", 6); ctx.beginPath(); ctx.moveTo(40, 13); ctx.lineTo(50, 23); ctx.lineTo(57, 16); ctx.lineTo(47, 6); ctx.stroke();
    stroke("#ffca58", 7); ctx.beginPath(); ctx.arc(15, 50, 7, 0, Math.PI * 2); ctx.stroke();
  } else if (slug === "anti") {
    fill("#38c9d7"); ctx.beginPath(); ctx.moveTo(32, 5); ctx.lineTo(55, 14); ctx.lineTo(52, 39); ctx.quadraticCurveTo(48, 53, 32, 60); ctx.quadraticCurveTo(16, 53, 12, 39); ctx.lineTo(9, 14); ctx.closePath(); ctx.fill();
    stroke("#eaffff", 5); ctx.beginPath(); ctx.moveTo(20, 32); ctx.lineTo(28, 40); ctx.lineTo(45, 22); ctx.stroke();
  } else if (slug === "manager") {
    fill("#53d7f0"); ctx.beginPath(); ctx.arc(23, 22, 10, 0, Math.PI * 2); ctx.arc(45, 24, 8, 0, Math.PI * 2); ctx.fill();
    fill("#1689b7"); ctx.beginPath(); ctx.ellipse(23, 48, 17, 11, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(46, 47, 13, 9, 0, Math.PI, Math.PI * 2); ctx.fill();
  } else if (slug === "admin") {
    fill("#ffd45e"); ctx.beginPath(); ctx.moveTo(7, 17); ctx.lineTo(22, 29); ctx.lineTo(31, 9); ctx.lineTo(42, 29); ctx.lineTo(57, 17); ctx.lineTo(52, 49); ctx.lineTo(12, 49); ctx.closePath(); ctx.fill();
    fill("#fff2b5"); rounded(ctx, 12, 52, 40, 6, 3); ctx.fill();
  } else if (slug === "mybot") {
    fill("#ffca4e"); rounded(ctx, 10, 18, 44, 38, 10); ctx.fill();
    stroke("#ffe7a1", 4); ctx.beginPath(); ctx.moveTo(32, 18); ctx.lineTo(32, 9); ctx.stroke();
    fill("#ffca4e"); ctx.beginPath(); ctx.arc(32, 7, 4, 0, Math.PI * 2); ctx.fill();
    fill("#174d69"); ctx.beginPath(); ctx.arc(23, 34, 4, 0, Math.PI * 2); ctx.arc(41, 34, 4, 0, Math.PI * 2); ctx.fill();
    stroke("#174d69", 3); ctx.beginPath(); ctx.moveTo(23, 45); ctx.lineTo(41, 45); ctx.stroke();
  } else if (slug === "hidden") {
    fill("#aebbd1"); rounded(ctx, 10, 27, 44, 31, 7); ctx.fill();
    stroke("#e9f1ff", 6); ctx.beginPath(); ctx.moveTo(19, 28); ctx.lineTo(19, 20); ctx.arc(32, 20, 13, Math.PI, 0); ctx.lineTo(45, 28); ctx.stroke();
    fill("#42536e"); ctx.beginPath(); ctx.arc(32, 41, 4, 0, Math.PI * 2); ctx.fill();
    fill("#42536e"); rounded(ctx, 30, 42, 4, 8, 2); ctx.fill();
  } else if (slug === "test") {
    fill("#a78bfa"); rounded(ctx, 9, 8, 46, 48, 8); ctx.fill();
    stroke("#fff", 4); ctx.beginPath(); ctx.moveTo(22, 32); ctx.lineTo(29, 39); ctx.lineTo(44, 22); ctx.stroke();
  } else {
    fill("#35c6d6"); rounded(ctx, 7, 15, 50, 40, 7); ctx.fill();
    fill("#dffcff"); rounded(ctx, 14, 27, 36, 4, 2); ctx.fill();
    rounded(ctx, 14, 37, 27, 4, 2); ctx.fill();
  }
  ctx.restore();
}

function drawClock(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = theme.S(1.6);
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - size * 0.24);
  ctx.moveTo(x, y); ctx.lineTo(x + size * 0.19, y + size * 0.08); ctx.stroke();
  ctx.restore();
}

function drawPaletteIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = theme.S(1.7);
  ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.45, size * 0.36, -0.18, 0, Math.PI * 2); ctx.stroke();
  const dots = [[-0.2, -0.08], [0.02, -0.19], [0.23, -0.05], [-0.08, 0.16]];
  ctx.fillStyle = color;
  for (const dot of dots) {
    ctx.beginPath(); ctx.arc(cx + dot[0] * size, cy + dot[1] * size, theme.S(1.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBotIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = theme.S(1.6);
  rounded(ctx, cx - size * 0.34, cy - size * 0.2, size * 0.68, size * 0.48, theme.S(4)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - size * 0.2); ctx.lineTo(cx, cy - size * 0.42); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - size * 0.47, theme.S(1.7), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(cx - size * 0.13, cy, theme.S(1.4), 0, Math.PI * 2);
  ctx.arc(cx + size * 0.13, cy, theme.S(1.4), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

async function renderMenuGrid({ requesterName, requesterAvatarUrl, botVersion, commands }) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 900 / 1280);
  const result = theme.newCanvas(W, H);
  const ctx = result.ctx;
  const palette = menuPalette.getPalette();

  paintBackdrop(ctx, W, H, palette);

  const panelX = S(18);
  const panelY = S(17);
  const panelW = W - panelX * 2;
  const panelH = H - panelY * 2;
  drawOuterPanel(ctx, panelX, panelY, panelW, panelH, S(18), palette.panel, palette.border);

  const margin = S(32);
  drawText(ctx, "Danh sách tính năng", margin, S(58), 24, palette.text, true);
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date());
  // Measure the rendered time first so the clock always keeps a clean gap.
  ctx.save();
  ctx.font = theme.font(19, "JT-Round-Bold");
  const timeWidth = ctx.measureText(time).width;
  ctx.restore();
  const timeRight = W - margin;
  const timeLeft = timeRight - timeWidth;
  const clockSize = S(14);
  const clockGap = S(11);
  drawClock(ctx, timeLeft - clockGap - clockSize / 2, S(51), clockSize, palette.accent);
  drawText(ctx, time, timeRight, S(58), 19, palette.accent, true, "right");

  const groups = Array.isArray(commands) ? commands : [];
  const columns = 3;
  const rows = Math.max(1, Math.ceil(groups.length / columns));
  const gap = S(9);
  const gridY = S(70);
  const cardW = (W - margin * 2 - gap * (columns - 1)) / columns;
  // Keep the same compact folder-card height even when empty folders are
  // removed; the menu remains aligned with the reference instead of stretching
  // the remaining cards and making their icons look distorted.
  const cardH = S(81);

  groups.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardW + gap);
    const y = gridY + row * (cardH + gap);

    rounded(ctx, x, y, cardW, cardH, S(12));
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.18)";
    ctx.shadowBlur = S(7);
    ctx.shadowOffsetY = S(3);
    const cardFill = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
    cardFill.addColorStop(0, palette.card[0]);
    cardFill.addColorStop(1, palette.card[1]);
    ctx.fillStyle = cardFill;
    ctx.fill();
    ctx.restore();
    rounded(ctx, x, y, cardW, cardH, S(12));
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = S(0.85);
    ctx.stroke();
    rounded(ctx, x + S(1), y + S(1), cardW - S(2), cardH - S(2), S(11));
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = S(0.8);
    ctx.stroke();

    const slug = String(item.slug || item.name || "").toLowerCase();
    const iconSize = S(38);
    const iconX = x + S(29);
    drawMenuFolderIcon(ctx, slug, iconX, y + cardH / 2, iconSize);

    const textX = x + S(57);
    const maxTextWidth = cardW - S(91);
    drawText(ctx, item.name, textX, y + cardH / 2 - S(2), 20, palette.text, true, "left", maxTextWidth);
    drawText(ctx, item.category || "", textX, y + cardH / 2 + S(13), 12.5, palette.muted, false, "left", maxTextWidth);

    drawText(ctx, "›", x + cardW - S(10), y + cardH / 2 + S(5), 25, palette.accent, false, "center");
  });

  const footerX = margin;
  const footerY = S(439);
  const footerW = W - margin * 2;
  const footerH = S(56);
  rounded(ctx, footerX, footerY, footerW, footerH, S(17));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.34)";
  ctx.shadowBlur = S(12);
  ctx.shadowOffsetY = S(4);
  const footerFill = ctx.createLinearGradient(footerX, footerY, footerX, footerY + footerH);
  footerFill.addColorStop(0, palette.footer[0]);
  footerFill.addColorStop(1, palette.footer[1]);
  ctx.fillStyle = footerFill;
  ctx.fill();
  ctx.restore();
  rounded(ctx, footerX, footerY, footerW, footerH, S(17));
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = S(0.9);
  ctx.stroke();

  const avatarSize = S(40);
  const avatarX = footerX + S(11);
  const avatarY = footerY + (footerH - avatarSize) / 2;
  drawAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, true);
  drawText(ctx, requesterName || "Người dùng", avatarX + avatarSize + S(12), footerY + S(36), 20, palette.text, true);

  const iconY = footerY + footerH / 2;
  // Reserve a dedicated version slot; the old icons overlapped v4.0.0.
  drawPaletteIcon(ctx, W - margin - S(128), iconY, S(15), palette.accent);
  drawBotIcon(ctx, W - margin - S(94), iconY, S(17), palette.accent);
  drawText(ctx, "v" + (botVersion || "1.0.2"), W - margin - S(10), footerY + S(36), 16, palette.accent, true, "right");

  const filePath = path.join(os.tmpdir(), "johntran_menu_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png");
  fs.writeFileSync(filePath, result.canvas.toBuffer("image/png"));
  return filePath;
}

async function renderFolderCard({
  folderName, folderDescription, requesterName, requesterAvatarUrl, botVersion
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 540 / 1280);
  const result = theme.newCanvas(W, H);
  const ctx = result.ctx;
  const palette = menuPalette.getPalette();

  paintBackdrop(ctx, W, H, palette);

  const panelX = S(24);
  const panelY = S(24);
  const panelW = W - panelX * 2;
  const panelH = S(252);
  drawOuterPanel(ctx, panelX, panelY, panelW, panelH, S(15), palette.panel, palette.border);

  const padX = panelX + S(23);
  const iconCenterX = padX + S(25);
  const iconCenterY = panelY + S(52);
  const slug = String(folderName || "").toLowerCase();
  drawMenuFolderIcon(ctx, slug, iconCenterX, iconCenterY, S(54));

  const titleX = padX + S(70);
  drawText(ctx, "Chi tiết chức năng: " + (folderName || "Danh mục"), titleX, panelY + S(61), 22, palette.text, true);
  drawText(ctx, folderDescription || "Các chức năng hỗ trợ", padX, panelY + S(120), 20, palette.text, true);

  const infoX = padX;
  const infoY = panelY + S(149);
  const infoW = S(502);
  const infoH = S(42);
  rounded(ctx, infoX, infoY, infoW, infoH, S(12));
  ctx.fillStyle = palette.infoFill;
  ctx.fill();
  rounded(ctx, infoX, infoY, infoW, infoH, S(12));
  ctx.strokeStyle = palette.infoBorder;
  ctx.lineWidth = S(1);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(infoX + S(23), infoY + infoH / 2, S(8), 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = S(1.5);
  ctx.stroke();
  drawText(ctx, "i", infoX + S(23), infoY + infoH / 2 + S(4), 11, palette.accent, true, "center");
  drawText(
    ctx,
    "Gõ tên lệnh hoặc tag bot để thực thi chức năng " + (folderName || ""),
    infoX + S(42),
    infoY + S(27),
    15.5,
    palette.text,
    true,
    "left",
    infoW - S(54)
  );

  const avatarSize = S(76);
  const avatarX = panelX + panelW - S(28) - avatarSize;
  const avatarY = panelY + S(81);
  await drawAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, true);

  const footerY = panelY + panelH - S(18);
  // Keep the icons separate from the version label.
  drawPaletteIcon(ctx, W - S(174), footerY, S(14), palette.accent);
  drawBotIcon(ctx, W - S(140), footerY, S(16), palette.accent);
  drawText(ctx, "v" + (botVersion || "1.0.2"), W - S(24), footerY + S(6), 16, palette.accent, true, "right");

  const filePath = path.join(os.tmpdir(), "johntran_folder_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(filePath, result.canvas.toBuffer("image/png"));
  return filePath;
}

module.exports = { renderMenuGrid, renderFolderCard, _test: { presenceBadgePosition } };
