"use strict";

/**
 * User domain service facade.
 *
 * Keeps the existing controller as the storage implementation for now.
 * This creates a stable service boundary without changing persistence,
 * cache semantics, record shape, or the plugin API.
 */
function createUserService(controller) {
  if (!controller) throw new TypeError("User controller is required");

  return Object.freeze({
    getAll(...args) { return controller.getAll(...args); },
    getData(...args) { return controller.getData(...args); },
    setData(...args) { return controller.setData(...args); },
    delData(...args) { return controller.delData(...args); },
    createData(...args) { return controller.createData(...args); },
    isBanned(...args) { return controller.isBanned(...args); },
    setBan(...args) { return controller.setBan(...args); }
  });
}

const service = createUserService(require("../../controller/controllerUsers"));
service.createUserService = createUserService;

module.exports = service;
