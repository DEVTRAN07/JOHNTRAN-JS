"use strict";

const tlmn = require("../commands/tlmn");

module.exports.config = {
  name: "tlmn",
  event_type: ["message"],
  ignoreCommandMessages: true,
  version: "1.1.0",
  author: "JOHNTRAN",
  description: "Nhận lệnh bàn, lượt bỏ và mã bài Tiến Lên Miền Nam",
  category: "Game",
  usage: "join <mã 5 số> / start / bo / pass / 3b / doi 4 / sanh 345",
  cooldowns: 0,
  dependencies: {}
};

module.exports.run = async function (context) {
  return tlmn.handleIncoming(context);
};
