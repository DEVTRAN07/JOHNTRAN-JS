"use strict";

const engine = require("../../core/games/tuTienEngine");

module.exports.config = {
  name: "tutien",
  aliases: ["tu-tien", "tiendao"],
  version: "3.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Game tu tiên: tu luyện, đột phá và Cửu Trọng Thiên Kiếp",
  category: "Game",
  usage: "tutien [batdau|profile|tuluyen|dotpha|dotkiem|help]",
  cooldowns: 2,
  dependencies: {}
};

const locks = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PHASE_DELAY_MS = 520;

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

async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}

// This calls the real Zalo typing-event endpoint shipped by vendor/zalo-client.
// If the connected client lacks it or the endpoint errors, the text sequence still works.
async function typingIndicator(api, event) {
  if (typeof api?.sendTypingEvent !== "function") return false;
  try {
    await api.sendTypingEvent(event.threadId, event.type);
    return true;
  } catch (error) {
    console.warn("[tutien] Zalo typing indicator unavailable:", error?.message || error);
    return false;
  }
}

async function sendPhase(api, event, message, delay = PHASE_DELAY_MS) {
  const typing = await typingIndicator(api, event);
  await sleep(typing ? delay : Math.min(delay, 180));
  return send(api, event, message);
}

async function runPhases(api, event, phases) {
  const responses = [];
  for (const phase of phases) {
    responses.push(await sendPhase(api, event, phase.message, phase.delay ?? PHASE_DELAY_MS));
  }
  return responses;
}

function profileText(player, name) {
  const need = engine.requiredCultivation(player);
  const stats = engine.effectiveStats(player);
  const percent = Math.min(100, Math.floor(player.cultivation / need * 100));
  return `╔════ ☯ TIÊN ĐẠO VÔ HẠN ☯ ════╗
👤 Đạo hữu: ${name || "Vô danh"}
🏯 Cảnh giới: ${engine.realmLabel(player)}
✨ Tu vi: ${player.cultivation}/${need}
[${progressBar(player.cultivation, need)}] ${percent}%
❤️ Sinh lực: ${player.hp}/${player.maxHp}
⚔️ Công kích: ${stats.attack}  🛡️ Phòng ngự: ${stats.defense}
💎 Linh thạch: ${player.spiritStones}
🏆 Thắng: ${player.wins}  ☠️ Bại: ${player.losses}
╚══════════════════════════════╝`;
}

function savePlayer(stored, player) {
  stored.tuTien = player;
  return stored;
}

module.exports.run = async function ({ args = [], event, api, Users }) {
  const uid = String(event?.data?.uidFrom || "");
  if (!uid) return;
  const action = String(args[0] || "help").toLowerCase();
  const name = event?.data?.dName || event?.data?.name || "Đạo hữu";

  return withUserLock(uid, async () => {
    const userRecord = await Users.getData(uid);
    const stored = userRecord?.data && typeof userRecord.data === "object"
      ? userRecord.data
      : userRecord && typeof userRecord === "object" ? userRecord : {};
    let player = stored.tuTien ? engine.normalizePlayer(stored.tuTien) : null;

    if (["batdau", "start", "begin"].includes(action)) {
      if (player) {
        await sendPhase(api, event, "🧿 Thiên Đạo đang mở lại mệnh đăng của đạo hữu...");
        return send(api, event, profileText(player, name));
      }

      player = engine.createPlayer();
      savePlayer(stored, player);
      await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "🌌 THIÊN ĐẠO ĐANG QUAN SÁT CĂN CỐT...", delay: 620 },
        { message: "🌀 Linh khí hội tụ. Kinh mạch phàm thể bắt đầu khai mở...", delay: 620 },
        { message: "📜 Mệnh đăng đã được khắc tên vào Tiên Lục...", delay: 620 }
      ]);
      return send(api, event,
        `✨ ĐẠO LỘ ĐÃ MỞ! ✨
Đạo hữu ${name} chính thức bước vào tiên đồ.
🏯 Cảnh giới: ${engine.realmLabel(player)}
💎 Linh thạch khởi đầu: ${player.spiritStones}
📖 Dùng /tutien tuluyen để hấp thu linh khí.`
      );
    }

    if (!player) {
      return sendPhase(api, event, "📜 Đạo hữu chưa nhập đạo. Hãy dùng /tutien batdau để lập mệnh đăng.");
    }

    if (["profile", "info", "hoso"].includes(action)) {
      await runPhases(api, event, [
        { message: "🧿 ĐANG KẾT NỐI MỆNH ĐĂNG...", delay: 450 },
        { message: "📖 Đang dò xét kinh mạch và căn cơ tu luyện...", delay: 450 }
      ]);
      return send(api, event, profileText(player, name));
    }

    if (["tuluyen", "tu-luyen", "cultivate"].includes(action)) {
      const result = engine.cultivate(player);
      if (!result.ok) {
        return sendPhase(api, event, `🧘 Đạo hữu đang vận công. Còn ${Math.ceil(result.remainingMs / 1000)} giây mới có thể tiếp tục.`);
      }

      savePlayer(stored, result.player);
      await Users.setData(uid, stored);
      const gained = result.gain;
      const stages = [
        { fraction: 0.25, text: "🧘 NHẬP ĐỊNH — Điều tức, ổn định tâm mạch..." },
        { fraction: 0.55, text: "🌫️ TỤ KHÍ — Linh khí bắt đầu hội tụ quanh thân..." },
        { fraction: 0.85, text: "🌀 VẬN CHU THIÊN — Linh lực lưu chuyển qua kinh mạch..." }
      ];
      for (const stage of stages) {
        const interim = Math.min(result.player.cultivation, Math.max(0, result.player.cultivation - gained + Math.floor(gained * stage.fraction)));
        const bar = progressBar(interim, result.required);
        await sendPhase(api, event, `${stage.text}\nTu vi: [${bar}] ${interim}/${result.required}`, 560);
      }
      return send(api, event,
        `✨ HẤP THU LINH KHÍ THÀNH CÔNG!
━━━━━━━━━━━━━━━━━━━━
➕ Tu vi +${gained}
💎 Linh thạch +3
☯ Cảnh giới: ${engine.realmLabel(result.player)}
📊 [${progressBar(result.player.cultivation, result.required)}] ${result.player.cultivation}/${result.required}
━━━━━━━━━━━━━━━━━━━━
${result.player.cultivation >= result.required ? "⚡ Tu vi đã viên mãn, có thể thử đột phá!" : "Tiếp tục tu luyện để tích lũy đạo hạnh."}`
      );
    }

    if (["dotpha", "độtphá", "breakthrough"].includes(action)) {
      const result = engine.breakthrough(player);
      if (!result.ok && result.code === "NOT_READY") {
        return sendPhase(api, event, `⚠️ Thiên Đạo kiểm tra: tu vi còn thiếu ${result.missing} điểm (cần ${result.required}).`);
      }
      if (!result.ok && result.code === "NEED_STONES") {
        return sendPhase(api, event, "💎 Không đủ 20 linh thạch để bày trận đột phá.");
      }
      if (!result.ok && result.code === "COOLDOWN") {
        return sendPhase(api, event, `⏳ Thiên cơ chưa đến. Hãy chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      }
      if (!result.ok && result.code === "TRIBULATION_REQUIRED") {
        return sendPhase(api, event, "⚡ Đã đến Độ Kiếp Cửu Trọng. Hãy dùng /tutien dotkiem để nghênh đón thiên kiếp!");
      }

      savePlayer(stored, result.player);
      await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "⚡ ĐỘT PHÁ BẮT ĐẦU — Tụ linh thạch, dựng hộ thân trận...", delay: 650 },
        { message: "🌩️ Linh lực nghịch chuyển — Đạo cơ đang chịu áp lực...", delay: 700 },
        { message: "💠 KIM ĐAN CHẤN ĐỘNG — Thiên Đạo sắp định kết quả...", delay: 700 }
      ]);

      if (result.maxRealm) return send(api, event, "👑 Ngươi đã đứng trên đỉnh Tiên Đạo!");
      if (result.success) {
        return send(api, event,
          `🌟 ĐỘT PHÁ THÀNH CÔNG! 🌟
╔════════════════════════════╗
☯ Cảnh giới mới: ${engine.realmLabel(result.player)}
❤️ Sinh lực: ${result.player.hp}/${result.player.maxHp}
⚔️ Công kích: ${result.player.attack}
🛡️ Phòng ngự: ${result.player.defense}
╚════════════════════════════╝
✨ Đạo cơ vững chắc hơn, linh lực đã tăng tiến!`
        );
      }
      return send(api, event,
        `💥 ĐỘT PHÁ THẤT BẠI!
Tâm ma quấy nhiễu, linh lực phản phệ.
Tu vi bị hao tổn, sinh lực còn ${result.player.hp}/${result.player.maxHp}.
Hãy ổn định đạo tâm trước lần thử tiếp theo.`
      );
    }

    if (["dotkiem", "do-kiem", "thienkiep", "tribulation"].includes(action)) {
      const result = engine.tribulation(player);
      if (!result.ok && result.code === "WRONG_REALM") {
        return sendPhase(api, event, "⚡ Chỉ có thể độ kiếp khi đạt Độ Kiếp Cửu Trọng.");
      }
      if (!result.ok && result.code === "NOT_READY") {
        return sendPhase(api, event, `🌩️ Tu vi chưa đủ nghênh kiếp. Còn thiếu ${result.missing} điểm.`);
      }
      if (!result.ok && result.code === "NEED_STONES") {
        return sendPhase(api, event, "💎 Cần 80 linh thạch để dựng trận hộ kiếp.");
      }
      if (!result.ok && result.code === "COOLDOWN") {
        return sendPhase(api, event, `⏳ Thiên kiếp đang tích tụ. Chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      }

      savePlayer(stored, result.player);
      await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "🌩️ CỬU TRỌNG THIÊN KIẾP — Mây đen phủ kín tiên sơn...", delay: 750 },
        { message: "⚡ ĐỆ NHẤT LÔI — Thiên lôi đánh xuống hộ thể trận!", delay: 750 },
        { message: "⚡ ĐỆ NGŨ LÔI — Đạo cơ rung chuyển, nguyên thần chống đỡ...", delay: 750 },
        { message: "🔥 ĐỆ CỬU LÔI — Sinh tử chỉ còn trong một niệm!", delay: 850 }
      ]);

      if (result.success) {
        return send(api, event,
          `🌟 PHÁ KIẾP THÀNH TIÊN! 🌟
☯ Cảnh giới: ${engine.realmLabel(result.player)}
❤️ Sinh lực tối đa +100
⚔️ Công kích +20
🛡️ Phòng ngự +15
👑 Đạo hữu đã bước vào hàng Chân Tiên!`
        );
      }
      return send(api, event,
        `💥 ĐỘ KIẾP THẤT BẠI!
Thiên lôi phản phệ, sinh lực tổn thất ${result.damage}.
❤️ Sinh lực còn: ${result.player.hp}/${result.player.maxHp}
✨ Tu vi còn: ${result.player.cultivation}/${result.required}
Thiên Đạo chưa tuyệt đường sinh cơ. Hãy hồi phục rồi thử lại.`
      );
    }

    if (["help", "bang", "menu"].includes(action)) {
      await sendPhase(api, event, "📜 Thiên Đạo truyền xuống tu tiên bí lục...");
      return send(api, event,
        `☯ JOHNTRAN – TIÊN ĐẠO VÔ HẠN V3 ☯
/tutien batdau  – Bước vào tiên đồ
/tutien profile – Xem mệnh bàn tu sĩ
/tutien tuluyen – Hấp thu linh khí (hồi 30 giây)
/tutien dotpha  – Đột phá cảnh giới
/tutien dotkiem  – Vượt Cửu Trọng Thiên Kiếp
/tutien help    – Xem hướng dẫn

🌌 12 đại cảnh giới, từ Phàm Nhân đến Tiên Đế.
⚡ Đột phá có xác suất thành công và thất bại.
🌩️ Độ Kiếp Cửu Trọng mở ra con đường Chân Tiên.
🎭 Mỗi hành động đều có tín hiệu đang nhập của Zalo và các giai đoạn phản hồi bằng tin nhắn thật.
Không có ảnh, bí cảnh, linh thú hay tông môn trong phiên bản này.`
      );
    }

    return sendPhase(api, event, "❓ Đạo pháp không tồn tại. Dùng /tutien help để xem các lệnh hiện có.");
  });
};

module.exports._test = {
  progressBar,
  withUserLock,
  typingIndicator,
  sendPhase,
  runPhases,
  profileText
};
