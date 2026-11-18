"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antivoice",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn tin nhắn thoại",
  category: "Anti",
  usage: "antivoice [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antivoice", context);
};
