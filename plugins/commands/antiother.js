"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antiother",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn payload lỗi/không xác định",
  category: "Anti",
  usage: "antiother [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antiother", context);
};
