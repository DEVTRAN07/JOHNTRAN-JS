"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const { vietnamDateKey, buildRanking } = require("../../core/topchat/stats");
const topchatCounter = require("../events/topchatCounter");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "topchat",
  aliases: ["topmsg"],
  version: "1.4.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tìm thành viên gửi nhiều tin nhắn nhất trong ngày của nhóm",
  category: "Tiện ích",
  usage: "topchat",
  cooldowns: 5,
  dependencies: { canvas: "" }
};

function readDailyCounts(thread) {
  const today = vietnamDateKey();
  if (thread?.topchatDate !== today) return { today, counts: {} };
  const counts = thread.topchatCounts && typeof thread.topchatCounts === "object"
    ? thread.topchatCounts : {};
  return { today, counts };
}

function emptyRankingMessage(thread, today, listenerDiagnostics = {}) {
  const diagnostics = thread?.topchatDiagnostics?.date === today
    ? thread.topchatDiagnostics
    : { received: 0, counted: 0, rejected: 0, duplicates: 0 };
  const realtime = `\n📡 Realtime: nhận ${Number(diagnostics.received) || 0}, ghi nhận ${Number(diagnostics.counted) || 0}, bị lọc ${Number(diagnostics.rejected) || 0}, trùng ${Number(diagnostics.duplicates) || 0} tin.`;
  const listenerLine = `\n🎧 Listener: ${Number(listenerDiagnostics.events) || 0} event, nhóm ${Number(listenerDiagnostics.groups) || 0}, tự gửi ${Number(listenerDiagnostics.self) || 0}, người khác ${Number(listenerDiagnostics.other) || 0}, type=${String(listenerDiagnostics.lastType || "none")}, msgType=${String(listenerDiagnostics.lastMessageType || "none")}.`;
  const historyComplete = thread?.topchatHistoryDate === today &&
    thread?.topchatHistoryComplete === true &&
    thread?.topchatHistoryVersion === 2;

  if (historyComplete) {
    return "📊 Đã quét đủ lịch sử nhóm. Hôm nay chưa có tin nhắn phù hợp để xếp hạng." + realtime + listenerLine;
  }

  if (thread?.topchatHistoryDate === today && thread?.topchatHistoryComplete === true) {
    return "📥 Trạng thái quét lịch sử cũ không còn được tin cậy; bot đang chờ đồng bộ lại. " +
      "Tin nhắn mới vẫn được ghi nhận qua realtime." + realtime + listenerLine;
  }

  const reason = String(thread?.topchatHistoryReason || "");
  if (reason === "response-timeout" || reason === "request-error" ||
      reason === "empty-page" || reason === "missing-timestamps") {
    return "⚠️ Zalo chưa trả dữ liệu lịch sử nhóm qua WebSocket. Bot vẫn ghi nhận tin nhắn mới theo thời gian thực." + realtime + listenerLine;
  }

  if (!diagnostics.received) {
    return "📥 Chưa ghi nhận event tin nhắn nhóm nào trong ngày. Hãy gửi tin nhắn thường từ một thành viên khác rồi chạy lại /topchat để kiểm tra realtime." + realtime + listenerLine;
  }
  if (!diagnostics.counted) {
    return "📥 Bot đã nhận event nhóm nhưng chưa có tin nào đủ điều kiện xếp hạng (tin nhắn lệnh, tin bot hoặc dữ liệu không hợp lệ sẽ bị bỏ qua)." + realtime + listenerLine;
  }
  return "📥 Đã nhận event realtime nhưng bộ đếm chưa tạo được bảng xếp hạng. Cần kiểm tra trạng thái lưu dữ liệu nhóm." + realtime + listenerLine;
}

module.exports.run = async function ({ api, event, Threads, reply }) {
  if (event?.type !== ThreadType.Group) {
    return reply?.warn
      ? reply.warn("Lệnh /topchat chỉ dùng được trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /topchat chỉ dùng được trong nhóm." }, event.threadId, event.type);
  }

  const threadId = String(event.threadId);
  await topchatCounter.flushGroup(threadId, Threads);
  const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
  const thread = record?.data || {};
  const { today, counts } = readDailyCounts(thread);
  const ranking = buildRanking(counts, 10);
  const totalMessages = Object.values(counts).reduce(
    (total, member) => total + Math.max(0, Number(member?.count) || 0), 0
  );

  if (!ranking.length) {
    const listenerDiagnostics = topchatCounter.getRuntimeDiagnostics(threadId);
    const message = emptyRankingMessage(thread, today, listenerDiagnostics);
    return reply?.info
      ? reply.info(message)
      : api.sendMessage({ msg: message }, event.threadId, event.type);
  }

  const historyComplete = thread.topchatHistoryDate === today &&
    thread.topchatHistoryComplete === true;
  const historyLabel = historyComplete
    ? "ĐÃ QUÉT LỊCH SỬ TỪ 00:00"
    : thread.topchatHistoryDate === today && thread.topchatHistoryReason
      ? "LỊCH SỬ CHƯA ĐẦY ĐỦ"
      : "ĐANG ĐỒNG BỘ LỊCH SỬ";

  let imagePath;
  try {
    imagePath = await renderCanvas("topchat", {
      title: "TOP CHAT HÔM NAY",
      subtitle: `${historyLabel} · ${today} · ${totalMessages} TIN NHẮN`,
      ranking,
      totalMembers: ranking.length
    }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath] }, event.threadId, event.type);
  } catch (error) {
    console.error("[TOPCHAT]", error?.stack || error);
    const lines = ranking.map((item, index) => `${index + 1}. ${item.name} — ${item.count} tin`);
    return api.sendMessage({
      msg: `📊 TOP CHAT HÔM NAY · ${today}\nTổng ${totalMessages} tin nhắn\n${lines.join("\n")}`
    }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = { readDailyCounts, emptyRankingMessage };
