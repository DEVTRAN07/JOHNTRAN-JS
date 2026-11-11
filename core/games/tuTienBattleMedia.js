"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const ffmpeg = require("ffmpeg-static");
const { createCanvas } = require("canvas");
const { enqueue } = require("../jobQueue");

const WIDTH = 640, HEIGHT = 360, FRAME_COUNT = 16;
const COLORS = { bg: "#080d20", gold: "#f7cf72", cyan: "#66d9ef", red: "#ff5b75", white: "#f5f7ff" };

function drawFrame(ctx, battle, entry, frame) {
  const t = frame / (FRAME_COUNT - 1);
  const attacker = battle.fighters.find((f) => f.uid === entry.uid) || battle.fighters[0];
  const defender = battle.fighters.find((f) => f.uid !== entry.uid) || battle.fighters[1];
  const hit = entry.action !== "defend" && !entry.dodged;
  const pulse = 0.5 + Math.sin(t * Math.PI * 6) * 0.5;
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#080d20"); bg.addColorStop(0.55, "#182044"); bg.addColorStop(1, "#090b18");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 48; i++) {
    const x = (i * 137 + frame * (i % 3 + 1) * 3) % WIDTH;
    const y = (i * 71 + frame * (i % 4 + 1) * 2) % HEIGHT;
    ctx.fillStyle = `rgba(255,220,140,${0.15 + pulse * 0.35})`;
    ctx.beginPath(); ctx.arc(x, y, (i % 3) + 1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.gold; ctx.font = "bold 25px sans-serif";
  ctx.fillText("DEVTRAN TIÊN TÔNG • TIÊN ĐẠO ĐẤU", WIDTH / 2, 42);
  ctx.font = "bold 20px sans-serif"; ctx.fillStyle = COLORS.white;
  ctx.fillText(attacker.name.slice(0, 18), 155, 105);
  ctx.fillText(defender.name.slice(0, 18), 485, 105);
  ctx.font = "15px sans-serif"; ctx.fillStyle = "#b8c3e8";
  ctx.fillText(attacker.realm, 155, 130); ctx.fillText(defender.realm, 485, 130);
  const radius = 43 + pulse * (hit ? 7 : 3);
  ctx.shadowBlur = 22; ctx.shadowColor = hit ? COLORS.red : COLORS.cyan;
  ctx.fillStyle = "#1e3764"; ctx.beginPath(); ctx.arc(155, 205, 43, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4d2546"; ctx.beginPath(); ctx.arc(485, 205, 43, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(155, 205, 47, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(485, 205, 47, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = COLORS.white; ctx.font = "bold 16px sans-serif";
  ctx.fillText("⚔", 155, 212); ctx.fillText("🛡", 485, 212);
  if (hit && frame >= 5 && frame <= 11) {
    const x = 205 + (frame - 5) * 43;
    ctx.save(); ctx.translate(x, 195 + Math.sin(frame) * 22); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = entry.critical ? COLORS.gold : COLORS.red;
    ctx.shadowBlur = 25; ctx.shadowColor = ctx.fillStyle;
    ctx.fillRect(-5, -30, 10, 60); ctx.restore();
  }
  const hpY = 275;
  const drawBar = (x, value, max, color) => {
    ctx.fillStyle = "#26304d"; ctx.fillRect(x, hpY, 180, 12);
    ctx.fillStyle = color; ctx.fillRect(x, hpY, 180 * Math.max(0, value / max), 12);
  };
  drawBar(65, attacker.hp, attacker.maxHp, COLORS.cyan);
  drawBar(395, defender.hp, defender.maxHp, COLORS.red);
  ctx.fillStyle = COLORS.white; ctx.font = "14px sans-serif";
  ctx.fillText(`HP ${attacker.hp}/${attacker.maxHp}`, 155, 305);
  ctx.fillText(`HP ${defender.hp}/${defender.maxHp}`, 485, 305);
  ctx.fillStyle = entry.critical ? COLORS.gold : COLORS.white;
  ctx.font = "bold 22px sans-serif";
  const title = entry.action === "defend" ? "HỘ THỂ CƯƠNG KHÍ" :
    entry.dodged ? "THÂN PHÁP NÉ TRÁNH!" :
    entry.critical ? "CHÍ MẠNG!!" : entry.skill.toUpperCase();
  ctx.fillText(title, WIDTH / 2, 345);
  if (frame >= 7 && frame <= 10 && hit) {
    ctx.font = "bold 36px sans-serif"; ctx.fillStyle = COLORS.gold;
    ctx.fillText(`-${entry.damage}`, 485, 170);
  }
}

async function renderBattleMedia(battle, entry) {
  if (!ffmpeg) throw new Error("ffmpeg-static chưa sẵn sàng");
  return enqueue("canvas", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "johntran-pvp-"));
    const canvas = createCanvas(WIDTH, HEIGHT), ctx = canvas.getContext("2d");
    try {
      for (let i = 0; i < FRAME_COUNT; i++) {
        drawFrame(ctx, battle, entry, i);
        await fs.writeFile(path.join(dir, `frame-${String(i).padStart(3, "0")}.png`), canvas.toBuffer("image/png"));
      }
      const input = path.join(dir, "frame-%03d.png");
      const gifPath = path.join(dir, "battle.gif");
      const videoPath = path.join(dir, "battle.mp4");
      await execFileAsync(ffmpeg, ["-y", "-framerate", "10", "-i", input, "-vf", "fps=10,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer", "-loop", "0", gifPath], { timeout: 30000 });
      await execFileAsync(ffmpeg, ["-y", "-framerate", "10", "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", "2", videoPath], { timeout: 30000 });
      return { gifPath, videoPath, thumbnailPath: path.join(dir, "frame-000.png"), cleanup: async () => fs.rm(dir, { recursive: true, force: true }) };
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }, { priority: 2 });
}

async function sendBattleMedia(api, event, battle, entry, options = {}) {
  const media = await renderBattleMedia(battle, entry);
  try {
    const gif = await api.sendMessage({ msg: "⚔️ Hiệu ứng chiêu thức", attachments: media.gifPath }, event.threadId, event.type);
    let videoSent = false;
    if (options.includeVideo && typeof api.uploadAttachment === "function" && typeof api.sendVideo === "function") {
      const [uploadedVideo, uploadedThumb] = await Promise.all([
        api.uploadAttachment(media.videoPath, event.threadId, event.type),
        api.uploadAttachment(media.thumbnailPath, event.threadId, event.type)
      ]);
      const video = Array.isArray(uploadedVideo) ? uploadedVideo.find((x) => x.fileType === "video") : null;
      const thumb = Array.isArray(uploadedThumb) ? uploadedThumb.find((x) => x.fileType === "image") : null;
      if (video?.fileUrl) {
        await api.sendVideo({ videoUrl: video.fileUrl, thumbnailUrl: thumb?.normalUrl || thumb?.hdUrl || "", duration: 2000, width: WIDTH, height: HEIGHT, msg: "🎬 Tóm tắt lượt đấu" }, event.threadId, event.type);
        videoSent = true;
      }
    }
    return { gif, videoSent };
  } finally {
    await media.cleanup();
  }
}

module.exports = { renderBattleMedia, sendBattleMedia, drawFrame, FRAME_COUNT, WIDTH, HEIGHT };
