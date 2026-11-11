const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config.yml");
const ENV_PATH = path.join(__dirname, "..", "..", ".env");

// Nạp .env vào process.env (key thật, không lên git)
function loadDotEnv() {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env lỗi thì bỏ qua, dùng env thật
  }
}

const SECRET_KEYS = ["key", "keys", "secret", "token", "password", "cookie", "imei", "credential"];
const REDACTED = "***";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(object) {
  for (const key of Object.getOwnPropertyNames(object)) {
    const value = object[key];
    if (value && typeof value === "object") deepFreeze(value);
  }
  return Object.freeze(object);
}

function redactValue(key, value) {
  const lowerKey = String(key).toLowerCase();
  if (SECRET_KEYS.some((word) => lowerKey.includes(word))) return REDACTED;
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:st|e|sig|sign|token|key|apiKey|api_key|secret|password)=)[^&]*/gi, "$1" + REDACTED)
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1" + REDACTED);
  }
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? REDACTED : item));
  if (isPlainObject(value)) return redact(value);
  return value;
}

function redact(object) {
  if (!isPlainObject(object)) return object;
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    output[key] = redactValue(key, value);
  }
  return output;
}

function setNestedValue(target, pathSegments, value) {
  let current = target;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const segment = pathSegments[i];
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[pathSegments[pathSegments.length - 1]] = value;
}

function getNestedValue(target, pathSegments) {
  let current = target;
  for (const segment of pathSegments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function parseEnvValue(rawValue, isArrayTarget) {
  // Đích là mảng hoặc giá trị có dấu phẩy → tách theo dấu phẩy
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "") return "";
  if (isArrayTarget || rawValue.includes(",")) {
    return rawValue.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!Number.isNaN(Number(rawValue))) return Number(rawValue);
  return rawValue;
}

function applyEnvOverrides(config) {
  // JT_MUSIC__MAX_RESULTS=5 → music.max_results
  // JT_SERVICES__MEDIA_DOWNLOADER_URL=... → services.media_downloader_url
  // JT_PREFIX=/ → prefix
  // JT_MUSIC__MAX_RESULTS=5 → music.max_results
  const applied = [];
  for (const [envKey, rawValue] of Object.entries(process.env)) {
    const match = envKey.match(/^JT_([A-Z0-9_]+)$/);
    if (!match) continue;
    const pathSegments = match[1].toLowerCase().split("__");
    // Nếu giá trị hiện tại trong config là mảng → ép override thành mảng
    const existing = getNestedValue(config, pathSegments);
    const isArrayTarget = Array.isArray(existing);
    setNestedValue(config, pathSegments, parseEnvValue(rawValue, isArrayTarget));
    applied.push(envKey);
  }
  return applied;
}

const DEFAULTS = {
  prefix: "/",
  name_bot: "JohnTran Bot",
  account_file: "account.json",
  login_qrcode: true,
  qrcode_path: "qr.png",
  save_cookie: true,
  allow_private_command: false,
  allow_self_command: false,
  admin_bot: [],
  support_bot: [],
  admin: {
    // Lệnh nhạy (role 2 = admin bot) chỉ cho phép chạy trong nhóm đã đăng ký
    // làm admin group qua Panel. Giảm bề mặt tấn công khi uidFrom có thể bị
    // giả mạo (spoof) thành ID admin. false = chạy như cũ (chỉ kiểm tra uidFrom).
    require_admin_group_for_sensitive: false
  },
  check_update: true,
  hot_reload: true,
  logging_level: "info",
  // Thiết bị đăng nhập (userAgent) — để trống thì bot tự đo theo OS
  device: {
    user_agent: ""
  },
  // Web panel quản lý bot + bot con
  panel: {
    enabled: false,
    host: "0.0.0.0",
    port: 3000,
    token: "",
    bridge_token: "",
    allowed_origins: []
  },
  zalo_client_config: {},
  // Tải media pure JS (autodown) — cookies cho fetch khi trang yêu cầu đăng nhập
  media: {
    tiktok_cookies: "",
    facebook_cookies: "",
    youtube_cookies: ""
  },
  // Autodown: tự tải media từ link trong nhóm (pure JS)
  autodown: {
    enabled: true,
    rate_limit_max: 5,
    rate_limit_window_ms: 300000,
    circuit_fail_threshold: 3,
    circuit_cooldown_ms: 600000,
    url_dedup_ttl_ms: 120000,
    cache_ttl_ms: 600000,
    max_concurrent_downloads: 3,
    max_video_mb: 200
  },
  privacy: {
    allow_all_hosts: false,
    allowed_hosts: [
      // Nhạc (SoundCloud — /scl)
      "soundcloud.com",
      "sndcdn.com",
      "api-v2.soundcloud.com",
      // Đọc giọng nói (/noi — Google TTS)
      "translate.google.com",
      // CDN/media cần cho các tính năng có sẵn
      "tikwm.com",
      "www.tikwm.com",
      "api.tikwm.com",
      "tiktokcdn.com",
      "tiktokcdn-us.com",
      "tiktok.com",
      "vm.tiktok.com",
      "vt.tiktok.com",
      "api.tiktok.com",
      "instagram.com",
      "cdninstagram.com",
      "facebook.com",
      "fb.watch",
      "fbsbx.com",
      "youtube.com",
      "youtu.be",
      "m.youtube.com",
      "music.youtube.com",
      "googlevideo.com",
      "noembed.com",
      "raw.githubusercontent.com",
      "imgur.com",
      "i.imgur.com",
      "postimg.cc",
      "i.postimg.cc",
      "pinimg.com",
      "i.pinimg.com",
      "drive.google.com",
      "dpaste.com",
      "googleusercontent.com",
      "stickers.zaloapp.com",
      "fbcdn.net",
      "zalo.ai",
      "zadn.vn",
      "dlfl.vn",
      "zdn.vn",
      // Video (/vdgirl — catbox.moe)
      "catbox.moe",
      // Lời bài hát (/lyric — LRCLIB)
      "lrclib.net",
      // DNS-over-HTTPS bootstrap (không cần system DNS)
      "cloudflare-dns.com",
      "dns.google",
    ]
  },
  services: {
    media_downloader_url: "",
    tiktok_api_url: "",
    dpaste_url: "https://dpaste.com/api/v2/",
    facebook_api_url: "https://graph.facebook.com/v19.0",
    facebook_access_token: ""
  },
  ai: {
    tts_enabled: true
  },
  // Cỡ ảnh canvas: 1280 = lớn rõ, 750 = Zalo gửi nguyên bản (không resize)
  canvas: {
    theme: "editorial",
    width: 750,
    quality: 100
  },
  music: {
    max_results: 5,
    cache_ttl: 300000,
    soundcloud_client_id: ""
  }
};

function mergeDefaults(config) {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (config[key] === undefined) {
      config[key] = value;
    } else if (isPlainObject(value) && isPlainObject(config[key])) {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (config[key][subKey] === undefined) config[key][subKey] = subValue;
      }
    }
  }
  return config;
}

function validate(config) {
  const errors = [];
  if (typeof config.prefix !== "string" || !config.prefix) errors.push("prefix phải là chuỗi không rỗng");
  if (!Array.isArray(config.admin_bot)) errors.push("admin_bot phải là mảng");
  if (config.privacy && typeof config.privacy.allow_all_hosts !== "boolean") {
    errors.push("privacy.allow_all_hosts phải là boolean");
  }
  if (config.music && (!Number.isFinite(config.music.max_results) || config.music.max_results < 1)) {
    errors.push("music.max_results phải là số >= 1");
  }
  if (config.panel && config.panel.enabled && !Number.isFinite(config.panel.port)) {
    errors.push("panel.port phải là số khi panel.enabled = true");
  }
  if (config.panel && config.panel.allowed_origins !== undefined && !Array.isArray(config.panel.allowed_origins)) {
    errors.push("panel.allowed_origins phải là mảng origin");
  }
  return errors;
}

function load() {
  loadDotEnv();

  let config = {};
  try {
    config = YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) || {};
  } catch (error) {
    throw new Error(`Không thể đọc config.yml: ${error.message}`);
  }

  config = mergeDefaults(config);
  applyEnvOverrides(config);

  const errors = validate(config);
  if (errors.length > 0) {
    throw new Error(`Config không hợp lệ:\n- ${errors.join("\n- ")}`);
  }

  config.admin_bot = (config.admin_bot || []).map(String);
  config.support_bot = (config.support_bot || []).map(String);

  return deepFreeze(config);
}

function safeView(config) {
  return JSON.stringify(redact(JSON.parse(JSON.stringify(config))), null, 2);
}

module.exports = { load, redact, safeView, validate, REDACTED };
