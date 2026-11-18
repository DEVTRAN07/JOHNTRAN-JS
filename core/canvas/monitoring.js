"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const theme = require("./theme");
const S = theme.S;
const W = theme.WIDTH;
const PAD = 28;

function rounded(ctx, x, y, w, h, r) { theme.roundRect(ctx, x, y, w, h, r); }
function fit(ctx, value, width) {
  let out = theme.sanitizeGlyphs(String(value == null ? "" : value));
  if (!width || ctx.measureText(out).width <= width) return out;
  while (out.length > 1 && ctx.measureText(out + "…").width > width) out = out.slice(0, -1);
  return out + "…";
}
function text(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save(); ctx.font = theme.font(size, bold ? "JT-Round-Bold" : "JT-Round");
  ctx.fillStyle = (color === theme.PALETTE.accent || color === theme.PALETTE.accent2) ? theme.randomTextColor(String(value) + ":" + x + ":" + y) : color; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(fit(ctx, value, maxWidth), x, y); ctx.restore();
}
function backdrop(ctx, width, height, p) {
  theme.paintBackground(ctx, width, height);
}
function panel(ctx, x, y, w, h, p, colors) {
  const c = colors || p.card; rounded(ctx, x, y, w, h, S(12));
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.14)"; ctx.shadowBlur = S(5); ctx.shadowOffsetY = S(2);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, theme.rgba(c[0], .34)); g.addColorStop(1, theme.rgba(c[1], .38)); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  rounded(ctx, x, y, w, h, S(12)); ctx.strokeStyle = p.cardBorder; ctx.lineWidth = Math.max(1, S(.8)); ctx.stroke();
}
function header(ctx, title, subtitle, meta, p) {
  text(ctx, "JOHN TRAN  /  SYSTEM MONITOR", S(PAD), S(30), 10, p.accent, true);
  text(ctx, title, S(PAD), S(61), 26, p.text, true);
  text(ctx, subtitle, S(PAD), S(82), 11, p.muted, false);
  text(ctx, meta || "", W - S(PAD), S(36), 11, p.accent, true, "right", S(250));
}
function metric(ctx, x, y, w, label, value, note, p, color) {
  panel(ctx, x, y, w, S(82), p);
  text(ctx, label, x + S(13), y + S(22), 9, p.muted, true);
  text(ctx, value, x + S(13), y + S(51), 23, color || p.text, true, "left", w - S(26));
  text(ctx, note || "", x + S(13), y + S(69), 9, p.muted, false, "left", w - S(26));
}
function sectionHeight(n, rowH) { return S(42 + Math.max(1, n) * (rowH || 27) + 13); }
function listSection(ctx, x, y, w, title, rows, p, caption, empty) {
  const h = sectionHeight(rows.length); panel(ctx, x, y, w, h, p, p.panel);
  text(ctx, title, x + S(15), y + S(25), 10, p.accent, true);
  text(ctx, caption || "", x + w - S(15), y + S(25), 8.5, p.muted, false, "right", w * .42);
  const items = rows.length ? rows : [{ left: empty || "Chưa có dữ liệu", right: "—" }];
  items.forEach((item, i) => {
    const yy = y + S(49 + i * 27);
    if (i) { ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(x + S(14), yy - S(17)); ctx.lineTo(x + w - S(14), yy - S(17)); ctx.stroke(); ctx.restore(); }
    text(ctx, item.left, x + S(16), yy, 11, p.text, false, "left", w - S(150));
    text(ctx, item.right || "", x + w - S(15), yy, 9, p.muted, false, "right", S(126));
  });
  return h;
}
function compactSection(ctx, x, y, w, title, rows, p) {
  const h = sectionHeight(rows.length, 26); panel(ctx, x, y, w, h, p, p.panel);
  text(ctx, title, x + S(13), y + S(25), 9, p.accent, true, "left", w - S(26));
  const items = rows.length ? rows : [{ left: "Chưa đủ dữ liệu", right: "" }];
  items.forEach((item, i) => {
    const yy = y + S(49 + i * 26);
    text(ctx, item.left, x + S(13), yy, 9, p.text, false, "left", w - S(112));
    text(ctx, item.right || "", x + w - S(13), yy, 8, p.muted, false, "right", S(96));
  });
  return h;
}
function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n <= 1 ? n * 100 : n)) + "%" : "0%";
}
function milliseconds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) + " ms" : "N/A";
}
function cacheGrid(ctx, x, y, w, items, p, title) {
  const rowCount = Math.max(1, Math.ceil(items.length / 2));
  const h = S(42 + rowCount * 39 + 13); panel(ctx, x, y, w, h, p, p.panel);
  text(ctx, title, x + S(15), y + S(25), 10, p.accent, true);
  const rows = items.length ? items : [{ name: "Cache", size: 0, max: 0, hitRate: 0 }];
  rows.forEach((item, i) => {
    const col = i % 2, row = Math.floor(i / 2), cw = (w - S(42)) / 2;
    const cx = x + S(14) + col * (cw + S(12)), cy = y + S(36) + row * S(39);
    rounded(ctx, cx, cy, cw, S(32), S(7)); ctx.fillStyle = "rgba(255,255,255,.045)"; ctx.fill();
    text(ctx, item.name, cx + S(8), cy + S(13), 8.5, p.text, true, "left", cw - S(16));
    text(ctx, String(item.size || 0) + "/" + String(item.max || 0) + " · " + percent(item.hitRate),
      cx + S(8), cy + S(26), 8, p.muted, false, "left", cw - S(16));
  });
  return h;
}
function footer(ctx, y, p, label) {
  panel(ctx, S(PAD), y, W - S(PAD * 2), S(31), p, p.footer);
  text(ctx, label, S(PAD + 12), y + S(20), 8.5, p.muted, false, "left", W - S(PAD * 2 + 24));
}
function saveFrame(canvas) {
  const output = path.join(os.tmpdir(), "jt_monitor_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(output, canvas.toBuffer("image/png"));
  return output;
}

function renderStatsCard(data = {}) {
  theme.initFonts();
  const p = theme.getCardPalette(), daily = data.daily || {}, latency = data.latency || {};
  const top = (data.topCommands || []).slice(0, 5).map((v, i) => ({ left: (i + 1) + ". " + v[0], right: v[1] + " lần" }));
  const slow = (data.slowCommands || []).slice(0, 5).map(v => ({ left: v.command, right: "P95 " + milliseconds(v.p95Ms) }));
  const handlers = (data.slowHandlers || []).slice(0, 5).map(v => ({ left: v.command, right: "P95 " + milliseconds(v.p95Ms) }));
  const firstResponses = (data.firstResponses || []).slice(0, 5).map(v => ({ left: v.command, right: "P95 " + milliseconds(v.p95Ms) }));
  const zaloSend = data.zaloSend || {};
  const sendRows = zaloSend.count ? [{ left: "Zalo send RTT", right: "P95 " + milliseconds(zaloSend.p95Ms) }] : [];
  const caches = (data.caches || []).slice(0, 10);
  const topH = sectionHeight(top.length), slowH = sectionHeight(Math.max(slow.length, handlers.length), 26);
  const responseH = sectionHeight(Math.max(firstResponses.length, sendRows.length), 26);
  const cacheH = S(42 + Math.max(1, Math.ceil(caches.length / 2)) * 39 + 13);
  let y = 96;
  const metricY = y; y += 95;
  const activityY = y; y += 62;
  const responseY = y; y += responseH + 12;
  const topY = y; y += topH + 12;
  const slowY = y; y += slowH + 12;
  const cacheY = y; y += cacheH + 42;
  const result = theme.newCanvas(W, S(y)), canvas = result.canvas, ctx = result.ctx;
  backdrop(ctx, W, canvas.height, p);
  header(ctx, "THỐNG KÊ HOẠT ĐỘNG", "Ngày " + (daily.day || "N/A") + "  ·  Uptime " + (data.uptime || "N/A"),
    String(latency.count || 0) + " MẪU", p);
  const gap = S(9), cw = (W - S(PAD * 2) - gap * 2) / 3;
  metric(ctx, S(PAD), S(metricY), cw, "TỔNG LỆNH", String(daily.commands || 0), "Lỗi " + String(daily.errors || 0), p);
  metric(ctx, S(PAD) + cw + gap, S(metricY), cw, "ĐỘ TRỄ P95", milliseconds(latency.p95Ms), "P50 " + milliseconds(latency.p50Ms), p, p.accent);
  metric(ctx, S(PAD) + (cw + gap) * 2, S(metricY), cw, "LỆNH GẦN NHẤT", milliseconds(latency.lastMs), "TB " + milliseconds(latency.avgMs), p);
  const full = W - S(PAD * 2);
  const responseHalf = (full - S(10)) / 2;
  panel(ctx, S(PAD), S(activityY), full, S(49), p, p.panel);
  [["NHẠC TÌM", daily.musicSearch || 0], ["NHẠC TẢI", daily.musicDownload || 0], ["AI", daily.aiRequests || 0], ["TTS", daily.ttsRequests || 0]]
    .forEach((v, i) => {
      const x = S(PAD) + i * full / 4;
      text(ctx, v[0], x + S(12), S(activityY + 19), 8, p.muted, true);
      text(ctx, String(v[1]), x + S(12), S(activityY + 38), 13, p.text, true);
    });
  compactSection(ctx, S(PAD), S(responseY), responseHalf, "PHẢN HỒI ĐẦU TIÊN", firstResponses, p);
  compactSection(ctx, S(PAD) + responseHalf + S(10), S(responseY), responseHalf, "ZALO SEND RTT", sendRows, p);
  listSection(ctx, S(PAD), S(topY), full, "TOP LỆNH", top, p, "TẦN SUẤT SỬ DỤNG", "Chưa có dữ liệu");
  const half = (full - S(10)) / 2;
  compactSection(ctx, S(PAD), S(slowY), half, "LỆNH CHẬM · TOÀN BỘ", slow, p);
  compactSection(ctx, S(PAD) + half + S(10), S(slowY), half, "HANDLER · COMMAND.RUN", handlers, p);
  cacheGrid(ctx, S(PAD), S(cacheY), full, caches, p, "HIỆU SUẤT CACHE");
  footer(ctx, S(y - 34), p, "JOHNTRAN  ·  LIVE METRICS  ·  " + String(latency.count || 0) + " mẫu độ trễ");
  return saveFrame(canvas);
}

function renderJobsCard(data = {}) {
  theme.initFonts();
  const p = theme.getCardPalette(), q = data.global || {};
  const lanes = (data.lanes || []).slice(0, 12), workers = (data.workers || []).slice(0, 8);
  const caches = (data.caches || []).slice(0, 10);
  const laneRows = lanes.length ? lanes : [{ empty: true }];
  const workerRows = workers.length ? workers : [{ empty: true }];
  const queueH = S(42 + laneRows.length * 52 + 13);
  const workerH = S(42 + workerRows.length * 34 + 13);
  const cacheH = S(42 + Math.max(1, Math.ceil(caches.length / 2)) * 39 + 13);
  let y = 96;
  const metricY = y; y += 95;
  const queueY = y; y += queueH + 12;
  const workerY = y; y += workerH + 12;
  const cacheY = y; y += cacheH + 12;
  const mediaY = y; y += 58;
  const memoryY = y; y += 88;
  const result = theme.newCanvas(W, S(y)), canvas = result.canvas, ctx = result.ctx;
  backdrop(ctx, W, canvas.height, p);
  header(ctx, "SPEED ENGINE", "Trạng thái hàng đợi, worker và bộ nhớ", data.uptime || "LIVE", p);
  const gap = S(9), cw = (W - S(PAD * 2) - gap * 2) / 3;
  metric(ctx, S(PAD), S(metricY), cw, "ĐANG CHẠY", (q.active || 0) + "/" + (q.concurrency || 0), "Tác vụ đồng thời", p);
  metric(ctx, S(PAD) + cw + gap, S(metricY), cw, "ĐANG CHỜ", (q.pending || 0) + "/" + (q.maxPending || 0), "Tác vụ trong queue", p, p.accent);
  metric(ctx, S(PAD) + (cw + gap) * 2, S(metricY), cw, "RAM / HEAP", Number(data.memory?.rssMb || 0).toFixed(1) + " MB",
    "Heap " + Number(data.memory?.heapMb || 0).toFixed(1) + " MB", p);
  const full = W - S(PAD * 2);
  panel(ctx, S(PAD), S(queueY), full, queueH, p, p.panel);
  text(ctx, "HÀNG ĐỢI TÁC VỤ", S(PAD + 15), S(queueY + 25), 10, p.accent, true);
  laneRows.forEach((lane, i) => {
    const yy = queueY + 49 + i * 52;
    if (i) { ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(S(PAD + 14), S(yy - 18)); ctx.lineTo(W - S(PAD + 14), S(yy - 18)); ctx.stroke(); ctx.restore(); }
    const title = lane.empty ? "Chưa có tác vụ nào được đưa vào queue" : lane.name;
    const state = lane.empty ? "" : lane.active + "/" + lane.concurrency + " chạy  ·  " + lane.pending + "/" + lane.maxPending + " chờ";
    const detail = lane.empty ? "Queue sẽ xuất hiện khi có tác vụ đầu tiên" :
      "Xong " + lane.completed + "  ·  Lỗi " + lane.failed + "  ·  Retry " + lane.retried + "  ·  Từ chối " + lane.rejected;
    const timing = lane.empty ? "" : "Chờ TB " + Number(lane.avgWaitMs || 0).toFixed(1) + " ms  ·  Xử lý TB " + Number(lane.avgRunMs || 0).toFixed(1) + " ms  ·  Max chờ " + Number(lane.maxWaitMs || 0).toFixed(1) + " ms";
    text(ctx, title, S(PAD + 16), S(yy), 10, p.text, true, "left", full * .42);
    text(ctx, state, W - S(PAD + 16), S(yy), 9, p.accent, true, "right", full * .5);
    text(ctx, detail, S(PAD + 16), S(yy + 15), 8, p.muted, false, "left", full - S(32));
    text(ctx, timing, S(PAD + 16), S(yy + 28), 8, p.accent, false, "left", full - S(32));
  });
  panel(ctx, S(PAD), S(workerY), full, workerH, p, p.panel);
  text(ctx, "WORKER POOL", S(PAD + 15), S(workerY + 25), 10, p.accent, true);
  workerRows.forEach((pool, i) => {
    const yy = workerY + 49 + i * 34;
    if (i) { ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(S(PAD + 14), S(yy - 16)); ctx.lineTo(W - S(PAD + 14), S(yy - 16)); ctx.stroke(); ctx.restore(); }
    const title = pool.empty ? "Worker chưa được khởi tạo" : pool.name;
    const state = pool.empty ? "" : pool.busy + "/" + pool.workers + " bận  ·  " + pool.pending + "/" + pool.maxPending + " chờ  ·  lỗi " + pool.failed;
    text(ctx, title, S(PAD + 16), S(yy), 9.5, p.text, true, "left", full * .42);
    text(ctx, state, W - S(PAD + 16), S(yy), 8.5, p.muted, false, "right", full * .52);
  });
  cacheGrid(ctx, S(PAD), S(cacheY), full, caches, p, "CACHE");
  const media = data.media || {};
  panel(ctx, S(PAD), S(mediaY), full, S(48), p, p.panel);
  text(ctx, "MEDIA CACHE", S(PAD + 14), S(mediaY + 18), 8, p.muted, true);
  text(ctx, (media.localFiles || 0) + " file local  ·  " + percent(media.hitRate) + " hit  ·  " +
    (media.uploads || 0) + " lần ghi  ·  R2 " + (media.r2Configured ? "đã bật" : "local-only"),
    S(PAD + 14), S(mediaY + 36), 9.5, p.text, false, "left", full - S(28));
  const mem = data.memory || {};
  panel(ctx, S(PAD), S(memoryY), full, S(48), p, p.footer);
  text(ctx, "RAM " + Number(mem.rssMb || 0).toFixed(1) + " MB  ·  Heap " + Number(mem.heapMb || 0).toFixed(1) + " MB",
    S(PAD + 14), S(memoryY + 20), 10, p.text, true);
  text(ctx, "Retry chỉ chạy với tác vụ an toàn; bot không tự gửi lại tin nhắn Zalo.",
    S(PAD + 14), S(memoryY + 37), 8, p.muted, false, "left", full - S(28));
  footer(ctx, S(y - 34), p, "JOHNTRAN  ·  SPEED ENGINE  ·  QUEUE SNAPSHOT");
  return saveFrame(canvas);
}

module.exports = { renderStatsCard, renderJobsCard, _test: { percent, milliseconds, sectionHeight } };
