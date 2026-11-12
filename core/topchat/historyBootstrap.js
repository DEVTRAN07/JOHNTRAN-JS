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



// Wait for one old_messages response before issuing the next history request.
// Zalo replays cmd 510/511 as separate global batches; overlapping requests can
// cross-talk on the shared old_messages event.
function requestOldMessagesThen(listener, threadType, onComplete, timeoutMs = 5000) {
  if (!listener || typeof listener.on !== "function" ||
      typeof listener.removeListener !== "function" ||
      typeof listener.requestOldMessages !== "function") {
    throw new TypeError("A Zalo listener with old_messages support is required");
  }
  if (typeof onComplete !== "function") throw new TypeError("onComplete must be a function");

  let settled = false;
  let timer = null;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    listener.removeListener("old_messages", onOldMessages);
  };
  const finish = (reason) => {
    if (settled) return;
    settled = true;
    cleanup();
    Promise.resolve()
      .then(() => onComplete(reason))
      .then(() => resolvePromise(reason), rejectPromise);
  };
  const onOldMessages = (_messages, responseType) => {
    if (responseType === threadType) finish("response");
  };

  listener.on("old_messages", onOldMessages);
  timer = setTimeout(() => finish("timeout"), Math.max(100, Number(timeoutMs) || 5000));
  timer.unref?.();
  try {
    listener.requestOldMessages(threadType);
  } catch {
    finish("request-error");
  }

  return {
    promise,
    cancel() {
      if (settled) return false;
      settled = true;
      cleanup();
      resolvePromise("cancelled");
      return true;
    }
  };
}

module.exports = { createCipherReadyGate, requestOldMessagesThen };
