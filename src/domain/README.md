# Domain layer

Domain chứa quy tắc nghiệp vụ thuần, không biết về Zalo SDK, HTTP, Express, filesystem, Canvas hay database.

## Đã chuyển
- groups/botState.js: xác định trạng thái bật/tắt, ngoại lệ /bot on và /bot status, tạo snapshot trạng thái nhóm. Phần policy và ánh xạ flag chạy Rust qua N-API; adapter JS giữ nguyên hợp đồng cũ.
- users/requesterGreeting.js: xác định chủ bot/admin/support và câu chào; hỗ trợ truyền config/users tường minh để test không cần khởi tạo bot. Phân loại vai trò và chuẩn hóa UID chạy Rust qua N-API; adapter JS giữ nguyên API cũ.
- moderation/protectionState.js: danh sách feature Anti, đọc trạng thái boolean nghiêm ngặt và cập nhật một flag mà không mất các thiết lập khác. Schema 21 cờ và ánh xạ trạng thái chạy Rust qua N-API; setter JS giữ nguyên kiểm tra lỗi và mutation.

## Miền tiếp theo
- games/engines/: caroEngine, noituEngine, samEngine và tlmnEngine là luật chơi thuần, không phụ thuộc Zalo, file hay network.
- src/application/games/services/: session map, timer, lobby, room và điều phối phiên chơi; gọi engine từ domain.
- Pipeline nhạc, provider mạng, cache tải, FFmpeg và upload thuộc src/application/media/music, không đưa vào domain vì đây là orchestration/I/O.
- Quy trình bật/tắt Anti, kiểm tra quyền nhóm, ghi dữ liệu và render thông báo thuộc src/application/moderation/antiToggle; domain/moderation/protectionState chỉ giữ schema và quy tắc trạng thái thuần.
- users/: quyền và policy người dùng.
- moderation/: quyết định chống spam/link/thu hồi; tải nội dung và gọi API vẫn nằm ngoài domain.

Adapter tương thích trong core/runtime giữ nguyên đường dẫn mà plugin cũ sử dụng. Chỉ xóa adapter khi toàn bộ plugin/test đã dùng đường dẫn chuẩn và có xác nhận triển khai.
