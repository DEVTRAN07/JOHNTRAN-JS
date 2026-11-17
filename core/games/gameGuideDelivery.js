"use strict";

const inFlight = new Map();
const sentThisProcess = new Set();

async function sendGameGuideOnce({ Users, uid, gameKey, send } = {}) {
  const userId = String(uid || "").trim();
  const keyName = String(gameKey || "").trim();
  if (!userId || !keyName || typeof send !== "function" ||
      typeof Users?.getData !== "function") {
    return { ok: false, sent: false, code: "INVALID_INPUT" };
  }

  const key = keyName + ":" + userId;
  if (sentThisProcess.has(key)) return { ok: true, sent: false, alreadySent: true };
  const active = inFlight.get(key);
  if (active) return active;

  const task = (async () => {
    let record;
    try {
      record = await Users.getData(userId);
    } catch (error) {
      return { ok: false, sent: false, code: "READ_FAILED", error };
    }

    const data = record?.data && typeof record.data === "object"
      ? { ...record.data }
      : record && typeof record === "object" ? { ...record } : {};
    const existingGuides = data.gameGuides && typeof data.gameGuides === "object"
      ? { ...data.gameGuides } : {};
    if (existingGuides[keyName] === true) {
      sentThisProcess.add(key);
      return { ok: true, sent: false, alreadySent: true };
    }

    let response;
    try {
      response = await send();
    } catch (error) {
      return { ok: false, sent: false, code: "SEND_FAILED", error };
    }
    if (!response) return { ok: false, sent: false, code: "SEND_FAILED" };

    // Don't resend repeatedly in this process if the database write fails.
    sentThisProcess.add(key);
    let persisted = false;
    const nextData = { ...data, gameGuides: { ...existingGuides, [keyName]: true } };
    try {
      if (typeof Users.setDataAndWait === "function") {
        await Users.setDataAndWait(userId, nextData);
        persisted = true;
      } else if (typeof Users.setData === "function") {
        await Users.setData(userId, nextData);
        persisted = true;
      }
    } catch {
      persisted = false;
    }
    return { ok: true, sent: true, persisted };
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}

module.exports = { sendGameGuideOnce };
