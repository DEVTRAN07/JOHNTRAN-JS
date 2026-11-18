// ===== GUARD — canh link lạ và từ cấm trong nhóm =====
// Ba lần đầu là cảnh cáo. Vi phạm lần thứ tư mới thử kick.
// Bật/tắt: /events guard on|off
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Reactions, ThreadType } = require("zalo-client");
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const { getBotGroupRole } = require("../../core/runtime/botGroupKey");
const { runThreadQueue } = require("../../core/runtime/threadQueue");
const anti = require("../commands/anti");

const BADWORDS_FILE = path.join(__dirname, "..", "..", "assets", "spam", "badwords.txt");
const WARN_LIMIT = 3;

let badwords = [];
function loadBadwords() {
  try {
    badwords = fs.readFileSync(BADWORDS_FILE, "utf8")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => line.toLowerCase());
  } catch {
    badwords = [];
  }
  return badwords;
}
loadBadwords();

function defaultAllowedHosts() {
  // Zalo group-invite links are intentionally not allowlisted.
  return [
    "youtube.com", "youtu.be", "facebook.com", "fb.watch", "tiktok.com",
    "instagram.com", "soundcloud.com", "spotify.com", "imgur.com"
  ];
}

module.exports.config = {
  name: "guard",
  event_type: ["message"],
  version: "1.1.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Cảnh cáo link lạ / từ cấm; đủ 3 cảnh cáo, lần vi phạm thứ 4 sẽ kick",
  category: "Sự kiện",
  usage: "events guard on|off",
  cooldowns: 0
};

function isAllowedLink(url, allowed) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return allowed.some(item => host === item || host.endsWith("." + item));
  } catch {
    return false;
  }
}

function badwordHit(text) {
  const lower = String(text || "").toLowerCase();
  return badwords.find(word => word && lower.includes(word));
}

function getMessageText(data) {
  if (typeof data?.content === "string") return data.content;
  try { return JSON.stringify(data || ""); }
  catch { return ""; }
}

function withDeleteStatus(deleted, error) {
  if (deleted) return "✅ Tin vi phạm đã được xóa.";
  return "⚠️ Bot chưa xóa được tin vi phạm: " + String(error?.message || error || "API Zalo không hỗ trợ.");
}

module.exports.run = async function ({ api, event, Threads, isSelf }) {
  if (isSelf) return;
  const { data = {}, threadId } = event || {};
  const uid = String(data.uidFrom || "");
  if (!threadId || !uid) return;

  // Người quản trị nhóm được miễn guard từ cấm/link lạ.
  const hasAdminFlag = data.isGroupAdmin === true || data.isAdmin === true || data.isGroupAdmin === 1;
  if (hasAdminFlag || await getGroupAdminState(api, threadId, uid) !== false) return;

  return runThreadQueue(threadId, async () => {
    const record = await Threads.getData(threadId);
    const thread = { ...(record?.data || {}) };
    if (!thread.event_guard) return;

    // Anti-Link đã xử lý URL ở handler chính. Tránh nhân đôi cảnh cáo nếu
    // nhóm đồng thời bật /antilink hoặc /anti link; guard vẫn quét từ cấm.
    const antiLinkOwnsUrls = thread.anti_danger_link === true || thread.anti_link === true;
    const urls = anti._test.extractMessageUrls(data);
    const allowed = defaultAllowedHosts().concat(
      Array.isArray(thread.guard_allowed_hosts) ? thread.guard_allowed_hosts : []
    );
    const blockedUrl = antiLinkOwnsUrls
      ? null
      : urls.find(url => anti._test.isGroupInviteUrl(url) || !isAllowedLink(url, allowed));
    const badword = badwordHit(getMessageText(data));
    if (!blockedUrl && !badword) return;

    // Fail closed if the bot itself is not a confirmed group owner/deputy.
    const botRole = await getBotGroupRole(api, threadId);
    if (botRole !== "owner" && botRole !== "deputy") return;

    const warnKey = "guardWarn_" + uid;
    const current = Math.min(WARN_LIMIT, Math.max(0, Math.floor(Number(thread[warnKey]) || 0)));
    const reason = blockedUrl
      ? "🔗 Link không được phép (" + blockedUrl.slice(0, 90) + ")"
      : "🚫 Tin chứa từ cấm \"" + badword + "\"";

    let deleteError = null;
    try {
      await anti._test.deleteGroupMessage(api, event);
    } catch (error) {
      deleteError = error;
    }
    const deleteStatus = withDeleteStatus(!deleteError, deleteError);
    const save = Threads.setDataAndWait || Threads.setData;
    if (typeof save !== "function") return;

    // The first three offences are warnings. Only the next offence kicks.
    if (current < WARN_LIMIT) {
      const warns = current + 1;
      thread[warnKey] = warns;
      await save.call(Threads, threadId, thread);
      try {
        await api.addReaction(Reactions.LIKE, {
          data: { msgId: data.msgId, cliMsgId: data.cliMsgId },
          threadId,
          type: event.type || ThreadType.Group
        });
      } catch { /* reaction is optional */ }
      return api.sendMessage({
        msg: "🚨 " + reason + "\n" +
          "⚠️ Cảnh cáo " + warns + "/3. Sau 3 cảnh cáo, vi phạm lần thứ 4 mới bị kick.\n" +
          deleteStatus
      }, threadId, event.type || ThreadType.Group);
    }

    try {
      await anti._test.kickGroupMember(api, uid, threadId);
    } catch (error) {
      thread[warnKey] = WARN_LIMIT;
      await save.call(Threads, threadId, thread);
      return api.sendMessage({
        msg: "🚫 " + reason + "\n⚠️ Đã đủ 3 cảnh cáo nhưng Zalo chưa cho kick; bot sẽ thử lại lần tái phạm tiếp theo.\n" +
          String(error?.message || error) + "\n" + deleteStatus
      }, threadId, event.type || ThreadType.Group);
    }

    thread[warnKey] = 0;
    await save.call(Threads, threadId, thread);
    return api.sendMessage({
      msg: "⛔ Đã kick thành viên sau 3 lần cảnh cáo.\nLý do: " + reason + "\n" + deleteStatus
    }, threadId, event.type || ThreadType.Group);
  });
};

module.exports._test = { defaultAllowedHosts, isAllowedLink, badwordHit, getMessageText, WARN_LIMIT };
