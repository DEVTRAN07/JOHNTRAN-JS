"use strict";

const engine = require("../../core/games/tuTienEngine");
const { createTuTienEffects } = require("../../core/games/tuTienEffects");
const arena = require("../../core/games/tuTienArena");
const { sendBattleMedia } = require("../../core/games/tuTienBattleMedia");

module.exports.config = {
  name: "tutien", aliases: ["tu-tien", "tiendao"], version: "5.0.0", role: 0,
  author: "JOHNTRAN", description: "Tu tiên: DEVTRAN Tiên Tông và Cửu Trọng Thiên Kiếp",
  category: "Game", usage: "tutien [batdau|profile|tuluyen|dotkiem|pvp|bxh|tranhdoat|nhiemvu|luyennhanh|tongmon|help]",
  cooldowns: 2, dependencies: {}
};

const locks = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AVATAR_SIZE_LARGE = 240;

async function withUserLock(userId, task) {
  const key = String(userId), previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous.catch(() => {});
  try { return await task(); }
  finally { release(); if (locks.get(key) === current) locks.delete(key); }
}

function progressBar(value, max, size = 12) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}

async function send(api, event, msg) { return api.sendMessage({ msg }, event.threadId, event.type); }

async function typingIndicator(api, event) {
  if (typeof api?.sendTypingEvent !== "function") return false;
  try { await api.sendTypingEvent(event.threadId, event.type); return true; }
  catch (error) { console.warn("[tutien] Zalo typing event failed:", error?.message || error); return false; }
}

async function sendPhase(api, event, message, delay = 520) {
  const typing = await typingIndicator(api, event);
  await sleep(typing ? delay : Math.min(delay, 180));
  return send(api, event, message);
}

async function runPhases(api, event, phases) {
  const responses = [];
  for (const phase of phases) responses.push(await sendPhase(api, event, phase.message, phase.delay ?? 520));
  return responses;
}

function getSectMasterId() {
  const admins = Array.isArray(global.users?.admin) ? global.users.admin : [];
  return admins.map((id) => String(id || "").trim()).find(Boolean) || "";
}

async function getZaloIdentity(api, event, uid) {
  const data = event?.data || {};
  const identity = {
    displayName: String(data.dName || data.name || "Đạo hữu"),
    avatarUrl: String(data.avatar || data.avatarUrl || data.avt || "")
  };
  if (typeof api?.getUserInfo !== "function" || !uid) return identity;
  try {
    const response = await api.getUserInfo(String(uid), AVATAR_SIZE_LARGE);
    const profiles = response?.changed_profiles || response?.changedProfiles || {};
    const profile = profiles[String(uid)] || profiles[`${uid}_0`] || Object.values(profiles)[0] || {};
    identity.displayName = String(profile.displayName || profile.zaloName || profile.username || identity.displayName);
    identity.avatarUrl = String(profile.avatar || profile.avatarUrl || identity.avatarUrl);
  } catch (error) {
    console.warn("[tutien] Could not fetch Zalo profile; using event data:", error?.message || error);
  }
  return identity;
}

function profileText(player) {
  const need = engine.requiredCultivation(player), stats = engine.effectiveStats(player);
  const percent = Math.min(100, Math.floor(player.cultivation / need * 100));
  const avatarState = player.avatarUrl ? "Đã đồng bộ ảnh đại diện Zalo" : "Chưa lấy được ảnh đại diện";
  return `╔════ ☯ TIÊN ĐẠO VÔ HẠN ☯ ════╗
👤 Nhân vật: ${player.displayName || "Đạo hữu"}
🪪 Avatar: ${avatarState}
🏯 Tông môn: ${engine.SECT.name}
🎖️ Cảnh giới: ${engine.realmLabel(player)}
✨ Tu vi: ${player.cultivation}/${need}
[${progressBar(player.cultivation, need)}] ${percent}%
❤️ Sinh lực: ${player.hp}/${player.maxHp}
⚔️ Công kích: ${stats.attack}  🛡️ Phòng ngự: ${stats.defense}
💎 Linh thạch: ${player.spiritStones}
🏯 Linh thạch tông môn: ${player.sectStones}
╚════════════════════════════════╝`;
}

function savePlayer(stored, player) { player.sectId = engine.SECT.id; stored.tuTien = player; return stored; }

function formatMissions(player, now = Date.now()) {
  const lines = engine.missionStatus(player, now).map((m) => {
    const status = m.claimed ? "✅ Đã nhận" : m.claimable ? "🎁 Có thể nhận" : "⏳ Đang thực hiện";
    return `${m.name}: ${m.progress}/${m.target} — ${m.reward} linh thạch tông môn\n   ${status} • ${m.description}`;
  });
  return `📜 NHIỆM VỤ DEVTRAN TIÊN TÔNG\n━━━━━━━━━━━━━━━━━━━━\n${lines.join("\n\n")}\n━━━━━━━━━━━━━━━━━━━━\n/tutien nhiemvu diem-danh — Điểm danh hôm nay\n/tutien nhiemvu nhan — Nhận toàn bộ thưởng đã hoàn thành\n/tutien luyennhanh — Dùng 30 linh thạch tông môn đổi 100+ tu vi`;
}

async function getSectMasterName(api, Users) {
  const id = getSectMasterId();
  if (!id) return "Chưa cấu hình admin_bot";
  try { const record = await Users.getData(id); if (record?.data?.tuTien?.displayName) return record.data.tuTien.displayName; }
  catch { /* use Zalo profile */ }
  const profile = await getZaloIdentity(api, { data: {} }, id);
  return profile.displayName && profile.displayName !== "Đạo hữu" ? profile.displayName : "Tông Chủ (admin_bot đầu tiên)";
}

function getMemberCount(Users) {
  try { return Users.getAll().filter((row) => row?.data?.tuTien).length; }
  catch { return 0; }
}

async function runTuTien({ args = [], event, api, Users }, effects) {
  // Route all actual bot replies through the live Zalo effect runner.
  const send = (_api, _event, message) => effects.result(message);
  const sendPhase = (_api, _event, message, delay = 520) => effects.respond(message, delay);
  const runPhases = (_api, _event, phases) => effects.sequence(phases);
  const uid = String(event?.data?.uidFrom || "");
  if (!uid) return;
  const action = String(args[0] || "help").toLowerCase();

  if (["laptonmon", "taotongmon", "create-sect", "create_sect"].includes(action)) {
    return sendPhase(api, event, `${engine.SECT.name} là tông môn duy nhất. Tông Chủ đã được cố định theo tài khoản admin_bot; không thể lập tông môn khác.`);
  }

  return withUserLock(uid, async () => {
    const record = await Users.getData(uid);
    const stored = record?.data && typeof record.data === "object" ? record.data : record || {};
    let player = stored.tuTien ? engine.normalizePlayer(stored.tuTien) : null;

    if (["tongmon", "ton-mon", "sect"].includes(action)) {
      const masterId = getSectMasterId(), masterName = await getSectMasterName(api, Users);
      await runPhases(api, event, [
        { message: "🏯 ĐANG KIỂM TRA TÔNG MÔN...", delay: 360 },
        { message: "📜 Thiên Đạo xác nhận quyền Tông Chủ và danh sách môn đồ...", delay: 420 }
      ]);
      return send(api, event, `╔════ 🏯 TÔNG MÔN DUY NHẤT 🏯 ════╗
⚜️ ${engine.SECT.name}
📜 Danh hiệu: ${engine.SECT.title}
👑 Tông Chủ: ${masterName}
👥 Môn đồ: ${getMemberCount(Users)}
💎 Tiền tệ riêng: Linh thạch tông môn
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tông môn này là mặc định cho toàn bộ người chơi.
Không có lệnh lập, đổi hoặc tạo tông môn thứ hai.
Mọi đạo hữu đều có thể nhận nhiệm vụ để cống hiến.`);
    }

    if (["batdau", "start", "begin"].includes(action)) {
      if (player) {
        player.sectId = engine.SECT.id;
        if (!player.displayName || !player.avatarUrl) {
          const identity = await getZaloIdentity(api, event, uid);
          player.displayName = identity.displayName || player.displayName;
          player.avatarUrl = identity.avatarUrl || player.avatarUrl;
        }
        savePlayer(stored, player); await Users.setData(uid, stored);
        await effects.phase("🧿 Thiên Đạo đang mở lại mệnh đăng của đạo hữu...", { delayMs: 520 });
        return send(api, event, profileText(player));
      }
      const identity = await getZaloIdentity(api, event, uid);
      player = engine.createPlayer(Date.now(), identity);
      savePlayer(stored, player); await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "🌌 THIÊN ĐẠO ĐANG QUAN SÁT CĂN CỐT...", delay: 560 },
        { message: `🪪 Nhận diện đạo hữu: ${player.displayName} — đã ghi nhận avatar Zalo.`, delay: 460 },
        { message: "🌀 Linh khí hội tụ. Kinh mạch phàm thể bắt đầu khai mở...", delay: 560 },
        { message: `🏯 Tông Môn ${engine.SECT.name} đã nhận ngươi làm môn đồ.`, delay: 460 },
        { message: "📜 Mệnh đăng đã được khắc tên vào Tiên Lục...", delay: 560 }
      ]);
      return send(api, event, `✨ ĐẠO LỘ ĐÃ MỞ! ✨
👤 Nhân vật: ${player.displayName}
🏯 Tông môn: ${engine.SECT.name}
🎖️ Cảnh giới: ${engine.realmLabel(player)}
💎 Linh thạch: ${player.spiritStones}
🏯 Linh thạch tông môn: ${player.sectStones}
📖 Dùng /tutien tuluyen để hấp thu linh khí.`);
    }

    if (!player) return sendPhase(api, event, "📜 Đạo hữu chưa nhập đạo. Hãy dùng /tutien batdau để lập mệnh đăng.");

    player.sectId = engine.SECT.id;
    if (!player.displayName || !player.avatarUrl) {
      const identity = await getZaloIdentity(api, event, uid);
      player.displayName = identity.displayName || player.displayName;
      player.avatarUrl = identity.avatarUrl || player.avatarUrl;
    }

    if (["pvp", "dau", "thachdau"].includes(action)) {
      const sub = String(args[1] || "help").toLowerCase();
      const getPending = () => Users.getAll().find((row) =>
        row?.data?.tuTien?.arena?.pendingChallenge?.toUid === uid &&
        row.data.tuTien.arena.pendingChallenge.status === "pending"
      );
      if (["help", "menu"].includes(sub)) {
        return send(api, event, "⚔️ ĐẤU TRƯỜNG TIÊN ĐẠO\n/tutien pvp @nguoichoi — Gửi lời thách đấu\n/tutien pvp chapnhan — Chấp nhận\n/tutien pvp tuchoi — Từ chối\n/tutien pvp danh — Đánh thường\n/tutien pvp skill — Thiên Lôi Chưởng (20 khí)\n/tutien pvp ultimate — Cửu Trọng Kiếm Quyết (45 khí)\n/tutien pvp defend — Phòng thủ và hồi khí\n/tutien pvp status — Xem trận hiện tại");
      }
      if (["chapnhan", "accept", "yes"].includes(sub)) {
        const pendingRow = getPending();
        if (!pendingRow) return sendPhase(api, event, "📭 Không có lời thách đấu nào đang chờ ngươi.");
        const challenger = pendingRow.data.tuTien;
        const challenge = challenger.arena.pendingChallenge;
        const started = arena.startBattle(challenge);
        if (!started.ok) {
          challenger.arena.pendingChallenge = null;
          await Users.setData(pendingRow.userId, pendingRow.data);
          return sendPhase(api, event, "⌛ Lời thách đấu đã hết hạn hoặc không còn hợp lệ.");
        }
        const battle = started.battle;
        challenger.arena.pendingChallenge = null;
        challenger.arena.battle = battle;
        player.arena = player.arena || {};
        player.arena.battle = JSON.parse(JSON.stringify(battle));
        savePlayer(stored, player);
        await Users.setData(pendingRow.userId, pendingRow.data);
        await Users.setData(uid, stored);
        await runPhases(api, event, [
          { message: "🏟️ ĐẤU TRƯỜNG ĐÃ MỞ — hai đạo hữu bước vào kết giới!", delay: 450 },
          { message: "⚔️ Trận đấu bắt đầu! Người thách đấu được đi trước.", delay: 450 }
        ]);
        return send(api, event, `⚔️ ${battle.fighters[0].name} VS ${battle.fighters[1].name}\nLượt 1: ${battle.fighters[0].name} ra chiêu trước.\nDùng /tutien pvp danh | skill | ultimate | defend`);
      }
      if (["tuchoi", "decline", "no"].includes(sub)) {
        const pendingRow = getPending();
        if (!pendingRow) return sendPhase(api, event, "📭 Không có lời thách đấu nào đang chờ.");
        pendingRow.data.tuTien.arena.pendingChallenge = null;
        await Users.setData(pendingRow.userId, pendingRow.data);
        return send(api, event, "🕊️ Ngươi đã từ chối lời thách đấu.");
      }
      if (["status", "trangthai"].includes(sub)) {
        const battle = player.arena?.battle;
        if (!battle || battle.status !== "active") return sendPhase(api, event, "🏟️ Ngươi hiện không ở trong trận PvP nào.");
        const lines = battle.fighters.map((fighter) => `${fighter.name} — ❤️ ${fighter.hp}/${fighter.maxHp} • 🔷 Khí ${fighter.qi}`);
        return send(api, event, `⚔️ TRẠNG THÁI ĐẤU TRƯỜNG\n${lines.join("\n")}\nLượt hiện tại: ${battle.fighters.find((x) => x.uid === battle.turnUid)?.name || "?"}`);
      }
      const battle = player.arena?.battle;
      if (!battle || battle.status !== "active") {
        const targetUid = String(event?.mentions?.[0]?.uid || event?.mentions?.[0]?.id || "");
        if (!targetUid) return sendPhase(api, event, "🎯 Hãy tag một đạo hữu để thách đấu: /tutien pvp @uid");
        const targetRecord = await Users.getData(targetUid);
        const targetStored = targetRecord?.data && typeof targetRecord.data === "object" ? targetRecord.data : targetRecord || {};
        const targetPlayer = targetStored.tuTien ? engine.normalizePlayer(targetStored.tuTien) : null;
        if (!targetPlayer) return sendPhase(api, event, "📜 Đối thủ chưa khai mở tiên lộ. Họ cần dùng /tutien batdau trước.");
        if (targetPlayer.arena?.battle?.status === "active" || targetPlayer.arena?.pendingChallenge) return sendPhase(api, event, "⏳ Đối thủ đang có trận đấu hoặc lời mời chờ xử lý.");
        const created = arena.createChallenge(uid, targetUid, player, targetPlayer);
        if (!created.ok) return sendPhase(api, event, created.code === "POWER_GAP" ? "⚖️ Chênh lệch chiến lực quá lớn (trên 65%). Hãy tìm đối thủ cân bằng hơn." : "❌ Không thể tạo lời thách đấu.");
        player.arena = player.arena || {};
        player.arena.pendingChallenge = created.challenge;
        savePlayer(stored, player);
        await Users.setData(uid, stored);
        return send(api, event, `📯 LỜI THÁCH ĐẤU ĐÃ ĐƯỢC GỬI!\n⚔️ ${player.displayName} thách đấu ${targetPlayer.displayName}.\n⏳ Đối thủ có 120 giây để dùng /tutien pvp chapnhan hoặc tuchoi.`);
      }
      const actionMap = { danh: "normal", attack: "normal", skill: "skill", ultimate: "ultimate", defend: "defend", phongthu: "defend" };
      const move = actionMap[sub];
      if (!move) return sendPhase(api, event, "❓ Chiêu thức không hợp lệ. Chọn danh, skill, ultimate hoặc defend.");
      const turn = arena.takeTurn(battle, uid, move);
      if (!turn.ok) {
        const errors = {
          NOT_YOUR_TURN: "⌛ Chưa đến lượt của ngươi.",
          LOW_QI: `🔷 Không đủ linh khí. Cần ${turn.required} khí.`,
          EXPIRED: "⌛ Trận đấu đã hết thời gian.",
          NO_BATTLE: "🏟️ Không có trận đấu đang diễn ra."
        };
        return sendPhase(api, event, errors[turn.code] || "Không thể thực hiện lượt đánh.");
      }
      const opponentUid = battle.fighters.find((fighter) => fighter.uid !== uid)?.uid;
      const opponentRecord = await Users.getData(opponentUid);
      const opponentStored = opponentRecord?.data && typeof opponentRecord.data === "object" ? opponentRecord.data : opponentRecord || {};
      const opponentPlayer = engine.normalizePlayer(opponentStored.tuTien || {});
      if (turn.finished) {
        const winnerUid = turn.winner.uid, loserUid = turn.loser.uid;
        const winnerStored = winnerUid === uid ? stored : opponentStored;
        const loserStored = loserUid === uid ? stored : opponentStored;
        const winnerPlayer = winnerUid === uid ? player : opponentPlayer;
        const loserPlayer = loserUid === uid ? player : opponentPlayer;
        const reward = arena.settleRating(winnerPlayer, loserPlayer);
        winnerPlayer.spiritStones = (Number(winnerPlayer.spiritStones) || 0) + reward.reward;
        winnerPlayer.arena.battle = null;
        loserPlayer.arena.battle = null;
        winnerPlayer.arena.lastResult = { outcome: "win", at: Date.now(), opponent: loserPlayer.displayName };
        loserPlayer.arena.lastResult = { outcome: "loss", at: Date.now(), opponent: winnerPlayer.displayName };
        savePlayer(winnerStored, winnerPlayer); savePlayer(loserStored, loserPlayer);
        await Users.setData(winnerUid, winnerStored); await Users.setData(loserUid, loserStored);
      } else {
        player.arena.battle = JSON.parse(JSON.stringify(battle));
        opponentPlayer.arena = opponentPlayer.arena || {};
        opponentPlayer.arena.battle = JSON.parse(JSON.stringify(battle));
        savePlayer(stored, player); savePlayer(opponentStored, opponentPlayer);
        await Users.setData(uid, stored); await Users.setData(opponentUid, opponentStored);
      }
      try {
        await sendBattleMedia(api, event, battle, turn.entry, { includeVideo: turn.finished });
      } catch (mediaError) {
        console.warn("[tutien-pvp] Media render/send failed:", mediaError?.message || mediaError);
      }
      const actionText = turn.entry.dodged ? "💨 Đối thủ né được đòn đánh!" :
        turn.entry.action === "defend" ? "🛡️ Đã dựng Hộ Thể Cương Khí." :
        `${turn.entry.critical ? "💥 CHÍ MẠNG! " : "⚔️ "}${turn.entry.skill}: gây ${turn.entry.damage} sát thương.`;
      if (turn.finished) return send(api, event, `🏆 TRẬN ĐẤU KẾT THÚC!\n👑 Người thắng: ${turn.winner.name}\n💎 Thưởng: +30 linh thạch thường\n📈 Điểm xếp hạng: +25\n🔥 Chuỗi thắng: ${winnerPlayer.arena.streak}`);
      return send(api, event, `${actionText}\n❤️ HP đối thủ: ${turn.entry.enemyHp}\n🔷 Linh khí còn: ${turn.entry.qi}\n➡️ Đến lượt: ${battle.fighters.find((x) => x.uid === battle.turnUid)?.name}`);
    }

    if (["bxh", "rank", "leaderboard"].includes(action)) {
      const metric = String(args[1] || "rating").toLowerCase();
      const titles = { rating: "ĐIỂM ĐẤU TRƯỜNG", wins: "SỐ TRẬN THẮNG", power: "CHIẾN LỰC", seasonPoints: "ĐIỂM MÙA", bestStreak: "CHUỖI THẮNG" };
      const rows = arena.leaderboard(Users.getAll(), metric, 10);
      if (!rows.length) return sendPhase(api, event, "📊 Chưa có dữ liệu xếp hạng. Hãy tham gia đấu trường PvP.");
      const lines = rows.map((row, i) => `${["🥇","🥈","🥉"][i] || `${i + 1}.`} ${row.name} — ${row.score} • ${row.realm}`);
      return send(api, event, `🏆 BẢNG XẾP HẠNG TIÊN ĐẠO\n📊 ${titles[metric] || titles.rating}\n━━━━━━━━━━━━━━━━━━\n${lines.join("\n")}\n━━━━━━━━━━━━━━━━━━\n/tutien bxh wins | power | seasonPoints`);
    }

    if (["tranhdoat", "season", "mua"].includes(action)) {
      const sub = String(args[1] || "info").toLowerCase();
      const currentSeason = arena.seasonId();
      if (["nhan", "claim", "reward"].includes(sub)) {
        const allRows = Users.getAll();
        for (const row of allRows) {
          if (!row?.data?.tuTien) continue;
          arena.ensureArena(row.data.tuTien);
          await Users.setData(row.userId, row.data);
        }
        const previous = arena.previousSeasonLeaderboard(allRows);
        const targetSeason = previous.map((row) => row.season).sort().at(-1);
        const standings = previous.filter((row) => row.season === targetSeason);
        const rank = standings.findIndex((row) => row.uid === uid);
        if (!targetSeason || rank < 0 || rank > 2) return sendPhase(api, event, "🎁 Chưa có phần thưởng mùa trước dành cho ngươi. Chỉ Top 3 được nhận thưởng.");
        arena.ensureArena(player);
        if (player.arena.previousSeason?.claimed) return sendPhase(api, event, "✅ Phần thưởng mùa này đã được nhận trước đó.");
        const reward = [500, 300, 150][rank];
        player.arena.previousSeason.claimed = true;
        player.sectStones = (Number(player.sectStones) || 0) + reward;
        savePlayer(stored, player); await Users.setData(uid, stored);
        return send(api, event, `🏆 VINH DANH TRANH ĐOẠT ${targetSeason}!\n🎖️ Thứ hạng: Top ${rank + 1}\n💎 Thưởng: +${reward} linh thạch tông môn\n🏯 Số dư: ${player.sectStones}`);
      }
      if (["thamgia", "join"].includes(sub)) {
        const a = arena.ensureArena(player);
        a.joinedSeason = currentSeason;
        savePlayer(stored, player); await Users.setData(uid, stored);
        return send(api, event, `⚔️ ĐÃ GHI DANH TRANH ĐOẠT ${currentSeason}!\n🏆 Mỗi trận PvP thắng nhận 30 điểm mùa.\n🎁 Top 3 cuối mùa nhận thưởng linh thạch tông môn.`);
      }
      const contest = arena.contestStatus(Users.getAll());
      const lines = contest.rows.length ? contest.rows.slice(0, 10).map((row, i) => `${i + 1}. ${row.name} — ${row.seasonPoints} điểm`) : ["Chưa có đạo hữu ghi danh mùa này."];
      return send(api, event, `🏆 TRANH ĐOẠT TIÊN BẢNG ${contest.id}\n⚔️ Ghi danh: /tutien tranhdoat thamgia\n🎁 Phần thưởng: Top 1 +500, Top 2 +300, Top 3 +150 linh thạch tông môn.\n━━━━━━━━━━━━━━━━━━\n${lines.join("\n")}`);
    }

    if (["profile", "info", "hoso"].includes(action)) {
      savePlayer(stored, player); await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "🧿 ĐANG KẾT NỐI MỆNH ĐĂNG...", delay: 420 },
        { message: "📖 Đang dò xét kinh mạch và căn cơ tu luyện...", delay: 420 }
      ]);
      return send(api, event, profileText(player));
    }

    if (["tuluyen", "tu-luyen", "cultivate"].includes(action)) {
      const result = engine.cultivate(player);
      if (!result.ok) return sendPhase(api, event, `🧘 Đạo hữu đang vận công. Còn ${Math.ceil(result.remainingMs / 1000)} giây mới có thể tiếp tục.`);
      savePlayer(stored, result.player); await Users.setData(uid, stored);
      for (const stage of [
        { fraction: 0.25, text: "🧘 NHẬP ĐỊNH — Điều tức, ổn định tâm mạch..." },
        { fraction: 0.55, text: "🌫️ TỤ KHÍ — Linh khí bắt đầu hội tụ quanh thân..." },
        { fraction: 0.85, text: "🌀 VẬN CHU THIÊN — Linh lực lưu chuyển qua kinh mạch..." }
      ]) {
        const interim = Math.min(result.player.cultivation, Math.max(0, result.player.cultivation - result.gain + Math.floor(result.gain * stage.fraction)));
        await effects.phase(`${stage.text}\nTu vi: [${progressBar(interim, result.required)}] ${interim}/${result.required}`, { delayMs: 540 });
      }
      const missions = engine.missionStatus(result.player);
      return send(api, event, `✨ HẤP THU LINH KHÍ THÀNH CÔNG!
➕ Tu vi +${result.gain}
💎 Linh thạch thường +3
🏯 Nhiệm vụ tu luyện: ${result.player.missions.cultivationCount} lần hôm nay
🎁 Nhiệm vụ có thể nhận: ${missions.filter((m) => m.claimable).length}
🎖️ Cảnh giới: ${engine.realmLabel(result.player)}
📊 [${progressBar(result.player.cultivation, result.required)}] ${result.player.cultivation}/${result.required}
Dùng /tutien nhiemvu để nhận linh thạch tông môn.`);
    }

    if (["luyennhanh", "tu-luyen-nhanh", "fast"].includes(action)) {
      const result = engine.fastCultivate(player);
      if (!result.ok && result.code === "NEED_SECT_STONES") return sendPhase(api, event, `🏯 Chưa đủ linh thạch tông môn. Cần thêm ${result.missing}; hãy hoàn thành nhiệm vụ tông môn.`);
      if (!result.ok && result.code === "COOLDOWN") return sendPhase(api, event, `⏳ Tụ Linh Trận đang hồi phục. Chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      savePlayer(stored, result.player); await Users.setData(uid, stored);
      await runPhases(api, event, [
        { message: "🏯 TÔNG MÔN KÍCH HOẠT TỤ LINH TRẬN...", delay: 500 },
        { message: `💎 Đã hiến tế ${result.cost} linh thạch tông môn vào trận nhãn...`, delay: 500 },
        { message: "🌪️ Linh khí tăng tốc vận chuyển, kinh mạch được khai thông...", delay: 560 }
      ]);
      return send(api, event, `⚡ TỤ LINH TRẬN HOÀN TẤT!
➕ Tu vi tăng: +${result.gain}
🏯 Linh thạch tông môn còn: ${result.player.sectStones}
✨ Tu vi hiện tại: ${result.player.cultivation}/${result.required}
Lần luyện nhanh tiếp theo sau 60 giây.`);
    }

    if (["nhiemvu", "nhiem-vu", "mission"].includes(action)) {
      const sub = String(args[1] || "list").toLowerCase();
      if (["diem-danh", "diemdanh", "checkin"].includes(sub)) {
        const result = engine.dailyCheckIn(player);
        if (!result.ok) return sendPhase(api, event, "📅 Đạo hữu đã điểm danh hôm nay. Hãy tiếp tục tu luyện để hoàn thành nhiệm vụ khác.");
        savePlayer(stored, result.player); await Users.setData(uid, stored);
        await runPhases(api, event, [
          { message: "📯 Chuông tiên môn vang lên, ghi nhận đạo hữu điểm danh...", delay: 450 },
          { message: "📜 Nhiệm vụ điểm danh đã hoàn thành. Thưởng đang chờ nhận...", delay: 450 }
        ]);
        return send(api, event, "✅ Điểm danh thành công! Dùng /tutien nhiemvu nhan để nhận 20 linh thạch tông môn.");
      }
      if (["nhan", "claim", "reward"].includes(sub)) {
        const result = engine.claimMissions(player);
        if (!result.ok) return sendPhase(api, event, "🎁 Hiện chưa có nhiệm vụ nào hoàn thành để nhận thưởng.");
        savePlayer(stored, result.player); await Users.setData(uid, stored);
        await runPhases(api, event, [
          { message: "📜 Tông Môn đang kiểm duyệt công tích...", delay: 450 },
          { message: "💎 Linh thạch tông môn đang được chuyển vào túi trữ vật...", delay: 500 }
        ]);
        return send(api, event, `🎉 NHẬN THƯỞNG NHIỆM VỤ THÀNH CÔNG!
${result.claimed.map((m) => `✅ ${m.name}: +${m.reward}`).join("\n")}
━━━━━━━━━━━━━━━━━━━━
🏯 Tổng nhận: +${result.reward} linh thạch tông môn
💎 Số dư: ${result.player.sectStones}
Dùng /tutien luyennhanh để tăng tu vi nhanh.`);
      }
      await effects.phase("📜 Đang mở bảng công tích của DEVTRAN TIÊN TÔNG...", { delayMs: 520 });
      return send(api, event, formatMissions(player));
    }

    if (["dotkiem", "do-kiem", "thienkiep", "tribulation"].includes(action)) {
      const result = engine.tribulation(player);
      if (!result.ok && result.code === "NOT_READY") return sendPhase(api, event, `🌩️ Thiên kiếp chưa giáng. Tu vi còn thiếu ${result.missing} điểm (cần ${result.required}).`);
      if (!result.ok && result.code === "NEED_STONES") return sendPhase(api, event, `💎 Cần ${result.cost} linh thạch thường để lập trận độ kiếp.`);
      if (!result.ok && result.code === "COOLDOWN") return sendPhase(api, event, `⏳ Thiên kiếp đang tích tụ. Chờ ${Math.ceil(result.remainingMs / 1000)} giây.`);
      if (!result.ok && result.code === "MAX_REALM") return sendPhase(api, event, "👑 Ngươi đã đạt Tiên Đế Cửu Phẩm — đỉnh cao của Tiên Đạo!");
      savePlayer(stored, result.player); await Users.setData(uid, stored);

      const phases = result.isFinalTribulation ? [
        { message: "🌩️ CỬU TRỌNG THIÊN KIẾP — Mây đen phủ kín tiên sơn...", delay: 700 },
        { message: "⚡ ĐỆ NHẤT LÔI — Thiên lôi đánh xuống hộ thể trận!", delay: 700 },
        { message: "⚡ ĐỆ NGŨ LÔI — Đạo cơ rung chuyển, nguyên thần chống đỡ...", delay: 700 },
        { message: "🔥 ĐỆ CỬU LÔI — Sinh tử chỉ còn trong một niệm!", delay: 800 }
      ] : result.isRealmAdvance ? [
        { message: "🏯 ĐẠI THIÊN KIẾP — Tông môn mở hộ sơn đại trận...", delay: 560 },
        { message: "🌩️ Lôi vân tụ hội, đạo cơ và nguyên thần cùng chịu khảo nghiệm...", delay: 620 },
        { message: "⚡ Thiên lôi giáng xuống! Cảnh giới sắp được định đoạt...", delay: 680 }
      ] : [
        { message: "🌩️ TIỂU THIÊN KIẾP — Linh lực hội tụ quanh đan điền...", delay: 520 },
        { message: "⚡ Thiên lôi thử thách kinh mạch, đạo tâm giữ vững...", delay: 560 },
        { message: "💠 Linh đài chấn động — kết quả sắp hiển lộ...", delay: 600 }
      ];
      await runPhases(api, event, phases);
      if (result.success) return send(api, event, `🌟 ĐỘ KIẾP THÀNH CÔNG! 🌟
☯ Cảnh giới trước: ${result.previousRealm}
☯ Cảnh giới mới: ${result.newRealm}
❤️ Sinh lực: ${result.player.hp}/${result.player.maxHp}
⚔️ Công kích: ${result.player.attack}
🛡️ Phòng ngự: ${result.player.defense}
💎 Linh thạch còn: ${result.player.spiritStones}
${result.isFinalTribulation ? "👑 Ngươi đã vượt Cửu Trọng Thiên Kiếp và bước vào Chân Tiên!" : result.isRealmAdvance ? "🌌 Đại cảnh giới mới đã được khai mở!" : "✨ Tu vi tiến thêm một tầng!"}`);
      return send(api, event, `💥 ĐỘ KIẾP THẤT BẠI!
Thiên lôi phản phệ, sinh lực tổn thất ${result.damage}.
❤️ Sinh lực còn: ${result.player.hp}/${result.player.maxHp}
✨ Tu vi còn: ${result.player.cultivation}/${result.required}
💎 Linh thạch đã tiêu hao: ${result.cost}
Thiên Đạo chưa tuyệt đường sinh cơ. Hãy hồi phục rồi thử lại.`);
    }

    if (["help", "bang", "menu"].includes(action)) {
      await effects.phase("📜 Thiên Đạo truyền xuống tu tiên bí lục...", { delayMs: 520 });
      return send(api, event, `☯ JOHNTRAN – TIÊN ĐẠO VÔ HẠN V4 ☯
/tutien batdau   – Tạo nhân vật bằng tên + avatar Zalo
/tutien profile  – Xem hồ sơ tu sĩ
/tutien tuluyen  – Tu luyện thường (hồi 30 giây)
/tutien dotkiem  – Tiểu kiếp/Đại kiếp để tăng cảnh giới
/tutien tongmon  – Xem Tông Môn DEVTRAN duy nhất
/tutien nhiemvu  – Xem nhiệm vụ tông môn
/tutien nhiemvu diem-danh – Điểm danh hằng ngày
/tutien nhiemvu nhan – Nhận linh thạch tông môn
/tutien luyennhanh – Tiêu linh thạch tông môn để tăng tu vi
/tutien help     – Xem hướng dẫn

🏯 DEVTRAN TIÊN TÔNG là tông môn duy nhất; Tông Chủ là admin_bot đầu tiên.
🎁 Nhiệm vụ mỗi ngày thưởng linh thạch tông môn.
⚡ Luyện nhanh tiêu 30 linh thạch tông môn để nhận 100+ tu vi.
🌩️ Chỉ còn một con đường thăng cảnh giới: ĐỘ KIẾP.
Không có lệnh đột phá riêng và không thể lập tông môn khác.`);
    }

    return sendPhase(api, event, "❓ Đạo pháp không tồn tại. Dùng /tutien help để xem các lệnh hiện có.");
  });
}

module.exports.run = async function (context = {}) {
  const effects = createTuTienEffects(context);
  try {
    return await runTuTien(context, effects);
  } catch (error) {
    await effects.fail();
    throw error;
  }
};

module.exports._test = {
  progressBar,
  withUserLock,
  typingIndicator,
  sendPhase,
  runPhases,
  profileText,
  formatMissions,
  getZaloIdentity,
  getSectMasterId,
  runTuTien
};
