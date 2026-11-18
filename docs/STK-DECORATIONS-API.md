# Lệnh STK Discord — tải tài nguyên từ raw GitHub

STK dùng catalog nhẹ nằm trong bot và lấy ảnh từ kho công khai:

- Repository: https://github.com/DEVTRAN07/Discord-decor
- Raw URL: https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main/
- Kho có đủ menu.jpg và 200 file khung PNG.

## Cách sử dụng

1. Gửi ảnh, sticker, GIF hoặc video vào Zalo.
2. Reply đúng tin media đó.
3. Gõ /stk dis 1 đến /stk dis 200 (prefix thực tế lấy từ cấu hình bot).
4. Gõ /stk dis để gửi ảnh menu.

Khi không reply media, bot thử lấy avatar Zalo của người gửi lệnh. Nếu media reply bị 404, bot thử dùng avatar của chủ tin được reply, tương tự Python.

## Cơ chế tải ảnh và cache

- Bot không chứa 200 ảnh trong repository.
- /stk dis chỉ tải menu.jpg.
- /stk dis N chỉ tải file PNG của ID N, không tải toàn bộ kho.
- Ảnh được lưu ở cache/stk-discord/ và dùng lại trong các lần sau.
- Cache mặc định có thời hạn 7 ngày; sau thời hạn đó bot thử cập nhật từ raw GitHub.
- Nếu raw GitHub tạm thời lỗi nhưng cache cũ còn hợp lệ, bot tiếp tục dùng cache.
- Có thể đổi nguồn raw bằng biến môi trường STK_DISCORD_RAW_BASE_URL.
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
- Tác vụ chạy trong hàng đợi sticker; bot gửi trạng thái ⏳ rồi phản hồi kết quả và reaction ✅ nếu API Zalo hỗ trợ.
