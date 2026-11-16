const { convertTimestamp, getMessageCache } = require("../../utils/index");
const fs = require("fs").promises;
const path = require("path");
const { ThreadType } = require("zalo-client");
const http = require("../../core/http");

module.exports.config = {
  name: "anti",
  version: "1.1.7",
  role: 1,
  author: "ShinTHL09",
  description: "Bật/tắt các chế độ Anti của nhóm",
  category: "Nhóm",
  usage: "anti <link|undo|spam>",
  cooldowns: 2
};

const baseUndoMsg = `👤 {name} đã thu hồi tin nhắn sau...\n` +
  `⏰ Thời gian gửi: {time_send}\n` +
  `🔔 Thời gian thu hồi: {time_undo}\n` +
  `📝 Nội Dung: {content}`;

function formatUndoMessage(name, timeSend, timeUndo, content) {
  return baseUndoMsg
    .replace('{name}', name)
    .replace('{time_send}', convertTimestamp(timeSend))
    .replace('{time_undo}', convertTimestamp(timeUndo))
    .replace('{content}', content || "");
}

async function handlePhoto(messageCache, tempPath, name, timeSend, timeUndo, threadId, api, type) {
  const tempFilePath = path.join(tempPath, `anti_undo_${Date.now()}.jpg`);
  const { buffer } = await http.getBuffer(messageCache.content.href);

  await fs.mkdir(tempPath, { recursive: true });
  await fs.writeFile(tempFilePath, buffer);

  const message = messageCache.content.title || "";
  const msgBody = formatUndoMessage(name, timeSend, timeUndo, message);

  await api.sendMessage({ msg: msgBody, attachments: [tempFilePath] }, threadId, type);
  return tempFilePath;
}

async function isAdmin(api, userId, threadId) {
  if (userId == null || typeof api?.getGroupInfo !== "function") return null;

  const info = await api.getGroupInfo(threadId);
  const groupInfo = info?.gridInfoMap?.[threadId];
  // Missing role metadata is "unknown", not proof that the sender is a member.
  if (!groupInfo || (groupInfo.creatorId == null && !Array.isArray(groupInfo.adminIds))) {
    return null;
  }

  const uid = String(userId);
  const isCreator = groupInfo.creatorId != null && String(groupInfo.creatorId) === uid;
  const isDeputy = Array.isArray(groupInfo.adminIds) &&
    groupInfo.adminIds.some(id => String(id) === uid);

  return isCreator || isDeputy;
}


module.exports.handleEvent = async function ({ event, api, Threads, eventType, isSelf }) {
  const { threadId, isGroup, data, type } = event;
  const typeUndo = isGroup ? 1 : 0;
  const userId = data.uidFrom;
  const name = data.dName || "Bạn";

  // Không xử lý hành động của chính bot (tự xoá link/spam của bot, anti_undo tin bot)
  if (isSelf) return;

  const threadData = (await Threads.getData(threadId)).data || {};
  const tempPath = path.join(__dirname, "temp");
  const tempFiles = [];
  let groupAdminCheck = null;

  // Reuse one Zalo group-info lookup for every Anti rule on this message.
  // Unknown role metadata fails safe: do not delete a message that may belong to an admin.
  const isAdminOrUnknown = () => {
    if (!groupAdminCheck) {
      groupAdminCheck = isAdmin(api, userId, threadId).catch(() => null);
    }
    return groupAdminCheck.then(result => result !== false);
  };

  try {
    // === Anti Link ===
    if (threadData.anti_link) {
      if ((data.msgType == "chat.recommended" && data.content.action == "recommended.link") || (data.msgType == "webchat" && String(data.content).match(/https?:\/\/[^\s]+/))) {
        if (await isAdminOrUnknown()) return;
        await api.deleteMessage({
          threadId,
          type,
          data: {
            cliMsgId: data.cliMsgId,
            msgId: data.msgId,
            uidFrom: userId
          }
        }, false);

        const msg = `🚫 @${name}, không được gửi link trong nhóm này!`;
        return api.sendMessage({
          msg,
          mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
        }, threadId, type);
      }
    }

    // === Anti Spam ===
    const SPAM_LIMIT = 5;
    const SPAM_TIME = 5000;
    const now = Date.now();

    global.spamCache = global.spamCache || {};
    const spamCache = global.spamCache;

    if (threadData.anti_spam) {
      if (!spamCache[threadId]) spamCache[threadId] = {};
      if (!spamCache[threadId][userId]) spamCache[threadId][userId] = [];

      if (await isAdminOrUnknown()) return;

      spamCache[threadId][userId].push(now);
      spamCache[threadId][userId] = spamCache[threadId][userId].filter(ts => now - ts <= SPAM_TIME);

      if (spamCache[threadId][userId].length > SPAM_LIMIT) {
        await api.deleteMessage({
          threadId,
          type,
          data: {
            cliMsgId: data.cliMsgId,
            msgId: data.msgId,
            uidFrom: userId
          }
        }, false);

        const msg = `🚫 @${name}, vui lòng không spam!`;
        return api.sendMessage({
          msg,
          mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
        }, threadId, type);
      }
    }

    // === Anti Undo ===
    if (threadData.anti_undo && eventType === "undo") {
      const messageCache = getMessageCache()[data.content.cliMsgId];
      if (!messageCache) return;

      const timeSend = messageCache.timestamp;
      const timeUndo = data.ts;

      const sendUndoMessage = async (msg, extra) => {
        await api.sendMessage({ msg, ...(extra || {}) }, threadId, typeUndo);
      };

      switch (messageCache.msgType) {
        case "chat.photo": {
          const filePath = await handlePhoto(messageCache, tempPath, name, timeSend, timeUndo, threadId, api, typeUndo);
          tempFiles.push(filePath);
          break;
        }

        case "chat.video.msg": {
          const { href: videoUrl, thumb: thumbnailUrl, params } = messageCache.content;
          const { duration, video_width: width, video_height: height } = JSON.parse(params);

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendVideo({ videoUrl, thumbnailUrl, duration, height, width }, threadId, typeUndo);
          break;
        }

        case "chat.sticker": {
          const { id, catId, type: stickerType } = messageCache.content;

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendSticker({ id, cateId: catId, type: stickerType }, threadId, typeUndo);
          break;
        }

        case "chat.voice": {
          const { href: voiceUrl } = messageCache.content;

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendVoice({ voiceUrl }, threadId, typeUndo);
          break;
        }

        case "chat.recommended": {
          const { action, href, title, params } = messageCache.content;

          if (action === "recommended.link") {
            const msg = formatUndoMessage(name, timeSend, timeUndo, title.replace(href, ""));
            await api.sendLink({ msg, link: href }, threadId, typeUndo);
          } else if (action === "recommended.user") {
            await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
            await api.sendCard({ userId: params }, threadId, typeUndo);
          }
          break;
        }

        case "chat.gif":
        case "share.file": {
          const fileUrl = messageCache.content?.href;
          if (!fileUrl) break;

          try {
            const response = await http.request(fileUrl);

            let fileName = `anti_undo_${Date.now()}.dat`;

            const disposition = response.headers["content-disposition"];
            if (disposition && disposition.includes("filename=")) {
              const match = disposition.match(/filename="?([^"]+)"?/);
              if (match && match[1]) {
                fileName = `${Date.now()}_${match[1]}`;
              }
            }

            const tempFilePath = path.join(tempPath, fileName);
            await fs.writeFile(tempFilePath, response.body);

            const msgBody = formatUndoMessage(name, timeSend, timeUndo, messageCache.content.title || "");

            await api.sendMessage({
              msg: msgBody,
              attachments: [tempFilePath]
            }, threadId, typeUndo);

            tempFiles.push(tempFilePath);
          } catch (err) {
            console.error("[share.file] Download failed:", err.message);
          }
          break;
        }

        case "webchat": {
          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo, messageCache.content));
          break;
        }
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý anti:", err);
  } finally {
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch (err) {
        console.error(`Không thể xóa file tạm ${file}:`, err);
      }
    }
  }
};

module.exports.run = async function ({ api, event, args, Threads }) {
  const { threadId, type } = event;
  const action = (args[0] || "").toLowerCase();

  if (type !== ThreadType.Group) {
      return api.sendMessage("Lệnh này chỉ có thể được sử dụng trong nhóm chat.", threadId, type);
  }

  const keyMap = {
    link: "anti_link",
    undo: "anti_undo",
    spam: "anti_spam"
  };

  const key = keyMap[action];

  if (!key) {
    return api.sendMessage({
      plain: true,
      msg: "🛡️ Quản lý chế độ Anti của nhóm\n\n" +
      "• anti undo [on|off] - Chống thu hồi tin nhắn\n" +
      "• anti link [on|off] - Chống gửi link\n" +
      "• anti spam [on|off] - Chống spam tin nhắn\n" +
      "• không ghi on/off = bật/tắt (toggle)"
    }, threadId, type);
  }

  const threadData = await Threads.getData(threadId);
  const currentValue = threadData.data[key] || false;
  // on/off tường minh nếu có tham số thứ 2, không thì toggle
  const mode = (args[1] || "").toLowerCase();
  const newValue = mode === "on" ? true : mode === "off" ? false : !currentValue;

  threadData.data[key] = newValue;
  await Threads.setData(threadId, threadData.data);

  return api.sendMessage({
    plain: true,
    msg: `✅ Đã ${newValue ? "bật" : "tắt"} chế độ Anti ${key.replace("anti_", "").toUpperCase()}.`
  }, threadId, type);
};
