"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antidoodle",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi nét vẽ doodle",
  category: "Anti",
  usage: "antidoodle [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antidoodle", context);
};
