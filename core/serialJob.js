"use strict";

function stopSerialJob(threadId, running) {
  const key = String(threadId);
  const job = running?.get(key);
  if (!job) return null;
  job.stopped = true;
  if (job.timer) clearTimeout(job.timer);
  job.timer = null;
  running.delete(key);
  return job;
}

function startSerialJob({ threadId, running, job, delayMs, run, onComplete, onError } = {}) {
  const key = String(threadId ?? "");
  if (!key || !(running instanceof Map) || !job || typeof run !== "function") {
    throw new TypeError("startSerialJob requires threadId, running Map, job and run()");
  }
  if (running.has(key)) return false;

  job.stopped = false;
  job.timer = null;
  const delay = Math.max(0, Number(delayMs) || 0);

  const schedule = () => {
    if (running.get(key) !== job || job.stopped) return;
    job.timer = setTimeout(async () => {
      if (running.get(key) !== job || job.stopped) return;
      job.timer = null;

      if (job.times !== 0 && Number(job.count) >= Number(job.times)) {
        running.delete(key);
        job.stopped = true;
        try {
          await onComplete?.(job);
        } catch (error) {
          try { await onError?.(error, job); } catch { /* preserve job completion */ }
        }
        return;
      }

      try {
        await run(job);
      } catch (error) {
        if (running.get(key) !== job || job.stopped) return;
        running.delete(key);
        job.stopped = true;
        try { await onError?.(error, job); } catch { /* command error handlers are isolated */ }
        return;
      }

      // Stop may have been requested while the current API call was in flight.
      if (running.get(key) !== job || job.stopped) return;
      job.count = Math.max(0, Number(job.count) || 0) + 1;
      schedule();
    }, delay);
    job.timer.unref?.();
  };

  running.set(key, job);
  schedule();
  return true;
}

module.exports = { startSerialJob, stopSerialJob };
