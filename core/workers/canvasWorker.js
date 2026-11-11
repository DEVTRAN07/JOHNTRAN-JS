const { parentPort } = require("worker_threads");
const fs = require("fs");

let configError = null;
try {
  // Canvas modules read global.config during initialization. Load the same
  // configuration in this worker before importing any renderer.
  global.config = require("../config").load();
} catch (error) {
  configError = error;
  global.config = global.config || {};
}

async function renderToPath(type, data) {
  if (configError) {
    throw new Error("Canvas worker cannot load application config: " + configError.message);
  }

  switch (type) {
    case "menu": {
      const { renderMenuGrid } = require("../canvas/menu");
      return renderMenuGrid(data || {});
    }
    case "music-grid": {
      const { renderSearchGrid } = require("../canvas/music");
      const payload = data || {};
      return renderSearchGrid(payload.query || "", payload.tracks || [], payload.options || {});
    }
    case "music-nowplaying": {
      const { renderNowPlaying } = require("../canvas/music");
      const payload = data || {};
      return renderNowPlaying(payload.track || {}, payload.sourceLabel || "");
    }
    case "tuTien-card": {
      const { render } = require("../canvas/tuTien");
      return render(data || {});
    }
    case "vip-card": {
      const { renderVipCard } = require("../canvas/vip");
      return renderVipCard(data || {});
    }
    case "card": {
      const { renderCardToFile } = require("../canvas");
      return renderCardToFile(data || {});
    }
    default:
      throw new Error("Canvas worker không hỗ trợ loại render: " + String(type));
  }
}

async function handleMessage(payload) {
  let outputPath;
  try {
    outputPath = await renderToPath(payload?.type, payload?.data);
    if (typeof outputPath !== "string" || !fs.existsSync(outputPath)) {
      throw new Error("Canvas renderer không tạo được file đầu ra");
    }

    const buffer = fs.readFileSync(outputPath);
    if (!buffer.length) throw new Error("Canvas renderer tạo file rỗng");
    return { ok: true, data: { buffer } };
  } finally {
    if (outputPath) {
      try { fs.unlinkSync(outputPath); } catch { /* temporary file already removed */ }
    }
  }
}

parentPort.on("message", async (payload) => {
  try {
    parentPort.postMessage(await handleMessage(payload));
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || ""
    });
  }
});
