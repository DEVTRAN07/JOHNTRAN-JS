"use strict";

const nativeCore = require("../../../../native");

const BOARD_SIZE = 16;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const WIN_LENGTH = 5;
const DIRECTIONS = Object.freeze([[0, 1], [1, 0], [1, 1], [1, -1]]);

function createBoard() {
  return Array(CELL_COUNT).fill(null);
}

function inside(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function checkWinnerFallback(board, cellIndex, symbol) {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) return false;
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= CELL_COUNT) return false;
  const row = Math.floor(cellIndex / BOARD_SIZE);
  const col = cellIndex % BOARD_SIZE;

  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const direction of [-1, 1]) {
      let r = row + dr * direction;
      let c = col + dc * direction;
      while (inside(r, c) && board[r * BOARD_SIZE + c] === symbol) {
        count += 1;
        r += dr * direction;
        c += dc * direction;
      }
    }
    if (count >= WIN_LENGTH) return true;
  }
  return false;
}

function isRustBoard(board) {
  return Array.isArray(board) &&
    board.length === CELL_COUNT &&
    board.every(value => value === null || value === "X" || value === "O");
}

function checkWinner(board, cellIndex, symbol) {
  if (isRustBoard(board) &&
      Number.isInteger(cellIndex) &&
      cellIndex >= 0 && cellIndex < CELL_COUNT &&
      (symbol === "X" || symbol === "O")) {
    const nativeResult = nativeCore.tryCaroCheckWinner(board, cellIndex, symbol);
    if (nativeResult.used) return Boolean(nativeResult.value);
  }
  return checkWinnerFallback(board, cellIndex, symbol);
}

function placeMove(board, cellNumber, symbol) {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) {
    return { ok: false, code: "INVALID_BOARD" };
  }
  const cell = Number(cellNumber);
  if (!Number.isInteger(cell) || cell < 1 || cell > CELL_COUNT) {
    return { ok: false, code: "OUT_OF_RANGE" };
  }
  if (symbol !== "X" && symbol !== "O") {
    return { ok: false, code: "INVALID_SYMBOL" };
  }

  const index = cell - 1;
  if (board[index] !== null) return { ok: false, code: "OCCUPIED" };

  if (isRustBoard(board)) {
    const nativeResult = nativeCore.tryCaroEvaluateMove(board, index, symbol);
    if (nativeResult.used &&
        nativeResult.value &&
        typeof nativeResult.value.won === "boolean" &&
        typeof nativeResult.value.draw === "boolean") {
      board[index] = symbol;
      return { ok: true, cell, index, symbol, won: nativeResult.value.won, draw: nativeResult.value.draw };
    }
  }

  board[index] = symbol;
  const won = checkWinner(board, index, symbol);
  const draw = !won && board.every(value => value !== null);
  return { ok: true, cell, index, symbol, won, draw };
}

function findImmediateMove(board, symbol) {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (board[index] !== null) continue;
    board[index] = symbol;
    const wins = checkWinner(board, index, symbol);
    board[index] = null;
    if (wins) return index + 1;
  }
  return null;
}

function buildWindows() {
  const windows = [];
  for (const [dr, dc] of DIRECTIONS) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const endRow = row + dr * (WIN_LENGTH - 1);
        const endCol = col + dc * (WIN_LENGTH - 1);
        if (!inside(endRow, endCol)) continue;
        const cells = [];
        for (let offset = 0; offset < WIN_LENGTH; offset += 1) {
          cells.push((row + dr * offset) * BOARD_SIZE + col + dc * offset);
        }
        windows.push(cells);
      }
    }
  }
  return windows;
}

const WINDOWS = buildWindows();

function chooseAiMoveFallback(board, aiSymbol = "O") {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) return null;
  if (aiSymbol !== "X" && aiSymbol !== "O") return null;
  const opponent = aiSymbol === "X" ? "O" : "X";

  const winNow = findImmediateMove(board, aiSymbol);
  if (winNow !== null) return winNow;

  const blockNow = findImmediateMove(board, opponent);
  if (blockNow !== null) return blockNow;

  const attackWeight = [0, 4, 32, 300, 30000];
  const defenceWeight = [0, 6, 48, 420, 36000];
  const scores = new Float64Array(CELL_COUNT);

  for (const window of WINDOWS) {
    let own = 0;
    let enemy = 0;
    const empty = [];
    for (const index of window) {
      const value = board[index];
      if (value === aiSymbol) own += 1;
      else if (value === opponent) enemy += 1;
      else empty.push(index);
    }
    if (!empty.length || (own && enemy)) continue;

    const weight = own ? attackWeight[own] : defenceWeight[enemy];
    for (const index of empty) scores[index] += weight;
  }

  let bestIndex = null;
  let bestScore = -Infinity;
  const center = (BOARD_SIZE - 1) / 2;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (board[index] !== null) continue;
    const row = Math.floor(index / BOARD_SIZE);
    const col = index % BOARD_SIZE;
    const distance = Math.abs(row - center) + Math.abs(col - center);
    let neighbors = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const r = row + dr;
        const c = col + dc;
        if (inside(r, c) && board[r * BOARD_SIZE + c]) neighbors += 1;
      }
    }
    const score = scores[index] + neighbors * 1.5 - distance * 0.05;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex === null ? null : bestIndex + 1;
}

function chooseAiMove(board, aiSymbol = "O") {
  if (isRustBoard(board) && (aiSymbol === "X" || aiSymbol === "O")) {
    const nativeResult = nativeCore.tryCaroChooseAiMove(board, aiSymbol);
    if (nativeResult.used) {
      return nativeResult.value == null ? null : Number(nativeResult.value);
    }
  }
  return chooseAiMoveFallback(board, aiSymbol);
}

module.exports = {
  BOARD_SIZE,
  CELL_COUNT,
  WIN_LENGTH,
  createBoard,
  checkWinner,
  placeMove,
  chooseAiMove,
  getNativeDiagnostics: nativeCore.getGameCoreDiagnostics,
  __test: { checkWinnerFallback, chooseAiMoveFallback }
};
