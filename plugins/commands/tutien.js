"use strict";

const fs = require("fs");
const engine = require("../../core/games/tuTienEngine");
const { renderTuTienCard } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "tutien",
  aliases: ["tu-tien", "tiendao"],
  version: "2.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Game tu tiên nhập vai: tu luyện, bí cảnh, linh thú và độ kiếp",
  category: "Game",
  usage: "tutien [batdau|profile|tuluyen|dotpha|bicanh|linhthu|dotkiem|help]",
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

function petSymbol(pet) {
  const symbols = { cloud_fox: "🦊", thunder_bird: "🦅", jade_turtle: "🐢", white_tiger: "🐅", phoenix: "🔥" };
  return symbols[pet?.speciesId] || "🐉";
}

async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}

async function sendScene(api, event, card, fallback) {
  let filePath = null;
  try {
    filePath = await renderTuTienCard(card, { timeout: 45000 });
    const response = await api.sendMessage({ msg: fallback || "", attachments: filePath }, event.threadId, event.type);
    const cleanupTimer = setTimeout(() => {
      try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* temporary file cleanup */ }
    }, 60_000);
    cleanupTimer.unref?.();
    return response;
  } catch (error) {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch { /* already removed */ }
    }
    console.error("[tutien] render card failed:", error?.message || error);
    return send(api, event, fallback || "⚠️ Không thể tạo thẻ hình ảnh. Đạo hữu hãy thử lại sau.");
  }
}

async function showProfile(api, event, player, name) {
  const need = engine.requiredCultivation(player);
  const stats = engine.effectiveStats(player);
  const pet = stats.pet;
  const percent = Math.min(100, Math.floor(player.cultivation / need * 100));
  const fallback =
    `☯ HỒ SƠ TU SĨ • JOHNTRAN
👤 Đạo hữu: ${name || "Vô danh"}
🏯 Cảnh giới: ${engine.realmLabel(player)}
✨ Tu vi: ${player.cultivation}/${need} [${progressBar(player.cultivation, need)}] ${percent}%
❤️ Sinh lực: ${player.hp}/${player.maxHp}
⚔️ Công kích: ${stats.attack}  🛡️ Phòng ngự: ${stats.defense}
💎 Linh thạch: ${player.spiritStones}
🐾 Linh thú: ${pet ? pet.name + " • cấp " + pet.level : "Chưa có"}
🧭 Bí cảnh đã khám phá: ${player.discoveries}
🏆 Thắng: ${player.wins}  ☠️ Bại: ${player.losses}`;
  return sendScene(api, event, {
    kind: "profile",
    name: name || "Vô danh",
    realm: engine.realmLabel(player),
    cultivation: player.cultivation,
    required: need,
    stones: player.spiritStones,
    hp: `${player.hp}/${player.maxHp}`,
    attack: stats.attack,
    defense: stats.defense,
    subtitle: pet ? `Linh thú hộ đạo: ${pet.name}` : "Mệnh cách đã được Thiên Đạo ghi nhận"
  }, fallback);
}

function describeExplore(result) {
  switch (result.event) {
    case "spirit_spring":
      return {
        card: { kind: "scene", title: "LINH TUYỀN HIỆN THẾ", subtitle: "Một dòng linh tuyền giữa tiên sơn", symbol: "💧", badge: "CƠ DUYÊN HIẾM GẶP", lines: [`Tu vi tăng ${result.cultivationGain}`, `Nhận ${result.fruitGain} linh quả`, "Linh khí vận chuyển khắp kinh mạch"], reward: "+ Tu vi • Linh quả" },
        text: `💧 Phát hiện Linh Tuyền! Tu vi +${result.cultivationGain}, Linh quả +${result.fruitGain}.`
      };
    case "monster_win":
      return {
        card: { kind: "scene", title: "YÊU THÚ BỊ ĐÁNH BẠI", subtitle: "Đạo hữu chiến thắng trong bí cảnh", symbol: "⚔️", badge: "CHIẾN THẮNG", lines: [`Chiến lực của ngươi: ${result.power}`, `Địch thủ: ${result.enemyPower}`, `Linh thạch nhận được: ${result.stoneGain}`], reward: `+ ${result.stoneGain} linh thạch` },
        text: `⚔️ Đánh bại yêu thú! Nhận ${result.stoneGain} linh thạch.`
      };
    case "monster_loss":
      return {
        card: { kind: "scene", title: "GẶP YÊU THÚ", subtitle: "Đạo hữu tạm thời lui khỏi chiến trường", symbol: "🐲", badge: "HUNG HIỂM", lines: [`Chiến lực của ngươi: ${result.power}`, `Địch thủ: ${result.enemyPower}`, `Sinh lực tổn thất: ${result.damage}`], reward: "Hãy tăng cường pháp bảo và linh thú" },
        text: `🐲 Yêu thú quá mạnh! Ngươi mất ${result.damage} HP và phải rút lui.`
      };
    case "pet_captured":
      return {
        card: { kind: "pet", name: result.pet.name, rarity: result.pet.rarity, level: result.pet.level, attack: result.pet.attack, defense: result.pet.defense, symbol: petSymbol(result.pet), description: result.pet.description, subtitle: "Linh thú đã tự nguyện kết khế ước" },
        text: `🐾 Thu phục thành công ${result.pet.name} (${result.pet.rarity})!`
      };
    case "pet_escaped":
      return {
        card: { kind: "scene", title: "LINH THÚ BỎ TRỐN", subtitle: "Cơ duyên chưa đến", symbol: "🌫️", badge: "LỠ MẤT CƠ DUYÊN", lines: [`Phát hiện ${result.species.name}`, "Linh thú cảnh giác và biến mất", "Hãy tiếp tục khám phá bí cảnh"], reward: "Chưa thể lập khế ước" },
        text: `🌫️ ${result.species.name} đã bỏ trốn. Hãy thử vận may lần sau.`
      };
    default:
      return {
        card: { kind: "scene", title: "RƯƠNG CỔ KHAI MỞ", subtitle: "Bảo quang chiếu rọi cả bí cảnh", symbol: "🎁", badge: "TÌM THẤY CỔ BẢO", lines: [`Linh thạch +${result.stoneGain}`, `Mảnh cổ ngọc +${result.shardGain}`, "Một phần di tích đã được ghi vào bản đồ"], reward: "+ Linh thạch • Mảnh cổ ngọc" },
        text: `🎁 Mở rương cổ! Linh thạch +${result.stoneGain}, mảnh cổ ngọc +${result.shardGain}.`
      };
  }
}

function listPets(player) {
  if (!player.pets.length) return "🐾 Đạo hữu chưa có linh thú. Hãy dùng /tutien bicanh để tìm cơ duyên.";
  const lines = player.pets.map((pet, index) => {
    const active = pet.id === player.activePetId ? " ⭐ Đang hộ đạo" : "";
    return `${index + 1}. ${petSymbol(pet)} ${pet.name} • ${pet.rarity} • Cấp ${pet.level} • Công ${pet.attack} • Thủ ${pet.defense}${active}`;
  });
  return "🐉 LINH THÚ KHế ƯỚC\n" + lines.join("\n") +
    "\n\n/tutien linhthu chon <số> – chọn linh thú hộ đạo" +
    "\n/tutien linhthu choan – cho linh thú ăn (15 linh thạch)";
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

    if (action === "batdau" || action === "start" || action === "begin") {
      if (player) return showProfile(api, event, player, name);
      player = engine.createPlayer();
      stored.tuTien = player;
      await Users.setData(uid, stored);
      await send(api, event, "🌌 LINH KHÍ HỘI TỤ...\n📜 Thiên Đạo đang ghi danh một phàm nhân...");
      await sleep(350);
      return sendScene(api, event, {
        kind: "scene", title: "TIÊN ĐỒ ĐÃ MỞ", subtitle: name + " chính thức bước vào tiên lộ",
        symbol: "☯", badge: "MỆNH ĐĂNG ĐÃ LẬP",
        lines: ["Cảnh giới: Phàm Nhân", "Linh thạch khởi đầu: 100", "Thiên địa rộng lớn, tiên duyên đang chờ"],
        reward: "Dùng /tutien tuluyen để hấp thu linh khí"
      }, "✨ ĐẠO LỘ ĐÃ MỞ! Ngươi đã bước chân vào con đường tu tiên. Gõ /tutien help để xem bí kíp.");
    }

    if (!player) return send(api, event, "📜 Ngươi chưa nhập đạo. Hãy dùng /tutien batdau để lập mệnh đăng!");

    if (["profile", "info", "hoso", "the"].includes(action)) {
      return showProfile(api, event, player, name);
    }

    if (["tuluyen", "tu-luyen", "cultivate"].includes(action)) {
      const result = engine.cultivate(player);
      if (!result.ok) return send(api, event, `🧘 Đạo hữu đang vận công. Hãy tĩnh tâm thêm ${Math.ceil(result.remainingMs / 1000)}s rồi thử lại.`);
      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "🌀 ĐANG VẬN CHUYỂN CHU THIÊN...\n🌫️ Linh khí hội tụ quanh thân...");
      await sleep(250);
      return sendScene(api, event, {
        kind: "scene", title: "HẤP THU LINH KHÍ", subtitle: "Linh mạch vận chuyển • Chu thiên tuần hoàn",
        symbol: "☯", badge: "TU LUYỆN THÀNH CÔNG",
        lines: [`Tu vi tăng ${result.gain}`, "Linh thạch +3", `Cảnh giới: ${engine.realmLabel(result.player)}`],
        reward: `${progressBar(result.player.cultivation, result.required)} ${result.player.cultivation}/${result.required}`
      }, `✨ Tu luyện thành công! Tu vi +${result.gain}, linh thạch +3. ${result.player.cultivation}/${result.required}.`);
    }

    if (["dotpha", "độtphá", "breakthrough"].includes(action)) {
      const result = engine.breakthrough(player);
      if (!result.ok && result.code === "NOT_READY") return send(api, event, `⚠️ Tu vi chưa đủ. Còn thiếu ${result.missing} điểm (cần ${result.required}).`);
      if (!result.ok && result.code === "NEED_STONES") return send(api, event, "💎 Không đủ 20 linh thạch để bày trận đột phá.");
      if (!result.ok && result.code === "COOLDOWN") return send(api, event, `⏳ Thiên cơ chưa đến. Hãy chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      if (!result.ok && result.code === "TRIBULATION_REQUIRED") return send(api, event, "⚡ Đã đến Độ Kiếp Cửu Trọng. Hãy dùng /tutien dotkiem để nghênh đón thiên kiếp!");
      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "⚡ THIÊN ĐỊA CHẤN ĐỘNG!\n🌩️ Linh lực cuộn trào, đạo cơ rung chuyển...");
      await sleep(350);
      if (result.maxRealm) return send(api, event, "👑 Ngươi đã đứng trên đỉnh Tiên Đạo!");
      if (result.success) {
        const fallback = `🌟 ĐỘT PHÁ THÀNH CÔNG! Cảnh giới mới: ${engine.realmLabel(result.player)}. HP ${result.player.hp}/${result.player.maxHp}, Công ${result.player.attack}, Thủ ${result.player.defense}.`;
        return sendScene(api, event, {
          kind: "scene", title: "ĐỘT PHÁ THÀNH CÔNG", subtitle: "Thiên địa dị tượng • Đạo cơ tái sinh",
          symbol: "⚡", badge: engine.realmLabel(result.player),
          lines: ["Sinh lực: " + result.player.hp + "/" + result.player.maxHp, "Công kích: " + result.player.attack, "Phòng ngự: " + result.player.defense],
          reward: "Cảnh giới mới đã được khai mở"
        }, fallback);
      }
      return sendScene(api, event, {
        kind: "scene", title: "TÂM MA PHẢN PHỆ", subtitle: "Đột phá thất bại • Đạo tâm dao động",
        symbol: "☠", badge: "THẤT BẠI",
        lines: ["Tu vi bị hao tổn", "Sinh lực còn: " + result.player.hp, "Hãy củng cố căn cơ trước lần thử tiếp theo"],
        reward: "Không được nóng vội"
      }, `💥 Đột phá thất bại! Tu vi hao tổn, HP còn ${result.player.hp}.`);
    }

    if (["bicanh", "bícanh", "explore"].includes(action)) {
      const result = engine.explore(player);
      if (!result.ok) return send(api, event, `⏳ Bí cảnh chưa ổn định. Còn ${Math.ceil(result.remainingMs / 1000)} giây mới có thể vào lại.`);
      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "🗺️ BÍ CẢNH ĐÃ MỞ!\n🌫️ Ngươi bước qua kết giới cổ xưa...");
      await sleep(300);
      const scene = describeExplore(result);
      return sendScene(api, event, scene.card, scene.text);
    }

    if (["linhthu", "pet"].includes(action)) {
      const sub = String(args[1] || "list").toLowerCase();
      if (["choan", "feed"].includes(sub)) {
        const result = engine.feedPet(player, args[2]);
        if (!result.ok && result.code === "NO_PET") return send(api, event, "🐾 Ngươi chưa có linh thú để cho ăn.");
        if (!result.ok) return send(api, event, "💎 Cần 15 linh thạch để mua linh đan cho linh thú.");
        stored.tuTien = result.player;
        await Users.setData(uid, stored);
        const card = { kind: "pet", name: result.pet.name, rarity: result.pet.rarity, level: result.pet.level, attack: result.pet.attack, defense: result.pet.defense, symbol: petSymbol(result.pet), description: result.leveledUp ? "Linh thú đột phá cấp độ!" : "Linh thú hấp thu linh đan và tăng trưởng.", subtitle: result.leveledUp ? "TIẾN HÓA THÀNH CÔNG" : "BỒI DƯỠNG LINH THÚ" };
        return sendScene(api, event, card, `🍖 ${result.pet.name} đã ăn linh đan. Cấp hiện tại: ${result.pet.level}.`);
      }
      if (["chon", "select", "active"].includes(sub)) {
        const index = Number(args[2]) - 1;
        const target = Number.isInteger(index) ? player.pets[index] : null;
        const petId = target?.id || args[2];
        const result = engine.activatePet(player, petId);
        if (!result.ok) return send(api, event, "❌ Không tìm thấy linh thú. Dùng /tutien linhthu để xem danh sách.");
        stored.tuTien = result.player;
        await Users.setData(uid, stored);
        return sendScene(api, event, {
          kind: "pet", name: result.pet.name, rarity: result.pet.rarity,
          level: result.pet.level, attack: result.pet.attack, defense: result.pet.defense,
          symbol: petSymbol(result.pet), description: "Khế ước hộ đạo đã được kích hoạt.",
          subtitle: "LINH THÚ ĐANG HỘ ĐẠO"
        }, `🐾 ${result.pet.name} hiện là linh thú hộ đạo của ngươi.`);
      }
      return send(api, event, listPets(player));
    }

    if (["dotkiem", "do-kiem", "thienkiep", "tribulation"].includes(action)) {
      const result = engine.tribulation(player);
      if (!result.ok && result.code === "WRONG_REALM") return send(api, event, "⚡ Chỉ có thể độ kiếp khi đạt Độ Kiếp Cửu Trọng.");
      if (!result.ok && result.code === "NOT_READY") return send(api, event, `🌩️ Tu vi chưa đủ nghênh kiếp. Còn thiếu ${result.missing} điểm.`);
      if (!result.ok && result.code === "NEED_STONES") return send(api, event, "💎 Cần 80 linh thạch để dựng trận hộ kiếp.");
      if (!result.ok && result.code === "COOLDOWN") return send(api, event, `⏳ Thiên kiếp đang tích tụ. Chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      stored.tuTien = result.player;
      await Users.setData(uid, stored);
      await send(api, event, "🌩️ CỬU TRỌNG THIÊN KIẾP!\n⚡ Mây đen che phủ tiên sơn...\n🛡️ Trận pháp hộ thể đang tan vỡ...");
      await sleep(550);
      if (result.success) {
        return sendScene(api, event, {
          kind: "scene", title: "PHÁ KIẾP THÀNH TIÊN", subtitle: "Cửu trọng thiên lôi • Tiên môn khai mở",
          symbol: "⚡", badge: "CHÂN TIÊN GIÁNG THẾ",
          lines: ["Vượt qua Cửu Trọng Thiên Kiếp", "Sinh lực tối đa +100", "Công kích +20 • Phòng ngự +15"],
          reward: "ĐẠT CẢNH GIỚI CHÂN TIÊN"
        }, "🌟 ĐỘ KIẾP THÀNH CÔNG! Ngươi đã bước vào Chân Tiên.");
      }
      return sendScene(api, event, {
        kind: "scene", title: "THIÊN KIẾP PHẢN PHỆ", subtitle: "Thân thể trọng thương nhưng đạo tâm chưa diệt",
        symbol: "🌩", badge: "ĐỘ KIẾP THẤT BẠI",
        lines: ["Sinh lực tổn thất nặng", "Tu vi hao tổn", "Hãy hồi phục và chuẩn bị lại"],
        reward: "Tiên lộ vẫn còn phía trước"
      }, `💥 Độ kiếp thất bại! HP còn ${result.player.hp}; tu vi bị hao tổn.`);
    }

    if (["bang", "help", "menu"].includes(action)) {
      return send(api, event,
        `☯ JOHNTRAN – TIÊN ĐẠO VÔ HẠN V2 ☯
/tutien batdau   – Bước vào tiên đồ
/tutien profile  – Thẻ hồ sơ tu sĩ
/tutien tuluyen  – Hấp thu linh khí (hồi 30 giây)
/tutien dotpha   – Đột phá cảnh giới
/tutien bicanh   – Khám phá bí cảnh (hồi 60 giây)
/tutien linhthu  – Xem linh thú
/tutien linhthu chon <số> – Chọn linh thú hộ đạo
/tutien linhthu choan – Bồi dưỡng linh thú
/tutien dotkiem  – Vượt Cửu Trọng Thiên Kiếp

🎴 Bí cảnh tạo ngẫu nhiên cơ duyên, yêu thú, linh thú và cổ bảo.
🐉 Linh thú cộng chỉ số chiến đấu cho chủ nhân.
🌩️ Độ Kiếp Cửu Trọng mở ra con đường Chân Tiên.
🖼️ Các sự kiện chính có thẻ hình ảnh; khi render lỗi bot tự chuyển sang chữ.`
      );
    }

    return send(api, event, "❓ Lệnh chưa rõ. Dùng /tutien help để xem đạo pháp.");
  });
};

module.exports._test = { progressBar, withUserLock, describeExplore, listPets };
