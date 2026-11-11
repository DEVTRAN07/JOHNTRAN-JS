const logger = require("../../utils/logger");
const { wrapForEvent } = require("../runtime/adapters/zalo");
const { ThreadType } = require("zalo-client");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");
const { dispatchEvent } = require("../runtime/eventRegistry");
const { createEventContext } = require("../runtime/eventContext");

function handleEvent(eventType, eventData, api, isSelf = false) {
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
      logger.log(`Lỗi khi xử lý ${label} ${name}: ${error?.message || error}`, "error");
    }
  });
}

module.exports = handleEvent;
