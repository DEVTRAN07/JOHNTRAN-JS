# Lệnh STK Discord — tải tài nguyên từ raw GitHub

STK dùng catalog nhẹ nằm trong bot và lấy ảnh từ kho công khai:

- Repository: https://github.com/DEVTRAN07/Discord-decor
- Raw URL: https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main/
- Kho có đủ menu.jpg và 200 file khung PNG.

## Cách sử dụng

1. Gửi ảnh, sticker, GIF hoặc video vào Zalo.
2. Reply đúng tin media đó.
3. Gõ /stk để gửi menu 200 khung.
4. Reply ảnh/sticker/GIF/video và gõ /stk 1 đến /stk 200 để ghép khung.
5. Cú pháp /stk dis đã bị gỡ.

Khi không reply media, bot thử lấy avatar Zalo của người gửi lệnh. Nếu media reply bị 404, bot thử dùng avatar của chủ tin được reply, tương tự Python.

## Cơ chế tải ảnh và cache

- Bot không chứa 200 ảnh trong repository.
- /stk chỉ tải menu.jpg.
- /stk N chỉ tải file PNG của ID N, không tải toàn bộ kho.
- Ảnh được lưu ở thư mục stk-discord trong Persistent Disk nếu JT_PERSISTENT_DIR được cấu hình; trên Render hiện khai báo mount /opt/render/project/data nên cache ở /opt/render/project/data/stk-discord.
- Khi chạy local mà không có JT_PERSISTENT_DIR, cache nằm trong cache/stk-discord/.
- Cache mặc định có thời hạn 7 ngày; sau thời hạn đó bot thử cập nhật từ raw GitHub.
- Nếu raw GitHub tạm thời lỗi nhưng cache cũ còn hợp lệ, bot tiếp tục dùng cache.
- Có thể đổi thư mục cache bằng STK_DISCORD_CACHE_DIR hoặc đổi nguồn raw bằng STK_DISCORD_RAW_BASE_URL.
- Không cần token GitHub vì repository tài nguyên là public.

Lệnh kiểm tra cấu hình/catalog:

    npm run check:stk-assets

Lệnh này kiểm tra catalog và trạng thái cache, không tải hàng loạt ảnh về máy bot.

## Cách ghép

- Canvas đầu ra: 288×288.
- Ảnh gốc: crop vuông ở giữa, resize 240×240, mask tròn.
- Vị trí ảnh gốc: (24,24).
- Khung Discord được ghép phía trên avatar.
- APNG/GIF/WebP động và video được giữ chuyển động (tối đa 5 giây).
- Đầu ra WebP được giảm chất lượng theo từng mức, giới hạn 512 KB.
- Lệnh phản hồi ngay và đưa tác vụ vào hàng đợi nền; kết quả được gửi sau khi xử lý xong.
- Khung và media được tải đồng thời; bộ mã hóa dùng tối đa hai cấu hình FFmpeg thay vì thử năm cấu hình liên tiếp.
- Phản hồi nhận lệnh được tách khỏi tác vụ nặng để trả về nhanh (mục tiêu dưới 1 giây).
- Tải media Zalo: tối đa 18 giây, không retry; tải URL media ngoài: tối đa 20 giây, không retry.
- Upload/gửi sticker và mỗi lượt FFmpeg: tối đa 20 giây; FFmpeg chỉ thử tối đa hai cấu hình.
- Không thể bảo đảm sticker hoàn tất dưới 1 giây vì còn thời gian mạng, encode và upload/send qua máy chủ Zalo.
