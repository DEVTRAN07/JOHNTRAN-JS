const logger = require("../../utils/logger");
const { wrapForEvent } = require("../runtime/adapters/zalo");
const { ThreadType } = require("zalo-client");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { dispatchEvent } = require("../runtime/eventRegistry");
const { createEventContext } = require("../runtime/eventContext");
const { isEnabled: isGroupBotEnabled } = require("../runtime/groupBotState");

function handleEvent(eventType, eventData, api, isSelf = false) {
  // Safety net: suppress every event source when this group has disabled the bot.
  // Use the synchronous hot cache so the event path never waits for a database round-trip.
  if (eventData?.type === ThreadType.Group && eventData?.threadId) {
    const thread = Threads.getCachedData?.(eventData.threadId);
    // Fail closed: an uncached/missing setting remains OFF until /bot on.
    if (!isGroupBotEnabled(thread)) return;
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
