// ===== EVENT MỚI: GUARD — canh link lạ & từ cấm trong nhóm =====
// Tin nhắn chứa link KHÔNG nằm trong danh sách cho phép, hoặc chứa từ cấm
// (assets/spam/badwords.txt) → reaction 🚫 + cảnh cáo. Đủ 3 cảnh cáo thì kick.
// Bật/tắt: /events guard on|off
//
// ⚠️ Không xoá tin người khác được (Zalo không cho bot xoá tin member) nên
// cách làm an toàn nhất là cảnh cáo + kick khi tái phạm.
const fs = require("fs");
const path = require("path");
const { Reactions } = require("zalo-client");
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const { runThreadQueue } = require("../../core/runtime/threadQueue");

const BADWORDS_FILE = path.join(__dirname, "..", "..", "assets", "spam", "badwords.txt");
const WARN_LIMIT = 3; // số cảnh cáo trước khi kick
const LINK_RE = /(https?:\/\/[^\s<>"']+)/i;

let badwords = [];
function loadBadwords() {
  try {
    badwords = fs.readFileSync(BADWORDS_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.toLowerCase());
  } catch {
    badwords = [];
  }
  return badwords;
}
loadBadwords();

// Host được phép (nhóm tự add qua /events guard allow <host>)
function defaultAllowedHosts() {
  return [
    "youtube.com", "youtu.be", "facebook.com", "fb.watch", "tiktok.com",
    "instagram.com", "soundcloud.com", "spotify.com", "zalo.me", "imgur.com"
  ];
}

module.exports.config = {
  name: "guard",
  event_type: ["message"],
  version: "1.0.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Cảnh cáo link lạ / từ cấm, tái phạm sẽ kick",
  category: "Sự kiện",
  usage: "events guard on|off",
  cooldowns: 0
};

function containsLink(text) {
  return LINK_RE.test(text);
}

function isAllowedLink(url, allowed) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowed.some((a) => host === a || host.endsWith(`.${a}`));
  } catch {
    return false;
  }
}

function badwordHit(text) {
  const lower = text.toLowerCase();
  return badwords.find((word) => word && lower.includes(word));
}

module.exports.run = async function ({ api, event, Threads, isSelf }) {
  if (isSelf) return;

  const { data, threadId } = event;
  const content = String(data?.content || "");
  const uid = String(data?.uidFrom || "");
  if (!threadId || !uid || !content) return;

  const hasAdminFlag = data?.isGroupAdmin === true || data?.isAdmin === true || data?.isGroupAdmin === 1;
  if (hasAdminFlag || await getGroupAdminState(api, threadId, uid) !== false) return;

  return runThreadQueue(threadId, async () => {
    const record = await Threads.getData(threadId);
    const thread = { ...(record?.data || {}) };
    if (!thread.event_guard) return;

    const allowed = defaultAllowedHosts().concat(Array.isArray(thread.guard_allowed_hosts) ? thread.guard_allowed_hosts : []);
    const link = content.match(LINK_RE)?.[1];
    const hasBadLink = containsLink(content) && !isAllowedLink(link, allowed);
    const badword = badwordHit(content);
    if (!hasBadLink && !badword) return;

    const warnKey = `guardWarn_${uid}`;
    const warns = (Number(thread[warnKey]) || 0) + 1;
    thread[warnKey] = warns;
    const reason = hasBadLink
      ? `🔗 Link không nằm trong danh sách cho phép (${link?.slice(0, 40)})`
      : `🚫 Tin chứa từ cấm "${badword}"`;

    const save = Threads.setDataAndWait || Threads.setData;
    await save.call(Threads, threadId, thread);

    if (warns >= WARN_LIMIT) {
      try {
        await api.removeUserFromGroup(uid, threadId);
      } catch (error) {
        console.error("Không kick được thành viên:", error.message);
        return api.sendMessage({
          msg: `🚫 ${reason}\\n⚠️ Cảnh cáo ${warns}/${WARN_LIMIT} (không kick được: ${error.message})`
        }, threadId, event.type);
      }

      thread[warnKey] = 0;
      await save.call(Threads, threadId, thread);
      return api.sendMessage({
        msg: `⛔ Đã kick thành viên vi phạm ${WARN_LIMIT} lần.\\nLý do: ${reason}`
      }, threadId, event.type);
    }

    try {
      await api.addReaction(Reactions.LIKE, {
        data: { msgId: data.msgId, cliMsgId: data.cliMsgId },
        threadId,
        type: event.type
      });
    } catch { /* bỏ qua */ }
    return api.sendMessage({
      msg: `🚨 ${reason}\\n⚠️ Cảnh cáo ${warns}/${WARN_LIMIT} — đủ ${WARN_LIMIT} lần sẽ bị kick.`
    }, threadId, event.type);
  });
};
