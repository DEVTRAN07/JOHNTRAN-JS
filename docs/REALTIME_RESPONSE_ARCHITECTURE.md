# JOHNTRAN-JS — kiến trúc phản hồi thời gian thực

## Mục tiêu

Đường đi của một lệnh phải ưu tiên **phản hồi đầu tiên**. Mục tiêu kỹ thuật là bot bắt đầu gửi phản hồi trong vòng 1 giây khi WebSocket đã giao sự kiện, event loop không bị CPU đồng bộ chặn, cấu hình/quyền nhóm có sẵn trong cache và API gửi tin Zalo phản hồi bình thường.

Đây là mục tiêu cho đường đi nội bộ, không phải cam kết rằng Zalo hoặc mạng Internet luôn giao tin dưới 1 giây.

## Sơ đồ cây logic mới

```text
ZALO
└── WebSocket listener (zalo-client)
    └── INGRESS — đồng bộ, tối thiểu
        ├── Chuẩn hóa event + chống trùng cliMsgId
        ├── Ghi timestamp nhận event
        ├── Lấy snapshot cấu hình nhóm từ RAM
        └── Phân loại message
            ├── COMMAND PATH — ưu tiên tuyệt đối
            │   ├── Parse prefix / command / args
            │   ├── Resolve command + alias từ Map cache
            │   ├── Kiểm tra bot_enabled / role / cooldown
            │   ├── Kiểm tra quyền nhóm từ cache
            │   │   └── box_only chưa rõ quyền: REST lookup có deadline 850ms
            │   ├── Gọi command.run() ngay, không xếp hàng chung
            │   └── REPLY
            │       ├── Chuẩn bị nội dung
            │       ├── Cookie/header
            │       ├── HTTP fetch
            │       ├── Đọc toàn bộ response body trong cùng deadline
            │       └── Trả kết quả / lỗi có giới hạn thời gian
            │
            ├── NORMAL MESSAGE PATH
            │   ├── Anti moderation
            │   ├── Active games (Nối Từ / TLMN)
            │   └── Passive event plugins
            │
            └── BACKGROUND / AUXILIARY
                ├── Message cache + Rust IPC (sau khi command bắt đầu)
                ├── Panel transcript
                ├── Topchat aggregation / database batch writes
                ├── Media download / FFmpeg / Canvas worker queues
                └── Metrics / logs / cleanup
```

## Ngân sách đường phản hồi

| Chặng | Mục tiêu nội bộ |
|---|---:|
| Event routing + dedupe | 5–20 ms |
| Snapshot nhóm + parse/resolve | 5–30 ms |
| Role/cooldown/cache checks | 1–20 ms |
| Handler lệnh nhẹ | 0–100 ms |
| Bắt đầu gửi phản hồi | Tổng mục tiêu < 1.000 ms |

Mạng Zalo, TLS khi phải tạo kết nối mới, thời gian máy chủ Zalo xử lý và độ trễ giao WebSocket nằm ngoài quyền kiểm soát tuyệt đối của bot.

## Quy tắc kiến trúc

1. Không đặt filesystem, serialize cache lớn, render Canvas, FFmpeg hay tải media trước khi command được dispatch và bắt đầu phản hồi.
2. Không đưa tất cả lệnh vào một hàng đợi tuần tự. Lệnh nhẹ được dispatch độc lập; chỉ tác vụ có trạng thái mới dùng queue riêng.
3. Mọi request Zalo phải có deadline bao trùm headers, fetch, response body và chuỗi redirect.
4. Kiểm tra quyền nhạy cảm phải fail-closed. Timeout không bao giờ được xem là xác nhận admin.
5. Tác vụ phụ có thể trễ; không được chặn luồng trả lời.
6. Không thể bảo đảm dưới 1 giây nếu Zalo chưa giao event hoặc API gửi của Zalo phản hồi chậm.

## Thay đổi hiện thực

- Zalo SDK buffer response body trong deadline, thay vì kết thúc timeout ngay khi nhận headers.
- WebSocket payload dạng nén được giải nén bằng `node:zlib` bất đồng bộ qua libuv worker pool, tránh `pako.inflate()` đồng bộ chặn event loop.
- TopChat diagnostic counters được đẩy sang `setImmediate`, không chạy trước đường dispatch lệnh.
- Redirect chain bị giới hạn và chia sẻ deadline gốc.
- box_only live group-info lookup có deadline ngắn, vẫn fail-closed.
- Message-cache được đẩy sang `setImmediate`; command có cơ hội chạy qua các microtask đầu tiên và gọi API gửi tin trước serialization/IPC của cache phụ.