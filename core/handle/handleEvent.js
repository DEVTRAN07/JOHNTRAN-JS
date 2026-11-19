const logger = require("../../utils/logger");
const { wrapForEvent } = require("../runtime/adapters/zalo");
const { ThreadType } = require("zalo-client");
const { performance } = require("node:perf_hooks");
const metrics = require("../metrics");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { dispatchEvent } = require("../runtime/eventRegistry");
const { createEventContext } = require("../runtime/eventContext");
const { isEnabled: isGroupBotEnabled } = require("../runtime/groupBotState");

function isGroupEventPayload(eventType, eventData) {
  return eventData?.type === ThreadType.Group ||
    eventData?.isGroup === true ||
    eventType === "group_event";
}

function getDispatchSources(eventType, eventData, isSelf, events, commands) {
  const isSelfUndo = eventType === "undo" &&
    (isSelf === true || eventData?.isSelf === true);
  if (!isSelfUndo) return { events, commands };

  // Bot self-undo is a test-only path: dispatch it exclusively to Anti.
  const antiCommand = commands?.get?.("anti");
  return {
    events: new Map(),
    commands: typeof antiCommand?.handleEvent === "function"
      ? new Map([["anti", antiCommand]])
      : new Map()
  };
}

async function handleEvent(eventType, eventData, api, isSelf = false, dispatchOptions = {}) {
  // Safety net: suppress every event source when this group has disabled the bot.
  // Use the synchronous hot cache so the event path never waits for a database round-trip.
  const isGroupEvent = isGroupEventPayload(eventType, eventData);
  if (isGroupEvent && eventData?.threadId) {
    const thread = dispatchOptions.threadData || Threads.getCachedData?.(eventData.threadId);
    // Fail closed: an uncached/missing setting remains OFF until /bot on.
    if (!isGroupBotEnabled(thread)) return;
  }

  // Active mini-games get first refusal on plain-text answers. Only a user
  // enrolled in the matching session can consume a message; unrelated group
  // conversations continue through the regular event plugins unchanged.
  const allowSelfGameMessages = global.config?.allow_self_command === true;
  if (!dispatchOptions.skipGameConsumers &&
      eventType === "message" && ((!isSelf && !eventData?.isSelf) || allowSelfGameMessages)) {
    // Load the game consumer directly. Do not rely on command-registry timing:
    // the listener may receive plain text immediately after a command reload.
    try {
      const noituCommand = require("../../plugins/commands/noitu");
      const hasActiveGame = typeof noituCommand?.hasActiveGameForThread === "function"
        ? noituCommand.hasActiveGameForThread(eventData?.threadId)
        : true;
      // The listener also performs this in-memory check before dispatch. Keep
      // the safety-net path equally cheap for command-originated events.
      if (hasActiveGame && typeof noituCommand?.handleEvent === "function") {
        // This early game consumer runs before the regular event dispatcher.
        // Wrap it through the same adapter so every auto-recalled game reply
        // receives its clock reaction just like normal commands and events.
        const gameApi = wrapForEvent(api, eventData, "noitu-active-game", eventData?.type);
        const consumed = await noituCommand.handleEvent({
          api: gameApi,
          event: eventData,
          eventType,
          isSelf,
          Users,
          Threads,
          threadData: dispatchOptions.threadData || null
        });
        if (consumed === true) {
          return { consumed: true, eventModules: 0, commandModules: 0 };
        }
      }
    } catch (error) {
      logger.log("Lỗi xử lý câu trả lời game: " + (error?.message || error), "error", {
        source: "game-message-consumer",
        groupId: eventData?.threadId
      });
    }
  }

  const selfUndo = eventType === "undo" &&
    (isSelf === true || eventData?.isSelf === true);
  if (selfUndo && global.config?.allow_self_anti !== true) {
    return { eventModules: 0, commandModules: 0 };
  }
  const sources = getDispatchSources(
    eventType, eventData, isSelf, global.client?.events, global.client?.commands
  );
  return dispatchEvent({
    events: sources.events,
    commands: sources.commands,
    eventType,
    dispatchOptions,
    async onEventModule(eventModule, name) {
      const startedAt = performance.now();
      try {
        const context = createEventContext({
          api, eventData, name, eventType, ThreadType, wrapForEvent
        });
        return await eventModule.run({
          api: context.api,
          event: eventData,
          eventType,
          isSelf,
          reply: context.reply,
          Users,
          Threads,
          threadData: dispatchOptions.threadData || null,
          replyData: context.replyData,
          threadType: context.threadType
        });
      } finally {
        metrics.trackListenerStageLatency?.("event:" + name, performance.now() - startedAt);
      }
    },
    async onCommandModule(commandModule, name) {
      const startedAt = performance.now();
      try {
        const context = createEventContext({
          api, eventData, name, eventType, ThreadType, wrapForEvent
        });
        return await commandModule.handleEvent({
          api: context.api,
          event: eventData,
          eventType,
          isSelf,
          reply: context.reply,
          Users,
          Threads,
          threadData: dispatchOptions.threadData || null,
          cachedThreadRecord: dispatchOptions.threadData || null,
          cachedThreadCacheChecked: Boolean(dispatchOptions.threadData),
          replyData: context.replyData,
          threadType: context.threadType
        });
      } finally {
        metrics.trackListenerStageLatency?.("command-event:" + name, performance.now() - startedAt);
      }
    },
    onError(error, kind, name) {
      const label = kind === "event" ? "event" : "handleEvent trong command";
      logger.log(`Lỗi khi xử lý ${label} ${name}: ${error?.message || error}`, "error", { source: kind === "event" ? "event" : "command-event", eventName: name, eventType, isGroup: isGroupEvent || eventType === "group_event", groupId: eventData?.threadId });
    }
  });
}

module.exports = handleEvent;

module.exports._test = { isGroupEventPayload, getDispatchSources };
