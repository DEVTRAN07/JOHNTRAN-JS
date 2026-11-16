"use strict";

const PLAIN_GAME_ACTIONS = new Set(["join caro", "lose", "leave", "stop", "pass", "skip"]);

function buildRequesterMention(event) {
  if (event?.type !== 1) return null;

  const uid = String(event?.data?.uidFrom || "").trim();
  if (!uid) return null;

  const content = typeof event?.data?.content === "string"
    ? event.data.content.trim()
    : "";
  const prefix = String(global.config?.prefix || "/");
  const isCommand = Boolean(prefix && content.startsWith(prefix)) ||
    PLAIN_GAME_ACTIONS.has(content.toLocaleLowerCase("vi-VN"));
  if (!isCommand) return null;

  const rawName = String(event?.data?.dName || event?.data?.name || "Bạn");
  const name = rawName.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/^@+/, "").trim() || "Bạn";
  const label = "@" + name;
  return {
    text: label + "\n",
    mention: { pos: 0, uid, len: label.length }
  };
}

function withRequesterMention(event, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const requester = buildRequesterMention(event);
  if (!requester) return payload;

  const originalMessage = typeof payload.msg === "string" ? payload.msg : "";
  const existingMentions = Array.isArray(payload.mentions)
    ? payload.mentions.map(mention => ({
        ...mention,
        pos: (Number(mention?.pos) || 0) + requester.text.length
      }))
    : [];

  return {
    ...payload,
    msg: requester.text + originalMessage,
    mentions: [requester.mention, ...existingMentions]
  };
}

module.exports = { buildRequesterMention, withRequesterMention };
