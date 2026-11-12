#!/usr/bin/env node
"use strict";

// JOHNTRAN TUI — quản lý BotManager trực tiếp, không khởi chạy thêm bot master.
const readline = require("readline");
const os = require("os");
const { BotManager } = require("./panel/botManager");
const { collectDeviceMetrics } = require("./core/runtime/deviceMetrics");

const MENU = [
  ["dashboard", "Tổng quan"],
  ["bots", "Quản lý bot"],
  ["logs", "Nhật ký realtime"],
  ["system", "Tài nguyên hệ thống"],
  ["help", "Trợ giúp"]
];
const manager = new BotManager({
  bridgeToken: process.env.JT_BRIDGE_TOKEN || ""
});
let page = "dashboard";
let selected = 0;
let botSelected = 0;
let notice = "Sẵn sàng • ↑↓ di chuyển • Enter chọn • q thoát";
let logsBot = "";
let logsOffset = 0;
let busy = false;
let closing = false;
let metrics = null;
let lastRefresh = 0;

function clear() { process.stdout.write("\x1b[2J\x1b[H"); }
function line(s = "") { process.stdout.write(s + "\n"); }
function width() { return Math.max(60, Math.min(process.stdout.columns || 100, 110)); }
function cut(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + " " + u[i];
}
function fmtUptime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m " + s % 60 + "s";
}
function bar(value, size = 18) {
  const n = Math.max(0, Math.min(size, Math.round((Number(value) || 0) / 100 * size)));
  return "█".repeat(n) + "░".repeat(size - n);
}
function bots() { return manager.list(); }
function header(title) {
  const w = width();
  line("\x1b[1;36m╭" + "─".repeat(w - 2) + "╮\x1b[0m");
  line("\x1b[1;36m│\x1b[0m \x1b[1;97mJOHNTRAN CONTROL CENTER\x1b[0m" + " ".repeat(Math.max(1, w - 29)) + "\x1b[1;36m│\x1b[0m");
  line("\x1b[1;36m│\x1b[0m " + cut(title, w - 4) + " ".repeat(Math.max(1, w - 4 - cut(title, w - 4).length)) + "\x1b[1;36m│\x1b[0m");
  line("\x1b[1;36m╰" + "─".repeat(w - 2) + "╯\x1b[0m");
}
function footer() {
  line("\n\x1b[90m" + cut(notice, width() - 2) + "\x1b[0m");
  line("\x1b[90mPhím: ↑/↓ chọn  •  ←/→ chuyển trang  •  Enter thao tác  •  N tạo bot  •  R tải lại  •  Q thoát\x1b[0m");
}
function renderDashboard() {
  const list = bots();
  line("\n  \x1b[1mTRẠNG THÁI BOT\x1b[0m");
  line("  Tổng bot: " + list.length + "   Đang chạy: " + list.filter(b => b.status === "online").length + "   Dừng: " + list.filter(b => b.status !== "online").length);
  line("\n  " + "BOT".padEnd(22) + "TRẠNG THÁI".padEnd(22) + "PID".padEnd(12) + "UPTIME");
  line("  " + "─".repeat(Math.min(width() - 4, 76)));
  if (!list.length) line("  Chưa có bot. Nhấn N để tạo bot đầu tiên.");
  for (const b of list) {
    const color = b.status === "online" ? "\x1b[32m" : b.status === "restarting" ? "\x1b[33m" : "\x1b[90m";
    line("  " + cut(b.name, 20).padEnd(22) + color + cut(b.status, 20).padEnd(22) + "\x1b[0m" + String(b.pid || "—").padEnd(12) + fmtUptime(b.uptimeMs));
  }
  line("\n  \x1b[1mĐIỀU HƯỚNG\x1b[0m");
  MENU.forEach(([key, label], i) => line("  " + (page === key ? "\x1b[1;36m❯ " : "  ") + (i + 1) + ". " + label + (page === key ? "\x1b[0m" : "")));
}
function renderBots() {
  const list = bots();
  line("\n  \x1b[1mBOT MANAGER\x1b[0m  •  Enter: thao tác  •  N: tạo mới");
  if (!list.length) { line("\n  Chưa có bot nào."); return; }
  list.forEach((b, i) => {
    const active = i === botSelected;
    const status = b.status === "online" ? "\x1b[32m● online\x1b[0m" : "\x1b[90m● " + b.status + "\x1b[0m";
    line("  " + (active ? "\x1b[1;36m❯ " : "  ") + (i + 1) + ". " + cut(b.name, 22).padEnd(24) + status + "  pid " + (b.pid || "—") + "  restart " + b.restarts + (b.autoRestart ? "  auto↻" : "  manual") + (active ? "\x1b[0m" : ""));
  });
  const b = list[botSelected];
  if (b) {
    line("\n  \x1b[1mTHAO TÁC BOT: " + b.name + "\x1b[0m");
    line("  [S] " + (b.status === "online" ? "Dừng" : "Chạy") + "   [R] Khởi động lại   [A] " + (b.autoRestart ? "Tắt" : "Bật") + " tự khởi động");
    line("  [L] Xem log   [D] Xoá bot   [N] Tạo bot");
  }
}
function renderLogs() {
  const b = manager.get(logsBot) || manager.get(bots()[botSelected]?.name);
  if (!b) { line("\n  Chưa có bot để xem log."); return; }
  logsBot = b.name;
  const rows = b.logs.slice(-18);
  line("\n  \x1b[1mLOGS • " + b.name + "\x1b[0m  (tự cập nhật)");
  line("  " + "─".repeat(Math.min(width() - 4, 76)));
  rows.forEach(x => line("  " + cut(x, width() - 4)));
  if (!rows.length) line("  Chưa có log.");
}
function renderSystem() {
  const m = metrics || {};
  const mem = process.memoryUsage();
  line("\n  \x1b[1mHOST\x1b[0m");
  line("  Hostname : " + os.hostname());
  line("  Platform : " + os.platform() + " " + os.release() + " (" + os.arch() + ")");
  line("  Node.js  : " + process.version);
  line("\n  \x1b[1mTÀI NGUYÊN\x1b[0m");
  line("  CPU      : " + (m.cpuPercent ?? "—") + "%  " + bar(m.cpuPercent || 0));
  const ram = os.totalmem() ? (os.totalmem() - os.freemem()) / os.totalmem() * 100 : 0;
  line("  RAM      : " + ram.toFixed(1) + "%  " + bar(ram) + "  " + fmtBytes(os.totalmem() - os.freemem()) + " / " + fmtBytes(os.totalmem()));
  line("  Process  : RSS " + fmtBytes(mem.rss) + " • Heap " + fmtBytes(mem.heapUsed));
  line("  Disk     : " + fmtBytes(m.diskUsed) + " / " + fmtBytes(m.diskTotal));
  line("  Network  : ↓ " + (m.rxKBs == null ? "—" : m.rxKBs.toFixed(1) + " KB/s") + "  ↑ " + (m.txKBs == null ? "—" : m.txKBs.toFixed(1) + " KB/s"));
  line("  Uptime   : " + fmtUptime(process.uptime() * 1000));
}
function render() {
  if (closing) return;
  clear();
  header(({dashboard:"Dashboard",bots:"Bot Manager",logs:"Live Logs",system:"System Monitor",help:"Trợ giúp"})[page] || page);
  if (page === "dashboard") renderDashboard();
  else if (page === "bots") renderBots();
  else if (page === "logs") renderLogs();
  else if (page === "system") renderSystem();
  else {
    line("\n  TUI dùng chung BotManager với Web Panel, không tạo tiến trình bot trùng.");
    line("  npm start       Khởi chạy hệ thống bot/panel theo cấu hình hiện tại");
    line("  npm run tui     Mở giao diện quản lý Terminal");
    line("  ↑/↓ hoặc j/k    Di chuyển");
    line("  Enter           Chọn mục / thao tác bot");
    line("  N               Tạo bot mới");
    line("  Q               Thoát TUI (dừng các bot do TUI quản lý)");
  }
  footer();
}
function ask(question) {
  return new Promise(resolve => {
    rl.pause();
    process.stdout.write("\n" + question + " ");
    rl.question("", answer => { rl.resume(); resolve(answer.trim()); });
  });
}
async function actionBot(key) {
  const b = bots()[botSelected];
  if (!b) return;
  const instance = manager.get(b.name);
  try {
    busy = true;
    if (key === "s") {
      if (instance.process) await instance.stop();
      else instance.start();
      notice = "Đã cập nhật trạng thái bot " + b.name;
    } else if (key === "r") {
      await instance.restart(); notice = "Đã khởi động lại " + b.name;
    } else if (key === "a") {
      manager.setAutoRestart(b.name, !instance.autoRestart); notice = "Auto-restart: " + (instance.autoRestart ? "ON" : "OFF");
    } else if (key === "l") {
      logsBot = b.name; page = "logs";
    } else if (key === "d") {
      const confirm = await ask("Nhập DELETE để xoá bot " + b.name + " và dữ liệu:");
      if (confirm === "DELETE") {
        await manager.remove(b.name);
        botSelected = Math.max(0, botSelected - (botSelected >= bots().length ? 1 : 0));
        notice = "Đã xoá bot và dữ liệu: " + b.name;
      } else notice = "Đã huỷ thao tác xoá.";
    }
  } catch (e) { notice = "Lỗi: " + e.message; }
  finally { busy = false; render(); }
}
async function createBot() {
  const name = await ask("Tên bot mới (a-z, 0-9, _ hoặc -):");
  if (!name) { notice = "Đã huỷ tạo bot."; return render(); }
  try {
    const b = manager.create(name);
    b.start();
    botSelected = Math.max(0, bots().findIndex(x => x.name === name));
    notice = "Đã tạo và chạy bot " + name + ". Quét QR trong thư mục bots/" + name;
  } catch (e) { notice = "Không thể tạo bot: " + e.message; }
  render();
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
readline.emitKeypressEvents(process.stdin, rl);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
function onKey(str, key = {}) {
  if (busy || closing) return;
  const name = key.name || str;
  if (name === "q" || (key.ctrl && name === "c")) return shutdown();
  if (name === "up" || name === "k") {
    if (page === "bots") botSelected = Math.max(0, botSelected - 1);
    else selected = Math.max(0, selected - 1);
  } else if (name === "down" || name === "j") {
    if (page === "bots") botSelected = Math.min(Math.max(0, bots().length - 1), botSelected + 1);
    else selected = Math.min(MENU.length - 1, selected + 1);
  } else if (name === "left" || name === "right") {
    const i = MENU.findIndex(x => x[0] === page);
    page = MENU[(i + (name === "right" ? 1 : MENU.length - 1)) % MENU.length][0];
  } else if (name === "return" || name === "enter") {
    if (page === "bots") actionBot("s");
    else page = MENU[selected][0];
  } else if (name === "n") createBot();
  else if (name === "r") { metrics = null; notice = "Đã yêu cầu làm mới."; }
  else if (page === "bots" && ["s","a","l","d"].includes(name)) actionBot(name);
  else if (page === "bots" && name === "r") actionBot("r");
  else if (/^[1-5]$/.test(name)) { selected = Number(name) - 1; page = MENU[selected][0]; }
  render();
}
async function refreshMetrics() {
  try { metrics = await collectDeviceMetrics(); lastRefresh = Date.now(); } catch {}
}
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(poll);
  process.stdin.removeListener("keypress", onKey);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  clear();
  line("Đang dừng các bot do TUI quản lý...");
  try { await manager.stopAll(); } catch {}
  line("TUI đã đóng.");
  rl.close();
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.error("TUI cần Terminal tương tác. Chạy: npm run tui");
  process.exit(1);
}
process.stdin.on("keypress", onKey);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
refreshMetrics().finally(render);
const poll = setInterval(() => {
  if (page === "system" && Date.now() - lastRefresh > 2500) refreshMetrics().then(render);
  else if (page === "dashboard" || page === "bots" || page === "logs") render();
}, 1500);
render();
