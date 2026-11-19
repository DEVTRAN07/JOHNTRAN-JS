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

/**
 * Filter passive message subscribers before dispatch. Prefixed commands must
 * not fan out to every chat/game automation: only moderation handlers (or
 * plugins that explicitly opt in) should inspect command text.
 */
function filterDispatchSources(sources = {}, options = {}) {
  const sourceEvents = sources.events instanceof Map ? sources.events : new Map();
  const sourceCommands = sources.commands instanceof Map ? sources.commands : new Map();
  const skipTopchatCounter = options.skipTopchatCounter === true;
  const skipGameConsumers = options.skipGameConsumers === true;
  const skipAntiHandler = options.skipAnti === true;
  const isCommandMessage = options.isCommandMessage === true;

  const events = new Map([...sourceEvents].filter(([name, eventModule]) => {
    const key = String(name || eventModule?.config?.name || "").toLowerCase();
    if (skipTopchatCounter && key === "topchatcounter") return false;
    if (skipGameConsumers && (key === "noitu" || key === "tlmn")) return false;
    const commandAware = key === "guard" || eventModule?.config?.allowCommandMessages === true;
    if (isCommandMessage && (
      eventModule?.config?.ignoreCommandMessages === true ||
      !commandAware
    )) return false;
    return true;
  }));

  const commands = new Map([...sourceCommands].filter(([name, command]) => {
    const key = String(name || command?.config?.name || "").toLowerCase();
    if (skipAntiHandler && key === "anti") return false;
    if (skipGameConsumers && (key === "noitu" || key === "tlmn")) return false;
    const commandAware = key === "anti" || command?.config?.allowCommandMessages === true;
    if (isCommandMessage && (
      command?.config?.ignoreCommandMessages === true ||
      !commandAware
    )) return false;
    return true;
  }));

  return { events, commands };
}

module.exports = {
  buildRegistry,
  getEventRegistry,
  invalidateEventRegistry,
  filterDispatchSources,
  dispatchEvent
};
