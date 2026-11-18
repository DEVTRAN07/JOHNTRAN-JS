"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antilink",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn mọi URL và link mời nhóm khác trong nhóm",
  category: "Anti",
  usage: "antilink [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antilink", context);
};
