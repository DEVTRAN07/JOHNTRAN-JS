const logger = require("../../utils/logger");
const { wrapForEvent } = require("../runtime/adapters/zalo");
const { ThreadType } = require("zalo-client");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { dispatchEvent } = require("../runtime/eventRegistry");
const { createEventContext } = require("../runtime/eventContext");
const { isEnabled: isGroupBotEnabled } = require("../runtime/groupBotState");

async function handleEvent(eventType, eventData, api, isSelf = false) {
  // Safety net: suppress every event source when this group has disabled the bot.
  // Use the synchronous hot cache so the event path never waits for a database round-trip.
  if (eventData?.type === ThreadType.Group && eventData?.threadId) {
    const thread = Threads.getCachedData?.(eventData.threadId);
    // Fail closed: an uncached/missing setting remains OFF until /bot on.
    if (!isGroupBotEnabled(thread)) return;
  }

  // Active mini-games get first refusal on plain-text answers. Only a user
  // enrolled in the matching session can consume a message; unrelated group
  // conversations continue through the regular event plugins unchanged.
  if (eventType === "message" && !isSelf && !eventData?.isSelf) {
    // Load the game consumer directly. Do not rely on command-registry timing:
    // the listener may receive plain text immediately after a command reload.
    try {
      const noituCommand = require("../../plugins/commands/noitu");
      if (typeof noituCommand?.handleEvent === "function") {
        const consumed = await noituCommand.handleEvent({
          api,
          event: eventData,
          eventType,
          isSelf,
          Users,
          Threads
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

  return dispatchEvent({
    events: global.client?.events,
    commands: global.client?.commands,
    eventType,
    onEventModule(eventModule, name) {
      const context = createEventContext({
        api, eventData, name, eventType, ThreadType, wrapForEvent
      });
      return eventModule.run({
        api: context.api,
        event: eventData,
        eventType,
        isSelf,
        reply: context.reply,
        Users,
        Threads,
        replyData: context.replyData,
        threadType: context.threadType
      });
    },
    onCommandModule(commandModule, name) {
      const context = createEventContext({
        api, eventData, name, eventType, ThreadType, wrapForEvent
      });
      return commandModule.handleEvent({
        api: context.api,
        event: eventData,
        eventType,
        isSelf,
        reply: context.reply,
        Users,
        Threads,
        replyData: context.replyData,
        threadType: context.threadType
      });
    },
    onError(error, kind, name) {
      const label = kind === "event" ? "event" : "handleEvent trong command";
      logger.log(`Lỗi khi xử lý ${label} ${name}: ${error?.message || error}`, "error", { source: kind === "event" ? "event" : "command-event", eventName: name, eventType, isGroup: eventData?.type === ThreadType.Group || eventType === "group_event", groupId: eventData?.threadId });
    }
  });
}

module.exports = handleEvent;
