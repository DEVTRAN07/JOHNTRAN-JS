const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { renderCanvas } = require("../core/canvas/workerRender");
const workerPool = require("../core/workerPool");
const { TEMPLATE_PATH } = require("../core/canvas/ghepchu");

after(async () => {
  await workerPool.shutdown();
});

test("canvas worker renders a valid music card PNG", async () => {
  const outputPath = await renderCanvas(
    "music-nowplaying",
    {
      track: {
        title: "JOHNTRAN worker test",
        artist: "Regression Suite",
        duration: 42,
        thumbnail: ""
      },
      sourceLabel: "TEST"
    },
    { timeout: 20000, poolSize: 1 }
  );

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "rendered PNG should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "rendered file should have the PNG signature"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* already removed */ }
  }
});

test("canvas worker renders a valid SoundCloud search grid PNG", async () => {
  const outputPath = await renderCanvas(
    "music-grid",
    {
      query: "JOHNTRAN card test",
      tracks: [
        { id: "1", title: "Track One", artist: "Artist One", duration: 125, thumbnail: "", plays: 12000, likes: 250 },
        { id: "2", title: "Track Two", artist: "Artist Two", duration: 187, thumbnail: "", plays: 8000, likes: 300 }
      ],
      options: { page: 1, totalPages: 2, source: "SOUNDCLOUD" }
    },
    { timeout: 20000, poolSize: 1 }
  );

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "search card PNG should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "search card should have the PNG signature"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* already removed */ }
  }
});


test("canvas worker renders a valid topchat PNG", async () => {
  const outputPath = await renderCanvas("topchat", {
    title: "TOP CHAT TEST",
    subtitle: "TEST · 2026-11-12 · 2 TIN NHẮN",
    ranking: [
      { uid: "u1", name: "First", count: 2, avatar: "" },
      { uid: "u2", name: "Second", count: 1, avatar: "" }
    ]
  }, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});

test("canvas worker renders an enabled bot groups card", async () => {
  const outputPath = await renderCanvas("bot-groups", {
    botName: "JOHNTRAN Test",
    enabledCount: 2,
    groups: [
      { gid: "g1", name: "Nhóm đang bật A", avatar: "", totalMember: 20 },
      { gid: "g2", name: "Nhóm đang bật B", avatar: "", totalMember: 12 }
    ]
  }, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});

test("canvas worker renders the status card off the main thread", async () => {
  const outputPath = await renderCanvas("status", {
    botName: "JOHNTRAN",
    botAvatar: "",
    device: { cpuCores: 2, cpuPercent: 5, ramUsed: 1024, ramTotal: 2048 },
    group: { name: "Test group", enabled: true },
    uptime: "1 giờ",
    version: "4.0.0"
  }, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});


test("canvas worker renders a dedicated noitu welcome banner", async () => {
  const outputPath = await renderCanvas("noitu-guide", {}, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "Nối Từ welcome banner should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "Nối Từ welcome banner should be a PNG"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});


test("canvas worker renders the live ghép chữ game card", async () => {
  const outputPath = await renderCanvas("ghepchu", {
    status: "active",
    remainingSeconds: 84,
    score: 20,
    streak: 2,
    bestStreak: 2,
    correct: 2,
    skipped: 1,
    playerName: "Wuang",
    requesterAvatarUrl: "",
    letters: ["t", "r", "í", "t", "u", "ệ"],
    clue: "Khả năng suy nghĩ, hiểu biết và nhận thức.",
    version: "4.0.0",
    botName: "JOHNTRAN"
  }, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "ghép chữ card should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "ghép chữ card should be a PNG"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});

test("canvas worker renders the finished ghép chữ result card", async () => {
  const outputPath = await renderCanvas("ghepchu", {
    status: "finished",
    remainingSeconds: 0,
    score: 40,
    streak: 1,
    bestStreak: 3,
    correct: 4,
    skipped: 2,
    playerName: "Wuang",
    letters: [],
    clue: "",
    version: "4.0.0",
    botName: "JOHNTRAN"
  }, { timeout: 20000, poolSize: 1 });
  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});


test("uses the exact supplied ghép chữ screenshot as its canvas template", () => {
  assert.equal(
    fs.existsSync(TEMPLATE_PATH),
    true,
    "the reference screenshot template must be present in the repository"
  );
  assert.equal(
    TEMPLATE_PATH.endsWith("assets/games/ghepchu-template.jpg"),
    true
  );
});


test("canvas worker renders a square 16x16 Caro board with live X and O marks", async () => {
  const board = Array(256).fill(null);
  board[0] = "X";
  board[17] = "O";
  board[34] = "X";
  const outputPath = await renderCanvas("caro", {
    session: {
      mode: "pvp",
      status: "active",
      board,
      turnSymbol: "O",
      moves: 3,
      players: {
        X: { uid: "x-user", name: "Player X", kind: "human" },
        O: { uid: "o-user", name: "Player O", kind: "human" }
      }
    }
  }, { timeout: 20000, poolSize: 1 });

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 10000, "Caro board card should contain the full square grid");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch {}
  }
});
