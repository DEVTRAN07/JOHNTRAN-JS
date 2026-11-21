const logger = require("../../utils/logger");
const { wrapForThread } = require("../runtime/adapters/zalo");
const metrics = require("../metrics");
const fs = require("fs");
const { performance } = require("node:perf_hooks");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { getRequesterProfile } = require("../runtime/requesterProfile");
const { renderCanvas } = require("../canvas/workerRender");
const { readAdminGroups } = require("../runtime/adminGroups");


const { ThreadType, Reactions } = require("zalo-client");
const { getFolderReaction } = require("../runtime/folderReaction");
const {
  isBotAdmin: isBotAdminUser,
  isSupportUser,
  getRequesterGreeting,
  getRequesterPrompt
} = require("../runtime/requesterGreeting");

const { resolve: resolveCommand } = require("../runtime/commandRegistry");
const { commandLimiter } = require("../runtime/rateLimiter");
const { checkCommandRole, checkGroupPermissions } = require("../runtime/middleware/permissions");
const { consumeCooldown } = require("../runtime/middleware/cooldown");
const { dispatchCommand } = require("../runtime/dispatcher");
const { canRunCommandInGroup } = require("../runtime/groupBotState");

// These built-in plugins were checked and none consume the legacy userData
// preload. Unknown/custom plugins keep the old preload contract by default.
const BUILTINS_WITHOUT_USER_DATA = new Set([
  "adc", "adduser", "admin", "anti", "anticard", "antidoodle", "antifile",
  "antigif", "antiinvite", "antijoin", "antilink", "antilocation", "antinude",
  "antiother", "antiphoto", "antiqr", "antireaction", "antirecall", "antisex",
  "antispam", "antistk", "antistklag", "antitaghide", "antivideo", "antivoice",
  "antiword", "autodown", "autokick", "autosend", "bot", "card", "caro", "cmd",
  "delmsg", "events", "getavt", "getlink", "getvd", "getvoice", "girl", "hon",
  "id", "infofb", "jobs", "lyric", "menu", "noi", "noitu", "reloadconfig",
  "restart", "sam", "scl", "spam", "spamsticker", "stats", "status", "stk",
  "theme", "tiktok", "tlmn", "topchat", "vdgirl", "welcome"
]);

function trackPipelineStage(stage, startedAt) {
  try {
    metrics.trackListenerStageLatency?.(`pipeline:${stage}`, performance.now() - startedAt);
  } catch {
    // Timing must never affect command execution.
  }
}

async function runCommandPipeline(messageText, event = null, api = null, threadInfo = null, prefix = null, threadData = null) {
  const config = global.config;

  if (!messageText || typeof messageText !== "string") return;
  if (!messageText.startsWith(prefix)) return;

  const threadId = event?.threadId;
  const type = event?.type;
  const UIDUsage = event?.data?.uidFrom;
  let stageStartedAt = performance.now();

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
  trackPipelineStage("resolve", stageStartedAt);

  stageStartedAt = performance.now();
  // Groups stay silent by default; only /bot on and /bot status pass while OFF.
  if (type === ThreadType.Group && !canRunCommandInGroup(threadInfo, commandName, args)) return;
  // A bare category shortcut opens its folder unless the command explicitly
  // owns the bare invocation (e.g. /anti renders the live Anti-Protection card).
  if (!command || (menuGroupShortcut && folderMenuRuntime.shouldOpenMenuShortcut(command, args))) {
    try {
      const folderMenu = folderMenuRuntime;
      const folder = menuGroupShortcut;
      if (folder) {
        // Category shortcuts bypass dispatchCommand(); keep their folder reaction.
        void wrappedApi.__reply?.react(getFolderReaction(folder.slug));
        const items = folderMenu.collectMenuGroupCommands(global.client.commands, UIDUsage, folder);
        // Các thư mục luôn có thẻ riêng; nhóm rỗng vẫn hiển thị đúng bố cục và báo chưa có lệnh trong caption.
        const version = require("../../package.json").version;
        const profile = await getRequesterProfile(api, event, { waitMs: 250, skipAvatarWarm: true });
        const imagePath = await renderCanvas("menu-folder", {
          folderName: folder.name,
          folderSlug: folder.slug,
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
            getRequesterGreeting(UIDUsage),
            getRequesterPrompt(UIDUsage),
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
  if (commandName !== "bot" && Array.isArray(disabledCommands) && disabledCommands.includes(commandName)) {
    trackPipelineStage("group-gate", stageStartedAt);
    if (wrappedApi && threadId && type) {
      await wrappedApi.sendMessage({ msg: `🚫 Lệnh '${commandName}' đã bị tắt trong nhóm này.` }, threadId, type);
    }
    return;
  }
  trackPipelineStage("group-gate", stageStartedAt);

  stageStartedAt = performance.now();
  if (!commandLimiter.allow(UIDUsage)) {
    trackPipelineStage("rate-limit", stageStartedAt);
    return wrappedApi.sendMessage({
      msg: "🚫 Bạn đang gửi lệnh quá nhanh. Vui lòng chậm lại!"
    }, threadId, type);
  }
  trackPipelineStage("rate-limit", stageStartedAt);

  stageStartedAt = performance.now();
  const role = command.config.role || 0;
  const isBotAdmin = isBotAdminUser(UIDUsage);
  const isSupport = isSupportUser(UIDUsage);

  // Bảo mật: lệnh nhạy (role 2 = admin bot) chỉ cho phép chạy trong nhóm
  // đã đăng ký làm admin group qua Panel. Ngăn trường hợp uidFrom bị giả mạo
  // (spoof) thành ID admin từ nhóm lẻ / tin riêng (đã chặn riêng ở trên).
  if (role === 2 && config.admin?.require_admin_group_for_sensitive) {
    const adminGroups = await readAdminGroups();
    const isAdminGroup = Array.isArray(adminGroups) && adminGroups.includes(String(threadId));
    if (!isAdminGroup) {
      return wrappedApi.sendMessage({
        msg: "🚫 Lệnh này chỉ được dùng trong nhóm quản trị (admin group) đã đăng ký qua Panel."
      }, threadId, type);
    }
  }

  const roleCheck = checkCommandRole({ role, isBotAdmin, isSupport });
  if (roleCheck.denied) {
    trackPipelineStage("authorization", stageStartedAt);
    return wrappedApi.sendMessage({ msg: roleCheck.denied }, threadId, type);
  }
  trackPipelineStage("authorization", stageStartedAt);

  stageStartedAt = performance.now();
  const groupCheckResult = checkGroupPermissions({
    api: wrappedApi,
    threadId,
    isGroup: type == ThreadType.Group,
    UIDUsage,
    threadInfo,
    isBotAdmin,
    isSupport,
    // Guard consumes the same positive Zalo event markers. Passing the
    // confirmed flag avoids an extra network permission lookup for group admins.
    isGroupAdmin: event?.data?.isGroupAdmin === true ||
      event?.data?.isAdmin === true || event?.data?.isGroupAdmin === 1,
    logger
  });
  // Avoid an async/microtask boundary unless live group-admin verification is needed.
  const groupCheck = groupCheckResult && typeof groupCheckResult.then === "function"
    ? await groupCheckResult
    : groupCheckResult;
  trackPipelineStage("group-permission", stageStartedAt);
  if (groupCheck.denied) {
    return wrappedApi.sendMessage({ msg: groupCheck.denied }, threadId, type);
  }

  stageStartedAt = performance.now();
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
      trackPipelineStage("cooldown", stageStartedAt);
      const timeLeft = (remainingMs / 1000).toFixed(1);
      return wrappedApi.sendMessage({
        msg: `⏳ Vui lòng chờ ${timeLeft}s để dùng lại lệnh '${commandName}'`
      }, threadId, type);
    }
  }
  trackPipelineStage("cooldown", stageStartedAt);

  stageStartedAt = performance.now();
  // Built-in commands that do not use userData skip the cold DB lookup.
  // Preserve the legacy preload for custom/unknown plugins unless they opt out.
  const commandId = String(command.config.name || commandName).toLowerCase();
  const preloadUserData = command.config.requiresUserData === true ||
    command.config.preloadUserData === true ||
    (command.config.preloadUserData !== false && !BUILTINS_WITHOUT_USER_DATA.has(commandId));
  let userData = null;
  if (preloadUserData) {
    const cachedUserData = Users.getCachedData?.(UIDUsage) ?? null;
    userData = cachedUserData || await Users.getData(UIDUsage).catch(() => null);
  }
  trackPipelineStage("user-data", stageStartedAt);

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
  const commandName = isCommandMessage
    ? String(messageText.slice(prefix.length).trim().split(/\s+/, 1)[0] || "unknown").toLowerCase()
    : "";

  try {
    return await runCommandPipeline(messageText, event, api, threadInfo, prefix, threadData);
  } finally {
    // End-to-end latency includes parse/lookup, permissions, cooldowns, data
    // loading, command.run() and awaited replies, including early-return paths.
    if (isCommandMessage) {
      const elapsed = performance.now() - startedAt;
      metrics.trackLatency?.(elapsed);
      metrics.trackCommandLatency?.(commandName, elapsed);
    }
  }
}

module.exports = handleCommand;
module.exports._runCommandPipeline = runCommandPipeline;
