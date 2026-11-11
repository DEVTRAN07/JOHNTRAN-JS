const fs = require("fs");
const path = require("path");
const logger = require("./logger");

function saveBase64Image(base64String, outputPath) {
    const matches = base64String.match(/^data:(image\/\w+);base64,(.+)$/);
    let base64Data = base64String;

    if (matches) {
        base64Data = matches[2];
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const buf = Buffer.from(base64Data, "base64");
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        throw new Error("Ảnh QR rỗng sau decode base64");
    }

    fs.writeFileSync(outputPath, buf);
}

const getJsonData = (filePath, defaultData = {}) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!fs.existsSync(filePath)) {
        logger.log(`File ${path.basename(filePath)} chưa tồn tại, tạo mới.`, "warn");
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), "utf8");
        return defaultData;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
};

function tryUnlink(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* bỏ qua */ }
}

module.exports = {
    saveBase64Image,
    getJsonData,
    tryUnlink
};
