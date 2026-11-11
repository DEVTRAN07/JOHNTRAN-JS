"use strict";

/**
 * Normalize the legacy event payload once while preserving the plugin context.
 * This module deliberately has no Zalo SDK dependency so its behavior is easy
 * to test and can be reused by message, group and system event handlers.
 */
function resolveThreadType(eventData, eventType, ThreadType) {
  let threadType = eventData?.type;
  // For group events, event.type is the event name, not a ThreadType.
  if (eventType === "group_event" || !Number.isFinite(Number(threadType))) {
    threadType = ThreadType.Group;
  }
  return threadType;
}

function buildReplyData(eventData) {
  const data = eventData?.data || {};
  return {
    content: data.content,
    msgType: data.msgType,
    propertyExt: data.propertyExt,
    uidFrom: data.uidFrom,
    msgId: data.msgId,
    cliMsgId: data.cliMsgId,
    ts: data.ts
  };
}

function createEventContext({
  api,
  eventData,
  name,
  eventType,
  ThreadType,
  wrapForEvent
} = {}) {
  const threadType = resolveThreadType(eventData, eventType, ThreadType);
  let wrapped = api;

  try {
    if (typeof wrapForEvent === "function") {
      wrapped = wrapForEvent(api, eventData, name, threadType);
    }
  } catch {
    // Preserve legacy behavior: a wrapper failure must not block the plugin.
    wrapped = api;
  }

  return {
    api: wrapped,
    reply: wrapped?.__reply,
    threadType,
    replyData: buildReplyData(eventData)
  };
}

module.exports = {
  resolveThreadType,
  buildReplyData,
  createEventContext
};
