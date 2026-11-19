"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const stats = require("../../core/stats");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { isEnabled: isGroupBotEnabled } = require("../../core/runtime/groupBotState");
const { collectBotGroupKeys } = require("../../core/runtime/botGroupKey");

const GROUP_INFO_CONCURRENCY = 4;

module.exports.config = {
  name: "bot",
  aliases: [],
  version: "1.1.0",
  role: 2,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Bật/tắt bot theo nhóm và xem danh sách nhóm đang bật",
  category: "Hệ thống",
  usage: "bot on|off|status",
  cooldowns: 1,
  dependencies: { canvas: "" }
};

async function collectEnabledGroups(api, Threads) {
  if (typeof api?.getAllGroups !== "function") {
    throw new Error("API Zalo không hỗ trợ lấy danh sách nhóm.");
  }
  if (typeof Threads?.getAll !== "function") {
    throw new Error("Không đọc được dữ liệu thiết lập nhóm.");
  }

  const [groupResponse, storedThreads] = await Promise.all([
    api.getAllGroups(),
    Promise.resolve(Threads.getAll())
  ]);
  const allIds = Object.keys(groupResponse?.gridVerMap || {});
  const settingsById = new Map(
    (Array.isArray(storedThreads) ? storedThreads : []).map(row => [
      String(row?.threadId || row?.id || ""),
      row?.data || {}
    ])
  );

  // QTV status is independent from /bot on/off and covers every joined group.
  // Older test adapters and third-party wrappers may not expose getOwnId().
  // Keep the legacy /bot status card working, but never guess that an
  // unverified group has a QTV key.
  const canVerifyBotRole =
    typeof api?.getOwnId === "function" &&
    typeof api?.getGroupInfo === "function";

  let keySummary = {
    botUid: "",
    totalGroups: allIds.length,
    allGroups: allIds.map(gid => ({
      gid: String(gid),
      name: String(settingsById.get(String(gid))?.group_name || ("Nhóm " + String(gid).slice(-6))),
      avatar: "",
      totalMember: 0,
      role: "unknown"
    })),
    keyGroups: [],
    noKeyGroups: [],
    unknownGroups: [],
    ownerCount: 0,
    deputyCount: 0,
    verificationAvailable: false
  };
  const infoById = new Map();

  if (canVerifyBotRole) {
    try {
      keySummary = {
        ...(await collectBotGroupKeys(api, { groupIds: allIds })),
        verificationAvailable: true
      };
      for (const group of keySummary.allGroups) infoById.set(group.gid, group);
    } catch (error) {
      console.warn("[BOT_STATUS] Không xác minh được quyền QTV của bot:", error?.message || error);
    }
  }

  const enabledIds = allIds.filter(gid => isGroupBotEnabled(settingsById.get(String(gid))));
  const groups = [];

  // When role inspection is available, reuse the names/details gathered from
  // the same Zalo response. Otherwise retain the previous enabled-only lookup.
  if (keySummary.verificationAvailable) {
    for (const gid of enabledIds) {
      const info = infoById.get(String(gid)) || {};
      groups.push({
        gid: String(gid),
        name: String(info.name || settingsById.get(String(gid))?.group_name || ("Nhóm " + String(gid).slice(-6))),
        avatar: String(info.avatar || ""),
        totalMember: Number(info.totalMember) || 0
      });
    }
  } else {
    for (let offset = 0; offset < enabledIds.length; offset += GROUP_INFO_CONCURRENCY) {
      const batch = enabledIds.slice(offset, offset + GROUP_INFO_CONCURRENCY);
      const items = await Promise.all(batch.map(async gid => {
        let info = stats.getCachedGroupInfo(gid);
        if (!info && typeof api?.getGroupInfo === "function") {
          info = await api.getGroupInfo(gid);
        }
        const group = info?.gridInfoMap?.[gid] || {};
        return {
          gid: String(gid),
          name: String(group.name || settingsById.get(String(gid))?.group_name || ("Nhóm " + String(gid).slice(-6))),
          avatar: String(group.avt || group.fullAvt || ""),
          totalMember: Number(group.totalMember) || 0
        };
      }));
      groups.push(...items);
    }
  }

  if (!keySummary.verificationAvailable) {
    keySummary.unknownGroups = keySummary.allGroups;
  }

  return {
    ...keySummary,
    groups,
    totalGroups: allIds.length
  };
}

function buildBotGroupKeyStatus(summary = {}) {
  const keyGroups = Array.isArray(summary.keyGroups) ? summary.keyGroups : [];
  const noKeyGroups = Array.isArray(summary.noKeyGroups) ? summary.noKeyGroups : [];
  const unknownGroups = Array.isArray(summary.unknownGroups) ? summary.unknownGroups : [];
  const lines = [
    "🔑 QUYỀN QTV NHÓM CỦA TÀI KHOẢN BOT",
    "━━━━━━━━━━━━━━━━━━━━",
    "👥 Bot đang tham gia: " + (Number(summary.totalGroups) || 0) + " nhóm",
    "✅ Bot có key (trưởng/phó): " + keyGroups.length + " nhóm",
    "   👑 Trưởng nhóm: " + (Number(summary.ownerCount) || 0),
    "   🛡️ Phó nhóm: " + (Number(summary.deputyCount) || 0),
    "⚪ Bot chưa có quyền QTV: " + noKeyGroups.length + " nhóm",
    "❔ Chưa xác minh được: " + unknownGroups.length + " nhóm",
    "━━━━━━━━━━━━━━━━━━━━",
    "DANH SÁCH NHÓM BOT CÓ KEY:"
  ];

  if (!keyGroups.length) {
    lines.push("Không có nhóm nào mà bot đang giữ quyền trưởng/phó.");
  } else {
    const limit = 40;
    keyGroups.slice(0, limit).forEach((group, index) => {
      const isOwner = group.role === "owner";
      lines.push(
        (index + 1) + ". " + (isOwner ? "👑 " : "🛡️ ") +
        group.name + " [" + (isOwner ? "TRƯỞNG" : "PHÓ NHÓM") + "] · ID: " + group.gid
      );
    });
    if (keyGroups.length > limit) {
      lines.push("... và " + (keyGroups.length - limit) + " nhóm khác.");
    }
  }

  if (unknownGroups.length) {
    lines.push(
      "",
      "⚠️ Zalo chưa trả đủ thông tin quyền của " + unknownGroups.length +
      " nhóm; các nhóm này không được tính là có key."
    );
  }
  return lines.join("\n");
}

async function sendStatusCard({ api, event, Threads }) {
  let imagePath;
  try {
    const result = await collectEnabledGroups(api, Threads);
    const profile = stats.getCachedProfile() || await stats.getProfile(api);
    imagePath = await renderCanvas("bot-groups", {
      botName: profile?.displayName || global.config?.name_bot || "JOHNTRAN",
      botAvatar: profile?.avatar || "",
      groups: result.groups,
      enabledCount: result.groups.length,
      version: require("../../package.json").version
    }, { timeout: 30000, poolSize: 2 });

    await api.sendMessage({
      msg: "",
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
    if (result.verificationAvailable) {
      await api.sendMessage({
        msg: buildBotGroupKeyStatus(result)
      }, event.threadId, event.type);
    }
    return true;
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
}

module.exports.run = async function ({ api, event, args, Threads, reply, threadData }) {
  if (event?.type === ThreadType.User) {
    return reply.error("Lệnh này chỉ dùng trong nhóm.");
  }

  const threadId = String(event?.threadId || "");
  if (!threadId) return reply.error("Không xác định được nhóm hiện tại.");

  const action = String(args?.[0] || "status").trim().toLowerCase();
  if (!["on", "off", "status"].includes(action)) {
    return reply.error(`Dùng: ${global.config.prefix}bot on|off|status`);
  }

  if (action === "status") {
    try {
      return await sendStatusCard({ api, event, Threads });
    } catch (error) {
      console.error("[BOT_STATUS]", error?.stack || error);
      return reply.error("Không thể tạo danh sách nhóm đang bật: " + (error?.message || "Lỗi"));
    }
  }

  const record = threadData && typeof threadData === "object"
    ? threadData
    : await Threads.getData(threadId);
  const data = record?.data && typeof record.data === "object"
    ? record.data
    : record && typeof record === "object" ? record : {};
  const currentlyEnabled = isGroupBotEnabled(data);
  const enabled = action === "on";

  if (currentlyEnabled === enabled) {
    return reply.info(`Bot đã ${enabled ? "được bật" : "được tắt"} trong nhóm này.`);
  }

  data.bot_enabled = enabled;
  if (typeof Threads.setBotEnabled === "function") {
    await Threads.setBotEnabled(threadId, enabled);
  } else {
    await (Threads.setDataAndWait || Threads.setData).call(Threads, threadId, data);
  }

  return reply.success(
    enabled
      ? "Đã bật bot trong nhóm này. Các lệnh và sự kiện đã hoạt động trở lại."
      : "Đã tắt bot trong nhóm này. Bot sẽ im lặng và bỏ qua lệnh, điều hướng, sự kiện tự động."
  );
};

module.exports._test = { collectEnabledGroups, buildBotGroupKeyStatus, GROUP_INFO_CONCURRENCY, sendStatusCard };
