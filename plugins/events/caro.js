"use strict";

const caro = require("../commands/caro");

module.exports.config = {
  name: "caro",
  event_type: ["message"],
  version: "1.0.0",
  author: "Wuang",
  description: "Nhận nước đi trực tiếp và lệnh nhanh trong game Caro",
  category: "Game",
  usage: "nhập số ô 001–256 khi đến lượt; lose/leave/stop để điều khiển ván",
  cooldowns: 0,
  dependencies: {}
};

module.exports.run = async function (context) {
  return caro.handleIncoming(context);
};
