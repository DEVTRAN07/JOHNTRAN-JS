"use strict";

const ROUND_SECONDS = 90;
const CORRECT_POINTS = 10;

const WORD_BANK = Object.freeze([
  { answer: "trí tuệ", clue: "Khả năng suy nghĩ, hiểu biết và nhận thức." },
  { answer: "học sinh", clue: "Người học tập tại trường phổ thông." },
  { answer: "mặt trời", clue: "Ngôi sao chiếu sáng và sưởi ấm Trái Đất." },
  { answer: "bầu trời", clue: "Khoảng không gian rộng lớn phía trên chúng ta." },
  { answer: "máy tính", clue: "Thiết bị dùng để xử lý thông tin và dữ liệu." },
  { answer: "bông hoa", clue: "Bộ phận thường có màu sắc đẹp của cây." },
  { answer: "cây xanh", clue: "Thực vật có thân, cành và lá." },
  { answer: "tình bạn", clue: "Mối quan hệ thân thiết giữa những người quý mến nhau." },
  { answer: "sáng tạo", clue: "Tạo ra ý tưởng hoặc sản phẩm mới mẻ." },
  { answer: "kiên trì", clue: "Bền bỉ theo đuổi mục tiêu, không dễ bỏ cuộc." },
  { answer: "thành công", clue: "Đạt được kết quả tốt như mong muốn." },
  { answer: "hạnh phúc", clue: "Trạng thái vui vẻ và hài lòng trong cuộc sống." },
  { answer: "đại dương", clue: "Vùng biển rộng lớn bao phủ phần lớn Trái Đất." },
  { answer: "quả bóng", clue: "Dụng cụ hình tròn thường dùng trong thể thao." },
  { answer: "cánh đồng", clue: "Khu đất rộng dùng để trồng lúa hoặc hoa màu." },
  { answer: "đồng hồ", clue: "Vật dụng dùng để xem giờ." },
  { answer: "ngôi sao", clue: "Thiên thể phát sáng trên bầu trời đêm." },
  { answer: "mùa hè", clue: "Mùa nóng nhất trong năm ở miền Bắc Việt Nam." },
  { answer: "việt nam", clue: "Tên đất nước hình chữ S." },
  { answer: "trường học", clue: "Nơi thầy cô dạy và học sinh học tập." },
  { answer: "gia đình", clue: "Nơi có những người thân yêu cùng gắn bó." },
  { answer: "bình minh", clue: "Khoảnh khắc mặt trời bắt đầu mọc." },
  { answer: "hoàng hôn", clue: "Khoảnh khắc mặt trời lặn cuối ngày." },
  { answer: "âm nhạc", clue: "Nghệ thuật sử dụng âm thanh và giai điệu." },
  { answer: "thư viện", clue: "Nơi lưu giữ và cho mượn sách." },
  { answer: "bảo vệ", clue: "Giữ gìn để tránh bị tổn hại." },
  { answer: "lòng tốt", clue: "Sự tử tế và sẵn lòng giúp đỡ người khác." },
  { answer: "ước mơ", clue: "Điều đẹp đẽ mà mỗi người mong muốn đạt được." },
  { answer: "khám phá", clue: "Tìm hiểu điều mới lạ chưa biết." },
  { answer: "môi trường", clue: "Không gian sống của con người và sinh vật." }
]);

const sessions = new Map();

function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}]/gu, "");
}

function shuffleLetters(answer, random = Math.random) {
  const letters = Array.from(String(answer || "").normalize("NFC").replace(/\s+/g, ""));
  if (letters.length < 2) return letters;

  let shuffled = letters.slice();
  for (let attempt = 0; attempt < 12; attempt++) {
    shuffled = letters.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.join("") !== letters.join("")) return shuffled;
  }

  // Deterministic fallback prevents a puzzle from accidentally showing the answer.
  return letters.slice(1).concat(letters[0]);
}

function choosePuzzle(session, random = Math.random) {
  const available = WORD_BANK.filter(item => !session.usedAnswers.has(normalizeAnswer(item.answer)));
  const pool = available.length ? available : WORD_BANK;
  const index = Math.max(0, Math.min(pool.length - 1, Math.floor(random() * pool.length)));
  const selected = pool[index];
  session.usedAnswers.add(normalizeAnswer(selected.answer));
  session.puzzle = {
    answer: selected.answer,
    clue: selected.clue,
    letters: shuffleLetters(selected.answer, random)
  };
  session.round += 1;
  return session.puzzle;
}

function remainingSeconds(session, now = Date.now()) {
  if (!session) return 0;
  return Math.max(0, Math.ceil((session.endsAt - now) / 1000));
}

function start(threadId, playerId, playerName = "Người chơi", avatarUrl = "", options = {}) {
  const key = String(threadId || "").trim();
  const uid = String(playerId || "").trim();
  if (!key || !uid) return { ok: false, code: "INVALID_CONTEXT" };

  const existing = sessions.get(key);
  if (existing?.status === "active" && remainingSeconds(existing, options.now ?? Date.now()) > 0) {
    return { ok: false, code: "RUNNING", session: existing };
  }

  const now = Number(options.now) || Date.now();
  const session = {
    threadId: key,
    playerId: uid,
    playerName: String(playerName || "Người chơi").slice(0, 32),
    requesterAvatarUrl: String(avatarUrl || ""),
    status: "active",
    startedAt: now,
    endsAt: now + ROUND_SECONDS * 1000,
    finishedAt: null,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    skipped: 0,
    wrong: 0,
    round: 0,
    usedAnswers: new Set(),
    puzzle: null
  };
  sessions.set(key, session);
  choosePuzzle(session, options.random || Math.random);
  return { ok: true, session };
}

function get(threadId) {
  return sessions.get(String(threadId || "")) || null;
}

function submit(threadId, playerId, answer, options = {}) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };

  const now = Number(options.now) || Date.now();
  if (remainingSeconds(session, now) <= 0) {
    finish(threadId, now);
    return { ok: false, code: "TIME_UP", session };
  }

  if (normalizeAnswer(answer) !== normalizeAnswer(session.puzzle?.answer)) {
    session.wrong += 1;
    return { ok: false, code: "WRONG", session, remaining: remainingSeconds(session, now) };
  }

  session.correct += 1;
  session.score += CORRECT_POINTS;
  session.streak += 1;
  session.bestStreak = Math.max(session.bestStreak, session.streak);
  const completedAnswer = session.puzzle.answer;
  choosePuzzle(session, options.random || Math.random);
  return {
    ok: true,
    code: "CORRECT",
    completedAnswer,
    points: CORRECT_POINTS,
    session,
    remaining: remainingSeconds(session, now)
  };
}

function skip(threadId, playerId, options = {}) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };

  const now = Number(options.now) || Date.now();
  if (remainingSeconds(session, now) <= 0) {
    finish(threadId, now);
    return { ok: false, code: "TIME_UP", session };
  }

  const skippedAnswer = session.puzzle.answer;
  session.skipped += 1;
  session.streak = 0;
  session.endsAt -= 5000;

  if (remainingSeconds(session, now) <= 0) {
    finish(threadId, now);
    return { ok: true, code: "TIME_UP", skippedAnswer, session, remaining: 0 };
  }

  choosePuzzle(session, options.random || Math.random);
  return {
    ok: true,
    code: "SKIPPED",
    skippedAnswer,
    session,
    remaining: remainingSeconds(session, now)
  };
}

function finish(threadId, now = Date.now()) {
  const session = get(threadId);
  if (!session) return null;
  if (session.status !== "active") return session;
  session.status = "finished";
  session.finishedAt = now;
  return session;
}

function stop(threadId, playerId, now = Date.now()) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(playerId || "")) return { ok: false, code: "NOT_PLAYER" };
  session.status = "stopped";
  session.finishedAt = now;
  return { ok: true, session };
}

function remove(threadId) {
  return sessions.delete(String(threadId || ""));
}

function clear() {
  sessions.clear();
}

module.exports = {
  ROUND_SECONDS,
  CORRECT_POINTS,
  WORD_BANK,
  normalizeAnswer,
  shuffleLetters,
  remainingSeconds,
  start,
  get,
  submit,
  skip,
  finish,
  stop,
  remove,
  clear
};
