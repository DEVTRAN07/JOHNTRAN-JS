"use strict";

const theme = require("./theme");

const BOARD_SIZE = 16;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

function normalizeBoard(board) {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) return Array(CELL_COUNT).fill(null);
  return board.map(value => value === "X" || value === "O" ? value : null);
}

function cellLabel(value, index) {
  return value === "X" || value === "O"
    ? value
    : String(index + 1).padStart(3, "0");
}

function drawText(ctx, value, x, y, scale, options = {}) {
  const size = Math.max(8, Math.round((options.size || 18) * scale));
  ctx.save();
  ctx.font = (options.weight || 600) + " " + size + "px " + (options.family || "Arial, sans-serif");
  const requestedColor = options.color || theme.PALETTE.ink2;
  const content = String(value ?? "");
  const words = content.match(/[\p{L}\p{N}]+/gu) || [];
  const semanticColor = [theme.PALETTE.green, theme.PALETTE.red, theme.PALETTE.gold].includes(requestedColor);
  ctx.shadowColor = options.shadow ? "rgba(0,0,0,.45)" : "transparent";
  ctx.shadowBlur = options.shadow ? Math.round(5 * scale) : 0;
  theme.drawMulticolorText(ctx, content, x, y, {
    font: ctx.font,
    color: requestedColor,
    align: options.align || "left",
    baseline: options.baseline || "alphabetic",
    maxWidth: options.maxWidth,
    multicolor: !semanticColor && (words.length > 1 || words.some(word => Array.from(word).length > 1))
  });
  ctx.restore();
}

function drawPlayerPanel(ctx, player, symbol, x, y, width, height, active, scale) {
  const palette = theme.PALETTE;
  const color = symbol === "X" ? "#62d9ff" : "#e5b94f";
  theme.panel(ctx, x, y, width, height, Math.round(14 * scale), active ? color : palette.accent);
  const chipSize = Math.round(48 * scale);
  const chipX = x + Math.round(14 * scale);
  const chipY = y + Math.round(13 * scale);
  theme.roundRect(ctx, chipX, chipY, chipSize, chipSize, Math.round(10 * scale));
  ctx.fillStyle = symbol === "X" ? "rgba(98,217,255,.16)" : "rgba(229,185,79,.16)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();
  drawText(ctx, symbol, chipX + chipSize / 2, chipY + chipSize * 0.70, scale, {
    size: 26, weight: 800, color, align: "center"
  });

  const name = player?.name || (player?.kind === "bot" ? "Bot AI" : "Đang chờ...");
  const label = player?.kind === "bot" ? "BOT AI" : player ? "NGƯỜI CHƠI" : "CHƯA CÓ ĐỐI THỦ";
  const textX = chipX + chipSize + Math.round(15 * scale);
  drawText(ctx, label, textX, y + Math.round(28 * scale), scale, {
    size: 10, weight: 700, color: active ? color : palette.mute
  });
  drawText(ctx, name, textX, y + Math.round(56 * scale), scale, {
    size: 18, weight: 700, color: palette.ink, maxWidth: width - (textX - x) - Math.round(12 * scale)
  });
  if (active) {
    drawText(ctx, "ĐANG ĐI", x + width - Math.round(15 * scale), y + Math.round(20 * scale), scale, {
      size: 9, weight: 800, color, align: "right"
    });
  }
}

function renderCaro(data = {}) {
  theme.initFonts();
  theme.ensureTheme();

  const session = data.session && typeof data.session === "object" ? data.session : {};
  const board = normalizeBoard(session.board);
  const players = session.players && typeof session.players === "object" ? session.players : {};
  const width = theme.WIDTH;
  const scale = width / 1080;
  const px = value => Math.round(value * scale);
  const height = px(1400);
  const { canvas, ctx } = theme.newCanvas(width, height);
  const palette = theme.PALETTE;

  theme.paintBackground(ctx, width, height);

  drawText(ctx, "JOHNTRAN  /  GAME CENTER", px(58), px(53), scale, {
    size: 12, weight: 800, color: palette.accent
  });
  drawText(ctx, "CỜ CARO", width / 2, px(112), scale, {
    size: 38, weight: 800, color: palette.ink, align: "center"
  });
  const modeLabel = session.mode === "solo" ? "SOLO  •  ĐẤU AI" : "PVP  •  2 NGƯỜI CHƠI";
  drawText(ctx, modeLabel, width / 2, px(148), scale, {
    size: 14, weight: 700, color: palette.ink2, align: "center"
  });
  drawText(ctx, "16 × 16  /  256 Ô  /  5 QUÂN LIÊN TIẾP ĐỂ THẮNG", width / 2, px(176), scale, {
    size: 10, weight: 600, color: palette.mute, align: "center"
  });

  const sideMargin = px(58);
  const playerGap = px(16);
  const playerY = px(204);
  const playerHeight = px(76);
  const playerWidth = (width - sideMargin * 2 - playerGap) / 2;
  const status = String(session.status || "active");
  drawPlayerPanel(
    ctx, players.X, "X", sideMargin, playerY, playerWidth, playerHeight,
    status === "active" && session.turnSymbol === "X", scale
  );
  drawPlayerPanel(
    ctx, players.O, "O", sideMargin + playerWidth + playerGap, playerY,
    playerWidth, playerHeight, status === "active" && session.turnSymbol === "O", scale
  );

  let turnStatus = "VÁN ĐÃ KẾT THÚC";
  let turnColor = palette.mute;
  if (status === "waiting") {
    turnStatus = "ĐANG CHỜ NGƯỜI CHƠI THỨ HAI";
    turnColor = palette.accent;
  } else if (status === "active") {
    const player = players[session.turnSymbol];
    turnStatus = "LƯỢT " + String(session.turnSymbol || "") + "  •  " +
      String(player?.name || (player?.kind === "bot" ? "Bot AI" : "Người chơi"));
    turnColor = session.turnSymbol === "X" ? "#62d9ff" : "#e5b94f";
  }
  theme.roundRect(ctx, px(58), px(294), width - px(116), px(34), px(10));
  ctx.fillStyle = "rgba(255,255,255,.035)";
  ctx.fill();
  drawText(ctx, turnStatus, width / 2, px(316), scale, {
    size: 13, weight: 800, color: turnColor, align: "center"
  });
  drawText(ctx, "NƯỚC ĐI: " + (Math.max(0, Number(session.moves) || 0)), width - px(75), px(316), scale, {
    size: 10, weight: 700, color: palette.ink2, align: "right"
  });

  const cellSize = px(50);
  const cellGap = px(3);
  const boardSize = BOARD_SIZE * cellSize + (BOARD_SIZE - 1) * cellGap;
  const boardX = Math.round((width - boardSize) / 2);
  const boardY = px(350);
  theme.panel(
    ctx,
    boardX - px(17),
    boardY - px(17),
    boardSize + px(34),
    boardSize + px(34),
    px(18),
    palette.accent
  );

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const index = row * BOARD_SIZE + col;
      const value = board[index];
      const x = boardX + col * (cellSize + cellGap);
      const y = boardY + row * (cellSize + cellGap);
      const color = value === "X" ? "#62d9ff" : value === "O" ? "#e5b94f" : "#74716a";

      ctx.save();
      theme.roundRect(ctx, x, y, cellSize, cellSize, px(6));
      ctx.fillStyle = value === "X"
        ? "rgba(98,217,255,.15)"
        : value === "O"
          ? "rgba(229,185,79,.15)"
          : "rgba(255,255,255,.035)";
      ctx.fill();
      ctx.strokeStyle = value ? color : "rgba(85,214,232,.24)";
      ctx.lineWidth = value ? Math.max(1.5, px(1.4)) : Math.max(1, px(0.8));
      ctx.stroke();
      ctx.restore();

      const label = cellLabel(value, index);
      drawText(ctx, label, x + cellSize / 2, y + cellSize * 0.66, scale, {
        size: value ? 25 : 13,
        weight: value ? 800 : 600,
        color: value ? color : palette.mute,
        align: "center"
      });
    }
  }

  const footerY = px(1260);
  const legendCell = px(30);
  const legendGap = px(12);
  const legendX = px(94);
  for (const item of [
    { symbol: "X", color: "#62d9ff", x: legendX },
    { symbol: "O", color: "#e5b94f", x: legendX + px(125) }
  ]) {
    theme.roundRect(ctx, item.x, footerY - px(22), legendCell, legendCell, px(7));
    ctx.fillStyle = item.symbol === "X" ? "rgba(98,217,255,.16)" : "rgba(229,185,79,.16)";
    ctx.fill();
    ctx.strokeStyle = item.color;
    ctx.lineWidth = Math.max(1, px(1));
    ctx.stroke();
    drawText(ctx, item.symbol, item.x + legendCell / 2, footerY - px(1), scale, {
      size: 17, weight: 800, color: item.color, align: "center"
    });
    drawText(ctx, item.symbol + "  /  " + (item.symbol === "X" ? "QUÂN X" : "QUÂN O"),
      item.x + legendCell + legendGap, footerY - px(1), scale, {
        size: 11, weight: 700, color: palette.ink2
      });
  }
  drawText(ctx, "Ô TRỐNG HIỂN THỊ SỐ 001–256  •  GỬI SỐ VÀO CHAT ĐỂ ĐÁNH",
    width - px(58), footerY + px(34), scale, {
      size: 10, weight: 700, color: palette.accent, align: "right"
    });
  drawText(ctx, "JOHNTRAN  •  CARO BOARD", width / 2, px(1368), scale, {
    size: 9, weight: 600, color: palette.mute, align: "center"
  });

  return theme.save(canvas, "caro");
}

module.exports = {
  BOARD_SIZE,
  CELL_COUNT,
  renderCaro,
  _test: { normalizeBoard, cellLabel }
};
