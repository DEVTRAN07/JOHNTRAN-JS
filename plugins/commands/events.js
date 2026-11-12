// /events — bật/tắt & quản lý bộ SỰ KIỆN tự động của bot
//   /events                      → trạng thái tất cả
//   /events <welcome|rank|guard|bye> on|off
//   /events guard allow <host>    → cho phép link (vd: vnexpress.net)
//   /events guard allowed         → xem danh sách host được phép
const { ThreadType } = require("zalo-client");

// Danh sách sự kiện cài sẵn — thêm event mới chỉ cần thêm 1 dòng ở đây
const EVENTS = [
  { key: "welcome", label: "👋 Chào thành viên mới", field: "event_welcome" },
  { key: "bye", label: "🚪 Tạm biệt thành viên rời nhóm", field: "event_bye" },
  { key: "rank", label: "🏆 Level/EXP theo tin nhắn", field: "event_rank" },
  { key: "guard", label: "🚨 Cảnh cáo link lạ & từ cấm", field: "event_guard" }
];

module.exports.config = {
  name: "events",
  aliases: ["event", "sk"],
  version: "1.0.0",
  role: 2,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Bật/tắt sự kiện tự động của bot (welcome, rank, guard, bye)",
  category: "Hệ thống",
  usage: "events [tên] on|off | events guard allow <host>",
  cooldowns: 3,
  dependencies: {}
};

module.exports.run = async function ({ api, event, args, Threads, reply }) {
  const { threadId, type } = event;

  if (type === ThreadType.User) {
    return reply.error("Lệnh chỉ dùng trong nhóm.");
  }

  const target = EVENTS.find((e) => e.key === (args[0] || "").toLowerCase());

  // ===== Không tham số → trạng thái tất cả =====
  if (!args[0] || !target) {
    const thread = (await Threads.getData(threadId)).data || {};
    const lines = EVENTS.map((e) => `• ${e.label}: ${thread[e.field] ? "BẬT ✅" : "TẮT ❌"}`);
    return reply.info(
      `Bật tắt: ${global.config.prefix}events <tên> on|off\n` +
      `Tên: ${EVENTS.map((e) => e.key).join(" | ")}`,
      {
        title: "🎛️ SỰ KIỆN NHÓM NÀY",
        rows: [{ label: "Trạng thái", lines }]
      }
    );
  }

  const action = (args[1] || "").toLowerCase();

  // ===== Guard: quản lý host được phép =====
  if (target.key === "guard" && (action === "allow" || action === "allowed" || action === "host" || action === "hosts")) {
    const thread = (await Threads.getData(threadId)).data || {};
    const list = Array.isArray(thread.guard_allowed_hosts) ? thread.guard_allowed_hosts : [];

    if (action === "allow" && args[2]) {
      const host = args[2].toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!list.includes(host)) list.push(host);
      thread.guard_allowed_hosts = list;
      await Threads.setData(threadId, thread);
      return reply.success(`Đã cho phép host: ${host}`);
    }

    return reply.info(
      `Thêm host: ${global.config.prefix}events guard allow <host>`,
      { title: "🔗 HOST ĐƯỢC PHÉP", rows: [{ label: "Danh sách", lines: list.length ? list.map((h) => `✅ ${h}`) : ["(chưa thêm host nào — chỉ dùng danh sách mặc định)"] }] }
    );
  }

  // ===== Bật/tắt =====
  if (action !== "on" && action !== "off") {
    return reply.error(`Thiếu trạng thái. Dùng: ${global.config.prefix}events ${target.key} on|off`);
  }

  const thread = (await Threads.getData(threadId)).data || {};
  thread[target.field] = action === "on";
  await Threads.setData(threadId, thread);

  return reply.success(`${target.label} đã ${action === "on" ? "BẬT" : "TẮT"}.`);
};
