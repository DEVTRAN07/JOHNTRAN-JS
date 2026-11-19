"use strict";

// IDs recalled deliberately by bot-owned command flows (game-board replacement,
// solo prompt cleanup, Anti self-moderation) must not be restored by Anti-Recall.
// The marker is keyed by the original Zalo cliMsgId and group, not by message
// text, so ordinary user messages with identical content remain unaffected.
const INTENTIONAL_RECALL_TTL_MS = 10 * 60 * 1000;
const INTENTIONAL_RECALL_MAX = 10000;
const intentionalRecalls = new Map();

function normalize(value) {
  return value == null ? "" : String(value).trim();
}

function pruneIntentionalRecalls(now = Date.now()) {
  for (const [key, value] of intentionalRecalls) {
    if (!value || value.expiresAt <= now) intentionalRecalls.delete(key);
  }
  while (intentionalRecalls.size > INTENTIONAL_RECALL_MAX) {
    intentionalRecalls.delete(intentionalRecalls.keys().next().value);
  }
}

function intentionalRecallKey(threadId, cliMsgId) {
  const thread = normalize(threadId);
  const clientId = normalize(cliMsgId);
  return thread && clientId ? thread + "\\u0000" + clientId : "";
}

function rememberIntentionalRecall(threadId, target, source = "command", now = Date.now()) {
  const key = intentionalRecallKey(threadId, target?.cliMsgId);
  if (!key) return [];
  pruneIntentionalRecalls(now);
  intentionalRecalls.delete(key);
  intentionalRecalls.set(key, {
    expiresAt: now + INTENTIONAL_RECALL_TTL_MS,
    source: String(source || "command")
  });
  pruneIntentionalRecalls(now);
  return [key];
}

function forgetIntentionalRecall(keys) {
  for (const key of Array.isArray(keys) ? keys : []) intentionalRecalls.delete(key);
}

function isIntentionalRecall(event, now = Date.now()) {
  const threadId = normalize(event?.threadId);
  const data = event?.data || {};
  const content = data.content && typeof data.content === "object" ? data.content : {};
  // Match the same target-ID precedence used by Anti's Undo parser.
  const cliMsgId = content.cliMsgId ?? data.cliMsgId;
  const key = intentionalRecallKey(threadId, cliMsgId);
  if (!key) return false;
  pruneIntentionalRecalls(now);
  const marker = intentionalRecalls.get(key);
  return Boolean(marker && marker.expiresAt > now);
}

async function recallIntentionally(api, target, threadId, type, source = "command") {
  if (typeof api?.undo !== "function") {
    throw new Error("Zalo API undo không khả dụng");
  }
  const message = {
    msgId: target?.msgId,
    cliMsgId: target?.cliMsgId
  };
  const markers = rememberIntentionalRecall(threadId, message, source);
  try {
    return await api.undo(message, threadId, type);
  } catch (error) {
    // A failed API call should not suppress a later, genuine user recall.
    forgetIntentionalRecall(markers);
    throw error;
  }
}

module.exports = {
  INTENTIONAL_RECALL_TTL_MS,
  rememberIntentionalRecall,
  forgetIntentionalRecall,
  isIntentionalRecall,
  recallIntentionally,
  _test: {
    clear() { intentionalRecalls.clear(); },
    size() { return intentionalRecalls.size; },
    prune: pruneIntentionalRecalls
  }
};
