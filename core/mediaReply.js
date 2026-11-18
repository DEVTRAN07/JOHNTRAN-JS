// ===== LẤY MEDIA TỪ TIN REPLY =====
// Dùng chung cho getlink / getvoice / getvd / stk.
// Zalo gửi thông tin media trong quote: field `attach` (chuỗi JSON) hoặc
// `content` (object), tùy loại tin (ảnh/video/file/sticker/link).
function pickUrl(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === "object") {
      const inner = pickUrl(value, keys);
      if (inner) return inner;
    }
  }
  return null;
}

function pickNum(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return Number(value);
  }
  return null;
}

/**
 * @param {object} event  event của tin nhắn (có data.quote)
 * @returns {null | {
 *   video: string|null, image: string|null, file: string|null, thumb: string|null,
 *   sticker: {id:number, cateId:number, type:number}|null,
 *   isSticker: boolean, isGif: boolean, text: string, ext: string|null
 * }}
 */
function parseQuote(event) {
  const data = event?.data || event || {};
  const quote = data.quote || data.dQuote || event?.quote;
  if (!quote) return null;

  // attach: chuỗi JSON (Zalo) hoặc object
  let attach = {};
  if (typeof quote.attach === "string") {
    try { attach = JSON.parse(quote.attach) || {}; } catch { /* không parse được */ }
  } else if (quote.attach && typeof quote.attach === "object") {
    attach = quote.attach;
  }

  // content: một số loại tin gửi object này
  const content = quote.content && typeof quote.content === "object" ? quote.content : {};
  const merged = { ...attach, ...content };

  const video = pickUrl(merged, ["playUrl", "videoUrl", "videoUrlV2", "mp4Url", "src", "url", "href"]);
  const image = pickUrl(merged, ["photoUrl", "imageUrl", "normalUrl", "oriUrl", "hdUrl", "thumbUrl", "thumb", "url", "href"]);
  const file = pickUrl(merged, ["fileUrl", "normalUrl", "file", "href", "url"]);
  const thumb = pickUrl(merged, ["thumbUrl", "thumbnailUrl", "thumb", "previewUrl"]);

  // Sticker động: attach.webp = JSON chuỗi {url, width, height} — đây mới là nguồn sticker
  let webpUrl = null;
  try {
    const webp = merged.webp;
    if (typeof webp === "string" && webp.trim()) {
      const parsed = JSON.parse(webp);
      if (parsed?.url) webpUrl = String(parsed.url);
    } else if (webp && typeof webp === "object" && webp.url) {
      webpUrl = String(webp.url);
    }
  } catch { /* không parse được */ }

  // Sticker gốc (reply sticker)
  const stickerId = pickNum(merged, ["stickerId", "id", "sId"]);
  const cateId = pickNum(merged, ["cateId", "cate", "catId"]);
  const stickerType = pickNum(merged, ["stickerType", "stype", "type"]);
  const hasSticker = stickerId !== null && cateId !== null && cateId > 0;

  const text = String(quote.msg || content.title || quote.fromD || "").trim();

  return {
    video,
    image,
    file,
    thumb,
    webpUrl,
    sticker: hasSticker ? { id: stickerId, cateId, type: stickerType || 0 } : null,
    isSticker: hasSticker,
    isGif: /gif/i.test(String(pickUrl(merged, ["ext", "fileExt", "extension"]) || "")) || /\.gif(\?|$)/i.test(String(video || image || file || "")),
    text,
    ext: pickUrl(merged, ["ext", "fileExt", "extension"]) || null
  };
}

// Gợi ý lỗi khi tin reply không có media
function hint(kind) {
  const names = { video: "video", image: "ảnh", gif: "GIF", sticker: "sticker", file: "file" };
  return `❌ Tin được reply không chứa ${names[kind] || "media"}.\n` +
         `Hãy reply đúng tin ảnh/video/GIF/sticker rồi gõ lại lệnh.`;
}

module.exports = { parseQuote, hint, pickUrl, pickNum };
