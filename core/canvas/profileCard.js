"use strict";

const fs = require("fs");
const Jimp = require("jimp");
const { loadImage } = require("canvas");
const theme = require("./theme");

const CYAN = "#d4af37";
const GREEN = "#8fbf9f";
const W = 750;

async function circle(buffer) {
  const image = await Jimp.read(buffer);
  image.circle();
  return image.getBufferAsync("image/png");
}

async function render(options = {}) {
  theme.initFonts();
  const S = theme.S;
  const width = theme.WIDTH;
  const rows = Array.isArray(options.rows) ? options.rows.slice(0, 8) : [];
  const pad = S(28);
  const gap = S(10);
  const columns = 2;
  const rowHeight = S(62);
  const rowCount = Math.ceil(rows.length / columns);
  const identityY = S(104);
  const identityHeight = S(156);
  const detailsY = identityY + identityHeight + S(24);
  const height = detailsY + rowCount * (rowHeight + gap) + S(74);
  const { ctx, canvas } = theme.newCanvas(width, height);

  await theme.paintBackground(ctx, width, height);
  const palette = theme.PALETTE;

  theme.label(ctx, "JOHN TRAN  /  MEMBER PROFILE", pad, S(35), { size: 11 });
  theme.text(ctx, "HỒ SƠ THÀNH VIÊN", pad, S(72), {
    size: 28, family: "JT-Display-Bold", color: palette.ink
  });
  theme.foil(ctx, pad, S(84), S(112));

  theme.panel(ctx, pad, identityY, width - pad * 2, identityHeight, S(14), palette.accent);
  const avatarSize = S(118);
  const avatarX = pad + S(18);
  const avatarY = identityY + S(19);
  if (options.avatarBuffer) {
    const avatar = await loadImage(await circle(options.avatarBuffer));
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(212,175,55,.16)";
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = theme.font(34, "JT-Bold");
    ctx.fillStyle = palette.accent;
    ctx.textAlign = "center";
    ctx.fillText(String(options.name || "?").trim().charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2 + S(12));
    ctx.textAlign = "left";
  }
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + S(2), 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = S(2);
  ctx.stroke();

  const textX = avatarX + avatarSize + S(20);
  const textWidth = width - textX - pad - S(18);
  theme.label(ctx, "ZALO MEMBER", textX, identityY + S(42), { size: 10 });
  theme.text(ctx, options.name || "Người dùng", textX, identityY + S(77), {
    size: 22, family: "JT-Display-Bold", color: palette.ink, maxWidth: textWidth
  });
  theme.text(ctx, options.link ? "@" + String(options.link).replace(/^@/, "") : "Tài khoản Zalo", textX, identityY + S(106), {
    size: 12, family: "JT-Mono", color: palette.ink2, maxWidth: textWidth
  });
  theme.text(ctx, "THÔNG TIN TÀI KHOẢN", textX, identityY + S(135), {
    size: 10, family: "JT-Bold", color: palette.accent, maxWidth: textWidth
  });

  theme.label(ctx, "CHI TIẾT", pad, detailsY - S(8), { size: 11 });
  const cardWidth = (width - pad * 2 - gap) / 2;
  rows.forEach((entry, index) => {
    const pair = Array.isArray(entry) ? entry : [entry?.label || "Thông tin", entry?.value || "—"];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = pad + col * (cardWidth + gap);
    const y = detailsY + row * (rowHeight + gap);
    theme.panel(ctx, x, y, cardWidth, rowHeight, S(10), "rgba(212,175,55,.36)");
    theme.label(ctx, String(pair[0] || "THÔNG TIN"), x + S(12), y + S(23), {
      size: 9, color: palette.mute
    });
    theme.text(ctx, String(pair[1] ?? "—"), x + S(12), y + S(46), {
      size: 13, family: "JT-Bold", color: palette.ink, maxWidth: cardWidth - S(24)
    });
  });

  const footerY = detailsY + rowCount * (rowHeight + gap) + S(20);
  theme.text(ctx, "JOHNTRAN  •  PROFILE CARD", width - pad, footerY, {
    size: 10, family: "JT-Mono", color: palette.mute, align: "right"
  });

  const filePath = theme.save(canvas, "profile_card");
  const cleanupTimer = setTimeout(() => {
    try { fs.rmSync(filePath, { force: true }); } catch { /* temporary card */ }
  }, 120000);
  cleanupTimer.unref?.();
  return filePath;
}

async function loadImg(url, depth = 0) {
  const value = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(value) || depth > 5) return null;
  try {
    const client = /^https:/i.test(value) ? require("https") : require("http");
    const buffer = await new Promise((resolve, reject) => {
      const request = client.get(value, { timeout: 15000 }, response => {
        const location = response.headers.location;
        if (response.statusCode >= 300 && response.statusCode < 400 && location) {
          response.resume();
          const target = /^https?:\/\//i.test(location) ? location : new URL(location, value).href;
          resolve(loadImg(target, depth + 1));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error("Avatar request returned HTTP " + response.statusCode));
          return;
        }
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      });
      request.setTimeout(15000, () => request.destroy(new Error("Avatar request timeout")));
      request.on("error", reject);
    });
    return await loadImage(buffer);
  } catch {
    return null;
  }
}

module.exports = { render, circle, loadImg, CYAN, GREEN, WIDTH: W, HEIGHT: 520 };
