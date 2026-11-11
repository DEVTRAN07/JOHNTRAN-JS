const logger = require("../../utils/logger");
const { wrapForEvent } = require("../runtime/adapters/zalo");
const { ThreadType } = require("zalo-client");

const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");

const { dispatchEvent } = require("../runtime/eventRegistry");

function buildContext(api, eventData, name, eventType) {
  let threadType = eventData?.type;
  // Group event: event.type is the event name, not a Zalo ThreadType.
  if (eventType === "group_event" || !Number.isFinite(Number(threadType))) {
    threadType = ThreadType.Group;
  }
  let wrapped = api;
  try {
    wrapped = wrapForEvent(api, eventData, name, threadType);
  } catch {
    wrapped = api;
  }
  return { api: wrapped, reply: wrapped?.__reply, threadType };
}

function buildReplyData(eventData) {
  return {
    content: eventData.data?.content,
    msgType: eventData.data?.msgType,
    propertyExt: eventData.data?.propertyExt,
    uidFrom: eventData.data?.uidFrom,
    msgId: eventData.data?.msgId,
    cliMsgId: eventData.data?.cliMsgId,
    ts: eventData.data?.ts
  };
}

function handleEvent(eventType, eventData, api, isSelf = false) {
  return dispatchEvent({
    events: global.client?.events,
    commands: global.client?.commands,
    eventType,
    onEventModule(eventModule, name) {
      const { api: wrapped, reply, threadType } = buildContext(api, eventData, name, eventType);
      return eventModule.run({
        api: wrapped,
        event: eventData,
        eventType,
        isSelf,
        reply,
        Users,
        Threads,
        replyData: buildReplyData(eventData),
        threadType
      });
    },
    onCommandModule(commandModule, name) {
      const { api: wrapped, reply } = buildContext(api, eventData, name);
      return commandModule.handleEvent({
        api: wrapped,
        event: eventData,
        eventType,
        isSelf,
        reply,
        Users,
        Threads,
        replyData: buildReplyData(eventData)
      });
    },
    onError(error, kind, name) {
      const label = kind === "event" ? "event" : "handleEvent trong command";
      logger.log(`Lỗi khi xử lý ${label} ${name}: ${error?.message || error}`, "error");
    }
  });
}

module.exports = handleEvent;
