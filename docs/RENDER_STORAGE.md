# Lưu trữ bền vững trên Render

JOHNTRAN-JS hỗ trợ hai nơi lưu dữ liệu:

- **Supabase**: lưu dữ liệu nhóm, người dùng và metrics trong database từ xa.
- **JSON**: lưu trong các file trên filesystem của máy chủ.

Render sử dụng filesystem tạm cho phần lớn đường dẫn. Chỉ dữ liệu nằm bên trong đúng Disk Mount Path của Persistent Disk mới được giữ lại qua lần deploy/restart. Xem hướng dẫn chính thức: https://render.com/docs/disks.

## Cấu hình hiện tại trong repository

File `render.yaml` khai báo Persistent Disk của dịch vụ `JOHNTRAN-JS` tại:

```text
Disk name:  bot-data
Mount path: /opt/render/project/data
Size:       1 GB
```

Các file tài khoản, store và QR của master đã trỏ vào mount này. Bản cấu hình mới cũng đặt:

```text
JT_PERSISTENT_DIR=/opt/render/project/data
```

Biến này chuyển registry BotManager, dữ liệu từng bot con và nhật ký master/bot con vào cùng Persistent Disk. Sau khi đồng bộ Blueprint, mở Render Dashboard → Environment để xác nhận biến thực tế đã có đúng giá trị; chỉ sửa file trong Git không chứng minh Dashboard đã áp dụng Blueprint.

Registry được đặt dưới `/opt/render/project/data/data/bots.json`, dữ liệu bot con dưới `/opt/render/project/data/bots/<bot-name>/`, và log master dưới `/opt/render/project/data/logs/`.

## 1. Kiểm tra loại dịch vụ

Trong Render Dashboard, mở dịch vụ `JOHNTRAN-JS`.

- Nếu dịch vụ hỗ trợ Persistent Disk, mở phần **Disks** và xem Disk Mount Path.
- Nếu không thể gắn disk trên gói dịch vụ hiện tại, không được coi file JSON local là lưu trữ bền vững. Giữ dữ liệu chính trên Supabase hoặc chuyển sang gói Render hỗ trợ Persistent Disk.

Không thay đổi database driver chỉ để làm hết cảnh báo; trước tiên hãy xác định bot đang dùng Supabase hay JSON trong Panel → Hệ thống.

## 2. Nếu dùng JSON và đã gắn Persistent Disk

Với cấu hình hiện tại trong `render.yaml`, Disk Mount Path là `/opt/render/project/data`:

1. Đồng bộ Blueprint hoặc thêm biến môi trường `JT_PERSISTENT_DIR=/opt/render/project/data` trong Render Dashboard → Environment.
2. Giữ nguyên `JT_DB_DRIVER=json` nếu hiện tại đang dùng JSON.
3. Giữ `JT_DB_FILE=/opt/render/project/data/store.json` như cấu hình hiện tại trong `render.yaml`; file này nằm trong mount path.
4. Redeploy dịch vụ.

BotManager sẽ lưu registry tại `/opt/render/project/data/data/bots.json`, và file riêng của từng bot tại `/opt/render/project/data/bots/<bot-name>/` (store, account, cookie và QR). Khi đường dẫn persistent được bật lần đầu, mã sẽ sao chép registry/database/account cũ sang đích nếu file đích chưa có; file nguồn không bị xóa hoặc ghi đè.

**Không điền ví dụ `/var/data` nếu Disk Mount Path trên Render của bạn khác.** Dùng chính xác giá trị trong Dashboard.

## 3. Nếu dùng Supabase

Giữ nguyên `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` và `JT_DB_DRIVER=supabase`. Không cần chuyển database nhóm sang JSON.

Supabase lưu dữ liệu nhóm và trạng thái `bot_enabled` từ xa. Tuy nhiên Panel nhiều bot vẫn có các file local như registry, account/cookie và QR; nếu muốn các file này sống sót qua deploy/restart, vẫn cần Persistent Disk và `JT_PERSISTENT_DIR`.

## 4. Xác minh sau khi deploy

Mở Panel → **Hệ thống**.

- Database master: xem driver, file path, lỗi đọc/ghi, thời điểm flush và kết quả probe bảng `bot_threads`.
- Registry bot: xem đường dẫn và trạng thái mount.
- Database từng bot con: xem từng bot đang dùng Supabase hay JSON và độ bền của file store.
- Chỉ trạng thái **mount riêng đã xác minh và file database nằm trong mount** mới được coi là đã xác nhận dùng disk. Trạng thái chưa xác minh không có nghĩa là dữ liệu đã bền vững.

Sau đó kiểm tra thực tế: bật một nhóm bằng `/bot on`, tải lại Panel, restart bot và xác nhận nhóm vẫn ON. Với JSON, kiểm tra file được ghi dưới mount path; với Supabase, kiểm tra probe `bot_threads` và lần đồng bộ gần nhất.

## 5. Sao lưu

Trước khi đổi mount path hoặc đổi loại database, hãy sao lưu các file hiện tại. Cơ chế migration chỉ sao chép file khi đích chưa tồn tại và cố ý giữ bản nguồn; không tự hợp nhất hai bản database đã tồn tại. Nếu cả đích lẫn nguồn đều có dữ liệu mới, dừng migration và so sánh/khôi phục thủ công trước khi chọn file chuẩn.


## 6. Kiểm tra production chỉ đọc

Sau khi deploy và xác nhận Environment, chạy:

```bash
export JT_VERIFY_BASE_URL="https://<service-domain-cua-ban>"
export JT_VERIFY_PANEL_TOKEN="<panel-token>"
npm run verify:deployment
```

Script chỉ thực hiện HTTP GET: kiểm tra `/health`, quyền truy cập các API Panel, `/api/recovery`, `/api/errors` và `/api/database/health`. Nó không gửi tin nhắn thử, không restart bot, không tạo bot mới và không thay đổi trạng thái nhóm.

Không có public service domain nào được khai báo trong `render.yaml`; hãy dùng URL đang hiển thị trong Render Dashboard, không tự đoán hostname. Không chia sẻ Panel token trong log hoặc ảnh chụp màn hình.
