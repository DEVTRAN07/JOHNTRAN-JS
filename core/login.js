const fs = require("fs");
const path = require("path");
const os = require("os");
const { ZaloClient, LoginQRCallbackEventType } = require("zalo-client");
const logger = require("../utils/logger");
const { registerStickerApi } = require("./stickerFactory");
const { getJsonData, displayQRCodeInConsole } = require("../utils/index");

let db;
try {
  db = require("../utils/db");
} catch {
  db = null;
}

let _loginState = 'starting';
function setLoginState(s) { _loginState = s; }
function getLoginState() { return _loginState; }

const USER_AGENTS = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
};

function resolveBotPath(target) {
    return path.isAbsolute(target) ? target : path.join(__dirname, "..", String(target));
}

function resolveQrPath() {
  const envPath = process.env.JT_QRCODE_PATH;
  if (envPath && path.isAbsolute(envPath)) return envPath;
  return resolveBotPath(global.config?.qrcode_path || "qr.png");
}

function resolveAccountPath() {
  const envPath = process.env.JT_ACCOUNT_FILE;
  if (envPath && String(envPath).trim()) {
    return path.isAbsolute(envPath) ? envPath : resolveBotPath(envPath);
  }
  return resolveBotPath(global.config?.account_file || "account.json");
}

const BOT_NAME = process.env.JT_BOT_NAME || "main";

function saveBotStats(loginState, extra = {}) {
  if (!db) return;
  try {
    const statusMap = {
      starting: 'starting',
      cookie_login: 'starting',
      qr_pending: 'waiting',
      qr_scanned: 'waiting',
      logged_in: 'online',
      failed: 'failed'
    };
    const data = {
      loginState,
      status: statusMap[loginState] || 'starting',
      loginMessage: extra.loginMessage || '',
      reason: extra.reason || '',
      qrUpdatedAt: extra.qrUpdatedAt != null ? extra.qrUpdatedAt : Date.now(),
      updatedAt: Date.now()
    };
    if (extra.qrPath) data.qrPath = path.basename(String(extra.qrPath));
    db.saveData("BotStats", "name", BOT_NAME, data);
  } catch (error) {
    logger.logDebug(`[stats] Không ghi được BotStats (${loginState}): ${error.message || error}`);
  }
}

function resolveUserAgent() {
  const configured = global.config?.device?.user_agent;
  if (configured && String(configured).trim()) return String(configured).trim();
  const platform = os.platform();
  if (platform === "darwin") return USER_AGENTS.mac;
  if (platform === "win32") return USER_AGENTS.windows;
  if (platform === "linux") return USER_AGENTS.linux;
  return USER_AGENTS.mac;
}

function deviceLabel(userAgent) {
  if (userAgent.includes("iPhone")) return "iPhone";
  if (userAgent.includes("Android")) return "Android";
  if (userAgent.includes("Macintosh")) return "macOS";
  if (userAgent.includes("Windows")) return "Windows";
  if (userAgent.includes("Linux")) return "Linux";
  return "Không rõ";
}

function readImageHeaderSize(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      const segmentLength = buf.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
  }
  return null;
}

function createZaloClient() {
  return new ZaloClient({
    ...global.config.zalo_client_config,
    imageMetadataGetter: async (filePath) => {
      const fileHandle = await fs.promises.open(filePath, "r");
      try {
        const header = Buffer.alloc(64);
        const { bytesRead } = await fileHandle.read(header, 0, 64, 0);
        const size = (await fileHandle.stat()).size;
        const headerSize = readImageHeaderSize(header.subarray(0, bytesRead));
        if (headerSize) {
          return { width: headerSize.width, height: headerSize.height, size };
        }
      } finally {
        await fileHandle.close();
      }
      const Jimp = require("jimp");
      const image = await Jimp.read(filePath);
      return { width: image.bitmap.width, height: image.bitmap.height, size: fs.statSync(filePath).size };
    }
  });
}

async function loginWithQR() {
    try {
        const userAgent = resolveUserAgent();
        const zalo = createZaloClient();
        const accountPath = resolveAccountPath();
        fs.mkdirSync(path.dirname(accountPath), { recursive: true });

        const accountData = getJsonData(accountPath);
        const cookieFileName = accountData.cookie || "cookie.json";
        const cookiePath = path.isAbsolute(cookieFileName)
          ? cookieFileName
          : path.join(path.dirname(accountPath), cookieFileName);

        const qrPath = resolveQrPath();
        try { fs.mkdirSync(path.dirname(qrPath), { recursive: true }); } catch {}

        function tryRemoveQr() {
          try { if (qrPath && fs.existsSync(qrPath)) fs.unlinkSync(qrPath); } catch {}
        }

        function publishQrPending(message) {
          setLoginState('qr_pending');
          saveBotStats('qr_pending', { loginMessage: message, qrPath: path.basename(qrPath), qrUpdatedAt: Date.now() });
        }

        let qrRetryAttempts = 0;
        const MAX_QR_RETRIES = 8;

        const api = await zalo.loginQR({ userAgent }, async (qrData) => {
            const eventType = qrData?.type;
            const data = qrData?.data || {};

            if (eventType === LoginQRCallbackEventType.QRCodeGenerated) {
                const { image } = data;
                if (!image) return;

                qrRetryAttempts = 0;

                const isChild = process.env.JT_PANEL_CHILD === "1";
                const isNonTTY = !process.stdout.isTTY || !!(process.env.PORT || process.env.RENDER || process.env.RENDER_SERVICE_ID);
                const qrUrl = process.env.RENDER_EXTERNAL_URL
                    ? `${String(process.env.RENDER_EXTERNAL_URL).replace(/\/$/, "")}/qr`
                    : null;

                if (isChild || isNonTTY) {
                    const saved = await displayQRCodeInConsole(image, qrPath, { terminal: false, printPlain: true });
                    if (!saved || !fs.existsSync(qrPath) || fs.statSync(qrPath).size === 0) {
                        logger.log(`[QR LOGIN] Không lưu được QR tại ${qrPath}; /qr sẽ chưa có mã.`, "error");
                    }
                    publishQrPending(qrUrl ? `Mở ${qrUrl} để quét mã QR đăng nhập Zalo.` : "Mở /qr để quét mã QR đăng nhập Zalo.");
                    if (qrUrl) {
                        logger.log(`[QR LOGIN] Mở ${qrUrl} (hoặc /qr/main) để quét mã QR đăng nhập Zalo. (file: ${qrPath})`, "info");
                    } else {
                        logger.log("[QR LOGIN] Mở URL dịch vụ Render của bạn và truy cập /qr (hoặc /qr/main) để quét mã QR đăng nhập Zalo.", "info");
                    }
                    return;
                }

                logger.log("Vui lòng quét mã QRCode bên dưới để đăng nhập:", "info");
                await displayQRCodeInConsole(image, qrPath);
                publishQrPending("Vui lòng quét mã QRCode để đăng nhập Zalo.");
                return;
            }

            if (eventType === LoginQRCallbackEventType.QRCodeScanned) {
                logger.log("Đã quét QRCode, vui lòng xác nhận trên điện thoại", "info");
                setLoginState('qr_scanned');
                saveBotStats('qr_scanned', { loginMessage: 'Đã quét QR, vui lòng xác nhận trên điện thoại', qrPath: path.basename(qrPath), qrUpdatedAt: Date.now() });
                return;
            }

            if (eventType === LoginQRCallbackEventType.QRCodeExpired || eventType === LoginQRCallbackEventType.QRCodeDeclined) {
                qrRetryAttempts += 1;
                const label = eventType === LoginQRCallbackEventType.QRCodeExpired ? 'hết hạn' : 'bị từ chối';
                if (qrRetryAttempts > MAX_QR_RETRIES) {
                    const reason = `Mã QR ${label} quá ${MAX_QR_RETRIES} lần, dừng đăng nhập`;
                    logger.log(`[QR LOGIN] ${reason}`, "error");
                    setLoginState('failed');
                    saveBotStats('failed', { loginMessage: reason, reason: 'qr_retries_exhausted', qrPath: path.basename(qrPath), qrUpdatedAt: Date.now() });
                    tryRemoveQr();
                    process.exit(1);
                    return;
                }
                const delayMs = Math.min(1000 * Math.pow(2, qrRetryAttempts - 1), 15000);
                logger.log(`QRCode ${label}, thử lại sau ${delayMs}ms (lần ${qrRetryAttempts}/${MAX_QR_RETRIES})...`, "warn");
                publishQrPending(`Mã QR ${label}, tạo lại sau ${Math.round(delayMs / 1000)}s (lần ${qrRetryAttempts}/${MAX_QR_RETRIES}).`);
                setTimeout(() => {
                    try { qrData.actions.retry(); } catch (err) {
                        logger.log(`Không thể tạo lại mã QR: ${err.message || err}`, "error");
                    }
                }, delayMs);
                return;
            }

            if (eventType === LoginQRCallbackEventType.GotLoginInfo) {
                setLoginState('logged_in');
                const { cookie, imei, userAgent } = data;
                if (!userAgent || !cookie || !imei) return;
                if (!global.config.save_cookie) return;

                try {
                    fs.writeFileSync(cookiePath, JSON.stringify(cookie, null, 2), "utf8");

                    const newAccountData = {
                        imei,
                        userAgent,
                        cookie: cookieFileName
                    };
                    fs.writeFileSync(accountPath, JSON.stringify(newAccountData, null, 2), "utf8");
                    const isDev = (process.env.npm_lifecycle_script || "").includes("nodemon");
                    if (!isDev && process.env.JT_PANEL_CHILD !== "1") console.clear();
                    logger.clearReplaceable();
                    logger.log(`Đã lưu cookie vào ${cookieFileName} và cập nhật ${path.basename(accountPath)}`, "info");
                    tryRemoveQr();
                    saveBotStats('logged_in', { loginMessage: 'Đã đăng nhập và lưu cookie thành công', qrUpdatedAt: Date.now() });
                } catch (err) {
                    logger.log(`Lỗi khi ghi file: ${err.message || err}`, "error");
                    setLoginState('failed');
                    saveBotStats('failed', { loginMessage: 'Lỗi khi lưu cookie/account', reason: 'save_files_error', qrPath: path.basename(qrPath), qrUpdatedAt: Date.now() });
                    process.exit(1);
                }
            }
        });

        registerStickerApi(api);
        return api;
    } catch (error) {
        logger.log(`Lỗi đăng nhập Zalo bằng QR: ${error.message || error}`, "error");
        setLoginState('failed');
        saveBotStats('failed', { loginMessage: 'Lỗi đăng nhập bằng QR', reason: 'login_error' });
        process.exit(1);
    }
}

function parseCookieFromEnv(rawCookie) {
    if (rawCookie == null || !String(rawCookie).trim()) return null;

    let cookie;
    try {
        cookie = JSON.parse(String(rawCookie).trim());
    } catch {
        throw new Error("JT_COOKIE_JSON không phải JSON hợp lệ. Hãy dán nguyên nội dung Cookie JSON.");
    }

    const isObject = cookie !== null && typeof cookie === "object";
    if (!isObject || (Array.isArray(cookie) && cookie.length === 0) || (!Array.isArray(cookie) && Object.keys(cookie).length === 0)) {
        throw new Error("JT_COOKIE_JSON phải là một mảng hoặc object Cookie không rỗng.");
    }
    return cookie;
}

async function loginWithCookie() {
    try {
        const zalo = createZaloClient();
        const accountPath = resolveAccountPath();
        const accountData = getJsonData(accountPath) || {};

        // Render environment variables take priority; local account/cookie files remain supported.
        const imei = String(process.env.JT_IMEI || accountData.imei || "").trim();
        const userAgent = String(process.env.JT_USER_AGENT || accountData.userAgent || global.config?.device?.user_agent || "").trim();

        if (!imei) {
            throw new Error("Thiếu IMEI: hãy khai báo JT_IMEI hoặc cung cấp imei trong account.json.");
        }
        if (!userAgent) {
            throw new Error("Thiếu User-Agent: hãy khai báo JT_USER_AGENT hoặc cung cấp userAgent trong account.json.");
        }

        let cookie = parseCookieFromEnv(process.env.JT_COOKIE_JSON);
        let cookieSource = "JT_COOKIE_JSON";

        if (!cookie) {
            const cookieFileName = accountData.cookie || "cookie.json";
            const cookiePath = path.isAbsolute(cookieFileName)
                ? cookieFileName
                : path.join(path.dirname(accountPath), cookieFileName);
            cookie = getJsonData(cookiePath);
            cookieSource = path.basename(cookiePath);
        }

        if (!cookie || typeof cookie !== "object" ||
            (Array.isArray(cookie) && cookie.length === 0) ||
            (!Array.isArray(cookie) && Object.keys(cookie).length === 0)) {
            throw new Error(`Không tìm thấy Cookie hợp lệ trong JT_COOKIE_JSON hoặc file cookie.json (nguồn đã kiểm tra: ${cookieSource}).`);
        }

        logger.log(`Đang xác thực Cookie (nguồn: ${cookieSource}); IMEI và User-Agent đã được nạp.`, "info");
        const api = await zalo.login({ cookie, imei, userAgent });

        registerStickerApi(api);
        return api;
    } catch (error) {
        const message = error?.message || String(error);
        logger.log(`Lỗi đăng nhập Zalo bằng Cookie: ${message}`, "error");
        // Preserve the real error for the caller without ever logging cookie contents.
        throw error instanceof Error ? error : new Error(message);
    }
}

async function login() {
    try {
        setLoginState('cookie_login');
        saveBotStats('cookie_login', { loginMessage: 'Đang đăng nhập bằng cookie...' });
        logger.log("Tiến hành login bằng Cookie", "info");
        const api = await loginWithCookie();
        setLoginState('logged_in');
        return api;
    } catch (error) {
        if (!global.config.login_qrcode) {
            logger.log("Cookie không hợp lệ", "error");
            setLoginState('failed');
            saveBotStats('failed', { loginMessage: 'Cookie không hợp lệ và đăng nhập QR bị tắt', reason: 'cookie_invalid' });
            process.exit(1);
        }
        logger.log("Login bằng Cookie thất bại, chuyển sang QRCode...", "warn");
        logger.log(`Thiết bị đăng nhập: ${deviceLabel(resolveUserAgent())}`, "info");
        setLoginState('qr_pending');
        saveBotStats('qr_pending', { loginMessage: 'Cookie không hợp lệ, chuyển sang đăng nhập QRCode...', qrPath: path.basename(resolveQrPath()), qrUpdatedAt: Date.now() });
        return await loginWithQR();
    }
}

module.exports = login;
module.exports.resolveUserAgent = resolveUserAgent;
module.exports.deviceLabel = deviceLabel;
module.exports.USER_AGENTS = USER_AGENTS;
module.exports.getLoginState = getLoginState;
module.exports.setLoginState = setLoginState;
module.exports.loginState = getLoginState;
module.exports.resolveQrPath = resolveQrPath;
module.exports.resolveAccountPath = resolveAccountPath;
module.exports.saveBotStats = saveBotStats;
