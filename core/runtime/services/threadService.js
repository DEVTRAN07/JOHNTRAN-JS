"use strict";

function trackStorageRead(stage, startedAt) {
  try {
    require("../../metrics").trackListenerStageLatency?.(
      `storage:${stage}`,
      Number(process.hrtime.bigint() - startedAt) / 1e6
    );
  } catch {
    // Storage timing must never change data access behavior.
  }
}

function measuredRead(stage, read) {
  const startedAt = process.hrtime.bigint();
  let result;
  try {
    result = read();
  } catch (error) {
    trackStorageRead(stage, startedAt);
    throw error;
  }
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).finally(() => trackStorageRead(stage, startedAt));
  }
  trackStorageRead(stage, startedAt);
  return result;
}

/**
 * Thread/group domain service facade.
 *
 * Delegates to the existing controller so stored JSON and the normalized
 * { id, threadId, data } contract remain unchanged during migration.
 */
function createThreadService(controller) {
  if (!controller) throw new TypeError("Thread controller is required");

  return {
    getAll(...args) { return controller.getAll(...args); },
    getData(...args) { return measuredRead("thread-getData", () => controller.getData(...args)); },
    getCachedData(...args) { return controller.getCachedData?.(...args) || null; },
    setData(...args) { return controller.setData(...args); },
    setDataAndWait(...args) {
      return typeof controller.setDataAndWait === "function"
        ? controller.setDataAndWait(...args)
        : controller.setData(...args);
    },
    setBotEnabled(...args) {
      if (typeof controller.setBotEnabled !== "function") {
        throw new Error("Controller không hỗ trợ cập nhật trạng thái bot theo nhóm");
      }
      return controller.setBotEnabled(...args);
    },
    delData(...args) { return controller.delData(...args); },
    createData(...args) { return controller.createData(...args); }
  };
}

const service = createThreadService(require("../../controller/controllerThreads"));
service.createThreadService = createThreadService;

module.exports = service;
