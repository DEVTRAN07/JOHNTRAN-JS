"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antijoin",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn spam vào lại nhóm",
  category: "Anti",
  usage: "antijoin [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antijoin", context);
};
