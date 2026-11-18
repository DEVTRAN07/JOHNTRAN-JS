# Discord avatar decoration assets

Lệnh mới: `/stk dis` để xem menu, sau đó reply một ảnh/sticker/GIF/video và gõ `/stk dis <1-200>`.

Đặt tài nguyên tại thư mục này:

- `menu.jpg`: ảnh menu 200 khung.
- Các file khung theo đúng tên trong `core/data/stkDiscord200.json`.
- Có thể dùng APNG/GIF/WebP để giữ chuyển động. Các file PNG động (APNG) cũng được nhận diện.

Một số ví dụ tên file:

- `1_a_3c97a2d37f433a7913a1c7b7a735d000.png`
- `11_sakura.png`
- `200_timekeepers_clock.png`

Bot ghép ảnh avatar tròn kích thước 240×240 tại vị trí (24,24) trên canvas 288×288, ghép khung Discord lên trên, xuất WebP động và giới hạn file đầu ra 512 KB.

**Lưu ý:** mã nguồn chỉ chứa danh sách 200 tên/ID. Các ảnh khung và `menu.jpg` là tài nguyên riêng, cần được đưa vào thư mục này để lệnh gửi sticker thực tế. Khi thiếu ảnh, bot báo rõ file còn thiếu thay vì gửi sticker rỗng.
