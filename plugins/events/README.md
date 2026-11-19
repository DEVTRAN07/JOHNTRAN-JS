# plugins/events

Thư mục này chứa các bộ xử lý sự kiện tự động của JOHNTRAN-JS.

- `welcome.js`: nghe sự kiện thành viên JOIN và gửi Canvas chào mừng khi `event_welcome=true`.
- `bye.js`: nghe sự kiện rời nhóm và gửi thông báo tạm biệt.
- Các event khác xử lý game, guard, rank và thống kê theo cấu hình riêng.

Các lệnh để quản lý event nằm trong `plugins/commands`. Riêng lời chào thành viên mới:
- `/welcome`: xem trạng thái bằng Canvas.
- `/welcome on` / `/welcome off`: bật hoặc tắt tự động chào thành viên.
- `/welcome test`: gửi thử card Canvas.
- `/events welcome on|off` vẫn được giữ để tương thích lệnh cũ.

Event không phải lệnh người dùng gõ: nó được gọi tự động khi Zalo phát sinh sự kiện nhóm tương ứng.
