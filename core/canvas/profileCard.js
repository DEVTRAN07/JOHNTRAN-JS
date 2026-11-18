"use strict";

const fs = require("fs");
const Jimp = require("jimp");
const { loadImage } = require("canvas");
const theme = require("./theme");
const themeBackgrounds = require("./themeBackgrounds");

const CYAN = "#61d8f2";
const GREEN = "#54d6a0";
const W = 750;

async function circle(buffer) {
  const image = await Jimp.read(buffer);
  image.circle();
  return image.getBufferAsync("image/png");
}

async function render(options = {}) {
  await themeBackgrounds.prepare();
  theme.initFonts();
  const S = theme.S, width = theme.WIDTH, p = theme.PALETTE;
  const rows = Array.isArray(options.rows) ? options.rows.slice(0, 8) : [];
  const pad = S(28), gap = S(11), cardGap = S(9);
  const columns = 2, cardW = (width - pad * 2 - gap) / columns;
  const cardH = S(72), rowCount = Math.ceil(rows.length / columns);
  const titleY = S(39), heroY = S(82), heroH = S(180), detailsY = S(296);
  const height = detailsY + rowCount * (cardH + cardGap) + S(53);
  const { ctx, canvas } = theme.newCanvas(width, height);
  await theme.paintBackground(ctx, width, height);

  theme.label(ctx, "JOHNTRAN  /  MEMBER IDENTITY", pad, titleY, { size: 10 });
  theme.text(ctx, "HỒ SƠ THÀNH VIÊN", pad, titleY + S(37), {
    size: 28, family: "JT-Display-Bold", color: p.ink
  });
  theme.panel(ctx, pad, heroY, width - pad * 2, heroH, S(18), p.accent);

  const avatarSize = S(132), avatarX = pad + S(22), avatarY = heroY + S(24);
  if (options.avatarBuffer) {
    const avatar = await loadImage(await circle(options.avatarBuffer));
    ctx.save(); ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip(); ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize); ctx.restore();
  } else {
    const g = ctx.createLinearGradient(avatarX, avatarY, avatarX + avatarSize, avatarY + avatarSize);
    g.addColorStop(0, "#1c6a85"); g.addColorStop(1, "#243454");
    ctx.fillStyle = g; ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = theme.font(48, "JT-Display-Bold"); ctx.fillStyle = theme.randomTextColor(String(options.name || "?") + ":profile-initial");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(options.name || "?").trim().charAt(0).toUpperCase(),
      avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + S(3), 0, Math.PI * 2);
  ctx.strokeStyle = p.accent; ctx.lineWidth = S(3); ctx.stroke();

  const textX = avatarX + avatarSize + S(25), textW = width - textX - pad - S(22);
  theme.label(ctx, "ZALO ACCOUNT", textX, heroY + S(45), { size: 9, color: p.mute });
  theme.text(ctx, options.name || "Người dùng", textX, heroY + S(84), {
    size: 28, family: "JT-Display-Bold", color: p.ink, maxWidth: textW
  });
  theme.text(ctx, options.link ? "@" + String(options.link).replace(/^@/, "") : "Tài khoản Zalo",
    textX, heroY + S(111), { size: 14, family: "JT-Mono", color: p.ink2, maxWidth: textW });
  theme.roundRect(ctx, textX, heroY + S(130), S(132), S(27), S(13));
  ctx.fillStyle = "rgba(97,216,242,.13)"; ctx.fill();
  theme.text(ctx, "THÀNH VIÊN", textX + S(66), heroY + S(148), {
    size: 8.5, family: "JT-Bold", color: p.accent, align: "center"
  });
  theme.text(ctx, "Thông tin tài khoản Zalo", textX, heroY + S(166), {
    size: 10, color: p.mute, maxWidth: textW
  });

  theme.label(ctx, "THÔNG TIN CHI TIẾT", pad, detailsY - S(13), { size: 10 });
  rows.forEach((entry, index) => {
    const pair = Array.isArray(entry) ? entry : [entry?.label || "Thông tin", entry?.value || "—"];
    const col = index % columns, row = Math.floor(index / columns);
    const x = pad + col * (cardW + gap), y = detailsY + row * (cardH + cardGap);
    theme.panel(ctx, x, y, cardW, cardH, S(12), p.accent);
    theme.label(ctx, String(pair[0] || "THÔNG TIN"), x + S(14), y + S(25), { size: 8.5, color: p.mute });
    theme.text(ctx, String(pair[1] ?? "—"), x + S(14), y + S(51), {
      size: 14, family: "JT-Bold", color: p.ink, maxWidth: cardW - S(28)
    });
  });
  theme.text(ctx, "JOHNTRAN  •  PROFILE", width - pad, height - S(20), {
    size: 9, family: "JT-Mono", color: p.mute, align: "right"
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
          resolve(loadImg(target, depth + 1)); return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume(); reject(new Error("Avatar request returned HTTP " + response.statusCode)); return;
        }
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      });
      request.setTimeout(15000, () => request.destroy(new Error("Avatar request timeout")));
      request.on("error", reject);
    });
    return await loadImage(buffer);
  } catch { return null; }
}

module.exports = { render, circle, loadImg, CYAN, GREEN, WIDTH: W, HEIGHT: 520 };
