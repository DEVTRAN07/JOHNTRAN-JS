"use strict";

const { performance } = require("node:perf_hooks");
const { ThreadType } = require("zalo-client");

// Status reactions create extra Zalo requests on every command. Keep them opt-in
// so the default fast path sends only the actual command result.
const SHOW_COMMAND_STATUS_REACTIONS = process.env.JT_COMMAND_STATUS_REACTIONS === "true";

/**
 * Executes a resolved command using the legacy plugin contract.
 * Parsing, permissions and cooldowns stay in the pipeline; this module owns
 * only invocation, status reactions and command-level error isolation.
 */
async function dispatchCommand({
  command,
  commandName,
  args = [],
  event,
  api,
  Users,
  Threads,
  threadData,
  userData,
  logger,
  metrics,
  Reactions
} = {}) {
  const commandStartedAt = performance.now();
  try {
    const replyData = {
      content: event.data.content,
      msgType: event.data.msgType,
      propertyExt: event.data.propertyExt,
      uidFrom: event.data.uidFrom,
      msgId: event.data.msgId,
      cliMsgId: event.data.cliMsgId,
      ts: event.data.ts
    };
    metrics?.track?.("command", { command: commandName });

    const reply = api.__reply;
    let autoReacted = false;
    const reactAuto = (icon) => {
      if (reply.reacted && !autoReacted) return;
      autoReacted = true;
      Promise.resolve(reply.react(icon)).catch(() => {});
    };

    // Fast acknowledgement: show that the command has been received and is running.
    if (SHOW_COMMAND_STATUS_REACTIONS) reactAuto(Reactions.PRAY);
    try {
      await command.run({
        args,
        event,
        api,
        Users,
        Threads,
        replyData,
        reply,
        mentions: event.mentions || [],
        threadData,
        userData
      });
      if (SHOW_COMMAND_STATUS_REACTIONS && command?.config?.backgroundExecution !== true) {
        reactAuto(Reactions.OK);
      }
    } catch (error) {
      logger.log(`Lỗi khi xử lý lệnh '${commandName}': ${error.message}`, "error", { source: "command", commandName, isGroup: event?.type === ThreadType.Group, groupId: event?.type === ThreadType.Group ? event?.threadId : "" });
      metrics?.track?.("error", { command: commandName });
      if (SHOW_COMMAND_STATUS_REACTIONS) reactAuto(Reactions.CRY);
      try {
        await reply.error("Đã xảy ra lỗi khi xử lý lệnh!");
      } catch {
        // Ignore reply failures; command errors are already logged.
      }
    } finally {
      reply?.finishCommand?.();
    }
  } catch (error) {
    logger.log(`Lỗi pipeline lệnh '${commandName}': ${error.message}`, "error");
  } finally {
    metrics?.trackCommandExecutionLatency?.(commandName, performance.now() - commandStartedAt);
  }
}

module.exports = { dispatchCommand };
