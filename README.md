# 🤖 ᴶᴼᴴᴺ ᵀᴿᴬᴺ

**ᴶᴼᴴᴺ ᵀᴿᴬᴺ** là một chatbot Zalo được phát triển bằng Node.js, dựa trên thư viện [Zalo-Client](https://github.com/DEVTRAN07/Zalo-Client)


> [!IMPORTANT]
> 🚧 **ᴶᴼᴴᴺ ᵀᴿᴬᴺ** hiện đang trong quá trình phát triển.
> 
> Nếu bạn gặp bất kỳ sự cố, lỗi hoặc vấn đề nào trong quá trình sử dụng,  
> hãy **đóng góp** bằng cách báo lỗi hoặc gửi pull request.
>
> 💡 Chúng tôi luôn hoan nghênh mọi sự hỗ trợ từ cộng đồng!

---

## 📚 Tài liệu
📚 Xem tài liệu API tại: [https://github.com/DEVTRAN07/Zalo-Client#readme](https://github.com/DEVTRAN07/Zalo-Client#readme)

📚 Tải liệu Plugins

<details>
<summary>📁 Sự kiện mẫu</summary>

```javascript
module.exports.config = {
    name: "example", // Tên của sự kiện
    event_type: ["message"], // Loại event, có thể nhận nhiều event 1 lúc
    version: "1.0.0", // Phiên bản của sự kiện
    author: "ShinTHL09 ", // Tác giả của sự kiện
    description: "Sự kiện mẫu", // Thông tin sự kiện
    dependencies: {} // Các thư viện cần thiết (Bot sẽ tự cài khi load sự kiện)
};

module.exports.onLoad =  async function({ api, Users, Threads }) {
  console.log("Sự kiện example đã được load");
}

// Bot nhại tin nhắn
module.exports.run = async function({ api, event, eventType, Users, Threads, replyData }) {
    const { threaId, type, data } = event;
    const msg = data.content;
    return api.sendMessage(msg, threaId, type);
};

// Bot nhại tin nhắn có reply
module.exports.run = async function({ api, event, eventType, Users, Threads, replyData }) {
    const { threaId, type, data } = event;
    const msg = data.content;
    return api.sendMessage({ msg, quote: replyData }, threaId, type);
};
```

</details>

<details>
<summary>📁 Lệnh mẫu mẫu</summary>

```javascript
module.exports.config = {
  name: 'example', // Tên của lệnh
  version: '1.0.0', // Phiên bản của lệnh
  role: 0, // Quyền hạn 0: thành viên, 1: support bot, 2: admin bot
  author: 'ShinTHL09', // Tác giả của lệnh
  description: 'Lệnh mẫu', // Thông tin lệnh
  category: 'Tiện ích', // Mục của lệnh
  usage: 'restart', // Cách dùng lệnh
  cooldowns: 2, // Thời gian hồi lệnh
  dependencies: {} // Các thư viện cần thiết (Bot sẽ tự cài khi load lệnh)
};

module.exports.onLoad = async ({ api, Users, Threads }) => {
  console.log("Lệnh example đã được load")
}

module.exports.handleEvent = async ({ api, event, eventType, Users, Threads, replyData }) => {
  console.log("đã có event xảy ra");
}

// lệnh mẫu
module.exports.run = async ({ args, event, api, Users, Thread }) => {
  const { threadId, type } = event;

  return api.sendMessage("Đây là lệnh mẫu", threadId, type);

};

// lệnh mẫu có reply tin nhắn
module.exports.run = async ({ args, event, api, Users, Thread }) => {
  const { threadId, type } = event;

  return api.sendMessage({ msg: "Đây là lệnh mẫu", quote: replyData }, threadId, type);

};
```

</details>

<details>
<summary>📁 Các hàm để xử lí media</summary>

```js
const { processVideo, processAudio } = require("../../utils/index");

processVideo(videoPath, threadId, type); // Xử lí video
processAudio(audioPath, threadId, type); // Xử lí audio

```
</details>


<details>
<summary>📁 Các biến global</summary>

```js
global.client.config // Config bot
global.client.config.prefix // Prefix hiện tại

global.client.commands // Tất cả command
global.client.commands.get("example").config.author // lấy author của lệnh example

global.client.events // Tất cả event
global.client.events.get("example").config.author // lấy author của lệnh example

global.users.admin[0] // ID admin đầu tiên
global.users.support[0] // ID support đầu tiên
```

</details>


<details>
<summary>📁 Các hàm để cập nhật config</summary>

```js
const { updateConfigArray, updateConfigValue, reloadConfig } = require("../../utils/index");

updateConfigArray(key, newArray); // Sửa array trong config
// Example: updateConfigArray("admin_bot", ["1", "2"])

updateConfigValue(key, newValue); // Sửa giá trị trong config
// Example: updateConfigValue("prefix", "!")

reloadConfig();
// Reload lại file config
```
</details>


🗃️ Database (Users & Threads)

<details>
<summary>🧵 Threads</summary>

```js
await Thread.getData("id_box"); // Lấy dữ liệu
await Thread.setData("id_box", data_json); // Lưu dữ liệu
await Thread.getAll(); // Lấy tất cả dữ liệu

// Ví dụ
const databox = (await Thread.getData("id_box")).data;
databox.prefix = "!";
await Thread.setData("id_box", databox);
```
</details>

<details>
<summary>👤 Users</summary>

```js
await Users.getData("user_id"); // Lấy dữ liệu
await Users.setData("user_id", data_json); // Lưu dữ liệu
await Users.getAll(); // Lấy tất cả dữ liệu

// Ví dụ
const datauser = (await Users.getData("user_id")).data;
datauser.money = 1000;
await Users.setData("user_id", datauser);
```
</details>

---

## 🚀 Cài đặt

### 🎵 Lệnh nhạc (`/scl`)

Bot gọi **trực tiếp API của nền tảng** (hoặc endpoint do admin tự cấu hình), không qua proxy trung gian nên không rò rỉ dữ liệu:

| Lệnh | Nguồn | Cần cấu hình? |
|------|-------|---------------|
| `/scl <từ khóa>` | SoundCloud | Không (tự lấy client_id từ asset chính chủ) |

**Cách dùng:**
```
/scl Sơn Tùng MTP      → hiện danh sách 5 bài
/scl 2                 → tải bài số 2 về dạng voice
```
Danh sách kết quả được nhớ 5 phút; trả lời bằng số thứ tự để tải bài.

---

## 🏗️ Kiến trúc (ᴶᴼᴴᴺ ᵀᴿᴬᴺ v3)

```
core/
├── config/        # nạp config.yml + override env JT_* → validate → đóng băng (immutable)
├── http/          # HTTP client: timeout, retry/backoff, redirect, PRIVACY GUARD chặn host lạ
├── services.js    # endpoint do admin cấu hình (trống = tính năng TẮT, không gửi data đi đâu)
├── ai/            # tts (đọc giọng nói Google TTS cho /noi)
├── music/         # registry nhạc: model Track + provider SoundCloud + lyric + cache chọn bài
├── message.js     # reply helper (thẻ/card) + wrap api (reaction cho mọi lệnh)
├── canvas/        # theme.js (nền/font/bo góc chung) + vip.js, menu.js, music.js
├── cache.js       # LRU cache TTL cho group/user info + kết quả nhạc
├── storage/       # JSON store atomic (local/dev) + Supabase adapter (deploy Koyeb)
├── metrics.js     # thống kê ngày + audit log (data/audit.log)
├── hotReload.js   # theo dõi plugin thay đổi → tự nạp lại
├── health.js      # health server (PORT env) cho Render/Koyeb + UptimeRobot ping
├── bootstrap.js   # khôi phục account/cookie/db từ env khi deploy cloud
├── handle/        # pipeline lệnh: resolve → chống spam → phân quyền → cooldown → chạy
├── loader/        # nạp plugin commands/events
└── controller/    # tầng dữ liệu (Users/Threads)
panel/
├── botManager.js  # quản lý bot con: spawn/stop/restart/logs/QR/watchdog
└── server.js      # panel API zero-dependency (không cần express)
docs/             # panel UI tĩnh cho GitHub Pages
plugins/
├── commands/      # 23 lệnh (gồm scl, lyric, noi, stats, menu, spam, spamsticker)
└── events/        # (đã bỏ — bot thuần lệnh, mọi hành vi qua lệnh /xxx)
assets/
├── spam/          # ngôn từ spam cho /spam (mỗi dòng .txt = 1 câu)
└── autosend.json girl.json vdgirl.json   # dữ liệu ảnh cho autosend/girl/vdgirl
```

**Tính năng nổi bật v3:**
- **Mọi ảnh MỘT KIỂU**: `core/canvas/theme.js` giữ nền (`assets/bg/theme.jpg` + gradient + glow), font, bo góc — menu, thẻ lệnh, nhạc (kết quả + đang phát), thẻ VIP đều dùng chung, muốn đổi chỉ sửa 1 file.
- **Cỡ ảnh chỉnh được 1 chỗ**: `config.yml → canvas.width` (mặc định **750** = Zalo gửi **NGUYÊN BẢN**, ảnh nét, không bị nén/resize thành HD). Đổi sang `1280` nếu muốn ảnh lớn hơn (nhưng Zalo sẽ resize + nén). Cũng đổi được bằng biến môi trường `JT_CANVAS__WIDTH`.
- **Render chất lượng cao nhất**: `antialias/quality = "best"`, lưu PNG lossless → chữ sắc, ảnh nền không rỗ. Bố cục tự co theo cỡ (750px → menu 2 cột, nhạc 2 cột; ≥1100px → 3/4 cột như cũ).
- **PNG lossless**: ảnh lưu PNG không nén (`canvas.quality` trong config) — giữ original.
- **8 family font** để ảnh đa dạng: `JT` (sans), `JT-Display` (serif, tiêu đề), `JT-Round` (bo tròn), `JT-Mono` (số liệu/thời gian) — kèm bản Bold; tự động đăng ký theo hệ điều hành (macOS/Windows/Linux).
- **Mọi lệnh đều thả icon**: 👍 khi bắt đầu xử lý → ✅ khi xong / 😢 khi lỗi (lệnh tự thả reaction — nhạc, autodown — thì bot không thả thêm).
- **Menu phân trang thật sự**: `/menu next` / `/menu prev` / `/menu <số>` / `/menu out`; khi menu đang mở thì gõ trần `next` / `prev` / `out` (khỏi prefix) cũng chuyển trang được — không bị cooldown chặn. Nhạc (`/scl next`) cũng vậy.
- **Tự thu hồi tin bot**: tin nhắn, ảnh/tệp, voice, video, sticker và thẻ liên hệ do bot gửi được thu hồi bằng API `undo` sau 1 phút. Đây không phải TTL gốc của Zalo nên không có đồng hồ đếm hay hiệu ứng nứt; lịch thu hồi trong RAM sẽ mất nếu bot khởi động lại trước hạn.
- **Đổi storage**: bỏ better-sqlite3 (native), dùng JSON store atomic ghi `data/store.json`, mỗi bot con một file riêng.
- **Web panel + bot con**: bật `panel.enabled: true` rồi chạy `npm start`, mở `http://localhost:3000` — tạo/dừng/xoá bot con, log realtime, QR đăng nhập, metrics bar, auto-restart, watchdog crash loop. Khi bind `0.0.0.0` hoặc triển khai cloud, bắt buộc đặt `JT_PANEL__TOKEN` (ít nhất 32 ký tự; khuyến nghị `openssl rand -hex 32`). Dashboard gửi token bằng `Authorization: Bearer`, không dùng query string. CORS ngoài origin phải khai báo trong `panel.allowed_origins` hoặc `JT_PANEL__ALLOWED_ORIGINS`.
- **Đã xoá toàn bộ lệnh game** (taixiu, baucua, daily, tiền tệ, dt/dautruong...) và dữ liệu liên quan.

**Nguyên tắc bảo mật:**
- `privacy.allowed_hosts`: chỉ các host được liệt kê mới được phép gửi request (kiểm tra ở cả `core/http` và interceptor axios toàn cục).
- Endpoint dịch vụ ngoài (autodown, tải media...) **không hardcode** — admin đặt trong `config.yml → services`, để trống là tắt hoàn toàn.
- Secret (token, key, cookie, URL ký...) tự động che `***` trong log.
- Config đóng băng sau khi nạp; không thể bị sửa lúc chạy.

**Lệnh nhạc VIP:**
| Lệnh | Chức năng |
|---|---|
| `/scl <từ khóa>` | Tìm nhạc SoundCloud → trả lời số → tải voice; thêm `320` hoặc `-q 320` để lấy chất lượng cao |
| `/lyric <từ khóa>` | Lời bài hát (thẻ AI) — không nhập = bài tìm gần nhất |

**Lệnh tiện ích:**
| Lệnh | Chức năng |
|---|---|
| `/getavt` | Lấy avatar theo mẫu Kenne400k: `/getavt id <uid>` • `link <link>` • `user [@tag]` |
| `/card [uid \| @tag]` | Thẻ hồ sơ Zalo layout Kenne400k: nền ảnh + **avatar tròn** + cột thông tin bên phải (cyan `#00FFFF`, link xanh lá `#00FF33`) |
| `/tiktok <username>` | Thẻ thông tin TikTok (followers, thích, video, xác minh) |
| `/tiktok video <link>` / `tiktok music <link>` | Tải video/nhạc TikTok |
| `/infofb <username \| uid \| link>` | Thẻ thông tin Facebook (không cần token) |
| `/cardzalo [uid \| @tag]` | Thẻ hồ sơ người dùng Zalo (ảnh canvas) |
| `/getlink` (reply tin) | Lấy link media từ tin nhắn được reply |
| `/getvoice` (reply video) | Trích xuất audio từ video rồi gửi voice |
| `/getvd` (reply video) | Tải video gốc → upload asyncfile → gửi video gốc (không nén) |
| `/delmsg <N>` / `/delmsg <N> @tag` | Admin bot hoặc admin nhóm xóa tối đa N tin gần nhất trong cache 24 giờ của chính mình (không tag) hoặc người được tag; chỉ gồm tin bot đã nhận khi đang chạy (Zalo không còn API tải lịch sử nhóm), tối đa 100 tin/lần; tài khoản bot cần quyền xóa tin trong nhóm |
| `/stk` (reply ảnh/GIF/video/sticker) | Phân tích ảnh → **tìm sticker Zalo thật** trong kho → gõ số để gửi |
| `/stkvd` (reply GIF/video/sticker động) | Như trên nhưng ưu tiên sticker **động** (type 1) |
| `/autodown on` / `off` / `status` | Bật tự tải media trong nhóm. Đang bật thì **mọi link gửi vào nhóm** đều được tự tải (không cần prefix). Bot bỏ qua tin do chính mình gửi và tin là lệnh → không bị lặp |
| `/noi <văn bản>` | Bot đọc thành giọng nói (cần `ai.tts_enabled: true`) |
| `/events [tên] on\|off` | Bật/tắt **bộ sự kiện tự động** (mặc định tắt) |
| `/stats` | Thẻ thống kê ngày (lệnh, nhạc, lỗi, top lệnh, cache hit rate) |

**Điều hướng menu & nhạc (không cần nhớ lệnh dài):**
- Menu chỉ có `/menu` (bỏ alias `/menu2` vì gõ `/menu2` bị hiểu là mở lại trang 1, gây nhầm) — muốn tới trang 2 thì gõ `/menu 2`.
- Menu: `/menu` → trang 1, `/menu next` / `/menu prev`, `/menu <số>`, `/menu out` (đóng). Bố cục 3 cột × 3 hàng = 9 lệnh/trang.
- Khi menu đang mở, gõ trần **`next`** / **`prev`** / **`out`** (không cần prefix) cũng chuyển trang được.
- Nhạc: `/scl <từ khóa>` → `/scl next` / `/scl prev` / `/scl out`, hoặc gõ trần **`next`** / số thứ tự khi đang có kết quả. Kết quả hiện dạng lưới 4 cột (8 bài/trăng), xếp bài nhiều người nghe & thích nhất lên đầu.
- Kết quả nhạc **xếp bài nhiều người nghe & thích nhất lên đầu** (20 bài/trang, mỗi trang 8 bài).

**Bộ sự kiện tự động** — **mặc định TẮT**, phải bật bằng lệnh `/events <tên> on`:
| Lệnh bật | Sự kiện |
|---|---|
| `/events welcome on` | 👋 Có thành viên mới → thẻ chào mừng + mention + reaction |
| `/events bye on` | 🚪 Có thành viên rời/bị kick → thẻ tạm biệt |
| `/events rank on` | 🏆 Chat để nhận EXP (30s/lần), lên level → thẻ chúc mừng |
| `/events react on` | 😍 Thả icon/emoji cho **mọi tin nhắn** của thành viên (10s/người, bỏ qua lệnh) |
| `/events guard on` | 🚨 Canh link lạ & từ cấm (`assets/spam/badwords.txt`): cảnh cáo 3 lần → kick |
| `/events` | Xem trạng thái tất cả + hướng dẫn bật/tắt |
| `/events guard allow <host>` / `guard allowed` | Thêm / xem host được phép (mặc định: youtube, facebook, tiktok, instagram...) |

**Lệnh spam (chỉ admin bot):**
| Lệnh | Chức năng |
|---|---|
**Autodown — tự tải link trong nhóm (sau `/autodown on`):**
- Nhận **mọi dạng Zalo gửi link**: gõ tay, link kèm chú thích, tin chia sẻ (`href`/`url`/`link`), link gợi ý, object lồng object — bot tự quét tìm URL.
- Tải media (pure JS, không dùng yt-dlp/Python): TikTok qua `services.tiktok_api_url` (tikwm + dự phòng). YouTube/Facebook/Instagram/Twitter và các trang khác tự trích xuất link trực tiếp từ thẻ meta (og:video/twitter:player) của trang; nếu thất bại thì dùng endpoint `services.media_downloader_url` trong config.yml (nếu admin cấu hình). Nếu không có endpoint và trích xuất meta thất bại, link đó sẽ báo lỗi tải.
- Video → gửi video; chỉ có tiếng → tải mp3 gửi voice.
- **Chất lượng**: tuỳ theo nguồn endpoint trả về (giới hạn file Zalo mặc định 200MB, đổi bằng biến `JT_MAX_VIDEO_MB`).
- TikTok/Douyin: thử API công khai (chain: `services.tiktok_api_url` → tikwm → dự phòng). Các API public hiện hay chết nên **nên tự cấu hình `services.tiktok_api_url`** nếu có nguồn riêng.
- Nền tảng không hỗ trợ (link lạ) → bot im lặng, không làm nhiễu nhóm.

**Lệnh spam (chỉ admin bot):**
| Lệnh | Chức năng |
|---|---|
| `/spam @bạn` | Spam tin nhắn + tag người kia, nội dung **ngẫu nhiên mọi ngôn ngữ trong `assets/spam/*.txt`** |
| `/spam @bạn -t 50 -d 1` | 50 lần, mỗi 1 giây (`-t 0` = không giới hạn) |
| `/spam @bạn Xin chào` | Dùng câu tự gõ thay vì câu trong folder |
| `/spam @bạn en` | Chỉ dùng câu tiếng Anh (`vi\|en\|zh\|ja\|ko\|th\|mix`) |
| `/spam list` / `reload` | Xem ngôn ngữ & số câu / nạp lại sau khi sửa file |
| `/spam off` | Dừng job spam đang chạy trong nhóm |
| `/spamsticker on [số lần]` | Spam sticker **hiệu ứng màn hình** (gây lag) — nguồn `stickers.zaloapp.com`, bot tự lọc sticker `effectId > 0` |
| `/spamsticker off` | Dừng spam sticker |
| `/spamsticker list` / `reload` / `test` | Xem kho / nạy lại / kiểm tra nguồn (không spam) |

> **Lưu ý về sticker:** Zalo API không cho bot **tạo** sticker mới từ ảnh/video.
> Nên `/stk` và `/stkvd` phân tích màu ảnh reply → gợi ý từ khóa → **tìm sticker
> CÓ SẴN trong kho Zalo** (qua `searchSticker` + `getStickersDetail`) → bạn gõ
> số để gửi. Reply đúng sticker gốc thì gửi lại sticker đó.

- Folder ngôn từ spam: `assets/spam/*.txt` — MỖI FILE = MỘT NGÔN NGỮ (`vi`, `en`, `zh`, `ja`, `ko`, `th`, `mix`). Mỗi dòng một câu, dòng `#` là chú thích. Sửa file xong gõ `/spam reload`, **không cần sửa code**.
- Kho sticker hiệu ứng nạp 1 lần rồi nhớ 30 phút; mỗi lần `reload` xáo trộn và quét 24 bộ sticker mới.
- `core/stickerStore.js`: catalog từ `stickers.zaloapp.com/sticker` → `getStickerCategoryDetail` → giữ sticker `effectId > 0`.

**Kiến trúc + vận hành:**
- `/stats` — thẻ thống kê ngày (lệnh, nhạc, lỗi, top lệnh, cache hit rate).
- **Hot-reload**: sửa file plugin là tự nạp lại (`hot_reload: true`).
- **LRU cache** cho group/user info + kết quả nhạc (ít gọi API Zalo hơn).
- **Audit log**: mọi hành động admin ghi vào `data/audit.log`, xem qua panel `/api/metrics`.
- Test harness: `node scripts/test-commands.js` (cấu hình + chạy pipeline mọi lệnh) và `node scripts/test-all.js` (kiểm tra chi tiết từng chức năng).

---

## 🖥️ Chạy 24/7 miễn phí — KHÔNG CẦN THẺ (Render) + Database Supabase

### Kiến trúc

| Thành phần | Chạy ở đâu | Vai trò |
|---|---|---|
| Bot + Panel API | **Render** (Docker, free — KHÔNG cần thẻ) | WebSocket Zalo, lệnh, nhạc, quản lý bot con |
| Giữ thức | **UptimeRobot** (free) | Ping /health mỗi 5 phút → Render không ngủ |
| Database | **Supabase** (Postgres free) | Lưu settings nhóm, user, metrics — container restart KHÔNG mất |
| Panel UI | **GitHub Pages** | Giao diện điều khiển từ xa, gọi API trên Render |

> **So sánh nền tảng free cho bot Zalo (2026)**
>
> | Nền tảng | Thẻ? | WebSocket? | Ngủ? | Kết luận |
> |---|---|---|---|---|
> | **Render** | ❌ Không | ✅ | Có (15 phút) → UptimeRobot giữ thức | ✅ **Dùng được — không cần thẻ** |
> | Northflank | ⚠️ Verify thẻ | ✅ | Không (always-on) | ✅ Tốt hơn nhưng cần thẻ |
> | SnapDeploy | ❌ Không | ❌ Chỉ ở gói trả phí | Có | ❌ Không chạy được bot |
> | Koyeb | 💳 $29/tháng | ✅ | — | ❌ Đã đóng free tier (Mistral mua) |
> | Vercel | — | ❌ | Serverless | ❌ Không giữ được WebSocket |

### Bước 1 — Supabase (5 phút)

1. Tạo project miễn phí tại [supabase.com](https://supabase.com) (region Singapore)
2. Vào **SQL Editor** → dán nội dung file `supabase/schema.sql` → Run
3. Vào **Project Settings → API** → copy:
   - **Project URL** → biến môi trường `SUPABASE_URL`
   - **service_role key** → biến môi trường `SUPABASE_SERVICE_KEY` (giữ bí mật, không commit)

> Không có key Supabase? Bot vẫn chạy bình thường bằng JSON store local (`data/store.json`) — Supabase chỉ để dữ liệu nhóm/người dùng **không mất** khi Render khởi động lại.

### Bước 2 — Deploy Render (không cần thẻ)

1. Đăng ký [render.com](https://render.com) (bằng GitHub, **không cần thẻ**)
2. **New +** → **Web Service** → chọn repo `DEVTRAN07/JOHNTRAN-JS` (repo phải **Public**)
3. Cấu hình:

| Ô | Chọn gì |
|---|---|
| Name | `johntran-bot` |
| Region | **Singapore** (gần Việt Nam nhất) |
| Runtime | **Docker** (repo đã có sẵn Dockerfile) |
| Instance Type | **Free** (512 MB) |
| Health Check Path | `/health` |

4. **Environment Variables** → thêm:

| Biến | Giá trị |
|---|---|
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `JT_PANEL__ENABLED` | `1` (bật panel API) |
| `JT_PANEL__TOKEN` | tạo bằng `openssl rand -hex 32` (bắt buộc khi public) |
| `JT_PANEL__ALLOWED_ORIGINS` | origin của GitHub Pages, ví dụ `https://<user>.github.io` |
| `JT_ACCOUNT_JSON` | nội dung file `account.json` |
| `JT_COOKIE_JSON` | nội dung file `cookie.json` |
| `JT_AI__GEMINI_KEYS` | key Gemini (tuỳ chọn) |

5. **Create Web Service** → đợi build 5-10 phút → URL dạng `https://johntran-bot.onrender.com`

> Login 1 lần ở máy: chạy `node JohnTran.js`, quét QR, thấy "Đã đăng nhập thành công" rồi lấy nội dung `account.json` + `cookie.json` điền vào env. Cookie hết hạn (vài tuần) thì làm lại.

### Bước 3 — UptimeRobot giữ bot thức (QUAN TRỌNG)

Render free **ngủ sau 15 phút** không có request → bot mất kết nối Zalo. Giữ thức bằng ping miễn phí:

1. Đăng ký [uptimerobot.com](https://uptimerobot.com) (free, không cần thẻ)
2. **+ New Monitor** → Type: **HTTP(s)**
3. URL: `https://johntran-bot.onrender.com/health`
4. Monitoring Interval: **5 minutes**
5. **Create Monitor**

Từ đó Render luôn có request mỗi 5 phút → bot không bao giờ ngủ → WebSocket Zalo giữ liên tục.

> Lưu ý: mỗi lần Render build lại hoặc restart, bot cần ~1 phút để kết nối lại Zalo (listener tự reconnect).

### Bước 4 — Panel trên GitHub Pages

1. Repo → **Settings → Pages** → Source: `main` branch, thư mục `/docs` → Save
2. Mở `https://<user>.github.io/JOHNTRAN-JS/panel.html`
3. Nhập **REMOTE PANEL URL** = URL Render + **TOKEN** = `JT_PANEL__TOKEN` → Bấm **Kết nối**

Panel có: danh sách bot con (pid, uptime, restart, crash-loop) • chạy/dừng/khởi động lại/xoá • xem log realtime • xem QR đăng nhập • bật/tắt auto-restart • metrics • top lệnh • audit log admin.

### Phương án nâng cấp (nếu cần ổn định tuyệt đối)

- **Northflank** free (cần verify thẻ): always-on, không ngủ — không cần UptimeRobot
- **Oracle Cloud Always Free**: VPS ARM thật, không ai cắt được (cần thẻ, tự cài Node + chạy)

---

## 🔧 Yêu cầu

- **Node.js** phiên bản **v20.18 trở lên** (khuyến nghị Node.js 22, đồng nhất Render/Docker/CI)

- **Khi sử dụng hệ điều hành Windowns bạn cần phải cài các font trong plugins/cache/... để có font chữ cho canvas**

### 📦 Cài đặt Bot

```bash
git clone https://github.com/DEVTRAN07/JOHNTRAN-JS.git
cd JOHNTRAN-JS
npm install
```

> **Lưu ý `zalo-client`:** thư viện chưa publish lên npm. Bot đang gắn bản build sẵn qua `file:../Zalo-Client` (clone + `npm run build` repo [Zalo-Client](https://github.com/DEVTRAN07/Zalo-Client) cạnh thư mục bot). Khi đã publish npm, đổi thành `"zalo-client": "^3.0.0"` trong package.json.

---

### 🔐 Panel & triển khai an toàn (v4)

- Panel mặc định tắt. Khi mở public/cloud, đặt `JT_PANEL__TOKEN` bằng secret mới sinh (không dùng token từng commit trong repo). Ví dụ: `openssl rand -hex 32`.
- Có thể cấu hình bằng biến môi trường: `JT_PANEL__ENABLED=true`, `JT_PANEL__HOST=0.0.0.0`, `JT_PANEL__PORT=3000`, `JT_PANEL__TOKEN=<secret>`.
- Chỉ chạy local có thể đặt `JT_PANEL__HOST=127.0.0.1`; ở chế độ loopback token không bắt buộc.
- Bridge bot nội bộ dùng secret độc lập `JT_BRIDGE_TOKEN` (để trống sẽ tự sinh khi Panel khởi động), không tái sử dụng token dashboard.
- Dashboard gửi token qua header `Authorization: Bearer <token>`; token chỉ lưu trong `sessionStorage` của tab và không được gắn vào URL. Token qua query string bị từ chối.
- `/api/*`, `/metrics` và endpoint QR đều cần xác thực. `/health` và các file giao diện tĩnh vẫn public cho health-check và tải giao diện.
- Dashboard chạy ở domain khác phải được thêm vào `panel.allowed_origins` hoặc `JT_PANEL__ALLOWED_ORIGINS` (các origin phân tách bằng dấu phẩy). Không bật wildcard CORS.
- Nếu trước đây dùng token đã commit trong lịch sử Git, hãy coi token cũ đã lộ và thay mới ở mọi nơi đang triển khai.

## 🔐 Đăng nhập Bot

### ✅ Cách 1: Đăng nhập bằng **QR Code**

1. Chạy bot bằng lệnh:
   ```bash
   npm start
   ```
2. Mở file `qr.png` được tạo trong thư mục bot và quét mã bằng ứng dụng Zalo
3. Sau khi đăng nhập thành công, bot sẽ tự động lưu **cookie** cho những lần đăng nhập tiếp theo

📘 Xem tài liệu chi tiết tại:  
👉 [https://github.com/DEVTRAN07/Zalo-Client#qr-login](https://github.com/DEVTRAN07/Zalo-Client#qr-login)

### ✅ Cách 2: Đăng nhập bằng **Cookie**

1. Tạo file `account.json` với nội dung:

   ```json
   {
     "imei": "Imei_Cua_Ban",
     "userAgent": "userAgent_Cua_Ban",
     "cookie": "cookie.json"
   }
   ```

2. Thay thế các giá trị `imei`, `userAgent`

3. Tạo file `cookie.json` và dán nội dung cookie Zalo vào
4. Chạy bot bằng lệnh:
   ```bash
   npm start
   ```

📘 Có thể dùng công cụ ZaloDataExtractor để lấy `imei` `userAgent` `cookie`:
👉 [https://github.com/JustKemForFun/ZaloDataExtractor/](https://github.com/JustKemForFun/ZaloDataExtractor/)

📘 Xem hướng dẫn chi tiết cách lấy cookie tại:  
👉 [https://github.com/DEVTRAN07/Zalo-Client#cookie-login](https://github.com/DEVTRAN07/Zalo-Client#cookie-login)

---

## 📄 Giấy phép

Phát hành theo giấy phép **MIT License**

---
