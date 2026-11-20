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
    games/services/              # Điều phối phiên chơi, timer và state trong RAM
    media/music/                 # Provider, cache, FFmpeg và pipeline nhạc
  domain/
    groups/botState.js           # Chính sách bật/tắt bot theo nhóm, hàm thuần
    games/engines/               # Luật chơi thuần, không Zalo/I/O
    moderation/protectionState.js# Schema/trạng thái Anti, hàm thuần
    README.md                    # Quy ước cho domain service mới
  infrastructure/storage/
    index.js                     # JSON store trong RAM
    schema.js                    # Hợp đồng dữ liệu dùng chung
    jsonWriterWorker.js          # Ghi file ngoài event loop
    diagnostics.js               # Kiểm tra độ bền filesystem
core/                            # Zalo adapter, listener, controller, canvas, media
  runtime/                       # Adapter tương thích trỏ tới src
  storage/                       # Adapter tương thích trỏ tới src
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
  -> domain.groups.botState (policy thuần, không I/O)
  -> domain.games.engines (luật chơi thuần)
  -> application.games.services (session/timer/state của từng trò chơi)
  -> application.media.music (provider, cache, FFmpeg và upload)
  -> command registry -> permission/cooldown -> dispatcher -> plugin.run -> Zalo API
  -> event registry -> event plugins + command.handleEvent
Ghi dữ liệu: RAM mirror -> worker thread -> file JSON tạm -> atomic rename
```

## Quy tắc hiệu năng
1. Không chờ Supabase/HTTP/đọc file trong listener trước khi gọi command.
2. Dữ liệu group/user trên hot path phải có cache RAM và invalidation rõ.
3. Log, thống kê, panel transcript, cache phụ và media chạy nền sau khi command bắt đầu phản hồi.
4. Không stringify toàn bộ store trên event loop; JSON writer worker phụ trách serialize.
5. Không xếp mọi message của nhóm vào một queue chung; chỉ tuần tự hóa thao tác bắt buộc.
6. Media/nhạc cần timeout, dedupe, concurrency limit và acknowledgement.
7. Domain chỉ xử lý quy tắc và trạng thái; Zalo API, storage và render nằm ở adapter/application layer.
8. Không đổi API plugin cũ nếu chưa có adapter và test tương thích.

Thời gian cuối cùng vẫn phụ thuộc WebSocket/Zalo API và dịch vụ ngoài. Cấu trúc này giảm công việc đồng bộ phía bot, không thể bảo đảm luôn dưới 1 giây khi upstream chậm.

## Lộ trình
- Giai đoạn 1: chuyển composition root, command/event dispatch và JSON storage vào src.
- Giai đoạn 2: chính sách nhóm/Anti và engine game thuần đã chuyển vào domain; service phiên chơi đã chuyển vào application.games.services.
- Giai đoạn 2.5: pipeline nhạc/provider đã chuyển vào application.media.music; core/music giữ adapter tương thích.
- Giai đoạn 3: gỡ adapter cũ chỉ sau khi test tương thích và profiling xác nhận.
