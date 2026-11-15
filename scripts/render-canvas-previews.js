"use strict";

// Render real production canvas modules with deterministic sample data.
// Images are PNGs exactly as the bot attaches them; Zalo's surrounding chat UI
// and account-specific avatars are not part of the attachment bitmap.
const fs = require("node:fs");
const path = require("node:path");
const { renderCanvas } = require("../core/canvas/workerRender");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.resolve(process.env.CANVAS_PREVIEW_DIR || path.join(ROOT, "artifacts", "canvas-preview"));
const VERSION = require("../package.json").version;

function ensureOutput() {
  fs.mkdirSync(OUTPUT, { recursive: true });
}

async function saveWorker(name, type, data) {
  const temporary = await renderCanvas(type, data, { timeout: 60000, poolSize: 1 });
  const target = path.join(OUTPUT, name + ".png");
  try {
    fs.copyFileSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
  return target;
}

async function saveDirect(name, renderPromise, cleanup) {
  const temporary = await renderPromise;
  const target = path.join(OUTPUT, name + ".png");
  try {
    fs.copyFileSync(temporary, target);
  } finally {
    try { cleanup?.(temporary); } catch {}
  }
  return target;
}

async function main() {
  ensureOutput();

  const menuGroups = [
    { name: "Info", slug: "info", category: "Thông tin tài khoản" },
    { name: "Utility", slug: "public", category: "Tiện ích dùng chung" },
    { name: "Music", slug: "music", category: "Tìm kiếm và nghe nhạc" },
    { name: "Game", slug: "game", category: "Game và giải trí" },
    { name: "Tools", slug: "tools", category: "Công cụ xử lý tác vụ" },
    { name: "Anti", slug: "anti", category: "Bảo vệ nhóm" },
    { name: "Group", slug: "manager", category: "Quản lý thành viên" },
    { name: "Admin", slug: "admin", category: "Quản trị bot" },
    { name: "Bot", slug: "mybot", category: "Quản lý bot" },
    { name: "Test", slug: "test", category: "Chức năng thử nghiệm" },
    { name: "Special", slug: "hidden", category: "Chức năng đặc biệt" }
  ];

  const ranking = [
    { uid: "u1", name: "Quang Developer", count: 286, avatar: "" },
    { uid: "u2", name: "Minh Anh", count: 241, avatar: "" },
    { uid: "u3", name: "Hoàng Nam", count: 198, avatar: "" },
    { uid: "u4", name: "Linh Nguyễn", count: 166, avatar: "" },
    { uid: "u5", name: "Tuấn Khang", count: 143, avatar: "" },
    { uid: "u6", name: "Bảo Trân", count: 122, avatar: "" },
    { uid: "u7", name: "Gia Huy", count: 101, avatar: "" },
    { uid: "u8", name: "Đức Anh", count: 88, avatar: "" },
    { uid: "u9", name: "Phương Thảo", count: 76, avatar: "" },
    { uid: "u10", name: "Khánh Vy", count: 61, avatar: "" }
  ];

  const tracks = [
    { id: "1", title: "Một Ngày Nào Đó", artist: "JOHNTRAN Preview", duration: 214, thumbnail: "", plays: 128000, likes: 8400 },
    { id: "2", title: "Chạm Vào Nỗi Nhớ", artist: "Artist Two", duration: 187, thumbnail: "", plays: 98000, likes: 6900 },
    { id: "3", title: "Đêm Thành Phố", artist: "Artist Three", duration: 201, thumbnail: "", plays: 87000, likes: 5100 },
    { id: "4", title: "Lặng Im", artist: "Artist Four", duration: 196, thumbnail: "", plays: 76000, likes: 4200 },
    { id: "5", title: "Sau Cơn Mưa", artist: "Artist Five", duration: 223, thumbnail: "", plays: 65000, likes: 3900 },
    { id: "6", title: "Ngày Mới", artist: "Artist Six", duration: 182, thumbnail: "", plays: 54000, likes: 3300 }
  ];

  const jobs = [
    ["01-menu", "menu", {
      requesterName: "MrQ · Preview",
      requesterAvatarUrl: "",
      botVersion: VERSION,
      prefix: "/",
      page: 1,
      totalPages: 1,
      commands: menuGroups
    }],
    ["02-menu-folder", "menu-folder", {
      folderName: "Music",
      folderSlug: "music",
      folderDescription: "Tìm kiếm, khám phá và nghe nhạc trực tuyến",
      requesterName: "MrQ · Preview",
      requesterAvatarUrl: "",
      botVersion: VERSION
    }],
    ["03-topchat", "topchat", {
      title: "TOP CHAT HÔM NAY",
      subtitle: "NHÓM PREVIEW · 15/11/2026 · 10 THÀNH VIÊN",
      ranking
    }],
    ["04-status", "status", {
      botName: "JOHNTRAN",
      botAvatar: "",
      device: {
        platform: "darwin", release: "26.3",
        cpuCores: 10, cpuPercent: 18.4,
        ramUsed: 6.4 * 1024 ** 3, ramTotal: 16 * 1024 ** 3,
        diskUsed: 128 * 1024 ** 3, diskTotal: 512 * 1024 ** 3,
        txKBs: 84.6, rxKBs: 312.8
      },
      group: { name: "JOHNTRAN · Canvas Preview", enabled: true },
      uptime: "3 ngày 8 giờ 42 phút",
      version: VERSION
    }],
    ["06-music-grid", "music-grid", {
      query: "nhạc Việt trending",
      tracks,
      options: { page: 1, totalPages: 3, source: "SOUNDCLOUD" }
    }],
    ["07-music-nowplaying", "music-nowplaying", {
      track: {
        title: "Một Ngày Nào Đó",
        artist: "JOHNTRAN Preview",
        duration: 214,
        thumbnail: "",
        plays: 128000,
        source: "SoundCloud"
      },
      sourceLabel: "SOUNDCLOUD"
    }],
    ["08-reply-card-info", "vip-card", {
      theme: "info",
      icon: "ℹ️",
      title: "HƯỚNG DẪN SỬ DỤNG",
      subtitle: "Thông tin và cách dùng lệnh",
      rows: [{
        icon: "list",
        label: "CÁCH DÙNG",
        lines: [
          "/menu — mở danh mục chức năng",
          "/topchat — xem bảng xếp hạng nhóm",
          "/status — xem trạng thái bot",
          "/card — xem hồ sơ thành viên"
        ]
      }],
      footer: "JOHNTRAN"
    }],
    ["09-reply-card-success", "vip-card", {
      theme: "success",
      icon: "✅",
      title: "THÀNH CÔNG",
      subtitle: "Thao tác đã được xử lý",
      rows: [
        { icon: "check", strong: true, lines: ["Đã cập nhật cấu hình thành công"] },
        { label: "TRẠNG THÁI", lines: ["Hệ thống đang hoạt động bình thường"] }
      ],
      footer: "JOHNTRAN"
    }],
    ["10-reply-card-error", "vip-card", {
      theme: "error",
      icon: "❌",
      title: "KHÔNG THÀNH CÔNG",
      subtitle: "Có lỗi khi xử lý yêu cầu",
      rows: [{
        tone: "error",
        icon: "alert",
        strong: true,
        lines: ["Không thể xử lý dữ liệu mẫu", "Vui lòng kiểm tra cú pháp và thử lại"]
      }],
      footer: "JOHNTRAN"
    }],
    ["11-reply-card-warn", "vip-card", {
      theme: "warn",
      icon: "⚠️",
      title: "CẢNH BÁO",
      subtitle: "Vui lòng kiểm tra trước khi tiếp tục",
      rows: [{
        icon: "info",
        lines: ["Bạn cần quyền quản trị để sử dụng chức năng này"]
      }],
      footer: "JOHNTRAN"
    }],
    ["12-generic-card", "card", {
      chip: "JOHNTRAN",
      title: "THÔNG TIN HỆ THỐNG",
      subtitle: "Mẫu Generic Card tương thích ngược trong canvas worker",
      sections: [
        { title: "TRẠNG THÁI", lines: ["Bot đang hoạt động", "Tất cả dịch vụ mẫu đều sẵn sàng"] },
        { title: "THAO TÁC", lines: ["Dùng /menu để xem lệnh", "Dùng /status để xem thiết bị"] }
      ],
      footer: "JOHNTRAN · " + VERSION
    }]
  ];

  for (const [name, type, data] of jobs) {
    await saveWorker(name, type, data);
  }

  // /card directly invokes profileCard.render(), outside canvasWorker.
  const config = require("../core/config");
  global.config = typeof config.load === "function" ? config.load() : {};
  const profileCard = require("../core/canvas/profileCard");
  await saveDirect(
    "05-profile-card-command",
    profileCard.render({
      name: "MrQ · Preview",
      avatarBuffer: null,
      rows: [
        ["Sinh nhật", "01/01/2000"],
        ["Giới tính", "Không công khai"],
        ["Bạn bè", "Có"],
        ["Trạng thái", "Đang hoạt động"],
        ["UID", "100000000000001"]
      ],
      link: "devtran07"
    })
  );

  // Legacy renderers below are retained in the repository but are not mapped
  // in canvasWorker. They are shown separately as inactive/reference designs.
  const legacyProfile = require("../core/canvas/profile");
  await saveDirect(
    "13-legacy-profile-zalo-reference",
    legacyProfile.renderProfile({
      skin: "zalo",
      title: "MrQ · Preview",
      handle: "@devtran07",
      subtitle: "Mẫu hồ sơ legacy · không thấy command gọi trực tiếp",
      rows: [{ icon: "•", label: "UID", value: "100000000000001" }]
    }),
    legacyProfile.cleanup
  );

  await saveDirect(
    "14-legacy-avatar-reference",
    legacyProfile.renderAvatarCard({
      skin: "zalo",
      title: "MrQ · Preview",
      subtitle: "Mẫu avatar legacy · không thấy command gọi trực tiếp"
    }),
    legacyProfile.cleanup
  );

  fs.writeFileSync(path.join(OUTPUT, "README.txt"), [
    "JOHNTRAN-JS · ACTUAL CANVAS RENDERER PREVIEWS",
    "Repository source: current preview branch based on main.",
    "These PNGs were generated by the repository's actual canvas modules.",
    "They represent the image attachment bitmap sent to Zalo.",
    "The Zalo chat bubble/surrounding app UI is not part of the PNG.",
    "Account-specific avatars and album covers are blank placeholders.",
    "",
    "Active outputs:",
    "01 menu, 02 menu folder, 03 topchat, 04 status, 05 /card profile,",
    "06 music search, 07 now playing, 08-11 reply.card variants, 12 generic card.",
    "",
    "Reference only (not mapped into canvasWorker):",
    "13-14 legacy profile and avatar renderer previews."
  ].join("\n"), "utf8");

  const files = fs.readdirSync(OUTPUT).filter(file => file.endsWith(".png"));
  console.log("[CANVAS_PREVIEW] Rendered " + files.length + " PNG previews to " + OUTPUT);
}

main().catch(error => {
  console.error("[CANVAS_PREVIEW] " + (error.stack || error));
  process.exitCode = 1;
});
