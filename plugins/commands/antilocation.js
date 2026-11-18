"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antilocation",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn chia sẻ vị trí",
  category: "Anti",
  usage: "antilocation [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antilocation", context);
};
