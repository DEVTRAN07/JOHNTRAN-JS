"use strict";

const QUESTIONS = Object.freeze([
  { id: "ca-ngua", clues: ["CÁ", "NGỰA"], answer: "cá ngựa", hint: "Một loài sinh vật biển" },
  { id: "banh-mi", clues: ["BÁNH", "MÌ"], answer: "bánh mì", hint: "Món ăn quen thuộc buổi sáng" },
  { id: "den-pin", clues: ["ĐÈN", "PIN"], answer: "đèn pin", hint: "Dùng để chiếu sáng khi mất điện" },
  { id: "mat-kinh", clues: ["MẮT", "KÍNH"], answer: "mắt kính", hint: "Vật dụng hỗ trợ thị lực" },
  { id: "may-bay", clues: ["MÁY", "BAY"], answer: "máy bay", hint: "Phương tiện di chuyển trên trời" },
  { id: "cau-vong", clues: ["CẦU", "VỒNG"], answer: "cầu vồng", hint: "Thường xuất hiện sau cơn mưa" },
  { id: "nuoc-mat", clues: ["NƯỚC", "MẮT"], answer: "nước mắt", hint: "Chảy ra khi khóc" },
  { id: "dong-ho", clues: ["ĐỒNG", "HỒ"], answer: "đồng hồ", hint: "Dùng để xem giờ" },
  { id: "da-bong", clues: ["ĐÁ", "BÓNG"], answer: "đá bóng", hint: "Môn thể thao vua" },
  { id: "ban-tay", clues: ["BÀN", "TAY"], answer: "bàn tay", hint: "Có năm ngón" },
  { id: "hoa-hong", clues: ["HOA", "HỒNG"], answer: "hoa hồng", hint: "Loài hoa tượng trưng cho tình yêu" },
  { id: "lua-trai", clues: ["LỬA", "TRẠI"], answer: "lửa trại", hint: "Hoạt động thường có trong cắm trại" },
  { id: "mua-da", clues: ["MƯA", "ĐÁ"], answer: "mưa đá", hint: "Hiện tượng thời tiết nguy hiểm" },
  { id: "ca-phe", clues: ["CÀ", "PHÊ"], answer: "cà phê", hint: "Thức uống giúp tỉnh táo" },
  { id: "xe-dap", clues: ["XE", "ĐẠP"], answer: "xe đạp", hint: "Phương tiện có hai bánh" },
  { id: "dau-bep", clues: ["ĐẦU", "BẾP"], answer: "đầu bếp", hint: "Người nấu ăn chuyên nghiệp" },
  { id: "chan-thanh", clues: ["CHÂN", "THÀNH"], answer: "chân thành", hint: "Thật lòng, không giả dối" },
  { id: "that-hoc", clues: ["THẤT", "HỌC"], answer: "thất học", hint: "Không được học hành đầy đủ" },
  { id: "bao-mat", clues: ["BẢO", "MẬT"], answer: "bảo mật", hint: "Giữ an toàn thông tin" },
  { id: "dien-thoai", clues: ["ĐIỆN", "THOẠI"], answer: "điện thoại", hint: "Thiết bị liên lạc cá nhân" },
  { id: "hoa-qua", clues: ["HOA", "QUẢ"], answer: "hoa quả", hint: "Tên gọi chung của trái cây" },
  { id: "mat-troi", clues: ["MẶT", "TRỜI"], answer: "mặt trời", hint: "Nguồn sáng tự nhiên ban ngày" },
  { id: "song-bien", clues: ["SÓNG", "BIỂN"], answer: "sóng biển", hint: "Chuyển động nhấp nhô trên đại dương" },
  { id: "trong-dong", clues: ["TRỐNG", "ĐỒNG"], answer: "trống đồng", hint: "Biểu tượng văn hóa Đông Sơn" }
]);

function normalizeAnswer(value) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}
function pickQuestion(used = [], random = Math.random) {
  const pool = QUESTIONS.filter((item) => !used.includes(item.id));
  const source = pool.length ? pool : QUESTIONS;
  return source[Math.floor(random() * source.length)];
}
function createSession(threadId, ownerId, displayName = "", random = Math.random) {
  const question = pickQuestion([], random);
  return {
    threadId: String(threadId), ownerId: String(ownerId), ownerName: String(displayName || ""),
    players: new Map([[String(ownerId), { uid: String(ownerId), name: String(displayName || "Player") }]]),
    question, questionNumber: 1, used: [question.id], revealed: new Set(),
    startedAt: Date.now(), status: "active"
  };
}
function join(session, uid, name = "") {
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  if (session.players.has(key)) return { ok: false, code: "ALREADY_JOINED" };
  session.players.set(key, { uid: key, name: String(name || "Player") });
  return { ok: true, count: session.players.size };
}
function leave(session, uid) {
  if (!session) return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  if (!session.players.has(key)) return { ok: false, code: "NOT_JOINED" };
  session.players.delete(key);
  return { ok: true, empty: session.players.size === 0 };
}
function checkAnswer(session, answer) {
  if (!session || session.status !== "active") return { correct: false, code: "NO_GAME" };
  return normalizeAnswer(answer) === normalizeAnswer(session.question.answer)
    ? { correct: true, answer: session.question.answer }
    : { correct: false, code: "WRONG" };
}
function hint(session) {
  const answer = session.question.answer;
  const chars = [...answer];
  const candidates = chars.map((char, index) => ({ char, index }))
    .filter(({ char, index }) => /[a-zA-ZÀ-ỹ]/.test(char) && !session.revealed.has(index));
  if (candidates.length) {
    const chosen = candidates[0];
    session.revealed.add(chosen.index);
  }
  return chars.map((char, index) => char === " " ? "   " : session.revealed.has(index) ? char.toUpperCase() : "＿").join("");
}
function nextQuestion(session, random = Math.random) {
  if (!session) return null;
  const question = pickQuestion(session.used, random);
  session.question = question;
  session.used.push(question.id);
  if (session.used.length > QUESTIONS.length / 2) session.used = session.used.slice(-Math.floor(QUESTIONS.length / 2));
  session.questionNumber += 1;
  session.revealed = new Set();
  return question;
}
module.exports = { QUESTIONS, normalizeAnswer, pickQuestion, createSession, join, leave, checkAnswer, hint, nextQuestion };
