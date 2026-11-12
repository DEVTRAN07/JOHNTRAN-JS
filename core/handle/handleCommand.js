const logger = require("../../utils/logger");
const { wrapForThread } = require("../runtime/adapters/zalo");
const metrics = require("../metrics");
const fs = require("fs");
const path = require("path");
const { performance } = require("node:perf_hooks");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { getRequesterProfile } = require("../runtime/requesterProfile");
const { renderCanvas } = require("../canvas/workerRender");


const { ThreadType, Reactions } = require("zalo-client");
const { getFolderReaction } = require("../runtime/folderReaction");

const ADMIN_GROUPS_FILE = path.join(__dirname, "..", "..", "data", "bot_admin_groups.json");

function readAdminGroups() {
  try { return JSON.parse(fs.readFileSync(ADMIN_GROUPS_FILE, "utf8")) || []; } catch { return []; }
}


const { resolve: resolveCommand } = require("../runtime/commandRegistry");
const { commandLimiter } = require("../runtime/rateLimiter");
const { checkCommandRole, checkGroupPermissions } = require("../runtime/middleware/permissions");
const { consumeCooldown } = require("../runtime/middleware/cooldown");
const { dispatchCommand } = require("../runtime/dispatcher");


async function runCommandPipeline(messageText, event = null, api = null, threadInfo = null, prefix = null, threadData = null) {
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
  const folderMenuRuntime = require("../runtime/folderMenu");
  const menuGroupShortcut = folderMenuRuntime.resolveMenuGroup(global.client.commands, UIDUsage, commandName);
  if (threadInfo?.bot_enabled === false && !["mybot", "status", "menu"].includes(commandName)) {
    return wrappedApi.sendMessage({ msg: "⏸️ Bot đang tắt trong nhóm này. Quản trị viên dùng /mybot on để bật lại." }, threadId, type);
  }
  // A bare category shortcut opens its card. Commands with the same name
  // (for example /anti and /admin) still execute normally when arguments exist.
  if (!command || (menuGroupShortcut && args.length === 0)) {
    try {
      const folderMenu = folderMenuRuntime;
      const folder = menuGroupShortcut;
      if (folder) {
        // Category shortcuts bypass dispatchCommand(), so use a reaction that
        // matches the folder instead of leaving the original command unreacted.
        void wrappedApi.__reply?.react(getFolderReaction(folder.slug));
        const items = folderMenu.collectMenuGroupCommands(global.client.commands, UIDUsage, folder);
        // Các thư mục luôn có thẻ riêng; nhóm rỗng vẫn hiển thị đúng bố cục và báo chưa có lệnh trong caption.
        const version = require("../../package.json").version;
        const profile = await getRequesterProfile(api, event, { waitMs: 90, skipAvatarWarm: true });
        const imagePath = await renderCanvas("menu-folder", {
          folderName: folder.name,
          folderDescription: folder.description,
          folderIcon: folder.icon,
          requesterName: profile.requesterName,
          requesterAvatarUrl: profile.requesterAvatarUrl,
          botVersion: version,
          totalCommands: items.length
        }, { timeout: 30000, poolSize: 2 });
        try {
          const mentionName = profile.requesterName;
          const mentionUid = event?.data?.uidFrom;
          const heading = folder.name.toLowerCase() === "game"
            ? "🎮 DANH SÁCH GAME MINI"
            : `${folder.icon || "📂"} DANH SÁCH LỆNH ${folder.name.toLocaleUpperCase("vi-VN")}`;
          const commandLines = items.map(item => `➜ ${prefix}${item.usage || item.name} — ${item.description || "Chưa có mô tả"}`);
          const exampleNames = items.slice(0, 3).map(item => `${prefix}${item.usage || item.name}`);
          const hint = exampleNames.length
            ? `💡 Xem chi tiết cách dùng, hãy gõ trực tiếp: ${exampleNames.join(", ")}...`
            : `📂 Thư mục này chưa có lệnh khả dụng. Gõ ${prefix}menu để xem danh mục khác.`;
          const caption = [
            `@${mentionName}`,
            heading,
            "",
            ...commandLines,
            "",
            `* ${hint} *`
          ].join("\n");
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

  const groupCheckResult = checkGroupPermissions({
    api: wrappedApi,
    threadId,
    isGroup: type == ThreadType.Group,
    UIDUsage,
    threadInfo,
    isBotAdmin,
    isSupport,
    logger
  });
  // Avoid an async/microtask boundary unless live group-admin verification is needed.
  const groupCheck = groupCheckResult && typeof groupCheckResult.then === "function"
    ? await groupCheckResult
    : groupCheckResult;
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

async function handleCommand(messageText, event = null, api = null, threadInfo = null, prefix = null, threadData = null) {
  const startedAt = performance.now();
  const isCommandMessage = typeof messageText === "string" &&
    typeof prefix === "string" && prefix.length > 0 &&
    messageText.startsWith(prefix);

  try {
    return await runCommandPipeline(messageText, event, api, threadInfo, prefix, threadData);
  } finally {
    // Include the complete lifecycle, even when permission/cooldown checks or
    // unknown/disabled command paths return before dispatchCommand().
    if (isCommandMessage) metrics.trackLatency?.(performance.now() - startedAt);
  }
}

module.exports = handleCommand;
module.exports._runCommandPipeline = runCommandPipeline;
