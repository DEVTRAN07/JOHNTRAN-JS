"use strict";

const engine = require("../../core/games/tuTienEngine");

module.exports.config = {
  name: "tutien",
  aliases: ["tu-tien", "tiendao"],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Game tu tiên nhập vai: tu luyện, đột phá và phát triển cảnh giới",
  category: "Game",
  usage: "tutien [batdau|profile|tuluyen|dotpha|bang]",
  cooldowns: 2,
  dependencies: {}
};

const locks = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withUserLock(userId, task) {
  const key = String(userId);
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous.catch(() => {});
  try { return await task(); }
  finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function progressBar(value, max, size = 12) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}

function getPlayer(userData) {
  return engine.normalizePlayer(userData?.tuTien);
}

async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}

async function showProfile(api, event, player, name) {
  const need = engine.requiredCultivation(player);
  const percent = Math.min(100, Math.floor(player.cultivation / need * 100));
  return send(api, event,
    `╔═══ ☯ TIÊN ĐẠO VÔ HẠN ☯ ═══╗
👤 Đạo hữu: ${name || "Vô danh"}
🏯 Cảnh giới: ${engine.realmLabel(player)}
✨ Tu vi: ${player.cultivation}/${need}
[${progressBar(player.cultivation, need)}] ${percent}%
❤️ Sinh lực: ${player.hp}/${player.maxHp}
⚔️ Công kích: ${player.attack}  🛡️ Phòng ngự: ${player.defense}
💎 Linh thạch: ${player.spiritStones}
🏆 Thắng: ${player.wins}  ☠️ Bại: ${player.losses}
╚══════════════════════════╝
Dùng /tutien tuluyen để hấp thu linh khí.`
  );
}

module.exports.run = async function ({ args = [], event, api, Users, userData }) {
  const uid = String(event?.data?.uidFrom || "");
  if (!uid) return;
  const action = String(args[0] || "help").toLowerCase();
  const name = event?.data?.dName || event?.data?.name || "Đạo hữu";

  return withUserLock(uid, async () => {
    const stored = userData && typeof userData === "object" ? userData : (await Users.getData(uid))?.data || {};
    let player = stored.tuTien ? engine.normalizePlayer(stored.tuTien) : null;

    if (action === "batdau" || action === "start" || action === "begin") {
      if (player) return showProfile(api, event, player, name);
      player = engine.createPlayer();
      stored.tuTien = player;
      await Users.setData(uid, stored);
      await send(api, event, "🌌 Linh khí hội tụ...\n📜 Thiên Đạo đang ghi danh một phàm nhân...");
      await sleep(350);
      return send(api, event,
        `✨ ĐẠO LỘ ĐÃ MỞ! ✨
Ngươi đã bước chân vào con đường tu tiên.
🏯 Cảnh giới: ${engine.realmLabel(player)}
💎 Linh thạch khởi đầu: ${player.spiritStones}
📖 Gõ /tutien help để xem bí kíp.`
      );
    }

    if (!player) {
      return send(api, event, "📜 Ngươi chưa nhập đạo. Hãy dùng /tutien batdau để lập mệnh đăng!");
    }

    if (action === "profile" || action === "info" || action === "hoso") {
      return showProfile(api, event, player, name);
    }

    if (action === "tuluyen" || action === "tu-luyen" || action === "cultivate") {
      const result = engine.cultivate(player);
      if (!result.ok) {
        const seconds = Math.ceil(result.remainingMs / 1000);
        return send(api, event, `🧘 Đạo hữu đang vận công. Hãy tĩnh tâm thêm ${seconds}s rồi thử lại.`);
      }
      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "🌀 Đang vận chuyển chu thiên...\n🌫️ Linh khí quanh thân bắt đầu hội tụ...");
      await sleep(300);
      return send(api, event,
        `✨ HẤP THU LINH KHÍ THÀNH CÔNG!
━━━━━━━━━━━━━━━━
➕ Tu vi +${result.gain}
💎 Linh thạch +3
☯ Cảnh giới: ${engine.realmLabel(result.player)}
📊 ${progressBar(result.player.cultivation, result.required)} ${Math.min(100, Math.floor(result.player.cultivation / result.required * 100))}%
━━━━━━━━━━━━━━━━
Dùng /tutien dotpha khi tu vi đạt yêu cầu.`
      );
    }

    if (action === "dotpha" || action === "độtphá" || action === "breakthrough") {
      const result = engine.breakthrough(player);
      if (!result.ok && result.code === "NOT_READY") {
        return send(api, event, `⚠️ Tu vi chưa đủ để đột phá. Còn thiếu ${result.missing} điểm (cần ${result.required}).`);
      }
      if (!result.ok && result.code === "NEED_STONES") {
        return send(api, event, "💎 Không đủ 20 linh thạch để bày trận đột phá.");
      }
      if (!result.ok && result.code === "COOLDOWN") {
        return send(api, event, `⏳ Thiên cơ chưa đến. Hãy chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      }

      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "⚡ THIÊN KIẾP GIÁNG LÂM!\n🌩️ Lôi vân tụ hội, linh lực nghịch chuyển...");
      await sleep(450);
      if (result.maxRealm) {
        return send(api, event, "👑 Ngươi đã đứng trên đỉnh Tiên Đạo. Thiên Đạo không còn cảnh giới cao hơn!");
      }
      if (result.success) {
        return send(api, event,
          `🌟 ĐỘT PHÁ THÀNH CÔNG! 🌟
╔════════════════════╗
☯ Cảnh giới mới: ${engine.realmLabel(result.player)}
❤️ Sinh lực: ${result.player.hp}/${result.player.maxHp}
⚔️ Công kích: ${result.player.attack}
🛡️ Phòng ngự: ${result.player.defense}
╚════════════════════╝
Thiên địa dị tượng xuất hiện, đạo cơ càng thêm vững chắc!`
        );
      }
      return send(api, event,
        `💥 ĐỘT PHÁ THẤT BẠI!
Tâm ma quấy nhiễu, linh lực phản phệ.
Tu vi bị hao tổn, sinh lực còn ${result.player.hp}.
Hãy tích lũy thêm tu vi rồi thử lại.`
      );
    }

    if (action === "bang" || action === "help" || action === "menu") {
      return send(api, event,
        `☯ JOHNTRAN – TIÊN ĐẠO VÔ HẠN ☯
/tutien batdau  – Bước vào tiên đồ
/tutien profile – Xem hồ sơ tu sĩ
/tutien tuluyen – Hấp thu linh khí (hồi 30 giây)
/tutien dotpha  – Đột phá cảnh giới
/tutien bang    – Xem bảng lệnh

🌌 Tu luyện tích lũy tu vi.
💎 Mỗi lần tu luyện nhận 3 linh thạch.
⚡ Đột phá cần đủ tu vi và 20 linh thạch.
⚠️ Đột phá có xác suất thất bại; dữ liệu được lưu theo tài khoản.`
      );
    }

    return send(api, event, "❓ Lệnh chưa rõ. Dùng /tutien help để xem các đạo pháp.");
  });
};

module.exports._test = { progressBar, withUserLock };
