"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antitaghide",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn nhắc tên ẩn trong nhóm",
  category: "Anti",
  usage: "antitaghide [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antitaghide", context);
};
