"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antireaction",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chống spam reaction",
  category: "Anti",
  usage: "antireaction [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antireaction", context);
};
