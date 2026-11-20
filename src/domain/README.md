# Domain layer

Domain chứa quy tắc nghiệp vụ thuần, không biết về Zalo SDK, HTTP, Express, filesystem, Canvas hay database.

## Đã chuyển
- groups/botState.js: xác định trạng thái bật/tắt, ngoại lệ /bot on và /bot status, tạo snapshot trạng thái nhóm.
- moderation/protectionState.js: danh sách feature Anti, đọc trạng thái boolean nghiêm ngặt và cập nhật một flag mà không mất các thiết lập khác.

## Miền tiếp theo
- games/: luật chơi thuần và state transition đặt trong domain; session map, timer và điều phối phiên chơi đặt trong src/application/games/services.
- users/: quyền và policy người dùng.
- moderation/: quyết định chống spam/link/thu hồi; tải nội dung và gọi API vẫn nằm ngoài domain.

Adapter tương thích trong core/runtime giữ nguyên đường dẫn mà plugin cũ sử dụng. Chỉ xóa adapter khi toàn bộ plugin/test đã dùng đường dẫn chuẩn và có xác nhận triển khai.
