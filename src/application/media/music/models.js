const BRAND = "ᴶᴼᴴᴺ ᵀᴿᴬᴺ";

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  const minutes = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function createTrack({ id, title, artist, duration, thumbnail, source, sourceUrl, previewUrl, ...extra }) {
  return {
    id: String(id || ""),
    title: String(title || "Không rõ").trim(),
    artist: String(artist || "Không rõ").trim(),
    duration: Number(duration) || 0,
    thumbnail: thumbnail || "",
    source,
    sourceUrl: sourceUrl || "",
    previewUrl: previewUrl || "",
    ...extra
  };
}

function trackCard(track, index, total) {
  const duration = track.duration ? formatDuration(track.duration) : "--:--";
  const number = String(index + 1).padStart(2, " ");
  const counter = total ? ` (${index + 1}/${total})` : "";
  return [
    `${number}. ♪ ${track.title}`,
    `     ♫ ${track.artist}`,
    `     ⏱ ${duration} • 📡 ${track.source}${counter}`
  ].join("\n");
}

function trackHeader(query, tracks, sourceLabel) {
  const lines = [
    `╭─「 ${BRAND} • NHẠC 」`,
    `│ 🔎 Từ khóa: ${query}`,
    `│ 📡 Nguồn: ${sourceLabel}`,
    `│ 🎵 Tìm thấy: ${tracks.length} kết quả`,
    `╰──────────◆`
  ];
  return lines.join("\n");
}

function nowPlayingCard(track) {
  const duration = track.duration ? formatDuration(track.duration) : "--:--";
  return [
    `╭─「 ${BRAND} • ĐANG PHÁT 」`,
    `│ ♪ ${track.title}`,
    `│ ♫ ${track.artist}`,
    `│ ⏱ ${duration} • 📡 ${track.source}`,
    `╰──────────◆`
  ].join("\n");
}

function pickPrompt() {
  return `╭─「 ${BRAND} • HƯỚNG DẪN 」\n│ 💡 Trả lời số thứ tự để tải bài hát\n│ Ví dụ: 1\n╰──────────◆`;
}

module.exports = { BRAND, formatDuration, createTrack, trackCard, trackHeader, nowPlayingCard, pickPrompt };
