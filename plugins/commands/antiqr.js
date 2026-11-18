"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antiqr",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Chặn ảnh mã QR được nhận diện",
  category: "Anti",
  usage: "antiqr [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antiqr", context);
};
