const file = require("./file");
const config = require("./config");
const messageCache = require("./messageCache");
const media = require("./media");
const qr = require("./qr");

module.exports = {
  // file
  saveBase64Image: file.saveBase64Image,
  getJsonData: file.getJsonData,
  tryUnlink: file.tryUnlink,
  // config
  updateConfigArray: config.updateConfigArray,
  reloadConfig: config.reloadConfig,
  // messageCache
  updateMessageCache: messageCache.updateMessageCache,
  getMessageCache: messageCache.getMessageCache,
  cleanOldMessages: messageCache.cleanOldMessages,
  // media
  convertDurationToFiveDigits: media.convertDurationToFiveDigits,
  uploadFile: media.uploadFile,
  extractThumbnail: media.extractThumbnail,
  processVideo: media.processVideo,
  processAudio: media.processAudio,
  convertMp3ToAac: media.convertMp3ToAac,
  // qr
  decodeQRFromBase64: qr.decodeQRFromBase64,
  generateQRCodeInTerminal: qr.generateQRCodeInTerminal,
  displayQRCodeInConsole: qr.displayQRCodeInConsole,
  // convertTimestamp (kept inline as it's simple)
  convertTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    return date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  }
};