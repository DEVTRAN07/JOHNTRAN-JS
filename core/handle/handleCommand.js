const logger = require("../../utils/logger");
const { wrapForThread } = require("../runtime/adapters/zalo");
const metrics = require("../metrics");
const fs = require("fs");
const path = require("path");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");


const { ThreadType, Reactions } = require("zalo-client");

const ADMIN_GROUPS_FILE = path.join(__dirname, "..", "..", "data", "bot_admin_groups.json");

function readAdminGroups() {
  try { return JSON.parse(fs.readFileSync(ADMIN_GROUPS_FILE, "utf8")) || []; } catch { return []; }
}

const { resolve: resolveCommand } = require("../runtime/commandRegistry");
const { commandLimiter } = require("../runtime/rateLimiter");
const { checkCommandRole, checkGroupPermissions } = require("../runtime/middleware/permissions");
const { consumeCooldown } = require("../runtime/middleware/cooldown");
const { dispatchCommand } = require("../runtime/dispatcher");


async function handleCommand(messageText, event = null, api = null, threadInfo = null, prefix = null, threadData = null) {
  const config = global.config;

  if (!messageText || typeof messageText !== "string") return;
  if (!messageText.startsWith(prefix)) return;

  const threadId = event?.threadId;
  const type = event?.type;
  const UIDUsage = event?.data?.uidFrom;

  if (type == ThreadType.User && config.allow_private_command === false) {
    return;
  }

  const args = messageText.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  const wrappedApi = wrapForThread(api, threadId, type, commandName, event);
  const command = resolveCommand(global.client.commands, commandName);
  if (!command) {
    // Folder shortcuts (/tools, /music, /game...) render category image cards.
    try {
      const folderMenu = require("../runtime/folderMenu");
      const folder = folderMenu.resolveFolder(global.client.commands, UIDUsage, commandName);
      if (folder) {
        const items = folderMenu.collectFolderCommands(global.client.commands, UIDUsage, folder);
        const version = require("../../package.json").version;
        const { renderMenuGrid } = require("../canvas/menu");
        const imagePath = await renderMenuGrid({
          requesterName: String(event?.data?.dName || event?.data?.senderName || "Người dùng").slice(0, 32),
          requesterAvatarUrl: "",
          botVersion: version,
          prefix,
          page: 1,
          totalPages: 1,
          commands: items.map(item => ({
            name: item.name,
            usage: item.usage,
            category: folder.name
          })),
          totalCommands: items.length
        });
        try {
          const mentionName = String(event?.data?.dName || event?.data?.senderName || "Người dùng").slice(0, 32);
          const mentionUid = event?.data?.uidFrom;
          const caption = `@\u200b${mentionName}\n🛠️ Danh sách lệnh ${folder.name}\n👉 Gõ tên lệnh hoặc tag bot để thực thi chức năng ${folder.name}.`;
          const mentions = mentionUid ? [{ uid: String(mentionUid), pos: 0, len: mentionName.length + 1 }] : [];
          return await wrappedApi.sendMessage({
            msg: caption,
            mentions,
            attachments: [imagePath],
            ttlKind: "card"
          }, threadId, type);
        } finally {
          const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
          timer.unref?.();
        }
      }
    } catch (error) {
      logger.log("Không thể dựng Card danh mục lệnh: " + error.message, "warn");
    }
    if (wrappedApi && threadId && type) {
      await wrappedApi.sendMessage({ msg: "⚠️ Lệnh không tồn tại!" }, threadId, type);
    }
    return;
  }

  // Lệnh bị tắt trong nhóm này (quản lý từ panel)
  const disabledCommands = threadInfo?.disabled_commands;
  if (Array.isArray(disabledCommands) && disabledCommands.includes(commandName)) {
    if (wrappedApi && threadId && type) {
      await wrappedApi.sendMessage({ msg: `🚫 Lệnh '${commandName}' đã bị tắt trong nhóm này.` }, threadId, type);
    }
    return;
  }

  if (!commandLimiter.allow(UIDUsage)) {
    return wrappedApi.sendMessage({
      msg: "🚫 Bạn đang gửi lệnh quá nhanh. Vui lòng chậm lại!"
    }, threadId, type);
  }

  const role = command.config.role || 0;
  const isBotAdmin = global.users?.admin?.includes(UIDUsage);
  const isSupport = global.users?.support?.includes(UIDUsage);

  // Bảo mật: lệnh nhạy (role 2 = admin bot) chỉ cho phép chạy trong nhóm
  // đã đăng ký làm admin group qua Panel. Ngăn trường hợp uidFrom bị giả mạo
  // (spoof) thành ID admin từ nhóm lẻ / tin riêng (đã chặn riêng ở trên).
  if (role === 2 && config.admin?.require_admin_group_for_sensitive) {
    const adminGroups = readAdminGroups();
    const isAdminGroup = Array.isArray(adminGroups) && adminGroups.includes(String(threadId));
    if (!isAdminGroup) {
      return wrappedApi.sendMessage({
        msg: "🚫 Lệnh này chỉ được dùng trong nhóm quản trị (admin group) đã đăng ký qua Panel."
      }, threadId, type);
    }
  }

  const roleCheck = checkCommandRole({ role, isBotAdmin, isSupport });
  if (roleCheck.denied) {
    return wrappedApi.sendMessage({ msg: roleCheck.denied }, threadId, type);
  }

  const groupCheck = await checkGroupPermissions({
    api: wrappedApi,
    threadId,
    isGroup: type == ThreadType.Group,
    UIDUsage,
    threadInfo,
    isBotAdmin,
    isSupport,
    logger
  });
  if (groupCheck.denied) {
    return wrappedApi.sendMessage({ msg: groupCheck.denied }, threadId, type);
  }

  const cdTime = (command.config.cooldowns || 0) * 1000;
  // Điều hướng (/menu next, /scl next, /menu out...) không bị cooldown chặn
  const { isNavigation, isCommandNav } = require("./handleCommandNav");
  const isNav = isNavigation(commandName, messageText, prefix) || isCommandNav(commandName, messageText, prefix);

  if (cdTime > 0 && !isNav) {
    const remainingMs = consumeCooldown({
      cooldowns: global.client.cooldowns,
      commandName,
      userId: UIDUsage,
      cooldownMs: cdTime
    });
    if (remainingMs > 0) {
      const timeLeft = (remainingMs / 1000).toFixed(1);
      return wrappedApi.sendMessage({
        msg: `⏳ Vui lòng chờ ${timeLeft}s để dùng lại lệnh '${commandName}'`
      }, threadId, type);
    }
  }

  const cachedUserData = Users.getCachedData?.(UIDUsage) ?? null;
  const userData = cachedUserData || await Users.getData(UIDUsage).catch(() => null);

  await dispatchCommand({
    command,
    commandName,
    args,
    event,
    api: wrappedApi,
    Users,
    Threads,
    threadData,
    userData,
    logger,
    metrics,
    Reactions
  });

}

module.exports = handleCommand;
