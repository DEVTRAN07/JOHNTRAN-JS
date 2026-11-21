"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../src/domain/games/engines/caroEngine");

function runParityFixtures() {
  const horizontal = engine.createBoard();
  for (const cell of [1, 17, 2, 18, 3, 19, 4, 20]) {
    const symbol = cell < 17 ? "X" : "O";
    engine.placeMove(horizontal, cell, symbol);
  }
  const horizontalWin = engine.placeMove(horizontal, 5, "X");

  const diagonal = engine.createBoard();
  for (const cell of [18, 35, 52, 69]) engine.placeMove(diagonal, cell, "O");
  const diagonalWin = engine.placeMove(diagonal, 86, "O");

  const immediateWin = engine.createBoard();
  for (const cell of [34, 35, 36, 37]) engine.placeMove(immediateWin, cell, "O");
  const aiWin = engine.chooseAiMove(immediateWin, "O");

  const immediateBlock = engine.createBoard();
  for (const cell of [50, 51, 52, 53]) engine.placeMove(immediateBlock, cell, "X");
  const aiBlock = engine.chooseAiMove(immediateBlock, "O");

  const boundary = engine.createBoard();
  for (const cell of [15, 16, 17, 18]) engine.placeMove(boundary, cell, "X");
  const boundaryMove = engine.placeMove(boundary, 19, "X");

  return {
    horizontalWin,
    horizontalBoard: horizontal,
    diagonalWin,
    diagonalBoard: diagonal,
    aiWin,
    aiBlock,
    boundaryMove,
    boundaryBoard: boundary
  };
}

test("Caro Rust addon loads all migrated domain operations", t => {
  const diagnostics = engine.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Caro Rust engine is inactive");
  assert.ok(diagnostics.exports.includes("caroCheckWinner") || diagnostics.exports.includes("caro_check_winner"));
});

test("Caro Rust engine preserves results and mutations from the JavaScript fallback", t => {
  if (!engine.getNativeDiagnostics().loaded) {
    t.skip("native addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_CARO_ENGINE;
  try {
    process.env.JT_RUST_CARO_ENGINE = "0";
    const fallback = runParityFixtures();
    delete process.env.JT_RUST_CARO_ENGINE;
    const rust = runParityFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_CARO_ENGINE;
    else process.env.JT_RUST_CARO_ENGINE = previous;
  }
});
