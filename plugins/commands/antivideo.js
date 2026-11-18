"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antivideo",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi video",
  category: "Anti",
  usage: "antivideo [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antivideo", context);
};
