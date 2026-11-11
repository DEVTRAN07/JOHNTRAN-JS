"use strict";

/**
 * Zalo API adapter boundary.
 *
 * The existing message wrapper owns Zalo-specific behavior (reply helpers,
 * send interception, auto-recall and API caches). Keep that implementation
 * intact and expose stable intent-oriented entry points to runtime callers.
 */
function createZaloAdapter(messageModule) {
  if (!messageModule || typeof messageModule.wrapApi !== "function") {
    throw new TypeError("Zalo message wrapper with wrapApi() is required");
  }

  return Object.freeze({
    wrapForThread(api, threadId, threadType, commandName, event = null) {
      return messageModule.wrapApi(api, threadId, threadType, commandName, event);
    },
    wrapForEvent(api, event, commandName, threadType) {
      return messageModule.wrapApi(
        api,
        event?.threadId,
        threadType ?? event?.type,
        commandName || "event",
        event
      );
    },
    Reply: messageModule.Reply,
    DEFAULT_AUTO_RECALL_MS: messageModule.DEFAULT_AUTO_RECALL_MS
  });
}

const adapter = createZaloAdapter(require("../../message"));
adapter.createZaloAdapter = createZaloAdapter;

module.exports = adapter;
