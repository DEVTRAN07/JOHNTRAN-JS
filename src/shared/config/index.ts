import fs from "fs";
import path from "path";
import YAML from "yaml";

const CONFIG_PATH = path.join(__dirname, "..", "..", "config.yml");
const ENV_PATH = path.join(__dirname, "..", "..", ".env");

export interface DeviceConfig {
  user_agent: string;
}

export interface PanelConfig {
  enabled: boolean;
  host: string;
  port: number;
  token: string;
  bridge_token: string;
}

export interface PrivacyConfig {
  allow_all_hosts: boolean;
  allowed_hosts: string[];
}

export interface ServicesConfig {
  media_downloader_url: string;
  tiktok_api_url: string;
  dpaste_url: string;
  facebook_api_url: string;
  facebook_access_token: string;
}

export interface AIConfig {
  tts_enabled: boolean;
}

export interface CanvasConfig {
  theme: string;
  width: number;
  quality: number;
}

export interface MusicConfig {
  max_results: number;
  cache_ttl: number;
  soundcloud_client_id: string;
}

export interface AutodownConfig {
  enabled: boolean;
  rate_limit_max: number;
  rate_limit_window_ms: number;
  circuit_fail_threshold: number;
  circuit_cooldown_ms: number;
  url_dedup_ttl_ms: number;
  cache_ttl_ms: number;
  max_concurrent_downloads: number;
  max_video_mb: number;
}

export interface MediaConfig {
  tiktok_cookies: string;
  facebook_cookies: string;
  youtube_cookies: string;
}

export interface AdminConfig {
  require_admin_group_for_sensitive: boolean;
}

export interface Config {
  prefix: string;
  name_bot: string;
  account_file: string;
  login_qrcode: boolean;
  qrcode_path: string;
  save_cookie: boolean;
  allow_private_command: boolean;
  allow_self_command: boolean;
  admin_bot: string[];
  support_bot: string[];
  admin: AdminConfig;
  check_update: boolean;
  hot_reload: boolean;
  logging_level: string;
  device: DeviceConfig;
  panel: PanelConfig;
  zalo_client_config: Record<string, unknown>;
  media: MediaConfig;
  autodown: AutodownConfig;
  privacy: PrivacyConfig;
  services: ServicesConfig;
  ai: AIConfig;
  canvas: CanvasConfig;
  music: MusicConfig;
}

export default Config;

const REDACTED = "***";

const SECRET_KEYS = ["key", "keys", "secret", "token", "password", "cookie", "imei", "credential"];

export const DEFAULTS: Config = {
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
    require_admin_group_for_sensitive: false
  },
  check_update: true,
  hot_reload: true,
  logging_level: "info",
  device: {
    user_agent: ""
  },
  panel: {
    enabled: false,
    host: "0.0.0.0",
    port: 3000,
    token: "",
    bridge_token: ""
  },
  zalo_client_config: {},
  media: {
    tiktok_cookies: "",
    facebook_cookies: "",
    youtube_cookies: ""
  },
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
      "soundcloud.com",
      "sndcdn.com",
      "api-v2.soundcloud.com",
      "translate.google.com",
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
      "catbox.moe",
      "lrclib.net",
      "cloudflare-dns.com",
      "dns.google"
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

function loadDotEnv(): void {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^["\x27]|["\x27]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env lỗi thì bỏ qua, dùng env thật
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T extends Record<string, unknown>>(object: T): Readonly<T> {
  for (const key of Object.getOwnPropertyNames(object)) {
    const value = object[key];
    if (value && typeof value === "object") deepFreeze(value as Record<string, unknown>);
  }
  return Object.freeze(object);
}

function redactValue(key: string, value: unknown): unknown {
  const lowerKey = String(key).toLowerCase();
  if (SECRET_KEYS.some((word) => lowerKey.includes(word))) return REDACTED;
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:st|e|sig|sign|token|key|apiKey|api_key|secret|password)=)[^&]*/gi, `$1${REDACTED}`)
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, `$1${REDACTED}`);
  }
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? REDACTED : item));
  if (isPlainObject(value)) return redact(value);
  return value;
}

function redact(object: unknown): unknown {
  if (!isPlainObject(object)) return object;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    output[key] = redactValue(key, value);
  }
  return output;
}

function setNestedValue(target: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let current: Record<string, unknown> = target;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const segment = pathSegments[i];
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[pathSegments[pathSegments.length - 1]] = value;
}

function getNestedValue(target: Record<string, unknown>, pathSegments: string[]): unknown {
  let current: unknown = target;
  for (const segment of pathSegments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseEnvValue(rawValue: string, isArrayTarget: boolean): string | boolean | number | string[] {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "") return "";
  if (isArrayTarget || rawValue.includes(",")) {
    return rawValue.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!Number.isNaN(Number(rawValue))) return Number(rawValue);
  return rawValue;
}

function applyEnvOverrides(config: Config): string[] {
  const applied: string[] = [];
  for (const [envKey, rawValue] of Object.entries(process.env)) {
    const match = envKey.match(/^JT_([A-Z0-9_]+)$/);
    if (!match) continue;
    if (rawValue === undefined) continue;
    const pathSegments = match[1].toLowerCase().split("__");
    const existing = getNestedValue(config, pathSegments);
    const isArrayTarget = Array.isArray(existing);
    setNestedValue(config, pathSegments, parseEnvValue(rawValue, isArrayTarget));
    applied.push(envKey);
  }
  return applied;
}

function mergeDefaults(config: Record<string, unknown>): Config {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (config[key] === undefined) {
      config[key] = value;
    } else if (isPlainObject(value) && isPlainObject(config[key])) {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (config[key][subKey] === undefined) {
          config[key][subKey] = subValue;
        }
      }
    }
  }
  return config as Config;
}

function validate(config: Config): string[] {
  const errors: string[] = [];
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
  return errors;
}

function load(): Config {
  loadDotEnv();

  let config: Record<string, unknown> = {};
  try {
    config = (YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) || {}) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Không thể đọc config.yml: ${(error as Error).message}`);
  }

  config = mergeDefaults(config);
  applyEnvOverrides(config as Config);

  const errors = validate(config as Config);
  if (errors.length > 0) {
    throw new Error(`Config không hợp lệ:\n- ${errors.join("\n- ")}`);
  }

  config.admin_bot = (Array.isArray(config.admin_bot) ? config.admin_bot : []).map(String);
  config.support_bot = (Array.isArray(config.support_bot) ? config.support_bot : []).map(String);

  return deepFreeze(config as Config);
}

function safeView(config: Config): string {
  return JSON.stringify(redact(JSON.parse(JSON.stringify(config))), null, 2);
}

export { load, redact, safeView, validate, REDACTED, DEFAULTS };
