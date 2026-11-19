"use strict";

/**
 * Cached event subscriptions for the legacy plugin contract.
 *
 * The registry preserves Map insertion order and the historical dispatch order:
 * event plugins first, then command modules exposing handleEvent().
 */
const cache = new WeakMap();

function buildRegistry(events, commands) {
  const eventHandlers = new Map();
  const commandHandlers = [];

  if (events && typeof events[Symbol.iterator] === "function") {
    for (const [name, module] of events) {
      const types = module?.config?.event_type;
      if (!Array.isArray(types) || typeof module.run !== "function") continue;
      for (const type of types) {
        if (typeof type !== "string" || !type) continue;
        if (!eventHandlers.has(type)) eventHandlers.set(type, []);
        eventHandlers.get(type).push({ name, module, key: String(name || module?.config?.name || "").toLowerCase() });
      }
    }
  }

  if (commands && typeof commands[Symbol.iterator] === "function") {
    for (const [name, module] of commands) {
      if (typeof module?.handleEvent === "function") {
        const configuredTypes = module?.config?.event_type;
        const eventTypes = Array.isArray(configuredTypes)
          ? new Set(configuredTypes.filter(type => typeof type === "string" && type))
          : null;
        commandHandlers.push({ name, module, eventTypes, key: String(name || module?.config?.name || "").toLowerCase() });
      }
    }
  }

  return { eventHandlers, commandHandlers };
}

function getEventRegistry(events, commands) {
  if (!events || (typeof events !== "object" && typeof events !== "function")) {
    return buildRegistry(events, commands);
  }
  const cached = cache.get(events);
  if (cached && cached.commands === commands) return cached.registry;
  const registry = buildRegistry(events, commands);
  cache.set(events, { commands, registry });
  return registry;
}

function invalidateEventRegistry(events) {
  if (events && (typeof events === "object" || typeof events === "function")) {
    cache.delete(events);
  }
}

function dispatchEvent({
  events,
  commands,
  eventType,
  onEventModule,
  onCommandModule,
  onError = () => {},
  dispatchOptions = {}
} = {}) {
  // Always use the original event/command maps. Filtering temporary Maps here
  // would defeat the WeakMap cache and rebuild the full registry per command.
  const registry = getEventRegistry(events, commands);
  const eventEntries = registry.eventHandlers.get(eventType) || [];
  const isCommandMessage = dispatchOptions.isCommandMessage === true;
  const skipTopchatCounter = dispatchOptions.skipTopchatCounter === true;
  const skipGameConsumers = dispatchOptions.skipGameConsumers === true;
  const skipAntiHandler = dispatchOptions.skipAnti === true;

  let eventModules = 0;
  for (const entry of eventEntries) {
    const key = entry.key;
    if (skipTopchatCounter && key === "topchatcounter") continue;
    if (skipGameConsumers && (key === "noitu" || key === "tlmn")) continue;
    if (isCommandMessage && (
      entry.module?.config?.ignoreCommandMessages === true ||
      (key !== "guard" && entry.module?.config?.allowCommandMessages !== true)
    )) continue;

    eventModules++;
    Promise.resolve()
      .then(() => onEventModule?.(entry.module, entry.name))
      .catch((error) => onError(error, "event", entry.name));
  }

  let commandModules = 0;
  for (const entry of registry.commandHandlers) {
    if (entry.eventTypes && !entry.eventTypes.has(eventType)) continue;
    const key = entry.key;
    if (skipAntiHandler && key === "anti") continue;
    if (skipGameConsumers && (key === "noitu" || key === "tlmn")) continue;
    if (isCommandMessage && (
      entry.module?.config?.ignoreCommandMessages === true ||
      (key !== "anti" && entry.module?.config?.allowCommandMessages !== true)
    )) continue;

    commandModules++;
    Promise.resolve()
      .then(() => onCommandModule?.(entry.module, entry.name))
      .catch((error) => onError(error, "command", entry.name));
  }

  return { eventModules, commandModules };
}
module.exports = {
  buildRegistry,
  getEventRegistry,
  invalidateEventRegistry,
  dispatchEvent
};
