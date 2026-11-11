const fs = require("fs");
const path = require("path");
const os = require("os");
const { runInWorker } = require("../workerPool");

// Helper: gọi canvasWorker, nhận buffer PNG, viết ra file tạm, trả về đường dẫn.
// Dùng chung cho menu và nhạc — tránh render canvas trên main thread.
async function renderCanvas(type, data, options = {}) {
  const result = await runInWorker("canvasWorker", { type, data }, {
    timeout: options.timeout || 60000,
    size: options.poolSize
  });
  if (!result || !result.buffer) {
    throw new Error("Worker khong tra ve buffer");
  }
  const buf = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer);
  const filePath = path.join(
    os.tmpdir(),
    "jt_" + type + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6) + ".png"
  );
  fs.writeFileSync(filePath, buf);
  return filePath;
}

module.exports = { renderCanvas };
