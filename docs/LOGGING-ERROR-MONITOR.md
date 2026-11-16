# Nhật ký lỗi và giám sát JOHNTRAN-JS

## Panel

Mở **Panel → Hệ thống → Nhật ký lỗi & cảnh báo**. API `/api/errors` chỉ nằm sau lớp xác thực Panel Bearer Token, không phải endpoint public.

Panel tổng hợp:
- Lỗi và cảnh báo của tiến trình master.
- Nhật ký riêng từng bot con, kể cả khi bot đó đang offline.
- Tên bot, nguồn lỗi, lệnh, nhóm liên quan và thời điểm phát sinh.
- Các lần bot thoát bất thường, watchdog restart và restart thủ công.
- Số lần lỗi lặp đã được gộp, top lệnh/nhóm/nguồn phát sinh.

## Cách ghi và giới hạn

- Logger cũ vẫn in console như trước. Mọi log mức `warn` và `error` được ghi thêm vào JSON Lines (`*.errors.jsonl`) theo cách bất đồng bộ.
- Lỗi giống nhau (cùng bot, nguồn, lệnh, nhóm, mã và nội dung) trong 60 giây được gộp thành một sự kiện có bộ đếm, tránh spam.
- RAM giữ tối đa 200 sự kiện gần nhất; hàng đợi ghi tối đa 1.000 dòng.
- Mỗi file tối đa 2 MB; giữ tối đa 3 file archive (`.1`, `.2`, `.3`).
- Lỗi file system không được phép chặn listener hoặc lệnh bot. Sự kiện chưa ghi được được giữ trong hàng đợi có giới hạn để thử lại khi có log mới hoặc khi flush.

## Đường dẫn lưu

Bot con do Panel quản lý có file riêng:

```text
<JT_PERSISTENT_DIR>/bots/<bot-name>/logs/errors.jsonl
```

Nếu chưa đặt `JT_PERSISTENT_DIR`, file ở thư mục `bots/<bot-name>/logs/` trong project; filesystem Render có thể bị xóa khi redeploy.

Tiến trình master dùng:

```text
<JT_PERSISTENT_DIR>/logs/<bot-name>.errors.jsonl
```

hoặc `data/logs/` khi chưa cấu hình Persistent Disk.

Để giữ lịch sử qua deploy/restart trên Render, cần cấu hình `JT_PERSISTENT_DIR` đúng Disk Mount Path như hướng dẫn [RENDER_STORAGE.md](./RENDER_STORAGE.md). Không dùng một mount path giả định.

## Dữ liệu nhạy cảm

Trước khi ghi, logger loại bỏ Bearer token, token trong query string, các biến như `SUPABASE_SERVICE_KEY`, `JT_BRIDGE_TOKEN`, `JT_PANEL__TOKEN`, `API_KEY`, và giá trị cookie/authorization. ID người gửi trong tin nhắn riêng không được ghi vào trường Group ID; chỉ ID nhóm khi ngữ cảnh xác định là nhóm mới được lưu.

Nhật ký không ghi nội dung hội thoại hoặc payload tin nhắn. Tuy nhiên error message của thư viện bên ngoài vẫn có thể chứa thông tin định danh hoặc URL; cần kiểm tra log trước khi chia sẻ công khai.

## Phạm vi cảnh báo

Các nguồn được phân loại gồm:
- `command`, `command-event`, `event`, `listener-*`.
- `websocket-listener`, `websocket-watchdog`, `process-crash`.
- `database-supabase`, `bot-lifecycle`, `bot-restart-auto`, `bot-restart-manual`.
- `panel-bridge` và các lỗi runtime khác.

Thông báo DB/WebSocket hiện được ghi vào Panel để quản trị viên theo dõi; chưa gửi thông báo push ra Zalo/Telegram hoặc dịch vụ bên ngoài. Nhật ký master và bot con có thể lưu bền vững qua deploy khi đường dẫn nằm trên Persistent Disk đã xác minh.
