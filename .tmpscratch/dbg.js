const { runInWorker } = require("/Users/devtran/Downloads/JOHNTRAN-JS/core/workerPool");
const fs = require("fs"); const path = require("path");
const { createCanvas } = require("canvas");
const canvas = createCanvas(120, 120);
canvas.getContext("2d").fillStyle = "#3366cc";
canvas.getContext("2d").fillRect(0, 0, 120, 120);
const buffer = canvas.toBuffer("image/png");
const dir = "/Users/devtran/Downloads/JOHNTRAN-JS/assets/cache/sticker";
fs.mkdirSync(dir, { recursive: true });
const srcPath = path.join(dir, "stk_src_dbg.png");
fs.writeFileSync(srcPath, buffer);
runInWorker("stickerWorker", {
  url: srcPath,
  frameId: 3,
  forceStatic: false,
  threadId: "test-thread",
  type: 0,
  apiToken: undefined
}, { timeout: 300000 }).then((r) => {
  console.log("WORKER-RESULT", JSON.stringify({ format: r.format, width: r.width, height: r.height, len: r.buffer.length, mime: r.mimeType }));
}).catch((e) => {
  console.error("WORKER-ERROR:", e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
});
