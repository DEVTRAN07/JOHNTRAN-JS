"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antisex",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn nội dung nhạy cảm 18+",
  category: "Anti",
  usage: "antisex [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antisex", context);
};
