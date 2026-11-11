const crypto = require("crypto");

const MIN_PUBLIC_TOKEN_LENGTH = 32;

function timingSafeStringEqual(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string" || !expected || !actual) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function assertPanelToken(token, host) {
  const value = typeof token === "string" ? token.trim() : "";
  if (isLoopbackHost(host)) return true;
  if (value.length < MIN_PUBLIC_TOKEN_LENGTH) {
    throw new Error(
      "Panel đang bind ra mạng công khai nhưng JT_PANEL__TOKEN chưa được cấu hình hoặc quá ngắn. " +
      "Hãy tạo token ngẫu nhiên tối thiểu 32 ký tự (khuyến nghị: openssl rand -hex 32)."
    );
  }
  return true;
}

function isPanelRequestAuthorized(req, token, host) {
  if (!token && isLoopbackHost(host)) return true;

  const authorization = req && req.headers && req.headers.authorization;
  if (typeof authorization !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  return timingSafeStringEqual(token, match[1].trim());
}

module.exports = {
  MIN_PUBLIC_TOKEN_LENGTH,
  timingSafeStringEqual,
  isLoopbackHost,
  assertPanelToken,
  isPanelRequestAuthorized,
};
