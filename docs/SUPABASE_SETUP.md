# Kết nối JOHNTRAN-JS với Supabase

Hướng dẫn này chuyển dữ liệu nhóm/người dùng/metrics từ JSON sang Supabase, giữ bản JSON gốc và không ghi đè các hàng đã có trên Supabase.

## 1. Tạo project và lấy API credentials

1. Tạo một project trong Supabase.
2. Mở **Project Settings → API Keys**.
3. Sao chép **Project URL**.
4. Tạo/lấy **Secret API key** có dạng `sb_secret_...`. Đây là key server-side; không dùng publishable key.
5. Không gửi Secret key trong chat, không commit vào Git và không đưa vào mã frontend.

JOHNTRAN-JS ưu tiên `SUPABASE_SECRET_KEY`. Tên cũ `SUPABASE_SERVICE_KEY` vẫn được hỗ trợ cho deployment đang dùng legacy `service_role` JWT.

## 2. Tạo bảng trong Supabase

Mở **SQL Editor → New query**, lấy toàn bộ nội dung [supabase/schema.sql](../supabase/schema.sql), dán và chạy một lần.

Schema tạo đủ các bảng mà adapter đang sử dụng:

- `bot_threads`: cấu hình nhóm, bao gồm `bot_enabled`.
- `bot_users`: dữ liệu người dùng.
- `bot_metrics`: thống kê.
- `bot_stats`: thống kê bot con.
- `bot_media_cache`: cache metadata media.

Các bảng bật Row Level Security và chỉ cấp quyền truy cập cần thiết cho role `service_role` được dùng bởi server key.

## 3. Sao lưu và nhập JSON cũ trước khi chuyển driver

Không xóa `store.json`. Trước khi chuyển, hãy tải một bản sao an toàn của file JSON hiện tại từ Persistent Disk về máy.

Trên máy có repo JOHNTRAN-JS, chạy:

```bash
export JT_DB_FILE="/duong-dan/toi/store.json"
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SECRET_KEY="sb_secret_..."

npm ci
npm run migrate:supabase -- --dry-run
```

Kiểm tra số lượng bản ghi được liệt kê. Sau khi xác nhận đúng file và số liệu, chạy:

```bash
npm run migrate:supabase -- --import-missing
```

Trước khi import, script kiểm tra quyền truy cập đủ cả 5 bảng đích; nếu thiếu bảng/quyền, nó dừng trước khi ghi bản ghi đầu tiên. Khi import thật, script tự tạo bản sao `.pre-supabase-<timestamp>.bak` cạnh file JSON trước khi ghi và báo đường dẫn backup; file JSON gốc không bị sửa hoặc xóa. Lệnh import chỉ thêm ID chưa có trên Supabase; hàng cùng ID đã tồn tại được bỏ qua, không bị ghi đè. File JSON nguồn chỉ được đọc, không sửa hoặc xóa.

Nếu đang quản lý bot con có file riêng tại `<JT_PERSISTENT_DIR>/bots/<bot-name>/store.json`, sao lưu và chạy lại lệnh import cho từng file đó. Các ID trùng đã có trên Supabase sẽ được giữ nguyên; không tự động hợp nhất hai cấu hình khác nhau.

## 4. Cấu hình Render

Mở **Render Dashboard → JOHNTRAN-JS → Environment → Add Environment Variable**, thêm:

| Key | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | Secret API key `sb_secret_...` |

Sau đó kiểm tra:

- Không đặt `JT_DB_DRIVER=json`.
- Không đặt `SUPABASE_DISABLE=true`.
- Có thể đặt `JT_DB_DRIVER=supabase` để app fail-fast nếu thiếu credentials; nếu bỏ trống, app tự chọn Supabase khi đủ cả URL và Secret key.
- Không cần xóa `JT_DB_FILE` hoặc Persistent Disk: file local vẫn dùng cho registry, account, QR và log; database nghiệp vụ sẽ chạy trên Supabase.

Lưu Environment và triển khai lại service. `render.yaml` đã khai báo hai key với `sync: false`, nhưng Render không tự thêm chúng vào service Blueprint đã tồn tại khi cập nhật Blueprint; phải tạo hai biến trong Dashboard thủ công.

## 5. Xác minh kết nối

Sau khi service chạy, mở Panel → **Hệ thống → Database**. Kết quả cần thấy:

- Driver: `supabase`.
- Trạng thái: `ok=true`.
- Probe bảng `bot_threads`: `ok=true`.
- Có thời điểm sync gần nhất và không có `syncError`.

Có thể chạy kiểm tra API đã xác thực từ máy local:

```bash
export JT_VERIFY_BASE_URL="https://johntran-js.onrender.com"
export JT_VERIFY_PANEL_TOKEN="<panel-token>"
npm run verify:deployment
```

Endpoint `/api/database/health` chỉ probe `bot_threads`; Panel cũng hiển thị số hàng từng bảng và tình trạng retry/sync.

## 6. Lưu ý khi chuyển driver

- Hãy hoàn thành import trước khi thêm credentials vào Render để dữ liệu JSON cũ có sẵn trên Supabase khi app khởi động bằng driver mới.
- Không chạy `--import-missing` khi chưa kiểm tra `--dry-run`.
- Import không ghi đè hàng đã tồn tại. Nếu Supabase đã có dữ liệu trùng ID, cần so sánh và hợp nhất riêng trước khi chọn bản chuẩn.
- Secret key chỉ được dùng ở server. Nếu nghi ngờ đã lộ key, rotate key trong Supabase và cập nhật Render ngay.
