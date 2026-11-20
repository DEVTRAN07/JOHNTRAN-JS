const music = require("./index");

async function getLyric(providerName, trackId) {
  const provider = music.getProvider(providerName);
  if (typeof provider.getLyric !== "function") {
    const error = new Error(`Nguồn ${provider.label} chưa hỗ trợ lời bài hát. Hãy dùng lệnh khác (vd: /lyric với Zing).`);
    error.notAvailable = true;
    throw error;
  }
  const lyric = await provider.getLyric(trackId);
  if (!lyric || !lyric.trim()) {
    const error = new Error(`Bài hát này chưa có lời bài hát trên ${provider.label}.`);
    error.notAvailable = true;
    throw error;
  }
  return lyric.split("\n").filter((line) => line.trim() !== "");
}

async function getChart(providerName) {
  const provider = music.getProvider(providerName);
  if (typeof provider.getChart !== "function") {
    const error = new Error(`Nguồn ${provider.label} chưa hỗ trợ bảng xếp hạng.`);
    error.notAvailable = true;
    throw error;
  }
  const tracks = await provider.getChart();
  if (!tracks || tracks.length === 0) {
    const error = new Error(`Chưa lấy được bảng xếp hạng từ ${provider.label}.`);
    error.noResults = true;
    throw error;
  }
  return tracks;
}

module.exports = { getLyric, getChart };
