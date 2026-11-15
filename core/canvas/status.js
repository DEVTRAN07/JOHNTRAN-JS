"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = number;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return (index ? amount.toFixed(1) : amount.toFixed(0)) + " " + units[index];
}

function percent(value, total) {
  const current = Number(value);
  const maximum = Number(total);
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(current / maximum * 100)));
}

function drawAvatar(ctx, url, name, x, y, size) {
  const S = theme.S;
  const palette = theme.PALETTE;
  const image = avatarCache.getAvatar(url);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  } else {
    ctx.fillStyle = "rgba(212,175,55,.16)";
    ctx.fillRect(x, y, size, size);
    ctx.font = theme.font(18, "JT-Bold");
    ctx.fillStyle = palette.accent;
    ctx.textAlign = "center";
    ctx.fillText(String(name || "J").trim().charAt(0).toUpperCase(), x + size / 2, y + size / 2 + S(6));
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + S(1), 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = S(1.5);
  ctx.stroke();
}

function drawMetric(ctx, x, y, width, label, value, ratio, accent) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, S(94), S(12), palette.accent);
  theme.label(ctx, label, x + S(14), y + S(23), { size: 10, color: palette.mute });
  theme.text(ctx, value, x + S(14), y + S(51), {
    size: 18, family: "JT-Bold", color: palette.ink, maxWidth: width - S(28)
  });

  const barX = x + S(14);
  const barY = y + S(68);
  const barWidth = width - S(28);
  ctx.fillStyle = "rgba(255,255,255,.10)";
  theme.roundRect(ctx, barX, barY, barWidth, S(5), S(3));
  ctx.fill();
  if (ratio !== null) {
    ctx.fillStyle = accent || palette.accent;
    theme.roundRect(ctx, barX, barY, Math.max(S(3), barWidth * ratio / 100), S(5), S(3));
    ctx.fill();
  }
}

function drawInfo(ctx, x, y, width, label, value) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, S(72), S(11), "rgba(212,175,55,.35)");
  theme.label(ctx, label, x + S(13), y + S(23), { size: 9, color: palette.mute });
  theme.text(ctx, value || "N/A", x + S(13), y + S(49), {
    size: 13, family: "JT-Bold", color: palette.ink2, maxWidth: width - S(26)
  });
}

async function renderStatus(options = {}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const device = options.device || {};
  const group = options.group || {};
  const pad = S(26);
  const gap = S(10);
  const columns = 3;
  const cardWidth = (W - pad * 2 - gap * (columns - 1)) / columns;
  const headerY = S(24);
  const stateY = S(106);
  const metricsY = S(226);
  const infoY = S(353);
  const footerY = S(454);
  const height = S(506);
  const { ctx, canvas } = theme.newCanvas(W, height);

  await theme.paintBackground(ctx, W, height);
  const palette = theme.PALETTE;

  drawAvatar(ctx, options.botAvatar, options.botName, pad, headerY + S(2), S(52));
  theme.label(ctx, "JOHN TRAN  /  SYSTEM OVERVIEW", pad + S(66), headerY + S(16), { size: 10 });
  theme.text(ctx, options.botName || "JOHNTRAN", pad + S(66), headerY + S(43), {
    size: 23, family: "JT-Display-Bold", color: palette.ink, maxWidth: W - pad * 2 - S(180)
  });
  theme.text(ctx, "v" + String(options.version || ""), W - pad, headerY + S(37), {
    size: 13, family: "JT-Mono-Bold", color: palette.accent, align: "right"
  });
  theme.foil(ctx, pad, S(88), S(110));

  const stateWidth = (W - pad * 2 - gap) / 2;
  theme.panel(ctx, pad, stateY, stateWidth, S(92), S(12), group.enabled ? palette.green : palette.red);
  theme.label(ctx, "TRẠNG THÁI TRONG NHÓM", pad + S(14), stateY + S(26), { size: 10, color: palette.mute });
  theme.text(ctx, group.enabled ? "ĐANG HOẠT ĐỘNG" : "ĐANG TẠM DỪNG", pad + S(14), stateY + S(58), {
    size: 17, family: "JT-Bold", color: group.enabled ? palette.green : palette.red
  });
  theme.text(ctx, String(group.name || "Tin nhắn riêng"), pad + S(14), stateY + S(78), {
    size: 10, color: palette.ink2, maxWidth: stateWidth - S(28)
  });

  const uptimeX = pad + stateWidth + gap;
  theme.panel(ctx, uptimeX, stateY, stateWidth, S(92), S(12), palette.accent);
  theme.label(ctx, "THỜI GIAN BOT HOẠT ĐỘNG", uptimeX + S(14), stateY + S(26), { size: 10, color: palette.mute });
  theme.text(ctx, options.uptime || "N/A", uptimeX + S(14), stateY + S(59), {
    size: 19, family: "JT-Mono-Bold", color: palette.ink, maxWidth: stateWidth - S(28)
  });

  theme.label(ctx, "TÀI NGUYÊN THIẾT BỊ", pad, metricsY - S(9), { size: 11 });
  const cpuPercent = percent(device.cpuPercent, 100);
  const ramPercent = percent(device.ramUsed, device.ramTotal);
  const diskPercent = percent(device.diskUsed, device.diskTotal);
  const metricCards = [
    ["CPU", (Number(device.cpuCores) || 0) + " cores  •  " + (Number(device.cpuPercent) || 0).toFixed(1) + "%", cpuPercent],
    ["RAM", formatBytes(device.ramUsed) + " / " + formatBytes(device.ramTotal), ramPercent],
    ["DISK", device.diskTotal ? formatBytes(device.diskUsed) + " / " + formatBytes(device.diskTotal) : "N/A", diskPercent]
  ];
  metricCards.forEach((item, index) => {
    drawMetric(ctx, pad + index * (cardWidth + gap), metricsY + S(8), cardWidth, item[0], item[1], item[2], palette.accent);
  });

  theme.label(ctx, "THÔNG TIN HỆ THỐNG", pad, infoY - S(8), { size: 11 });
  const platform = device.platform === "darwin" ? "macOS" : device.platform === "win32" ? "Windows" : (device.platform || "OS");
  const infos = [
    ["HỆ ĐIỀU HÀNH", platform + " " + String(device.release || "")],
    ["TỐC ĐỘ UPLOAD", device.txKBs == null ? "N/A" : Number(device.txKBs).toFixed(1) + " KB/s"],
    ["TỐC ĐỘ DOWNLOAD", device.rxKBs == null ? "N/A" : Number(device.rxKBs).toFixed(1) + " KB/s"]
  ];
  infos.forEach((item, index) => {
    drawInfo(ctx, pad + index * (cardWidth + gap), infoY + S(8), cardWidth, item[0], item[1]);
  });

  theme.panel(ctx, pad, footerY, W - pad * 2, S(38), S(9), "rgba(212,175,55,.30)");
  theme.text(ctx, "JOHNTRAN  •  THIẾT BỊ ĐANG CHẠY BOT", pad + S(13), footerY + S(24), {
    size: 10, family: "JT-Mono", color: palette.mute
  });
  theme.text(ctx, "STATUS", W - pad - S(13), footerY + S(24), {
    size: 10, family: "JT-Mono-Bold", color: palette.accent, align: "right"
  });

  return theme.save(canvas, "status");
}

module.exports = { renderStatus, _test: { formatBytes, percent, drawMetric, drawInfo } };
