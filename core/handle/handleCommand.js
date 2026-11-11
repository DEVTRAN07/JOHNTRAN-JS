const logger = require("../../utils/logger");
const { wrapApi } = require("../message");
const metrics = require("../metrics");
const fs = require("fs");
const path = require("path");

const Users = require("../controller/controllerUsers");
const Threads = require("../controller/controllerThreads");

const { ThreadType, Reactions } = require("zalo-client");

const ADMIN_GROUPS_FILE = path.join(__dirname, "..", "..", "data", "bot_admin_groups.json");

function readAdminGroups() {
  try { return JSON.parse(fs.readFileSync(ADMIN_GROUPS_FILE, "utf8")) || []; } catch { return []; }
}

const SPAM_WINDOW_MS = 10000;
const SPAM_MAX_COMMANDS = 12;
const spamTracker = new Map();

function resolveCommand(commandName) {
  const direct = global.client.commands.get(commandName);
  if (direct) return direct;

  for (const [, command] of global.client.commands) {
    const aliases = command.config.aliases;
    if (Array.isArray(aliases) && aliases.includes(commandName)) return command;
  }
  return null;
}

function checkSpam(userId) {
  const now = Date.now();
  let history = spamTracker.get(userId);
  if (!history) {
    history = [];
    spamTracker.set(userId, history);
  }
  while (history.length > 0 && now - history[0] > SPAM_WINDOW_MS) history.shift();
  history.push(now);
  return history.length <= SPAM_MAX_COMMANDS;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, history] of spamTracker.entries()) {
    const filtered = history.filter((time) => now - time <= SPAM_WINDOW_MS);
    if (filtered.length === 0) spamTracker.delete(userId);
    else spamTracker.set(userId, filtered);
  }
}, SPAM_WINDOW_MS).unref();

async function checkGroupPermissions({ api, threadId, type, UIDUsage, threadInfo }) {
  const isBotAdmin = global.users?.admin?.includes(UIDUsage);
  const isSupport = global.users?.support?.includes(UIDUsage);
  let isGroupAdmin = false;

  if (type == ThreadType.Group) {
    if (threadInfo?.box_only && !isBotAdmin) {
      try {
        const info = await api.getGroupInfo(threadId);
        const groupInfo = info?.gridInfoMap?.[threadId];
        if (groupInfo) {
          isGroupAdmin = groupInfo.creatorId == UIDUsage
            || (Array.isArray(groupInfo.adminIds) && groupInfo.adminIds.includes(UIDUsage));
        }
      } catch (err) {
        logger.log("Không thể lấy thông tin nhóm từ API: " + err.message, "warn");
      }
    }

    if (threadInfo.admin_only && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh." };
    }
    if (threadInfo.support_only && !isSupport && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh." };
    }
    if (threadInfo.box_only && !isGroupAdmin && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh." };
    }
  }

  return { isBotAdmin, isSupport, isGroupAdmin };
}

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

  const wrappedApi = wrapApi(api, threadId, type, commandName, event);
  const command = resolveCommand(commandName);
  if (!command) {
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

  if (!checkSpam(UIDUsage)) {
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

  if ((role === 2 && !isBotAdmin) || (role === 1 && !isBotAdmin && !isSupport)) {
    return wrappedApi.sendMessage({ msg: "🚫 Bạn không có quyền sử dụng lệnh này." }, threadId, type);
  }

  const groupCheck = await checkGroupPermissions({ api: wrappedApi, threadId, type, UIDUsage, threadInfo });
  if (groupCheck.denied) {
    return wrappedApi.sendMessage({ msg: groupCheck.denied }, threadId, type);
  }

  const cdTime = (command.config.cooldowns || 0) * 1000;
  // Điều hướng (/menu next, /scl next, /menu out...) không bị cooldown chặn
  const { isNavigation, isCommandNav } = require("./handleCommandNav");
  const isNav = isNavigation(commandName, messageText, prefix) || isCommandNav(commandName, messageText, prefix);

  if (cdTime > 0 && !isNav) {
    if (!global.client.cooldowns.has(commandName)) {
      global.client.cooldowns.set(commandName, new Map());
    }
    const cdMap = global.client.cooldowns.get(commandName);
    const lastUsed = cdMap.get(UIDUsage);

    if (lastUsed && Date.now() - lastUsed < cdTime) {
      const timeLeft = ((cdTime - (Date.now() - lastUsed)) / 1000).toFixed(1);
      return wrappedApi.sendMessage({
        msg: `⏳ Vui lòng chờ ${timeLeft}s để dùng lại lệnh '${commandName}'`
      }, threadId, type);
    }
    cdMap.set(UIDUsage, Date.now());
  }

  const userData = await Users.getData(UIDUsage).catch(() => null);

  try {
    const replyData = {
      content: event.data.content,
      msgType: event.data.msgType,
      propertyExt: event.data.propertyExt,
      uidFrom: event.data.uidFrom,
      msgId: event.data.msgId,
      cliMsgId: event.data.cliMsgId,
      ts: event.data.ts,
    };
    metrics.track("command", { command: commandName });

    // MỌI lệnh đều có reaction trạng thái: 👍 đang xử lý → ✅ xong / 😢 lỗi.
    // Lệnh TỰ thả reaction (nhạc, autodown...) thì hệ thống giữ im lặng.
    // Reaction KHÔNG await: mỗi reaction là 1 round-trip tới server Zalo —
    // chờ 2 lần/lệnh làm phản hồi chậm thêm ~0.5s (Render xa VN).
    const reply = wrappedApi.__reply;
    let autoReacted = false; // hệ thống đã thả
    const reactAuto = (icon) => {
        if (reply.reacted && !autoReacted) return;
        autoReacted = true;
        Promise.resolve(reply.react(icon)).catch(() => { /* khỏi cần */ });
    };

    reactAuto(Reactions.LIKE);
    try {
        await command.run({ args, event, api: wrappedApi, Users, Threads, replyData, reply, mentions: event.mentions || [], threadData, userData });
        reactAuto(Reactions.OK);
    } catch (err) {
        logger.log(`Lỗi khi xử lý lệnh '${commandName}': ${err.message}`, "error");
        metrics.track("error", { command: commandName });
        reactAuto(Reactions.CRY);
        try {
          await reply.error("Đã xảy ra lỗi khi xử lý lệnh!");
      } catch {
        // bỏ qua nếu không gửi được thông báo lỗi
      }
    }
  } catch (err) {
    // Lỗi ngoài cùng (wrapApi hỏng, event thiếu dữ liệu...) — khỏi làm sập listener
    logger.log(`Lỗi pipeline lệnh '${commandName}': ${err.message}`, "error");
  }
}

module.exports = handleCommand;
