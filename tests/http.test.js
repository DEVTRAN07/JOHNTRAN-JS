const assert = require("assert");
const { hostAllowed, redactUrl } = require("../core/http/index");
const { load: loadConfig } = require("../core/config");

// ===== hostAllowed =====
// allow_all_hosts = true → mọi host đều đi được
assert.ok(hostAllowed("https://evil.com/x", { privacy: { allow_all_hosts: true } }).allowed);

// allowlist chứa host chính xác
assert.ok(hostAllowed("https://example.com/x", {
  privacy: { allow_all_hosts: false, allowed_hosts: ["example.com"] }
}).allowed);

// subdomain của host trong allowlist (endsWith .host)
assert.ok(hostAllowed("https://api.example.com/x", {
  privacy: { allow_all_hosts: false, allowed_hosts: ["example.com"] }
}).allowed);

// host không trong allowlist → bị chặn
const r1 = hostAllowed("https://evil.com/x", {
  privacy: { allow_all_hosts: false, allowed_hosts: ["example.com"] }
});
assert.strictEqual(r1.allowed, false);
assert.ok(String(r1.reason).includes("không nằm trong danh sách cho phép"));

// URL không hợp lệ → bị chặn
const r2 = hostAllowed("not-a-url", { privacy: { allow_all_hosts: false, allowed_hosts: [] } });
assert.strictEqual(r2.allowed, false);
assert.ok(String(r2.reason).includes("URL không hợp lệ"));

// Configured autodown source/API hosts must pass the privacy guard.
const configured = loadConfig();
for (const url of [
  "https://www.tikwm.com/api/",
  "https://api.tikwm.com/api/",
  "https://www.youtube.com/oembed",
  "https://noembed.com/embed",
  "https://www.facebook.com/reel/123",
  "https://www.instagram.com/reel/123/",
  "https://video.twimg.com/example.mp4",
  "https://lrclib.net/api/search",
  "https://files.catbox.moe/example.mp4",
  "https://s120.avatar.zalo.me/avatar.jpg"
]) {
  assert.ok(hostAllowed(url, configured).allowed, `${new URL(url).hostname} should be allowed for autodown`);
}

// ===== redactUrl =====
// Query params nhạy cảm được mask
assert.strictEqual(
  redactUrl("https://cdn.example.com/video?token=abc123&key=def456&normal=ok"),
  "https://cdn.example.com/video?token=***&key=***&normal=ok"
);

// password / secret / sign / sig / access_token / client_secret cũng bị mask
assert.strictEqual(
  redactUrl("https://a.b/c?password=pw&secret=s&sign=sg&sig=si&access_token=at&client_secret=cs"),
  "https://a.b/c?password=***&secret=***&sign=***&sig=***&access_token=***&client_secret=***"
);

// Header Authorization Bearer được mask trong redactUrl (nếu xuất hiện trên URL)
// redactUrl chỉ xử lý query string, không phải header — giữ nguyên phần path
assert.ok(redactUrl("https://example.com/path").includes("/path"));

console.log("✓ http tests passed");
