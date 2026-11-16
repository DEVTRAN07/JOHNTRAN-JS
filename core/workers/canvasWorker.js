const fs = require("fs");
const { parentPort } = require("worker_threads");
let configError = null;
try { global.config = require("../config").load(); }
catch (error) { configError = error; global.config = global.config || {}; }

async function renderToPath(type, data) {
  if (configError) throw new Error("Canvas worker cannot load application config: " + configError.message);
  await require("../canvas/prepareRequesterAvatar").prepareCanvasAvatars(type, data || {});
  switch (type) {
    case "menu": return require("../canvas/menu").renderMenuGrid(data || {});
    case "menu-folder": return require("../canvas/menu").renderFolderCard(data || {});
    case "status": return require("../canvas/status").renderStatus(data || {});
    case "bot-groups": return require("../canvas/botGroups").renderBotGroups(data || {});
    case "topchat": return require("../canvas/topchat").renderTopChat(data || {});
    case "music-grid": {
      const p = data || {};
      return require("../canvas/music").renderSearchGrid(p.query || "", p.tracks || [], p.options || {});
    }
    case "music-nowplaying": {
      const p = data || {};
      return require("../canvas/music").renderNowPlaying(p.track || {}, p.sourceLabel || "");
    }
    case "vip-card": return require("../canvas/vip").renderVipCard(data || {});
    case "stats": return require("../canvas/monitoring").renderStatsCard(data || {});
    case "jobs": return require("../canvas/monitoring").renderJobsCard(data || {});
    case "card": return require("../canvas").renderCardToFile(data || {});
    default: throw new Error("Canvas worker không hỗ trợ loại render: " + String(type));
  }
}
async function handleMessage(payload) {
  let outputPath;
  try {
    outputPath = await renderToPath(payload?.type, payload?.data);
    if (typeof outputPath !== "string" || !fs.existsSync(outputPath)) throw new Error("Canvas renderer không tạo được file đầu ra");
    const buffer = fs.readFileSync(outputPath);
    if (!buffer.length) throw new Error("Canvas renderer tạo file rỗng");
    return { ok: true, data: { buffer } };
  } finally { if (outputPath) { try { fs.unlinkSync(outputPath); } catch {} } }
}
parentPort.on("message", async payload => {
  try { parentPort.postMessage(await handleMessage(payload)); }
  catch (error) { parentPort.postMessage({ ok: false, error: error?.message || String(error), stack: error?.stack || "" }); }
});
