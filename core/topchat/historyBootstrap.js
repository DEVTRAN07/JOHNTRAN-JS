"use strict";

function createCipherReadyGate(onReady) {
  if (typeof onReady !== "function") throw new TypeError("onReady must be a function");
  let waitingForCipher = false;
  let generation = 0;

  return {
    connected() {
      generation++;
      waitingForCipher = true;
      return generation;
    },
    cipherReady() {
      if (!waitingForCipher) return false;
      waitingForCipher = false;
      onReady(generation);
      return true;
    },
    disconnected() {
      waitingForCipher = false;
    },
    get waiting() {
      return waitingForCipher;
    },
    get generation() {
      return generation;
    }
  };
}

module.exports = { createCipherReadyGate };
