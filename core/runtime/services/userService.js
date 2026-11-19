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
 * User domain service facade.
 *
 * Keeps the existing controller as the storage implementation for now.
 * This creates a stable service boundary without changing persistence,
 * cache semantics, record shape, or the plugin API.
 */
function createUserService(controller) {
  if (!controller) throw new TypeError("User controller is required");

  return {
    getAll(...args) { return controller.getAll(...args); },
    getData(...args) { return measuredRead("user-getData", () => controller.getData(...args)); },
    getCachedData(...args) { return controller.getCachedData?.(...args) ?? null; },
    setData(...args) { return controller.setData(...args); },
    setDataAndWait(...args) {
      return typeof controller.setDataAndWait === "function"
        ? controller.setDataAndWait(...args)
        : controller.setData(...args);
    },
    delData(...args) { return controller.delData(...args); },
    createData(...args) { return controller.createData(...args); },
    isBanned(...args) { return controller.isBanned(...args); },
    setBan(...args) { return controller.setBan(...args); }
  };
}

const service = createUserService(require("../../controller/controllerUsers"));
service.createUserService = createUserService;

module.exports = service;
