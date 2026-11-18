"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antijoin",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chống spam tham gia nhóm",
  category: "Anti",
  usage: "antijoin [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antijoin", context);
};
