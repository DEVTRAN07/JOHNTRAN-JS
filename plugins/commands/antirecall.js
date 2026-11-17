"use strict";

const { runAntiToggle } = require("../../core/runtime/antiToggle");

module.exports.config = {
  name: "antirecall",
  version: "1.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Lưu và khôi phục nội dung tin nhắn khi thành viên thu hồi",
  category: "Anti",
  usage: "antirecall [on/off]",
  cooldowns: 1
};

module.exports.run = function (context) {
  return runAntiToggle("antirecall", context);
};
