// ===== STICKER TUỲ BIẾN: upload WebP lên CDN Zalo + gửi dạng sticker =====
// Zalo API chính thức không có "tạo sticker từ ảnh". Cách hoạt động (đúng như
// bot ZALO-BOT gốc):
//   1. Upload file WebP/GIF lên host ảnh Zalo (photo_original/upload)
//      → nhận normalUrl/hdUrl trên CDN.
//   2. Thêm HẬU TỐ "?sticker.webp" vào URL (và ép đuôi .webp nếu là GIF).
//   3. Gửi như tin ảnh (photo_url) với properties.type = 3 +
//      ext.sSrcStr = "@NGH_STICKER" — Zalo app nhận ra và RENDER thành sticker
//      (không khung ảnh, không caption), kể cả ảnh tĩnh lẫn động.
const fs = require("fs");
const path = require("path");

// Host/file api của Zalo (không đi qua core/http vì zalo-client đã tự quản lý
// cookie/session AES — chỉ cần gọi đúng endpoint là xác thực theo).
const UPLOAD_HOST = "https://tt-files-wpa.chat.zalo.me";
const UPLOAD_USER_PATH = "/api/message/photo_original/upload";
const UPLOAD_GROUP_PATH = "/api/group/photo_original/upload";
const SEND_USER_PATH = "/api/message/photo_url";
const SEND_GROUP_PATH = "/api/group/photo_url";

// Hậu tố ma thuật: Zalo nhìn thấy "?sticker.webp" sẽ coi file là sticker
const STICKER_SUFFIX = "?sticker.webp";

function resolveUploadHost(ctx) {
  const serviceHost = ctx?.loginInfo?.zpw_service_map_v3?.file?.[0];
  if (typeof serviceHost === "string" && /^https:\/\//i.test(serviceHost)) {
    try {
      return new URL(serviceHost).origin;
    } catch {
      // Use the stable fallback when the session service map is malformed.
    }
  }
  return UPLOAD_HOST;
}

function now() {
  return Date.now();
}

// URL CDN Zalo: file .jxl thực chất là JPEG — đổi đuôi để tải đúng
function jxlToJpg(url) {
  return String(url || "").replace(/\.jxl(\?|$)/i, (m, q) => ".jpg" + (q || ""));
}

// Bỏ hậu tố sticker cũ (reply sticker Zalo → URL đã có sẵn ?sticker.webp)
function stripStickerSuffix(url) {
  return String(url || "")
    .replace(/\?sticker\.webp.*$/i, "")
    .replace(/\?Sticker_by_.*$/i, "")
    .trim();
}

// Chuẩn hoá URL để gửi sticker: ép đuôi .webp cho file động + thêm hậu tố
function buildStickerUrl(cdnUrl, forceWebp) {
  let url = stripStickerSuffix(cdnUrl).replace(/\?.*$/, "");
  if (forceWebp) url = url.replace(/\.[a-zA-Z0-9]+$/, ".webp");
  return url + STICKER_SUFFIX;
}

// Dựng multipart/form-data thủ công (full control content-type + boundary)
function buildMultipart(fields, fileField, fileName, fileBuffer) {
  const boundary = "----JTSticker" + now().toString(16);
  const chunks = [];

  for (const [name, value] of fields) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; ` +
    `filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  ));
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

/**
 * Gắn 2 endpoint tuỳ biến lên api zalo-client (gọi 1 lần sau khi login).
 *   api.uploadStickerImage({ filePath, threadId, threadType })
 *   api.sendCustomStickerUrl({ staticImgUrl, animationImgUrl, threadId, threadType, reply, width, height, ttl, variant })
 */
function registerStickerApi(api) {
  if (!api || typeof api.custom !== "function" || api.__jtStickerApi) return;
  api.__jtStickerApi = true;

  // ===== 1. Upload image to Zalo CDN =====
  // IMPORTANT: encrypted `params` must be in the QUERY STRING (matches
  // zalo-client uploadAttachment). Putting params in the multipart body makes
  // the server reject the request -> utils.resolve() throws ZaloApiError ->
  api.custom("uploadStickerImage", async ({ ctx, utils, props }) => {
    const { filePath, threadId, threadType } = props || {};
    if (!filePath || !fs.existsSync(filePath)) throw new Error("Sticker file not found");
    if (!threadId) throw new Error("Missing threadId");

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const isGroup = Number(threadType) === 1; // ThreadType.Group = 1
    const uploadPath = isGroup ? UPLOAD_GROUP_PATH : UPLOAD_USER_PATH;
    const typeParam = isGroup ? 11 : 2;

    const params = {
      totalChunk: 1,
      fileName,
      clientId: now(),
      totalSize: fileBuffer.length,
      imei: ctx.imei,
      isE2EE: 0,
      jxl: 0,
      chunkId: 1,
      ...(isGroup ? { grid: String(threadId) } : { toid: String(threadId) })
    };

    const encryptedParams = utils.encodeAES(JSON.stringify(params));
    if (!encryptedParams) throw new Error("Failed to encode sticker upload params");

    const uploadHost = resolveUploadHost(ctx);
    const url = utils.makeURL(uploadHost + uploadPath, { type: typeParam, params: encryptedParams });

    // Body must contain only chunkContent (no params field), matching uploadAttachment.
    const { body, contentType } = buildMultipart(
      [],
      "chunkContent",
      fileName,
      fileBuffer
    );

    let res;
    try {
      res = await utils.request(url, {
        method: "POST",
        headers: { "content-type": contentType },
        body
      });
    } catch (e) {
      throw new Error(`uploadStickerImage request failed: ${e?.message || e}`);
    }

    let result;
    try {
      result = await utils.resolve(res);
    } catch (e) {
      const code = e?.code != null ? ` code=${e.code}` : "";
      const msg = e?.message || String(e);
      throw new Error(`uploadStickerImage resolve failed${code}: ${msg}`);
    }

    return result || {};
  });

  // ===== 3. Tải media từ CDN Zalo bằng session của bot =====
  // Host CDN Zalo (zdn.vn, dlfl.vn, zadn.vn...) không có trong allowlist
  // privacy — đây là host CỦA CHÍNH tài khoản bot nên tải bằng cookie session
  // (utils.request) thay vì core/http.
  api.custom("fetchZaloMedia", async ({ utils, props }) => {
    const { url } = props || {};
    if (!url) throw new Error("Thiếu URL media");
    const res = await utils.request(String(url));
    if (!res?.ok) throw new Error("Tải media lỗi HTTP " + (res?.status ?? "?"));
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 64) throw new Error("Media rỗng hoặc quá nhỏ");
    return { buffer, contentType: res.headers?.get?.("content-type") || "" };
  });

  // ===== 2. Gửi sticker từ URL CDN =====
  api.custom("sendCustomStickerUrl", async ({ ctx, utils, props }) => {
    const {
      staticImgUrl, animationImgUrl, threadId, threadType,
      reply = null, ttl = 0,
      variant = "ai"        // "ai" = bản stk gốc | "std" = bản stkvd gốc
    } = props || {};

    if (!staticImgUrl || !threadId) throw new Error("Thiếu URL hoặc threadId");
    // props.width/height là const — ép số bằng biến mới, KHÔNG gán lại destructure
    const width = Number(props?.width) || 480;
    const height = Number(props?.height) || 480;

    const isGroup = Number(threadType) === 1;
    const sendPath = isGroup ? SEND_GROUP_PATH : SEND_USER_PATH;
    const url = utils.makeURL(resolveUploadHost(ctx) + sendPath, { nretry: 0 });

    // ext.sSrcStr ĐẶC BIỆT: "@NGH_STICKER" cho bản stk, "@STICKER" cho stkvd
    const srcStr = variant === "std" ? "@STICKER" : "@NGH_STICKER";
    const clientId = now() * 6000;
    const params = {
      clientId,
      title: "",
      oriUrl: staticImgUrl,
      thumbUrl: staticImgUrl,
      hdUrl: staticImgUrl,
      width,
      height,
      properties: JSON.stringify({
        subType: 0,
        color: -1,
        size: -1,
        type: 3,
        is_original: 0,
        ext: JSON.stringify({ sSrcStr: srcStr, sSrcType: 0 })
      }),
      contentId: now(),
      thumb_width: width,
      thumb_height: height,
      webp: JSON.stringify({ width, height, url: animationImgUrl || staticImgUrl }),
      msgBubbleLayoutType: 3,
      is_group_layout: 0,
      zsource: -1,
      jcp: JSON.stringify({ pStickerType: 1 }),
      ttl: Number(ttl) || 0,
      ...(isGroup ? { grid: String(threadId), visibility: 0 } : { toId: String(threadId) })
    };

    if (reply) params.refMessage = String(reply);

    const encryptedParams = utils.encodeAES(JSON.stringify(params));
    if (!encryptedParams) throw new Error("Không mã hoá được dữ liệu gửi sticker");

    const res = await utils.request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "params=" + encodeURIComponent(encryptedParams)
    });

    const result = await utils.resolve(res);
    if (result && typeof result === "object" && !result.cliMsgId) {
      result.cliMsgId = String(clientId);
    }
    return result;
  });
}

module.exports = {
  registerStickerApi,
  resolveUploadHost,
  buildStickerUrl,
  stripStickerSuffix,
  jxlToJpg,
  STICKER_SUFFIX
};
