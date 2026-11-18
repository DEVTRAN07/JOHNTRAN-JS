"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antiinvite",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn link mời vào nhóm khác",
  category: "Anti",
  usage: "antiinvite [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antiinvite", context);
};
