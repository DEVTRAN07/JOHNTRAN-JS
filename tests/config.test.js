const assert = require("assert");
const { redact, safeView, validate, REDACTED } = require("../core/config/index");

// ===== redact masks secret keys =====
const config = {
  prefix: "/",
  admin_bot: ["123"],
  services: {
    media_downloader_url: "https://secret.example.com",
    tiktok_api_url: "https://toksecret.example.com",
  },
  media: { tiktok_cookies: "cookie_gi_mat", facebook_cookies: "cookie_fb" },
  panel: { token: "panel_secret_token" }
};

const view = JSON.parse(safeView(config));
// Các key KHÔNG chứa từ khóa secret (key/secret/token/password/cookie/imei/credential) thì KHÔNG bị mask
assert.strictEqual(view.services.media_downloader_url, "https://secret.example.com");
assert.strictEqual(view.services.tiktok_api_url, "https://toksecret.example.com");
// Các key chứa từ khóa secret thì bị mask
assert.strictEqual(view.media.tiktok_cookies, REDACTED);
assert.strictEqual(view.media.facebook_cookies, REDACTED);
assert.strictEqual(view.panel.token, REDACTED);
assert.strictEqual(view.prefix, "/");
assert.strictEqual(Array.isArray(view.admin_bot), true);
// mảng string bị mask toàn bộ theo thiết kế (redactValue dòng 49)
assert.strictEqual(view.admin_bot[0], REDACTED);

// redact object directly
const redacted = redact({ api_key: "secret123", normal: "visible", nested: { secret_token: "abc" } });
assert.strictEqual(redacted.api_key, REDACTED);
assert.strictEqual(redacted.normal, "visible");
assert.strictEqual(redacted.nested.secret_token, REDACTED);

// ===== validate =====
// prefix thiếu
assert.ok(validate({}).length > 0);
// admin_bot phải là mảng
assert.ok(validate({ prefix: "/", admin_bot: "không phai mang" }).some((e) => e.includes("admin_bot")));
// music.max_results phải là số >= 1
assert.ok(validate({ prefix: "/", admin_bot: [], music: { max_results: 0 } }).some((e) => e.includes("max_results")));
// panel.enabled = true nhưng panel.port không phải số
assert.ok(
  validate({ prefix: "/", admin_bot: [], panel: { enabled: true } }).some((e) => e.includes("panel.port"))
);
// config hợp lệ → không lỗi
assert.deepStrictEqual(validate({ prefix: "/", admin_bot: [], panel: { enabled: true, port: 3000 } }), []);

console.log("✓ config tests passed");

