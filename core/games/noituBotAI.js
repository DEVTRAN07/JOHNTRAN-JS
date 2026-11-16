"use strict";

const engine = require("./noituEngine");

const OPENING_PHRASES = Object.freeze([
  "học sinh",
  "bông hoa",
  "bầu trời",
  "trường học",
  "bóng đá",
  "nước biển",
  "cây xanh",
  "cá voi",
  "mưa rào",
  "bàn học"
]);

// Compact local reply graph keeps the AI response fast and deterministic
// offline. Every suggestion is still checked by the same engine as players.
const REPLY_BANK = Object.freeze({
  sinh: ["sinh viên", "sinh nhật", "sinh học"],
  hoa: ["hoa hồng", "hoa quả", "hoa lá"],
  trời: ["trời xanh", "trời mưa", "trời nắng"],
  học: ["học tập", "học hành", "học phí"],
  đá: ["đá bóng", "đá cầu", "đá quý"],
  biển: ["biển cả", "biển xanh", "biển đảo"],
  xanh: ["xanh mát", "xanh tươi", "xanh biếc"],
  voi: ["voi rừng", "voi con", "voi châu á"],
  rào: ["rào chắn", "rào cản", "rào giậu"]
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
