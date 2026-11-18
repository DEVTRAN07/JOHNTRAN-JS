"use strict";

const { parentPort } = require("node:worker_threads");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function decodeQr(payload = {}) {
  const source = payload.buffer;
  const buffer = Buffer.isBuffer(source)
    ? source
    : Buffer.from(source?.data || source || []);

  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return null;
  }

  const Jimp = require("jimp");
  const jsQR = require("jsqr");
  const image = await Jimp.read(buffer);
  const bitmap = image?.bitmap;
  if (!bitmap?.data || !bitmap.width || !bitmap.height) return null;

  const decoded = jsQR(
    new Uint8ClampedArray(bitmap.data),
    bitmap.width,
    bitmap.height
  );
  return decoded?.data ? String(decoded.data) : null;
}

parentPort.on("message", async payload => {
  try {
    const data = await decodeQr(payload);
    parentPort.postMessage({ ok: true, data });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || ""
    });
  }
});
