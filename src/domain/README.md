# Domain layer

Đặt business rules thuần theo miền:
- groups/: bật/tắt bot, quyền và cấu hình nhóm.
- users/: quyền, hồ sơ và trạng thái người dùng.
- games/: luật chơi và state transition không phụ thuộc Zalo.
- moderation/: quyết định chống spam/link/thu hồi.

Domain service không import Zalo SDK, Express, filesystem hoặc Supabase. Adapter trong core/ và plugins/ gọi domain service rồi chuyển kết quả thành phản hồi Zalo. Chỉ chuyển từng miền sau khi có test tương thích với plugin cũ.
