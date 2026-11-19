"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas, loadImage } = require("canvas");
const theme = require("./theme");

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_CAPTION_CHARS = 2400;
const MAX_CAPTION_LINES = 28;

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

function localImageSource(attachment) {
  if (typeof attachment === "string") {
    return fs.existsSync(attachment) ? attachment : null;
  }

  if (!attachment || typeof attachment !== "object") return null;
  const filename = typeof attachment.filename === "string" ? attachment.filename : "";
  if (filename && fs.existsSync(filename)) return filename;
  if (Buffer.isBuffer(attachment.data)) return attachment.data;
  return null;
}

function extensionOf(attachment, source) {
  if (typeof attachment === "string") return path.extname(attachment).slice(1).toLowerCase();
  if (attachment?.filename) return path.extname(attachment.filename).slice(1).toLowerCase();
  return source && Buffer.isBuffer(source) ? "png" : "";
}

function cleanCaptionLines(ctx, caption, maxWidth) {
  const lines = [];
  for (const paragraph of String(caption).replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...theme.wrapText(ctx, paragraph, maxWidth));
  }
  return lines;
}

/**
 * Zalo ignores textProperties on image descriptions in its chat UI. Convert a
 * single local image + caption into one taller PNG so every caption word is
 * genuinely rendered in the Canvas bitmap. The original caption is not sent
 * as a second chat message.
 *
 * Real @mentions cannot be interactive inside an image. When this conversion
 * is used, @names remain visually present in the image but are no longer
 * Zalo notification mentions.
 */
async function composeImageCaption(message, options = {}) {
  const original = message && typeof message === "object" ? message : null;
  const caption = typeof original?.msg === "string" ? original.msg : "";
  const attachments = Array.isArray(original?.attachments)
    ? original.attachments
    : original?.attachments ? [original.attachments] : [];

  if (!original || !caption.trim() || attachments.length !== 1 || original.quote ||
      caption.length > MAX_CAPTION_CHARS) {
    return { payload: message, composed: false, tempFile: null };
  }

  // A Zalo placeholder such as "@." is meaningful only with live mention
  // metadata. Never turn an unresolved placeholder into artwork by accident.
  if (caption.includes("@.") && Array.isArray(original.mentions) && original.mentions.length) {
    return { payload: message, composed: false, tempFile: null };
  }

  const attachment = attachments[0];
  const source = localImageSource(attachment);
  if (!source || !IMAGE_EXTENSIONS.has(extensionOf(attachment, source))) {
    return { payload: message, composed: false, tempFile: null };
  }

  let tempFile = null;
  try {
    theme.initFonts();
    const image = await loadImage(source);
    if (!image.width || !image.height) {
      return { payload: message, composed: false, tempFile: null };
    }

    const maxWidth = Math.max(320, Math.min(1600, Number(options.maxWidth) || 1600));
    const width = Math.min(image.width, maxWidth);
    const imageScale = width / image.width;
    const imageHeight = Math.max(1, Math.round(image.height * imageScale));
    const designScale = width / 750;
    const paddingX = Math.round(28 * designScale);
    const paddingTop = Math.round(23 * designScale);
    const paddingBottom = Math.round(24 * designScale);
    const fontSize = Math.max(16, Math.min(25, 19.5 * designScale));
    const lineHeight = Math.round(fontSize * 1.48);
    const maxTextWidth = width - paddingX * 2;

    const measure = createCanvas(1, 1).getContext("2d");
    measure.font = Math.round(fontSize) + "px JT-Round-Bold";
    const lines = cleanCaptionLines(measure, caption, maxTextWidth);
    if (!lines.length || lines.length > MAX_CAPTION_LINES) {
      return { payload: message, composed: false, tempFile: null };
    }

    const panelHeight = paddingTop + paddingBottom + lineHeight * lines.length;
    const canvas = createCanvas(width, imageHeight + panelHeight);
    const ctx = canvas.getContext("2d");
    ctx.__jtRenderSeed = Math.floor(Math.random() * 0x7fffffff);
    try {
      ctx.antialias = "best";
      ctx.quality = "best";
      ctx.patternQuality = "best";
    } catch { /* Optional node-canvas quality hints. */ }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, imageHeight);

    const palette = theme.getCardPalette();
    const panelY = imageHeight;
    const panelGradient = ctx.createLinearGradient(0, panelY, width, panelY + panelHeight);
    panelGradient.addColorStop(0, "#07182b");
    panelGradient.addColorStop(0.5, "#0b2038");
    panelGradient.addColorStop(1, "#061426");
    ctx.fillStyle = panelGradient;
    ctx.fillRect(0, panelY, width, panelHeight);

    const separator = ctx.createLinearGradient(0, panelY, width, panelY);
    separator.addColorStop(0, "rgba(98,220,255,0)");
    separator.addColorStop(0.18, theme.rgba(palette.accent || "#62dcff", 0.92));
    separator.addColorStop(0.82, "rgba(165,137,255,.82)");
    separator.addColorStop(1, "rgba(98,220,255,0)");
    ctx.fillStyle = separator;
    ctx.fillRect(0, panelY, width, Math.max(2, Math.round(1.5 * designScale)));

    ctx.save();
    roundedRect(
      ctx,
      Math.max(1, Math.round(7 * designScale)),
      panelY + Math.round(7 * designScale),
      width - Math.max(2, Math.round(14 * designScale)),
      panelHeight - Math.round(14 * designScale),
      Math.round(13 * designScale)
    );
    ctx.strokeStyle = "rgba(98,220,255,.20)";
    ctx.lineWidth = Math.max(1, designScale);
    ctx.stroke();
    ctx.restore();

    let y = panelY + paddingTop + fontSize;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line) {
        theme.drawMulticolorText(ctx, line, paddingX, y, {
          size: fontSize,
          font: Math.round(fontSize) + "px JT-Round-Bold",
          family: "JT-Round-Bold",
          color: palette.text || "#f4f9ff",
          align: "left",
          maxWidth: maxTextWidth,
          multicolor: true,
          colorSeed: "attachment-caption:" + index + ":" + line
        });
      }
      y += lineHeight;
    }

    const imageBuffer = canvas.toBuffer("image/png", { compressionLevel: 6 });
    tempFile = path.join(
      os.tmpdir(),
      "jt_caption_" + process.pid + "_" + Date.now() + "_" +
        Math.random().toString(36).slice(2, 8) + ".png"
    );
    await fs.promises.writeFile(tempFile, imageBuffer);

    const payload = { ...original, msg: "", attachments: [tempFile] };
    delete payload.mentions;
    delete payload.styles;
    delete payload.mentionNames;
    delete payload.captionMentions;
    return { payload, composed: true, tempFile };
  } catch (error) {
    if (tempFile) {
      try { await fs.promises.rm(tempFile, { force: true }); } catch {}
    }
    return { payload: message, composed: false, tempFile: null, error };
  }
}

async function cleanupComposedCaption(filePath) {
  if (!filePath) return;
  try { await fs.promises.rm(filePath, { force: true }); } catch {}
}

module.exports = { composeImageCaption, cleanupComposedCaption, _test: { cleanCaptionLines, localImageSource, extensionOf } };
