const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { saveBase64Image } = require("./file");

async function decodeQRFromBase64(base64Image) {
    try {
        const buffer = Buffer.from(base64Image, "base64");
        const Jimp = require("jimp");
        const jimpImage = await Jimp.read(buffer);
        const imageData = {
            data: new Uint8ClampedArray(jimpImage.bitmap.data),
            width: jimpImage.bitmap.width,
            height: jimpImage.bitmap.height
        };

        const jsQR = require("jsqr");
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
            return code.data;
        } else {
            throw new Error("Không thể đọc QR code");
        }
    } catch (error) {
        throw error;
    }
}

function generateQRCodeInTerminal(data, options = {}) {
    const { plain, stripAnsi, ...qrOptions } = options || {};
    const defaultOptions = {
        type: "terminal",
        small: true,
        margin: 0,
        errorCorrectionLevel: "L"
    };

    const finalOptions = { ...defaultOptions, ...qrOptions };

    return new Promise((resolve, reject) => {
        const QRCode = require("qrcode");
        QRCode.toString(data, finalOptions, (err, string) => {
            if (err) {
                reject(err);
            } else {
                const out = (plain || stripAnsi)
                    ? String(string).replace(/\x1b\[[0-9;]*m/g, "")
                    : string;
                resolve(out);
            }
        });
    });
}

async function displayQRCodeInConsole(base64Image, fallbackPath = null, options = {}) {
    const verifySaved = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;
    try {
        if (options.terminal !== false) {
            const qrData = await decodeQRFromBase64(base64Image);
            const qrString = await generateQRCodeInTerminal(qrData);
            logger.printReplaceable([qrString]);
        }
        if (options.printPlain) {
            try {
                const qrData = await decodeQRFromBase64(base64Image);
                const qrString = await generateQRCodeInTerminal(qrData, { small: true, margin: 0, plain: true });
                const compact = String(qrString).replace(/\n+$/g, "");
                console.log("\n[QR LOGIN ASCII]\n" + compact);
            } catch (plainErr) {
                logger.log("Không thể in ASCII QR plainly: " + (plainErr.message || plainErr), "warn");
            }
        }
        if (fallbackPath) {
            try {
                saveBase64Image(base64Image, fallbackPath);
                if (!verifySaved(fallbackPath)) {
                    throw new Error(`QR file trống hoặc không tồn tại: ${fallbackPath}`);
                }
                if (options.terminal !== false) {
                    logger.log(`Đã lưu QRCode tại: ${path.basename(fallbackPath)} (mở ảnh để xem nhỏ gọn hơn)`, "info");
                }
            } catch (e) {
                logger.log(`Không thể lưu QRCode ra file (${fallbackPath}): ${e.message || e}`, "error");
                return false;
            }
        }
        return true;
    } catch (error) {
        if (fallbackPath) {
            logger.log("Lỗi hiển thị QR code trong terminal, đang lưu vào file...", "warn");
            try {
                saveBase64Image(base64Image, fallbackPath);
                if (!verifySaved(fallbackPath)) {
                    throw new Error(`QR file trống hoặc không tồn tại: ${fallbackPath}`);
                }
                logger.log(`Vui lòng quét mã QRCode ${path.basename(fallbackPath)} để đăng nhập`, "info");
                return true;
            } catch (e) {
                logger.log(`Không thể lưu QRCode ra file (${fallbackPath}): ${e.message || e}`, "error");
                return false;
            }
        }
        return false;
    }
}

module.exports = {
    decodeQRFromBase64,
    generateQRCodeInTerminal,
    displayQRCodeInConsole
};
