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
  cooldowns: 0,
  // Guard must inspect prefixed commands too, to protect links/bad words in args.
  allowCommandMessages: true
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
  // Include caption plus nested Zalo metadata (shared cards, links, propertyExt).
  try { return JSON.stringify(data || ""); }
  catch { return String(data?.content || ""); }
}

function withDeleteStatus(deleted, error) {
  if (deleted) return "✅ Tin vi phạm đã được xóa.";
  return "⚠️ Bot chưa xóa được tin vi phạm: " + String(error?.message || error || "API Zalo không hỗ trợ.");
}

function inspectGuardViolation(data, thread = {}) {
  // Anti-Link already owns URLs for groups where either Anti link rule is ON.
  const antiLinkOwnsUrls = thread.anti_danger_link === true || thread.anti_link === true;
  const urls = anti._test.extractMessageUrls(data);
  const allowed = defaultAllowedHosts().concat(
    Array.isArray(thread.guard_allowed_hosts) ? thread.guard_allowed_hosts : []
  );
  const blockedUrl = antiLinkOwnsUrls
    ? null
    : urls.find(url => anti._test.isGroupInviteUrl(url) || !isAllowedLink(url, allowed));
  const badword = badwordHit(getMessageText(data));
  return { blockedUrl, badword };
}

async function readGuardThread(Threads, threadId, initialRecord = null) {
  let record = initialRecord || null;
  if (!record) {
    try { record = Threads?.getCachedData?.(String(threadId)) || null; } catch {}
  }
  if (!record) record = await Threads.getData(threadId);
  return { ...(record?.data || record || {}) };
}

module.exports.run = async function ({ api, event, Threads, isSelf, threadData = null }) {
  if (isSelf) return;
  const { data = {}, threadId } = event || {};
  const uid = String(data.uidFrom || "");
  if (!threadId || !uid) return;

  // Fast reject before any group-admin API request or serialized queue.
  let initialThread;
  try {
    initialThread = await readGuardThread(Threads, threadId, threadData);
  } catch {
    return;
  }
  if (initialThread.event_guard !== true) return;

  const initialViolation = inspectGuardViolation(data, initialThread);
  if (!initialViolation.blockedUrl && !initialViolation.badword) return;

  // Admin members only need a live role check when the message is an actual
  // Guard violation, not for every harmless message in every active group.
  const hasAdminFlag = data.isGroupAdmin === true || data.isAdmin === true || data.isGroupAdmin === 1;
  if (hasAdminFlag || await getGroupAdminState(api, threadId, uid) !== false) return;

  return runThreadQueue(threadId, async () => {
    const thread = await readGuardThread(Threads, threadId);
    if (thread.event_guard !== true) return;

    // Re-check against the latest group settings after entering the warning lock.
    const { blockedUrl, badword } = inspectGuardViolation(data, thread);
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

module.exports._test = { defaultAllowedHosts, isAllowedLink, badwordHit, getMessageText, inspectGuardViolation, WARN_LIMIT };
