"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antiword",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn từ ngữ bị cấm",
  category: "Anti",
  usage: "antiword [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antiword", context);
};
