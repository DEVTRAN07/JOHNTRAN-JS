# Dữ liệu runtime

## Nơi lưu
Mặc định bot dùng local JSON tại data/store.json. Có thể đổi file bằng JT_DB_FILE hoặc đặt trên persistent disk bằng JT_PERSISTENT_DIR. Không cần Docker, Redis hay database server riêng để chạy lệnh cơ bản.

Supabase là adapter tùy chọn được giữ lại để tương thích cấu hình cũ: chỉ bật khi chủ động đặt cả JT_DB_DRIVER=supabase và JT_ENABLE_REMOTE_DATABASE=true. Cấu hình mặc định dùng JSON local; không gửi thao tác đọc/ghi từng tin nhắn lên mạng.

## Collections
| Collection | Khóa | Mục đích |
|---|---|---|
| Users | userId | Thông tin và trạng thái người dùng |
| Threads | threadId | Cấu hình nhóm, bật/tắt bot, thiết lập lệnh |
| Metrics | khóa metric | Thống kê và số liệu tổng hợp |
| BotStats | name | Trạng thái tiến trình/bot con cho Panel |
| MediaCache | khóa cache | Metadata/cache media |

## Định dạng bản ghi
```json
{
  "Threads": {
    "group-id": {
      "threadId": "group-id",
      "data": { "bot_enabled": true },
      "updatedAt": 1795000000000
    }
  }
}
```
Các collection còn lại dùng cùng nguyên tắc: object được đánh chỉ mục theo ID, bản ghi giữ data và metadata. Không xóa field chưa biết vì plugin cũ có thể đang dùng.

## An toàn dữ liệu
- schema.js là nơi duy nhất khai báo tên collection và kiểm tra hình dạng root/table.
- Bộ kiểm tra không loại field con; dữ liệu v4 hiện tại được giữ nguyên.
- JSON không hợp lệ sẽ khóa ghi để tránh ghi đè file gốc bằng dữ liệu rỗng.
- Ghi thường được gom đợt trong worker; ghi quan trọng dùng saveDataAndWait.
- account.json, cookie và secret phải ở file riêng/biến môi trường, không đưa vào store.json hoặc Git.
- Không commit dữ liệu runtime thật trong data/.
