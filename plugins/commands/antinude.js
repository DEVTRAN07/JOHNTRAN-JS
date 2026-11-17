"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antinude",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "AI quét và xử lý ảnh 18+ / khỏa thân trong nhóm",
  category: "Anti",
  usage: "antinude [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antinude", context);
};
