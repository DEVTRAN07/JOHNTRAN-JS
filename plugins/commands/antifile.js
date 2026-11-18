"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antifile",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi tập tin đính kèm",
  category: "Anti",
  usage: "antifile [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antifile", context);
};
