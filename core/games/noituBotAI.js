"use strict";

const engine = require("./noituEngine");

const OPENING_PHRASES = Object.freeze([
  "học sinh", "bông hoa", "bầu trời", "trường học", "bóng đá",
  "nước biển", "cây xanh", "cá voi", "mưa rào", "bàn học"
]);

// Keys use the engine's accent-insensitive syllable normalization.
const REPLY_BANK = Object.freeze({
  sinh: ["sinh viên", "sinh nhật", "sinh học"],
  hoa: ["hoa hồng", "hoa quả", "hoa lá"],
  troi: ["trời xanh", "trời mưa", "trời nắng"],
  hoc: ["học tập", "học hành", "học phí"],
  da: ["đá bóng", "đá cầu", "đá quý"],
  bien: ["biển cả", "biển xanh", "biển đảo"],
  xanh: ["xanh mát", "xanh tươi", "xanh biếc"],
  voi: ["voi rừng", "voi con", "voi châu á"],
  rao: ["rào chắn", "rào cản", "rào giậu"],
  vien: ["viên chức", "viên mãn", "viên ngọc"],
  chuc: ["chức năng", "chức vụ", "chức trách"],
  nang: ["năng lượng", "năng suất", "năng động"],
  luong: ["lượng tử", "lượng giác"],
  tu: ["tử tế", "tử vi", "tử số"],
  te: ["tế nhị", "tế bào"],
  nhi: ["nhịp điệu", "nhị phân"],
  dieu: ["điệu nhạc", "điệu bộ", "điệu nhảy"],
  nhac: ["nhạc cụ", "nhạc sĩ"],
  cu: ["cụ thể", "cụ già"],
  the: ["thể thao", "thể chất"],
  thao: ["thao trường", "thao tác"],
  truong: ["trường đời", "trường học"],
  tap: ["tập trung", "tập luyện"],
  trung: ["trung tâm", "trung thực"],
  tam: ["tâm lý", "tâm hồn"],
  ly: ["lý tưởng", "lý do"],
  tuong: ["tưởng tượng", "tượng trưng"],
  thuc: ["thực tế", "thực hành"],
  hanh: ["hành động", "hành trình"],
  dong: ["đồng hồ", "đồng ý"]
});

function pickIndex(length, random = Math.random) {
  if (!length) return -1;
  return Math.max(0, Math.min(length - 1, Math.floor(random() * length)));
}

function chooseOpeningPhrase(random = Math.random) {
  return OPENING_PHRASES[pickIndex(OPENING_PHRASES.length, random)];
}

function chooseReply(session, random = Math.random) {
  const required = session?.currentPhrase?.last;
  if (!required) return null;
  const used = session.used || new Set();
  const candidates = (REPLY_BANK[required] || [])
    .map(engine.parsePhrase)
    .filter(Boolean)
    .filter(phrase => phrase.first === required && !used.has(phrase.normalized));
  const index = pickIndex(candidates.length, random);
  return index < 0 ? null : candidates[index];
}

module.exports = { OPENING_PHRASES, REPLY_BANK, chooseOpeningPhrase, chooseReply };
