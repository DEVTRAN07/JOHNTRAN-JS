# JOHNTRAN-JS — Kiến trúc v5

## Mục tiêu
- Một composition root, một command registry và một event registry.
- Giữ API plugin v4 để không phải viết lại hàng loạt lệnh cùng lúc.
- Không đọc database qua mạng trong đường xử lý tin nhắn.
- Tách I/O lưu trữ khỏi event loop bằng JSON writer worker.
- Mọi thay đổi cấu trúc có adapter tương thích và kiểm thử.

## Cấu trúc chuẩn
```text
index.js                         # Supervisor: restart/backoff
JohnTran.js                      # Entry tương thích
src/
  app/startBot.js                # Composition root: config, login, listener
  application/
    commands/registry.js         # Resolve tên/alias lệnh
    commands/dispatcher.js       # Gọi plugin, lỗi, phản hồi trạng thái
    events/registry.js           # Index/dispatch event handlers
    events/threadQueue.js        # Queue theo nhóm khi cần thứ tự
  infrastructure/storage/
    index.js                     # JSON store trong RAM
    schema.js                    # Hợp đồng dữ liệu dùng chung
    jsonWriterWorker.js          # Ghi file ngoài event loop
    diagnostics.js               # Kiểm tra độ bền filesystem
  domain/README.md               # Quy ước cho domain service mới
core/                            # Zalo adapter, listener, controller, canvas, media
  runtime/                       # Adapter tương thích trỏ tới src/application
  storage/                       # Adapter tương thích trỏ tới src/infrastructure
plugins/commands/                # Giữ nguyên lệnh hiện có
plugins/events/                  # Giữ nguyên event plugin
data/store.json                  # Dữ liệu runtime, không commit dữ liệu thật
tests/                            # Test nghiệp vụ, tương thích và hiệu năng
```

## Luồng xử lý tin nhắn
```text
Zalo WebSocket
  -> core/listen.js
  -> RAM cache nhóm + phân loại message
  -> command registry -> permission/cooldown -> dispatcher -> plugin.run -> Zalo API
  -> event registry -> event plugins + command.handleEvent
Ghi dữ liệu: RAM mirror -> worker thread -> file JSON tạm -> atomic rename
```

## Quy tắc hiệu năng
1. Không chờ Supabase/HTTP/đọc file trong listener trước khi gọi command.
2. Dữ liệu group/user trên hot path phải có cache RAM và invalidation rõ.
3. Log, thống kê, panel transcript, cache phụ và media chạy nền sau khi command bắt đầu phản hồi.
4. Không stringify toàn bộ store trên event loop; JSON writer worker phụ trách serialize.
5. Không xếp mọi message của nhóm vào một queue chung; chỉ tuần tự hóa thao tác bắt buộc đúng thứ tự.
6. Media/nhạc cần timeout, dedupe, concurrency limit và acknowledgement.
7. Không đổi API plugin cũ nếu chưa có adapter và test tương thích.

Thời gian cuối cùng vẫn phụ thuộc WebSocket/Zalo API và dịch vụ ngoài. Cấu trúc này giảm công việc đồng bộ phía bot, không thể bảo đảm luôn dưới 1 giây khi upstream chậm.

## Lộ trình
- Giai đoạn 1 (commit này): chuyển composition root, command/event dispatch và JSON storage vào src; đường dẫn cũ làm adapter.
- Giai đoạn 2: chuyển từng miền anti, games, welcome và media sang domain service thuần.
- Giai đoạn 3: gỡ adapter cũ chỉ sau khi test tương thích và profiling xác nhận.
