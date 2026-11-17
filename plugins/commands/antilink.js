"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antilink",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn link mời nhóm Zalo khác và URL bị đánh dấu không an toàn",
  category: "Anti",
  usage: "antilink [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antilink", context);
};
