"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = number, index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return (index ? amount.toFixed(1) : amount.toFixed(0)) + " " + units[index];
}
function percent(value, total) {
  const current = Number(value), maximum = Number(total);
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(current / maximum * 100)));
}
function drawAvatar(ctx, url, name, x, y, size) {
  const S = theme.S, p = theme.PALETTE, image = avatarCache.getAvatar(url);
  ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#24617a"); g.addColorStop(1, "#162d4b");
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
    ctx.font = theme.font(27, "JT-Bold"); ctx.fillStyle = theme.randomTextColor(String(name || "J") + ":status-avatar");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(name || "J").trim().charAt(0).toUpperCase(), x + size / 2, y + size / 2);
  }
  ctx.restore(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2 + S(2), 0, Math.PI * 2);
  ctx.strokeStyle = p.accent; ctx.lineWidth = S(2); ctx.stroke();
}
function drawMetric(ctx, x, y, width, label, value, ratio, accent, note) {
  const S = theme.S, p = theme.PALETTE;
  theme.panel(ctx, x, y, width, S(108), S(15), accent || p.accent);
  theme.label(ctx, label, x + S(15), y + S(25), { size: 10, color: p.mute });
  theme.text(ctx, value, x + S(15), y + S(60), {
    size: 23, family: "JT-Display-Bold", color: p.ink, maxWidth: width - S(30)
  });
  const bx = x + S(15), by = y + S(78), bw = width - S(30);
  theme.roundRect(ctx, bx, by, bw, S(6), S(3)); ctx.fillStyle = "rgba(255,255,255,.10)"; ctx.fill();
  if (ratio !== null && ratio !== undefined) {
    const fw = Math.max(S(4), bw * Math.max(0, Math.min(100, ratio)) / 100);
    theme.roundRect(ctx, bx, by, fw, S(6), S(3)); ctx.fillStyle = accent || p.accent; ctx.fill();
  }
  if (note) theme.text(ctx, note, x + width - S(14), y + S(25), {
    size: 9, family: "JT-Mono", color: p.ink2, align: "right"
  });
}
function drawInfo(ctx, x, y, width, label, value) {
  const S = theme.S, p = theme.PALETTE;
  theme.panel(ctx, x, y, width, S(72), S(12), p.accent);
  theme.label(ctx, label, x + S(14), y + S(24), { size: 9, color: p.mute });
  theme.text(ctx, value || "N/A", x + S(14), y + S(49), {
    size: 14, family: "JT-Bold", color: p.ink, maxWidth: width - S(28)
  });
}
async function renderStatus(options = {}) {
  theme.initFonts();
  const S = theme.S, W = theme.WIDTH, p = theme.PALETTE;
  const device = options.device || {}, group = options.group || {};
  const pad = S(26), gap = S(11), colW = (W - pad * 2 - gap * 2) / 3;
  const heroY = S(105), metricY = S(246), infoY = S(381), footerY = S(476);
  const height = S(525);
  const { ctx, canvas } = theme.newCanvas(W, height);
  await theme.paintBackground(ctx, W, height);

  theme.label(ctx, "JOHNTRAN  /  SYSTEM OVERVIEW", pad, S(31), { size: 10 });
  theme.text(ctx, "TRẠNG THÁI BOT", pad, S(73), {
    size: 30, family: "JT-Display-Bold", color: p.ink
  });
  theme.text(ctx, "Tổng quan thiết bị và kết nối nhóm", pad, S(94), {
    size: 11, color: p.ink2
  });

  theme.panel(ctx, pad, heroY, W - pad * 2, S(119), S(17), group.enabled ? p.green : p.red);
  drawAvatar(ctx, options.botAvatar, options.botName || "JOHNTRAN",
    pad + S(17), heroY + S(20), S(76));
  const tx = pad + S(112);
  theme.label(ctx, "BOT ĐANG CHẠY", tx, heroY + S(32), { size: 9, color: p.mute });
  theme.text(ctx, options.botName || "JOHNTRAN", tx, heroY + S(66), {
    size: 27, family: "JT-Display-Bold", color: p.ink,
    maxWidth: W - tx - pad - S(150)
  });
  theme.text(ctx, String(group.name || "Tin nhắn riêng"), tx, heroY + S(91), {
    size: 11, color: p.ink2, maxWidth: W - tx - pad - S(150)
  });
  const pillW = S(150), pillH = S(31), pillX = W - pad - pillW - S(14), pillY = heroY + S(20);
  theme.roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = group.enabled ? "rgba(84,214,160,.16)" : "rgba(255,113,136,.14)"; ctx.fill();
  theme.text(ctx, group.enabled ? "● ONLINE" : "● OFFLINE", pillX + pillW / 2, pillY + S(21), {
    size: 10, family: "JT-Bold", color: group.enabled ? p.green : p.red, align: "center"
  });
  theme.label(ctx, "UPTIME", pillX, heroY + S(78), { size: 8, color: p.mute, align: "center" });
  theme.text(ctx, options.uptime || "N/A", pillX + pillW / 2, heroY + S(99), {
    size: 9, family: "JT-Mono-Bold", color: p.ink, align: "center", maxWidth: pillW - S(4)
  });

  theme.label(ctx, "TÀI NGUYÊN THIẾT BỊ", pad, metricY - S(12), { size: 10 });
  const cpu = Number(device.cpuPercent);
  drawMetric(ctx, pad, metricY, colW, "CPU", Number.isFinite(cpu) ? cpu.toFixed(1) + "%" : "N/A",
    percent(cpu, 100), p.accent, String(device.cpuCores || "—") + " cores");
  drawMetric(ctx, pad + colW + gap, metricY, colW, "RAM",
    percent(device.ramUsed, device.ramTotal) == null ? "N/A" : percent(device.ramUsed, device.ramTotal) + "%",
    percent(device.ramUsed, device.ramTotal), p.green,
    formatBytes(device.ramUsed) + " / " + formatBytes(device.ramTotal));
  drawMetric(ctx, pad + (colW + gap) * 2, metricY, colW, "DISK",
    percent(device.diskUsed, device.diskTotal) == null ? "N/A" : percent(device.diskUsed, device.diskTotal) + "%",
    percent(device.diskUsed, device.diskTotal), p.gold,
    formatBytes(device.diskUsed) + " / " + formatBytes(device.diskTotal));

  theme.label(ctx, "KẾT NỐI & HỆ ĐIỀU HÀNH", pad, infoY - S(12), { size: 10 });
  const platform = device.platform === "darwin" ? "macOS" :
    device.platform === "win32" ? "Windows" : String(device.platform || "OS");
  drawInfo(ctx, pad, infoY, colW, "HỆ ĐIỀU HÀNH", platform + " " + String(device.release || ""));
  drawInfo(ctx, pad + colW + gap, infoY, colW, "UPLOAD", device.txKBs == null ? "N/A" : Number(device.txKBs).toFixed(1) + " KB/s");
  drawInfo(ctx, pad + (colW + gap) * 2, infoY, colW, "DOWNLOAD", device.rxKBs == null ? "N/A" : Number(device.rxKBs).toFixed(1) + " KB/s");

  theme.text(ctx, "JOHNTRAN  •  SYSTEM STATUS", pad, footerY, {
    size: 9, family: "JT-Mono", color: p.mute
  });
  theme.text(ctx, "v" + String(options.version || ""), W - pad, footerY, {
    size: 9, family: "JT-Mono-Bold", color: p.accent, align: "right"
  });
  return theme.save(canvas, "status");
}

module.exports = { renderStatus, _test: { formatBytes, percent, drawMetric, drawInfo } };
