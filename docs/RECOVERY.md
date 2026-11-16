# Cơ chế tự phục hồi JOHNTRAN-JS

## Panel

Mở **Panel → Hệ thống → Sức khỏe & tự phục hồi** hoặc gọi API đã xác thực `GET /api/recovery`.

Snapshot bao gồm:
- CPU tiến trình, RSS/heap và giới hạn RAM container (cgroup khi hệ điều hành cung cấp).
- Event-loop delay P95/max.
- Job queue toàn cục, từng worker pool và trạng thái circuit breaker.
- Supabase sync/retry queue và trạng thái listener.
- Sức khỏe từng tiến trình bot con đang đăng nhập và truy cập được qua bridge.

API recovery là một endpoint `/api/*`, nên chịu cùng lớp Panel Bearer Token với các API quản trị khác. Bridge bot con chỉ bind localhost và yêu cầu bridge token.

## 1. Listener / WebSocket

- Reconnect dùng exponential backoff: mặc định 5, 10, 20, 40 giây, sau đó giới hạn ở 60 giây; mỗi lần có thêm jitter để tránh nhiều tiến trình kết nối cùng lúc.
- Backoff chỉ reset sau khi cipher key hoàn tất handshake, không reset ngay khi socket vừa mở.
- Sau 3 lần đóng liên tiếp không hoàn tất handshake, tiến trình bot thoát với mã 2 để supervisor hiện có khởi động lại từ session đã lưu.
- Watchdog hiện tại vẫn giữ điều kiện: chỉ xử lý socket state bất thường, connecting quá 90 giây hoặc half-open 30 phút. Không suy luận bot chết chỉ vì nhóm không có ai nhắn.

Có thể điều chỉnh:
- `JT_LISTENER_RECONNECT_BASE_MS`
- `JT_LISTENER_RECONNECT_MAX_MS`
- `JT_LISTENER_RECONNECT_JITTER`

## 2. Supervisor bot con

- Manual Stop không tính là crash và không được tự bật lại.
- Restart tự động tăng delay theo số crash gần đây: base mặc định 3 giây, sau đó 6, 12, 24, 48 giây, giới hạn 60 giây.
- Tối đa 5 lần thoát bất thường trong cửa sổ trượt 10 phút. Khi vượt giới hạn, bot vào cooldown tới khi cửa sổ được làm mới rồi mới thử lại.
- Trạng thái có `restartCountInWindow`, `flapping`, `nextRestartAt`, `lastExitAt` và `lastExitReason` để Panel giải thích tình trạng.
- Restart thủ công vẫn hoạt động như cũ và không thay đổi cài đặt ON/OFF của nhóm.

## 3. Worker pool

- Worker khởi động lỗi, thoát bất ngờ hoặc timeout đều được tính vào rolling crash window.
- Thay worker dùng backoff mặc định 1, 2, 4, 8, 16 rồi tối đa 30 giây.
- Quá 5 crash trong 60 giây, circuit breaker tạm dừng pool; task đang chờ bị từ chối rõ ràng thay vì giữ Promise vô hạn. Task mới trong thời gian circuit mở cũng nhận lỗi có thể xử lý.
- Pool chỉ tạo worker khi có tác vụ, không tự dựng sẵn worker idle.
- Worker trả kết quả lỗi nghiệp vụ `{ ok:false }` không tự động restart worker vì bản thân worker vẫn sống.

Có thể điều chỉnh:
- `JT_WORKER_MAX_RESTARTS`
- `JT_WORKER_RESTART_WINDOW_MS`
- `JT_WORKER_RESTART_DELAY_MS`
- `JT_WORKER_RESTART_MAX_DELAY_MS`
- `JT_WORKER_CIRCUIT_COOLDOWN_MS`

## 4. Supabase retry

- Sync đọc dữ liệu tiếp tục dùng exponential backoff sẵn có và giữ giới hạn 5 phút.
- Mỗi bản ghi ghi thất bại có lịch retry riêng; không nhân bản cùng một mutation vào hàng đợi.
- Retry ghi bắt đầu sau 5 giây, tiếp theo tăng 10, 20, 40 giây... và tối đa 5 phút.
- Bản ghi mới hơn cùng khóa vẫn thay thế mutation retry cũ; thao tác ghi theo cùng một row tiếp tục được serialize.
- Manual `flushRetry()` vẫn cho phép buộc chạy ngay; timer và chu kỳ nền chỉ chạy khi đến `nextRetryAt`.

Có thể điều chỉnh:
- `JT_SUPABASE_RETRY_BASE_MS`
- `JT_SUPABASE_RETRY_MAX_MS`

## 5. Tài nguyên và giới hạn an toàn

Panel tính trạng thái từ:
- RAM RSS so với giới hạn cgroup/host, mặc định cảnh báo 80%, nghiêm trọng 92%.
- Event loop P95, mặc định cảnh báo 250 ms và nghiêm trọng 1.000 ms.
- CPU tiến trình, mặc định cảnh báo từ 85%.
- Job/worker queue gần ngưỡng backpressure 75%.
- Database lỗi cấu hình hoặc có bản ghi chờ retry.

Đây là cảnh báo và thông tin chẩn đoán. **Không tự kill tiến trình, không tự xóa cache/dữ liệu, không tự đổi database, không tắt nhóm, không thay đổi `bot_enabled`, không restart tiến trình chỉ vì CPU/RAM cao.** Việc tự restart chỉ do các supervisor hiện có khi listener handshake hoặc bot process thực sự thất bại và vẫn chịu giới hạn crash window.

## 6. Giới hạn xác minh

- Panel chỉ lấy được recovery snapshot của bot con khi bot đang đăng nhập và bridge phản hồi; bot offline được hiển thị là chưa kết nối, không bị kết luận là khỏe.
- Thông số RAM cgroup phụ thuộc file cgroup có sẵn trên host. Khi không đọc được, dashboard dùng RAM host làm mẫu thay thế và ghi rõ nguồn.
- Mọi trạng thái là snapshot tại thời điểm kiểm tra; không thay thế giám sát ngoài tiến trình hoặc alert push.
- Các tác vụ chờ trong worker circuit open được từ chối rõ ràng; chúng không tự được replay sau cooldown. Caller/command có thể thử lại an toàn khi phù hợp.

