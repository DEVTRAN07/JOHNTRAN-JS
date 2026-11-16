"use strict";

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
    getData(...args) { return controller.getData(...args); },
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
