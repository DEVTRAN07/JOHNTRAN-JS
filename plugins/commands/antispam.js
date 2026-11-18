"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antispam",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn spam tin nhắn liên tục và dội bom sticker",
  category: "Anti",
  usage: "antispam [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antispam", context);
};
