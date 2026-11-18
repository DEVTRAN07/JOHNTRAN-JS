# Lệnh STK Discord 200 khung

Lệnh STK cũ dùng catalog Discord 136 mẫu đã được thay bằng luồng tương thích với module Python người dùng cung cấp.

## Cách dùng

1. Gửi ảnh, sticker, GIF hoặc video vào Zalo.
2. Reply đúng tin media đó.
3. Gõ `/stk dis 1` đến `/stk dis 200` (prefix thực tế lấy từ cấu hình bot).
4. Gõ `/stk dis` để gửi ảnh menu `data/discord_decor/menu.jpg`.

Khi không reply media, bot thử lấy avatar Zalo của người gửi lệnh. Nếu media reply trả 404, bot thử dùng avatar của chủ tin được reply, tương tự Python.

## Cách ghép

- Canvas đầu ra: 288×288.
- Ảnh gốc: crop vuông giữa, resize 240×240, mask hình tròn.
- Vị trí ảnh gốc: (24,24).
- Khung Discord được ghép đè lên toàn canvas.
- APNG/GIF/WebP động và video được giữ chuyển động, tối đa 5 giây.
- WebP được nén theo nhiều mức chất lượng, giới hạn 512 KB.
- Tác vụ chạy trong hàng đợi sticker; bot phản hồi trạng thái và reaction ⏳/✅ khi API Zalo hỗ trợ.

## Tài nguyên bắt buộc

Đặt `menu.jpg` và các file khung vào `data/discord_decor/`. Danh sách tên file, ID, tên hiển thị và icon nằm tại `core/data/stkDiscord200.json`.

Hiện repo chỉ có catalog 200 metadata và README thư mục; **200 ảnh khung và menu.jpg chưa được đính kèm vào repo**. Thiếu file sẽ được báo cụ thể khi chạy lệnh.
