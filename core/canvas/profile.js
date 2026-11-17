// ===== RENDERER HỒ SƠ BẢN 3.0 (legacy profile helper) =====
// Nền gradient sạch, không dùng wallpaper/theme image.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas, loadImage, registerFont } = require("canvas");

const WIDTH = 750;
const PAD = 40;

const SKINS = {
  zalo:     { name: "ZALO",     a: "#0068ff", b: "#00d4ff", icon: "🟦" },
  tiktok:   { name: "TIKTOK",   a: "#00e5d0", b: "#ff2e63", icon: "🎵" },
  facebook: { name: "FACEBOOK", a: "#1877f2", b: "#8ab4f8", icon: "📘" },
  neutral:  { name: "HỒ SƠ",    a: "#a78bfa", b: "#38bdf8", icon: "🪪" }
};

let fontReady = false;
function fonts() {
  if (fontReady) return;
  fontReady = true;
  const add = (p, f) => { try { if (fs.existsSync(p)) registerFont(p, { family: f }); } catch { /* bỏ qua */ } };
  if (process.platform === "darwin") {
    add("/System/Library/Fonts/Supplemental/Arial.ttf", "P");
    add("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "PB");
  } else if (process.platform === "win32") {
    add("C:\\Windows\\Fonts\\arial.ttf", "P");
    add("C:\\Windows\\Fonts\\arialbd.ttf", "PB");
  } else {
    add("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "P");
    add("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "PB");
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x, y, r);
  ctx.closePath();
}

function fit(ctx, text, w) {
  let t = String(text ?? "");
  if (ctx.measureText(t).width <= w) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > w) t = t.slice(0, -1);
  return t + "…";
}

// Tải ảnh: chỉ nhận URL tuyệt đối, resolve redirect cả tương đối
async function loadImg(url, depth = 0) {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(u) || depth > 5) return null;
  try {
    const client = /^https:/i.test(u) ? require("https") : require("http");
    const buffer = await new Promise((resolve, reject) => {
      client.get(u, { timeout: 12000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const target = /^https?:\/\//i.test(res.headers.location)
            ? res.headers.location
            : new URL(res.headers.location, u).href;
          resolve(loadImg(target, depth + 1));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }).on("error", reject);
    });
    return await loadImage(buffer);
  } catch {
    return null;
  }
}

/**
 * Vẽ ảnh nền dùng chung: ảnh theme rõ nét + gradient màu loại + vệt sáng
 */
async function paintBase(ctx, skin, w, h, avatar) {
  fonts();
  // lớp nền tối
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#080b16");
  base.addColorStop(0.5, "#0e1428");
  base.addColorStop(1, "#080b16");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // gradient màu loại phủ lên
  const tint = ctx.createLinearGradient(0, 0, w, h);
  tint.addColorStop(0, `${skin.a}55`);
  tint.addColorStop(0.6, `${skin.b}33`);
  tint.addColorStop(1, "rgba(8,11,22,.9)");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);

  // avatar làm nền mờ nếu có
  if (avatar) {
    const av = await loadImg(avatar);
    if (av) {
      const s = Math.max(w / av.width, h / av.height);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.drawImage(av, w - av.width * s * 0.8, h - av.height * s * 0.8, av.width * s * 0.8, av.height * s * 0.8);
      ctx.restore();
    }
  }
}

// Vẽ avatar tròn viền gradient
async function drawAvatar(ctx, url, cx, cy, size, skin) {
  const av = url ? await loadImg(url) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (av) {
    const s = Math.max(size / av.width, size / av.height);
    ctx.drawImage(av, cx - (av.width * s) / 2, cy - (av.height * s) / 2, av.width * s, av.height * s);
  } else {
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.font = `${Math.round(size * 0.5)}px P`;
    ctx.fillStyle = skin.a;
    ctx.textAlign = "center";
    ctx.fillText("👤", cx, cy + Math.round(size * 0.18));
    ctx.textAlign = "left";
  }
  ctx.restore();

  // viền gradient
  const grd = ctx.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
  grd.addColorStop(0, skin.a);
  grd.addColorStop(1, skin.b);
  ctx.lineWidth = 5;
  ctx.strokeStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 2, 0, Math.PI * 2);
  ctx.stroke();
}

// Hàng thông tin kiểu kính mờ
function infoRow(ctx, x, y, w, h, skin, icon, label, value) {
  ctx.fillStyle = "rgba(255,255,255,.09)";
  rr(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = skin.a;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ô icon
  ctx.fillStyle = `${skin.a}33`;
  rr(ctx, x + 14, y + (h - 40) / 2, 40, 40, 12);
  ctx.fill();
  ctx.font = "22px P";
  ctx.textAlign = "center";
  ctx.fillStyle = skin.b;
  ctx.fillText(icon || "•", x + 34, y + h / 2 + 8);
  ctx.textAlign = "left";

  // nhãn + giá trị
  ctx.font = "14px P";
  ctx.fillStyle = "#8b9ab8";
  ctx.fillText(String(label || "").toUpperCase(), x + 68, y + h / 2 - 6);
  ctx.font = "bold 21px PB";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(ctx, value ?? "—", w - 92), x + 68, y + h / 2 + 20);
}

// Nhãn loại hồ sơ
function skinTag(ctx, x, y, skin, w) {
  ctx.font = "bold 15px PB";
  const text = `${skin.icon}  ${skin.name}`;
  const tw = ctx.measureText(text).width + 36;
  ctx.fillStyle = `${skin.a}2e`;
  rr(ctx, x, y, tw, 34, 17);
  ctx.fill();
  ctx.strokeStyle = skin.a;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(text, x + tw / 2, y + 23);
  ctx.textAlign = "left";
  return tw;
}

/**
 * Thẻ hồ sơ đầy đủ thông tin (cardzalo)
 */
async function renderProfile(o = {}) {
  const skin = SKINS[o.skin] || SKINS.neutral;
  const rows = Array.isArray(o.rows) ? o.rows.filter(Boolean).slice(0, 8) : [];
  const avatarSize = 200;
  const rowH = 64;
  const top = 118;              // chừa chỗ nhãn loại
  const avatarBlock = avatarSize + 118; // avatar + tên + handle
  const H = top + avatarBlock + (rows.length ? rows.length * rowH + 18 : 0) + 64;

  const canvas = createCanvas(WIDTH, H);
  const ctx = canvas.getContext("2d");
  ctx.quality = "best";
  await paintBase(ctx, skin, WIDTH, H, o.avatar);

  // nhãn loại
  skinTag(ctx, PAD, 44, skin, WIDTH);

  // avatar
  const cx = WIDTH / 2;
  const cy = top + 34 + avatarSize / 2;
  await drawAvatar(ctx, o.avatar, cx, cy, avatarSize, skin);

  // tên + handle + subtitle
  ctx.textAlign = "center";
  ctx.font = "bold 42px PB";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(ctx, o.title || "—", WIDTH - PAD * 2), cx, cy + avatarSize / 2 + 52);
  if (o.handle) {
    ctx.font = "22px P";
    ctx.fillStyle = skin.b;
    ctx.fillText(fit(ctx, o.handle, WIDTH - PAD * 2), cx, cy + avatarSize / 2 + 84);
  }
  if (o.subtitle) {
    ctx.font = "18px P";
    ctx.fillStyle = "#c3cee3";
    ctx.fillText(fit(ctx, o.subtitle, WIDTH - PAD * 2), cx, cy + avatarSize / 2 + 112);
  }
  ctx.textAlign = "left";

  // hàng thông tin
  let y = top + avatarBlock;
  for (const row of rows) {
    infoRow(ctx, PAD, y, WIDTH - PAD * 2, rowH - 10, skin, row.icon, row.label, row.value);
    y += rowH;
  }

  // footer
  ctx.font = "bold 16px PB";
  ctx.fillStyle = "#8b9ab8";
  ctx.textAlign = "right";
  ctx.fillText(String(o.footer || "JOHN TRAN"), WIDTH - PAD, H - 22);
  ctx.textAlign = "left";

  return save(canvas, `${skin.name} Profile`);
}

/**
 * Thẻ avatar gọn (dùng cho getavt) — avatar to + tên, không hàng thông tin
 */
async function renderAvatarCard(o = {}) {
  const skin = SKINS[o.skin] || SKINS.neutral;
  const avatarSize = 340;
  const H = 150 + avatarSize + 150;

  const canvas = createCanvas(WIDTH, H);
  const ctx = canvas.getContext("2d");
  ctx.quality = "best";
  await paintBase(ctx, skin, WIDTH, H, o.avatar);

  skinTag(ctx, PAD, 44, skin);

  const cx = WIDTH / 2;
  const cy = 150 + avatarSize / 2;
  await drawAvatar(ctx, o.avatar, cx, cy, avatarSize, skin);

  ctx.textAlign = "center";
  ctx.font = "bold 40px PB";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fit(ctx, o.title || "—", WIDTH - PAD * 2), cx, H - 62);
  if (o.subtitle) {
    ctx.font = "19px P";
    ctx.fillStyle = "#c3cee3";
    ctx.fillText(fit(ctx, o.subtitle, WIDTH - PAD * 2), cx, H - 30);
  }
  ctx.textAlign = "left";

  return save(canvas, "Profile Photo");
}

function save(canvas, title) {
  const filePath = path.join(os.tmpdir(), `jt_prof_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

async function downloadImage(url, prefix = "avt") {
  const img = await loadImg(url);
  if (!img) return null;
  const filePath = path.join(os.tmpdir(), `jt_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  try {
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext("2d").drawImage(img, 0, 0);
    fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    return filePath;
  } catch (error) {
    console.error("downloadImage:", error.message);
    return null;
  }
}

function cleanup(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* bỏ qua */ }
}

module.exports = { renderProfile, renderAvatarCard, downloadImage, cleanup, SKINS, WIDTH };
