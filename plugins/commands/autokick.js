// Tự động kick thành viên vi phạm từ cấm (lưu theo nhóm trong DB)
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");

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
  dependencies: {}
};

async function getConfig(threadId) {
  const Threads = require("../../core/controller/controllerThreads");
  const thread = await Threads.getData(threadId);
  return (thread && thread.data) || {};
}

async function setConfig(threadId, data) {
  const Threads = require("../../core/controller/controllerThreads");
  await Threads.setData(threadId, data);
}

function getAutoKick(data) {
  if (!data.auto_kick) data.auto_kick = { enabled: false, words: [], violations: {} };
  if (!Array.isArray(data.auto_kick.words)) data.auto_kick.words = [];
  if (!data.auto_kick.violations) data.auto_kick.violations = {};
  return data.auto_kick;
}

module.exports.run = async function ({ api, event, args }) {
  const { threadId, type } = event;
  const data = await getConfig(threadId);
  const autoKick = getAutoKick(data);
  const action = (args[0] || "").toLowerCase();

  if (action === "on" || action === "off") {
    autoKick.enabled = action === "on";
    await setConfig(threadId, data);
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
    await setConfig(threadId, data);
    return api.sendMessage({ msg: `✅ Đã thêm ${added.length} từ vào danh sách cấm.` }, threadId, type);
  }

  if (action === "del") {
    const words = args.slice(1).join(" ").split(",").map((w) => w.trim().toLowerCase());
    const removed = words.filter((w) => autoKick.words.includes(w));
    autoKick.words = autoKick.words.filter((w) => !words.includes(w));
    autoKick.violations = {};
    await setConfig(threadId, data);
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
      "Quy tắc: vi phạm lần 1-2 cảnh báo, lần 3 sẽ bị kick."
  }, threadId, type);
};

module.exports.handleEvent = async function ({ api, event, Threads }) {
  const { threadId, type, data } = event;
  if (!data?.content || typeof data.content !== "string") return;

  const uid = data.uidFrom;
  const thread = await Threads.getData(threadId);
  const autoKick = getAutoKick(thread.data || {});
  if (!autoKick.enabled || autoKick.words.length === 0) return;

  const isAdmin = global.users?.admin?.includes(uid) || global.users?.support?.includes(uid);
  if (isAdmin) return;

  // Never apply an automatic kick unless Zalo confirms the sender is not
  // a group admin. Missing role metadata or API errors are treated as unknown.
  if (await getGroupAdminState(api, threadId, uid) !== false) return;

  const content = data.content.toLowerCase();
  const found = autoKick.words.find((w) => new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(content));
  if (!found) return;

  const violations = (autoKick.violations[uid] || 0) + 1;
  autoKick.violations[uid] = violations;
  await Threads.setData(threadId, thread.data);

  if (violations >= 3) {
    try {
      const name = data.dName || uid;
      await api.removeUserFromGroup(uid, threadId);
      delete autoKick.violations[uid];
      await Threads.setData(threadId, thread.data);
      return api.sendMessage({ msg: `🚫 Đã kick ${name} do vi phạm từ cấm "${found}" ${violations} lần.` }, threadId, type);
    } catch (error) {
      console.error("Lỗi kick:", error.message);
      return api.sendMessage({ msg: "⚠️ Không thể kick thành viên này (thiếu quyền quản trị)." }, threadId, type);
    }
  }

  return api.sendMessage({
    msg: `⚠️ Cảnh báo ${data.dName || uid}: dùng từ cấm "${found}" (lần ${violations}/3). Lần thứ 3 sẽ bị kick!`
  }, threadId, type);
};
