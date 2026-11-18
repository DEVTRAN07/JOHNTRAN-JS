"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antistk",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn gửi sticker",
  category: "Anti",
  usage: "antistk [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antistk", context);
};
