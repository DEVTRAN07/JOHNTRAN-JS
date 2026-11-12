"use strict";

/**
 * Database adapter boundary for the legacy storage API.
 *
 * JSON/Supabase selection remains owned by utils/db. This adapter only
 * normalizes access for domain controllers and metrics; it does not migrate
 * records, alter keys, or change sync/async behavior.
 */
function createDatabaseAdapter(backend) {
  if (!backend || typeof backend !== "object") {
    throw new TypeError("Database backend is required");
  }

  const required = ["getData", "saveData", "hasData", "delData", "allData"];
  for (const method of required) {
    if (typeof backend[method] !== "function") {
      throw new TypeError(`Database backend is missing ${method}()`);
    }
  }

  return {
    getData(...args) { return backend.getData(...args); },
    saveData(...args) { return backend.saveData(...args); },
    hasData(...args) { return backend.hasData(...args); },
    delData(...args) { return backend.delData(...args); },
    allData(...args) { return backend.allData(...args); },
    flush(...args) {
      return typeof backend.flush === "function" ? backend.flush(...args) : undefined;
    },
    get db() { return backend.db; }
  };
}

const adapter = createDatabaseAdapter(require("../../../utils/db"));
adapter.createDatabaseAdapter = createDatabaseAdapter;

module.exports = adapter;
