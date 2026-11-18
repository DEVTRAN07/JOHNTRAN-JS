"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "anticard",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi danh thiếp",
  category: "Anti",
  usage: "anticard [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("anticard", context);
};
