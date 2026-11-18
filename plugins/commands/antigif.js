"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antigif",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi ảnh động GIF",
  category: "Anti",
  usage: "antigif [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antigif", context);
};
