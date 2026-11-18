"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antistklag",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn sticker gây giật lag",
  category: "Anti",
  usage: "antistklag [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antistklag", context);
};
