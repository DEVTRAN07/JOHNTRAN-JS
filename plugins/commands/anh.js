"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getJson: queuedGetJson, getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");

const OPENVERSE_API = "https://api.openverse.org/v1/";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_ATTEMPTS = 3;
const SOURCE_TIMEOUT_MS = 12000;
const EXPLICIT_QUERY = /\b(porn|porno|xxx|nsfw|nude|nudity|sex|hentai|18\+)\b/i;

module.exports.config = {
  name: "anh",
  aliases: ["ảnh", "image", "photo"],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tìm và gửi ảnh có giấy phép mở từ API Openverse",
  category: "Giải trí",
  usage: "ảnh [từ khóa]",
  cooldowns: 4,
  dependencies: {}
};

function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  return null;
}

function buildImageSearchUrl(query = "") {
  const url = new URL("images/", OPENVERSE_API);
  url.searchParams.set("q", String(query || "nature").trim().slice(0, 120) || "nature");
  url.searchParams.set("mature", "false");
  url.searchParams.set("filter_dead", "true");
  url.searchParams.set("page_size", "20");
  return url.toString();
}

function getThumbnailUrl(item) {
  const id = String(item?.id || "").trim();
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  // Use Openverse's own thumbnail proxy instead of fetching an arbitrary
  // third-party image URL from an untrusted API response.
  return new URL("images/" + encodeURIComponent(id) + "/thumb/?full_size=false", OPENVERSE_API).toString();
}

function normalizeImageResults(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results
    : Array.isArray(payload?.data?.results) ? payload.data.results
    : [];
  return rows.filter(item =>
    item && item.mature !== true && /^[a-f0-9-]{36}$/i.test(String(item.id || ""))
  );
}

function cleanText(value, maxLength = 160) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatImageCaption(item) {
  const title = cleanText(item.title || "Ảnh từ Openverse", 120);
  const creator = cleanText(item.creator || "Không rõ tác giả", 80);
  const license = cleanText([item.license, item.license_version].filter(Boolean).join(" "), 50);
  const landing = String(item.foreign_landing_url || "");
  const safeLanding = /^https?:\/\//i.test(landing) ? landing : "https://openverse.org/";
  return [
    "📷 " + title,
    "Tác giả: " + creator,
    "Giấy phép: " + (license || "Xem trang nguồn"),
    "Nguồn: " + safeLanding,
    "Ảnh tìm qua Openverse · https://openverse.org/"
  ].join("\n");
}

async function fetchImage(item) {
  const thumbnailUrl = getThumbnailUrl(item);
  if (!thumbnailUrl) throw new Error("ID ảnh Openverse không hợp lệ.");
  const response = await queuedGetBuffer(thumbnailUrl, {
    timeout: SOURCE_TIMEOUT_MS,
    retries: 1,
    headers: { Accept: "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" }
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Openverse thumbnail trả HTTP " + response.status);
  }
  if (!Buffer.isBuffer(response.buffer) || response.buffer.length < 16 || response.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Ảnh rỗng hoặc vượt giới hạn 8 MB.");
  }
  const extension = imageExtension(response.buffer);
  if (!extension) throw new Error("API không trả về JPEG, PNG, WebP hoặc GIF hợp lệ.");
  return { buffer: response.buffer, extension };
}

module.exports.run = async function ({ api, event, args = [] }) {
  const { threadId, type } = event;
  const query = args.join(" ").trim().slice(0, 120) || "nature";
  if (EXPLICIT_QUERY.test(query)) {
    return api.sendMessage({
      plain: true,
      msg: "⚠️ /ảnh chỉ tìm ảnh thông thường, không tìm nội dung nhạy cảm. Lệnh nội dung 18+ được tách riêng."
    }, threadId, type);
  }

  await api.sendMessage({ plain: true, msg: "⏳ Đang tìm ảnh từ Openverse..." }, threadId, type);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_openverse_"));
  try {
    const response = await queuedGetJson(buildImageSearchUrl(query), {
      timeout: SOURCE_TIMEOUT_MS,
      retries: 1,
      headers: { Accept: "application/json" }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error("Openverse trả HTTP " + response.status);
    }

    const items = normalizeImageResults(response.data);
    if (!items.length) {
      return api.sendMessage({
        plain: true,
        msg: "❌ Không tìm thấy ảnh phù hợp. Thử từ khóa khác."
      }, threadId, type);
    }

    const start = Math.floor(Math.random() * items.length);
    const attempts = Math.min(MAX_SOURCE_ATTEMPTS, items.length);
    let selected = null;
    let lastError = null;
    for (let index = 0; index < attempts; index++) {
      const item = items[(start + index) % items.length];
      try {
        const media = await fetchImage(item);
        selected = { item, ...media };
        break;
      } catch (error) {
        lastError = error;
        console.warn("[anh] Bỏ qua ảnh lỗi:", error?.message || error);
      }
    }
    if (!selected) throw lastError || new Error("Không có ảnh khả dụng.");

    const filePath = path.join(tempDir, "openverse." + selected.extension);
    fs.writeFileSync(filePath, selected.buffer);
    return api.sendMessage({
      msg: formatImageCaption(selected.item),
      attachments: [filePath]
    }, threadId, type);
  } catch (error) {
    console.error("[anh] Không thể lấy ảnh:", error?.message || error);
    return api.sendMessage({
      plain: true,
      msg: "❌ Không thể lấy ảnh lúc này: " + String(error?.message || error).slice(0, 160)
    }, threadId, type);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
};

module.exports._test = {
  imageExtension,
  buildImageSearchUrl,
  getThumbnailUrl,
  normalizeImageResults,
  formatImageCaption,
  MAX_IMAGE_BYTES,
  MAX_SOURCE_ATTEMPTS,
  SOURCE_TIMEOUT_MS
};
