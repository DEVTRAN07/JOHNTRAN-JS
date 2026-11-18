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
        eventHandlers.get(type).push({ name, module });
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
        commandHandlers.push({ name, module, eventTypes });
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
  onError = () => {}
} = {}) {
  const registry = getEventRegistry(events, commands);
  const eventModules = registry.eventHandlers.get(eventType) || [];

  for (const entry of eventModules) {
    Promise.resolve()
      .then(() => onEventModule?.(entry.module, entry.name))
      .catch((error) => onError(error, "event", entry.name));
  }

  let commandModules = 0;
  for (const entry of registry.commandHandlers) {
    if (entry.eventTypes && !entry.eventTypes.has(eventType)) continue;
    commandModules++;
    Promise.resolve()
      .then(() => onCommandModule?.(entry.module, entry.name))
      .catch((error) => onError(error, "command", entry.name));
  }

  return {
    eventModules: eventModules.length,
    commandModules
  };
}

module.exports = {
  buildRegistry,
  getEventRegistry,
  invalidateEventRegistry,
  dispatchEvent
};
