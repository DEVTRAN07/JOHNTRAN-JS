# Lệnh STK Discord 200 khung

Lệnh STK cũ đã được thay bằng luồng tương thích với module Python người dùng cung cấp. Bot chỉ công khai lệnh `stk dis`; các nhánh lệnh `list/find/random` cũ không còn là cách dùng STK.

## Cách sử dụng

1. Gửi ảnh, sticker, GIF hoặc video vào Zalo.
2. Reply đúng tin media đó.
3. Gõ `/stk dis 1` đến `/stk dis 200` (prefix thực tế lấy từ cấu hình bot).
4. Gõ `/stk dis` để gửi ảnh menu `data/discord_decor/menu.jpg`.

Khi không reply media, bot thử lấy avatar Zalo của người gửi lệnh. Nếu media reply bị 404, bot thử dùng avatar của chủ tin được reply, tương tự Python.

## Cách ghép

- Canvas đầu ra: 288×288.
- Ảnh gốc: crop vuông ở giữa, resize 240×240, mask tròn.
- Vị trí ảnh gốc: (24,24).
- Khung Discord được ghép phía trên avatar.
- APNG/GIF/WebP động và video được giữ chuyển động (tối đa 5 giây).
- Đầu ra WebP được giảm chất lượng theo từng mức, giới hạn 512 KB.
- Tác vụ chạy trong hàng đợi sticker; bot gửi trạng thái `⏳` rồi phản hồi kết quả và reaction `✅` nếu API Zalo hỗ trợ.

## Cài tài nguyên bắt buộc

Sao chép ảnh khung từ thư mục `discord_decor` của bản Python sang `data/discord_decor/` trong repo. Tên file chuẩn nằm trong `core/data/stkDiscord200.json`. Có thể giữ tên thay thế dạng `<ID>_ten.png`, `<ID>_ten.gif` hoặc `<ID>_ten.webp`; ID phải trùng số thứ tự.

Cần đủ:

- `menu.jpg`
- 200 file khung theo danh sách metadata

Kiểm tra sau khi sao chép:

```bash
npm run check:stk-assets
```

Lệnh sẽ báo tổng số file có sẵn và liệt kê tất cả ID còn thiếu. Nếu `menu.jpg` thiếu, `stk dis` gửi hướng dẫn dạng text thay vì ảnh. Nếu file khung của ID được chọn thiếu, bot báo chính xác tên file cần thêm.

**Trạng thái repo hiện tại:** catalog 200 metadata và công cụ kiểm tra đã được thêm, nhưng 200 ảnh khung cùng `menu.jpg` chưa có trong Git repo. Vì vậy phần render đã được CI kiểm thử bằng ảnh fixture; việc gửi khung thật trên Zalo chỉ hoạt động sau khi thêm bộ ảnh nguồn.
