"use strict";

const fs = require("fs");
const path = require("path");
const engine = require("./dhbcEngine");
const FILE = path.resolve(__dirname, "../../data/dhbc-questions.json");

function validateQuestion(input) {
  const q = input && typeof input === "object" ? input : {};
  const id = String(q.id || "").trim().toLowerCase();
  const answer = String(q.answer || "").trim();
  const clues = Array.isArray(q.clues) ? q.clues.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const symbols = Array.isArray(q.symbols) ? q.symbols.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const images = Array.isArray(q.images) ? q.images.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const hint = String(q.hint || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new Error("id chỉ gồm chữ thường, số và dấu gạch ngang (2-64 ký tự)");
  if (!answer || answer.length > 120) throw new Error("answer bắt buộc và tối đa 120 ký tự");
  if (clues.length < 2 || clues.length > 6) throw new Error("clues cần từ 2 đến 6 phần");
  if (symbols.length !== clues.length) throw new Error("symbols phải có số phần tử bằng clues");
  if (images.length && (images.length !== clues.length || images.some((url) => !/^https:\/\//i.test(url)))) throw new Error("images phải là danh sách URL HTTPS, có số phần tử bằng clues");
  if (!hint || hint.length > 240) throw new Error("hint bắt buộc và tối đa 240 ký tự");
  return { id, clues, symbols, images, answer, hint };
}
function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed.questions) && parsed.questions.length) {
      return parsed.questions.map(validateQuestion);
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return null;
}
function getAll() {
  return readFile() || engine.QUESTIONS.map((q) => ({ ...q, clues: [...q.clues], symbols: [...q.symbols] }));
}
function writeAll(questions) {
  if (!Array.isArray(questions) || questions.length < 1) throw new Error("Ngân hàng phải có ít nhất 1 câu hỏi");
  const clean = questions.map(validateQuestion);
  const ids = new Set();
  for (const q of clean) {
    if (ids.has(q.id)) throw new Error("ID câu hỏi bị trùng: " + q.id);
    ids.add(q.id);
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), questions: clean }, null, 2) + "\n", "utf8");
  fs.renameSync(temp, FILE);
  return clean;
}
function add(input) {
  const current = getAll();
  const question = validateQuestion(input);
  if (current.some((q) => q.id === question.id)) throw new Error("ID câu hỏi đã tồn tại");
  return writeAll([...current, question]);
}
function update(id, input) {
  const current = getAll();
  const index = current.findIndex((q) => q.id === String(id));
  if (index < 0) throw new Error("Không tìm thấy câu hỏi");
  const question = validateQuestion({ ...current[index], ...input, id: String(id) });
  current[index] = question;
  return writeAll(current);
}
function remove(id) {
  const current = getAll();
  const next = current.filter((q) => q.id !== String(id));
  if (next.length === current.length) return false;
  writeAll(next);
  return true;
}
module.exports = { FILE, getAll, writeAll, add, update, remove, validateQuestion };
