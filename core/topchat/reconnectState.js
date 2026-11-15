"use strict";

// A WebSocket OPEN is not proof that the Zalo session is usable.
// Reset the consecutive failure count only after the cipher handshake.
function createReconnectFailureTracker(limit = 3) {
  const maxFailures = Math.max(1, Number(limit) || 3);
  let failures = 0;
  return {
    markStable() { failures = 0; },
    closed() {
      failures += 1;
      return { count: failures, exhausted: failures >= maxFailures };
    },
    get count() { return failures; }
  };
}

module.exports = { createReconnectFailureTracker };
