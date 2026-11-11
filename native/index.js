"use strict";
const path = require("path");
const fs = require("fs");

const NATIVE_DIR = path.resolve(__dirname);

function tryLoad(crateDir, addon) {
  const p = path.join(NATIVE_DIR, crateDir, addon);
  try {
    if (!fs.existsSync(p)) return { ok: false, err: new Error("missing: " + p) };
    const mod = require(p);
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, err };
  }
}

const stickerNative = tryLoad("sticker-rs", "sticker_rs.node");
const canvasNative = tryLoad("canvas-rs", "canvas_rs.node");
const ffmpegNative = tryLoad("ffmpeg-rs", "ffmpeg_rs.node");

function wrap(fn) {
  return async function (options) {
    let lastErr;
    if (fn.native && fn.native.mod) {
      try { return fn.native.mod[fn.name](options); } catch (err) { lastErr = err; }
    }
    if (fn.fallback) { return fn.fallback(options); }
    throw lastErr || new Error("native module unavailable and no js fallback");
  };
}

async function jsEncodeWebp(options) {
  const Jimp = require("jimp");
  const image = await Jimp.read(options.buffer);
  const w = options.width || image.getWidth();
  const h = options.height || image.getHeight();
  image.scaleToFit(w, h);
  const buf = await image.getBufferAsync(Jimp.MIME_PNG);
  return { buffer: buf, format: "png", width: image.getWidth(), height: image.getHeight(), size: buf.length };
}

async function jsEncodeGif(options) {
  return jsEncodeWebp(options);
}

async function jsEncodeSticker(options) {
  return jsEncodeWebp(options);
}

async function jsRenderCard(options) {
  const { createCanvas } = require("canvas");
  const width = options.width || 1000;
  const height = options.height || 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = options.theme ? "#0b0e14" : "#0b0e14";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#eef2f8";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(options.title || "JOHN TRAN", 56, 120);
  if (options.subtitle) {
    ctx.font = "26px sans-serif";
    ctx.fillStyle = "#8b98ad";
    ctx.fillText(options.subtitle, 56, 170);
  }
  const buf = canvas.toBuffer("image/png");
  return { buffer: buf, format: "png", width, height, size: buf.length };
}

async function jsProbe(input) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, meta) => {
      if (err) return reject(err);
      const v = meta.streams.find((s) => s.codec_type === "video");
      resolve({
        duration: meta.duration || 0,
        width: v ? v.width : null,
        height: v ? v.height : null,
        codec: v ? v.codec_name : null,
        bitrate: meta.format ? meta.format.bit_rate || 0 : 0,
      });
    });
  });
}

async function jsDecodeFrame(input, timeSeconds) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    const seek = timeSeconds != null ? timeSeconds : 0;
    ffmpeg(input)
      .seekInput(seek)
      .frames(1)
      .noAudio()
      .outputFormat("image2pipe")
      .output("pipe:1", { vcodec: "png" })
      .on("error", reject)
      .on("end", () => {})
      .on("data", (chunk) => {
        resolve({ buffer: chunk, width: 0, height: 0, format: "png", size: chunk.length });
      })
      .run();
  });
}

async function jsEncode(input, output) {
  const ffmpeg = require("fluent-ffmpeg");
  ffmpeg.setFfmpegPath(require("ffmpeg-static"));
  return new Promise((resolve, reject) => {
    ffmpeg(input).output(output).on("error", reject).on("end", () => resolve({ output, size: 0, duration: 0 })).run();
  });
}

const exports = {
  encodeWebp: wrap({ name: "encode_webp", native: stickerNative, fallback: jsEncodeWebp }),
  encodeGif: wrap({ name: "encode_gif", native: stickerNative, fallback: jsEncodeGif }),
  encodeSticker: wrap({ name: "encode_sticker", native: stickerNative, fallback: jsEncodeSticker }),
  renderCard: wrap({ name: "render_card", native: canvasNative, fallback: jsRenderCard }),
  probe: wrap({ name: "probe", native: ffmpegNative, fallback: (o) => jsProbe(o) }),
  decodeFrame: wrap({ name: "decode_frame", native: ffmpegNative, fallback: (o) => jsDecodeFrame(o.input, o.timeSeconds) }),
  encode: wrap({ name: "encode", native: ffmpegNative, fallback: (o) => jsEncode(o.input, o.output) }),
  nativeAvailable: {
    sticker: stickerNative.ok,
    canvas: canvasNative.ok,
    ffmpeg: ffmpegNative.ok,
  },
  loadErrors: {
    sticker: stickerNative.ok ? null : String(stickerNative.err && stickerNative.err.message),
    canvas: canvasNative.ok ? null : String(canvasNative.err && canvasNative.err.message),
    ffmpeg: ffmpegNative.ok ? null : String(ffmpegNative.err && ffmpegNative.err.message),
  },
};

module.exports = exports;
