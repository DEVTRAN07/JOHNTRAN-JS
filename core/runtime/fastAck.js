"use strict";

function reportFailure(error, threadId) {
  try {
    require("../../utils/logger").log(
      "Không gửi được phản hồi tiếp nhận nhanh: " + (error?.message || error),
      "warn",
      { source: "fast-ack", groupId: threadId }
    );
  } catch {
    // Acknowledgement/logging must never replace the command's real result.
  }
}

/**
 * Start a short text response synchronously before expensive profile, media or
 * Canvas work. Do not await the Zalo round-trip here: initiate the send first,
 * then let the command continue preparing its final result.
 */
function sendFastAcknowledgement(api, threadId, type, message) {
  if (typeof api?.sendMessage !== "function") return false;
  let pending;
  try {
    pending = api.sendMessage({
      msg: String(message || "⏳ Đang xử lý yêu cầu..."),
      recallAfterMs: 0
    }, threadId, type);
  } catch (error) {
    reportFailure(error, threadId);
    return false;
  }
  Promise.resolve(pending).catch(error => reportFailure(error, threadId));
  return true;
}

module.exports = { sendFastAcknowledgement };
