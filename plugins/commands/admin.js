"use strict";

const fs = require("fs");
const { updateConfigArray, reloadConfig } = require("../../utils/index");
const metrics = require("../../core/metrics");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "admin",
  version: "3.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Quản lý admin và support của bot bằng ID hoặc tag.",
  category: "Hệ thống",
  usage: "admin <add|rm|sp|rmsp|list> [@tag/ID] (có thể tag nhiều người, nhập nhiều uid cách nhau dấu cách hoặc ,)",
  cooldowns: 2,
  dependencies: { canvas: "" }
};

function mapEntries(ids, infos) {
  return ids.map((id, index) => ({
    name: infos[index]?.changed_profiles?.[id]?.displayName || "(Không rõ)",
    uid: String(id)
  }));
}

function entriesToLines(entries) {
  return entries.map(item => item.name + " — " + item.uid);
}

function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => { try { fs.rmSync(filePath, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}

async function sendAdminCard(api, event, reply, spec) {
  let imagePath;
  try {
    imagePath = await renderCanvas("admin", spec, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({
      msg: "",
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[ADMIN_CANVAS]", error?.stack || error);
    return reply.card(spec.fallback);
  } finally {
    cleanupLater(imagePath);
  }
}

module.exports.run = async ({ args = [], event, api, Threads, reply, threadData }) => {
  const action = args[0]?.toLowerCase();
  const { threadId, type, data } = event;
  let targetIds = [];

  if (data.mentions && Object.keys(data.mentions).length > 0) {
    targetIds = Object.values(data.mentions).map(mention => mention.uid);
  }
  if (targetIds.length === 0 && args.length > 1) {
    targetIds = args.slice(1).join(" ").split(/[\s,]+/).filter(id => id && !isNaN(id));
  }

  const processAdd = async (listName, label) => {
    if (targetIds.length === 0) return reply.error("Vui lòng nhập ID hoặc tag người dùng cần thêm làm " + label + ".");
    const currentList = global.users[listName];
    const newIds = targetIds.filter(id => !currentList.includes(id));
    if (newIds.length === 0) return reply.error("Không có người dùng nào mới cần thêm.");

    const updated = [...currentList, ...newIds];
    await updateConfigArray(listName + "_bot", updated);
    await reloadConfig();
    metrics.audit("admin add " + listName, event?.data?.uidFrom, newIds.join(","));

    const infos = await Promise.all(newIds.map(id => api.getUserInfo(id).catch(() => null)));
    const entries = mapEntries(newIds, infos);
    const title = "Đã thêm " + label;
    return sendAdminCard(api, event, reply, {
      title,
      subtitle: "Số lượng: " + newIds.length,
      meta: "ACCESS UPDATED",
      sections: [{ title: "DANH SÁCH ĐÃ THÊM", items: entries }],
      footer: global.config.name_bot,
      fallback: {
        theme: "success", title, subtitle: "Số lượng: " + newIds.length,
        sections: [{ title: "Danh sách", lines: entriesToLines(entries) }],
        footer: global.config.name_bot
      }
    });
  };

  const processRemove = async (listName, label) => {
    if (targetIds.length === 0) return reply.error("Vui lòng nhập ID hoặc tag người dùng cần gỡ khỏi " + label + ".");
    const currentList = global.users[listName];
    const existing = targetIds.filter(id => currentList.includes(id));
    if (existing.length === 0) return reply.error("Không có người dùng nào trong danh sách hiện tại.");

    const updated = currentList.filter(id => !existing.includes(id));
    await updateConfigArray(listName + "_bot", updated);
    await reloadConfig();
    metrics.audit("admin remove " + listName, event?.data?.uidFrom, existing.join(","));

    const infos = await Promise.all(existing.map(id => api.getUserInfo(id).catch(() => null)));
    const entries = mapEntries(existing, infos);
    const title = "Đã gỡ " + label;
    return sendAdminCard(api, event, reply, {
      title,
      subtitle: "Số lượng: " + existing.length,
      meta: "ACCESS UPDATED",
      sections: [{ title: "DANH SÁCH ĐÃ GỠ", items: entries }],
      footer: global.config.name_bot,
      fallback: {
        theme: "warn", title, subtitle: "Số lượng: " + existing.length,
        sections: [{ title: "Danh sách", lines: entriesToLines(entries) }],
        footer: global.config.name_bot
      }
    });
  };

  switch (action) {
    case "add": return processAdd("admin", "admin bot");
    case "rm": return processRemove("admin", "admin bot");
    case "sp": return processAdd("support", "support bot");
    case "rmsp": return processRemove("support", "support bot");

    case "list": {
      const adminList = global.users.admin || [];
      const supportList = global.users.support || [];
      const [adminInfos, supportInfos] = await Promise.all([
        Promise.all(adminList.map(id => api.getUserInfo(id).catch(() => null))),
        Promise.all(supportList.map(id => api.getUserInfo(id).catch(() => null)))
      ]);
      const admins = mapEntries(adminList, adminInfos);
      const supports = mapEntries(supportList, supportInfos);
      return sendAdminCard(api, event, reply, {
        title: "DANH SÁCH QUẢN TRỊ",
        subtitle: "Admin: " + adminList.length + "  ·  Support: " + supportList.length,
        meta: "ADMIN DIRECTORY",
        sections: [
          { title: "ADMIN BOT", items: admins.length ? admins : [{ name: "Không có admin nào", uid: "" }] },
          { title: "SUPPORT BOT", items: supports.length ? supports : [{ name: "Không có support nào", uid: "" }] }
        ],
        footer: global.config.name_bot,
        fallback: {
          theme: "brand",
          title: "Danh sách quản trị",
          subtitle: "Admin: " + adminList.length + " • Support: " + supportList.length,
          sections: [
            { title: "Admin Bot", lines: admins.length ? entriesToLines(admins) : ["Không có admin nào."] },
            { title: "Support Bot", lines: supports.length ? entriesToLines(supports) : ["Không có support nào."] }
          ],
          footer: global.config.name_bot
        }
      });
    }

    case "adminonly":
    case "supportonly":
    case "boxonly": {
      const keyMap = { adminonly: "admin_only", supportonly: "support_only", boxonly: "box_only" };
      const key = keyMap[action];
      const record = threadData && typeof threadData === "object"
        ? threadData
        : await Threads.getData(threadId);
      const data = record?.data && typeof record.data === "object"
        ? { ...record.data }
        : record && typeof record === "object" ? { ...record } : {};
      const currentValue = data[key] === true;
      const newValue = !currentValue;
      data[key] = newValue;
      await Threads.setData(threadId, data);
      return reply.success("Đã " + (newValue ? "bật" : "tắt") + " chế độ " + key.replace("_", " ") + ".");
    }

    default: {
      const commands = [
        ["admin add [@tag/ID...]", "Thêm admin"],
        ["admin rm [@tag/ID...]", "Gỡ admin"],
        ["admin sp [@tag/ID...]", "Thêm support"],
        ["admin rmsp [@tag/ID...]", "Gỡ support"],
        ["admin list", "Xem danh sách"],
        ["admin adminonly", "Bật/tắt chỉ admin dùng bot"],
        ["admin supportonly", "Bật/tắt chỉ support dùng bot"],
        ["admin boxonly", "Bật/tắt chỉ cho phép trong nhóm"]
      ];
      return sendAdminCard(api, event, reply, {
        title: "QUẢN LÝ ADMIN BOT",
        subtitle: "Lệnh quản trị và phân quyền",
        meta: "ADMIN GUIDE",
        sections: [{ title: "CÁC LỆNH", items: commands.map(item => ({ name: item[0], uid: item[1] })) }],
        footer: global.config.name_bot,
        fallback: {
          theme: "brand",
          title: "Quản lý admin bot",
          sections: [{ title: "Lệnh", lines: commands.map(item => item[0] + " — " + item[1]) }],
          footer: global.config.name_bot
        }
      });
    }
  }
};

module.exports._test = { mapEntries, entriesToLines };
