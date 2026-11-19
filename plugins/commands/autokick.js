// Tự động kick thành viên vi phạm từ cấm (lưu theo nhóm trong DB)
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const { runThreadQueue } = require("../../core/runtime/threadQueue");
const { ThreadType } = require("zalo-client");

module.exports.config = {
  name: "autokick",
  aliases: ["kick","tucam"],

  version: "2.0.0",
  role: 1,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tự động cảnh báo/kick thành viên dùng từ cấm",
  category: "Nhóm",
  usage: "autokick [on|off|add|del|list]",
  cooldowns: 2,
  dependencies: {},
  event_type: ["message"]
};

async function getConfig(threadId, Threads, threadData) {
  if (threadData && typeof threadData === "object") {
    return threadData?.data && typeof threadData.data === "object"
      ? threadData.data
      : threadData;
  }

  let record = null;
  try { record = Threads?.getCachedData?.(String(threadId)) || null; } catch {}
  if (!record && typeof Threads?.getData === "function") {
    record = await Threads.getData(threadId);
  }
  if (!record) {
    const legacyThreads = require("../../core/controller/controllerThreads");
    record = await legacyThreads.getData(threadId);
  }
  return record?.data || record || {};
}

async function setConfig(threadId, data, Threads) {
  if (typeof Threads?.setDataAndWait === "function") {
    await Threads.setDataAndWait(threadId, data);
    return;
  }
  if (typeof Threads?.setData === "function") {
    await Threads.setData(threadId, data);
    return;
  }
  const legacyThreads = require("../../core/controller/controllerThreads");
  await legacyThreads.setData(threadId, data);
}

function escapeRegExp(value) {
  const specialCodes = new Set([46, 42, 43, 63, 94, 36, 123, 125, 40, 41, 124, 91, 93, 92]);
  return Array.from(String(value), character =>
    specialCodes.has(character.charCodeAt(0))
      ? String.fromCharCode(92) + character
      : character
  ).join("");
}

function getAutoKick(data) {
  if (!data.auto_kick) data.auto_kick = { enabled: false, words: [], violations: {} };
  if (!Array.isArray(data.auto_kick.words)) data.auto_kick.words = [];
  if (!data.auto_kick.violations) data.auto_kick.violations = {};
  return data.auto_kick;
}

module.exports.run = async function ({ api, event, args, Threads, threadData }) {
  const { threadId, type } = event;
  const data = await getConfig(threadId, Threads, threadData);
  const autoKick = getAutoKick(data);
  const action = (args[0] || "").toLowerCase();

  if (action === "on" || action === "off") {
    autoKick.enabled = action === "on";
    await setConfig(threadId, data, Threads);
    return api.sendMessage({ msg: `✅ Autokick đã được ${action === "on" ? "bật" : "tắt"}.` }, threadId, type);
  }

  if (action === "add") {
    const words = args.slice(1).join(" ").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length === 0) {
      return api.sendMessage({ msg: "⚠️ Vui lòng nhập từ cần thêm." }, threadId, type);
    }
    const added = words.filter((w) => !autoKick.words.includes(w));
    autoKick.words.push(...added);
    autoKick.violations = {};
    await setConfig(threadId, data, Threads);
    return api.sendMessage({ msg: `✅ Đã thêm ${added.length} từ vào danh sách cấm.` }, threadId, type);
  }

  if (action === "del") {
    const words = args.slice(1).join(" ").split(",").map((w) => w.trim().toLowerCase());
    const removed = words.filter((w) => autoKick.words.includes(w));
    autoKick.words = autoKick.words.filter((w) => !words.includes(w));
    autoKick.violations = {};
    await setConfig(threadId, data, Threads);
    return api.sendMessage({ msg: `✅ Đã xoá ${removed.length} từ khỏi danh sách.` }, threadId, type);
  }

  if (action === "list") {
    const list = autoKick.words.length > 0
      ? autoKick.words.map((w) => ` - ${w}`).join("\n")
      : "(trống)";
    return api.sendMessage({ msg: `📌 Danh sách từ cấm:\n${list}` }, threadId, type);
  }

  return api.sendMessage({
    msg: "💮=== [ AUTO KICK ] ===💮\n" +
      `${global.config.prefix}autokick on/off — bật/tắt\n` +
      `${global.config.prefix}autokick add <từ> — thêm từ cấm (nhiều từ cách nhau dấu phẩy)\n` +
      `${global.config.prefix}autokick del <từ> — xoá\n` +
      `${global.config.prefix}autokick list — xem danh sách\n\n` +
      "Quy tắc: vi phạm lần 1-3 cảnh cáo, vi phạm lần thứ 4 sẽ bị kick."
  }, threadId, type);
};

async function readThreadData(Threads, threadId) {
  let record = null;
  try { record = Threads?.getCachedData?.(String(threadId)) || null; } catch {}
  if (!record) record = await Threads.getData(threadId);
  return record?.data || record || {};
}

function findMatchingWord(words, content) {
  if (!Array.isArray(words) || !content) return null;
  return words.find(word => String(word || "").trim() &&
    new RegExp(`(^|\\s)${escapeRegExp(word)}(\\s|$)`, "i").test(content)
  ) || null;
}

module.exports.handleEvent = async function ({
  api, event, Threads, eventType = "message", isSelf = false
} = {}) {
  if (eventType !== "message" || isSelf || event?.isSelf) return;
  const { threadId, type, data } = event || {};
  if (!threadId || (type !== ThreadType.Group && type !== 1)) return;

  const content = String(data?.content || "").toLowerCase();
  const uid = String(data?.uidFrom || "");
  if (!uid || !content) return;

  const botAdmins = new Set((global.users?.admin || []).map(String));
  const supports = new Set((global.users?.support || []).map(String));
  if (botAdmins.has(uid) || supports.has(uid)) return;

  // Most messages stop here: no admin API call and no serialized group lock.
  const snapshot = await readThreadData(Threads, threadId);
  const currentAutoKick = snapshot.auto_kick;
  if (!currentAutoKick?.enabled || !Array.isArray(currentAutoKick.words) ||
      currentAutoKick.words.length === 0) return;
  const candidate = findMatchingWord(currentAutoKick.words, content);
  if (!candidate) return;

  // Verify group role only after the message actually matches a configured word.
  if (await getGroupAdminState(api, threadId, uid) !== false) return;

  return runThreadQueue(threadId, async () => {
    const groupData = { ...(await readThreadData(Threads, threadId)) };
    const autoKick = {
      ...(groupData.auto_kick || {}),
      words: Array.isArray(groupData.auto_kick?.words) ? [...groupData.auto_kick.words] : [],
      violations: { ...(groupData.auto_kick?.violations || {}) }
    };
    const found = findMatchingWord(autoKick.words, content);
    if (!autoKick.enabled || !found) return;

    const currentWarnings = Math.min(3, Math.max(0, Math.floor(Number(autoKick.violations[uid]) || 0)));
    const save = Threads.setDataAndWait || Threads.setData;

    if (currentWarnings < 3) {
      const warnings = currentWarnings + 1;
      autoKick.violations[uid] = warnings;
      groupData.auto_kick = autoKick;
      await save.call(Threads, threadId, groupData);
      return api.sendMessage({
        msg: `⚠️ Cảnh cáo ${data.dName || uid}: dùng từ cấm "${found}" (lần ${warnings}/3). Sau 3 cảnh cáo, vi phạm lần thứ 4 sẽ bị kick!`
      }, threadId, type);
    }

    autoKick.violations[uid] = 3;
    groupData.auto_kick = autoKick;
    try {
      const result = await api.removeUserFromGroup(uid, threadId);
      const failedMembers = Array.isArray(result?.errorMembers) ? result.errorMembers.map(String) : [];
      if (failedMembers.includes(uid)) throw new Error("Zalo từ chối kick thành viên (errorMembers)");
    } catch (error) {
      await save.call(Threads, threadId, groupData);
      console.error("Lỗi kick:", error.message);
      return api.sendMessage({
        msg: `⚠️ Không thể kick ${data.dName || uid}. Đã đủ 3 cảnh cáo; bot sẽ thử lại khi tái phạm. ${error.message}`
      }, threadId, type);
    }

    delete autoKick.violations[uid];
    groupData.auto_kick = autoKick;
    await save.call(Threads, threadId, groupData);
    return api.sendMessage({
      msg: `🚫 Đã kick ${data.dName || uid} sau 3 lần cảnh cáo vì tiếp tục dùng từ cấm "${found}".`
    }, threadId, type);
  });
};
