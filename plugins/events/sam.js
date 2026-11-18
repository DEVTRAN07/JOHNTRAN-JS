"use strict";

const sam = require("../commands/sam");

module.exports.config = {
  name: "sam",
  event_type: ["message"],
  version: "1.0.0",
  author: "JOHNTRAN",
  description: "Nhận lượt đánh trực tiếp trong game Sâm Lốc",
  category: "Game",
  usage: "nhập mã lá, doi 7, sam 9, tuquy 5, sanh 345 hoặc pass",
  cooldowns: 0,
  dependencies: {}
};

module.exports.run = async function (context) {
  if (!sam.hasActiveRoom?.(context?.event?.threadId)) return false;
  return sam.handleIncoming(context);
};
