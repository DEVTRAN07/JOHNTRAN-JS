"use strict";

const { performance } = require("node:perf_hooks");
const { ThreadType } = require("zalo-client");

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

    const reply = api?.__reply;
    let autoReacted = false;
    const reactAuto = (icon) => {
      if (reply?.reacted && !autoReacted) return;
      if (typeof reply?.react !== "function") return;
      autoReacted = true;
      Promise.resolve(reply.react(icon)).catch(() => {});
    };

    // Do not spend a Zalo API call on a status reaction for fast commands.
    // Long-running commands still get a visible acknowledgement after a short
    // grace period; the first outgoing message cancels it in Reply.markResponseStarted().
    // A working reaction costs another Zalo API request. Keep it opt-in so
    // ordinary commands do not launch a second request that competes with
    // the actual reply. Background jobs retain their progress indicator.
    const hasAckConfig = command?.config &&
      Object.prototype.hasOwnProperty.call(command.config, "ackDelayMs");
    const configuredAckDelay = hasAckConfig
      ? Number(command.config.ackDelayMs)
      : command?.config?.backgroundExecution === true ? 600 : 0;
    const ackDelayMs = Number.isFinite(configuredAckDelay)
      ? Math.max(0, Math.min(5000, Math.floor(configuredAckDelay)))
      : 0;
    if (ackDelayMs > 0) {
      reply?.scheduleAcknowledgement?.(() => reactAuto(Reactions.PRAY), ackDelayMs);
    }

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
      // A quick command that already sent its result does not need an extra
      // success reaction. Update status only when a working reaction was shown,
      // or when the command completed without sending a response.
      if (command?.config?.backgroundExecution !== true &&
          (reply?.reacted === true || reply?._responseStarted !== true)) {
        reactAuto(Reactions.OK);
      }
    } catch (error) {
      logger.log(`Lỗi khi xử lý lệnh '${commandName}': ${error.message}`, "error", { source: "command", commandName, isGroup: event?.type === ThreadType.Group, groupId: event?.type === ThreadType.Group ? event?.threadId : "" });
      metrics?.track?.("error", { command: commandName });
      // Send the useful error message first; reactions are secondary UI.
      try {
        await reply?.error?.("Đã xảy ra lỗi khi xử lý lệnh!");
      } catch {
        // Ignore reply failures; command errors are already logged.
      }
      reactAuto(Reactions.CRY);
    } finally {
      reply?.cancelAcknowledgement?.();
      reply?.finishCommand?.();
    }
  } catch (error) {
    logger.log(`Lỗi pipeline lệnh '${commandName}': ${error.message}`, "error");
  } finally {
    metrics?.trackCommandExecutionLatency?.(commandName, performance.now() - commandStartedAt);
  }
}

module.exports = { dispatchCommand };
