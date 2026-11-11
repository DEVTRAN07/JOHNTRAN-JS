# JOHNTRAN – Tiên Đạo Vô Hạn (V2)

## Mục tiêu
Game nhập vai tu tiên chạy trực tiếp trong chat Zalo, dùng chung tài khoản Users hiện có. V2 bổ sung thẻ hình ảnh do Canvas worker nội bộ render, bí cảnh, linh thú và Cửu Trọng Thiên Kiếp. Không thêm dependency ngoài.

## Lệnh
- `/tutien batdau`: tạo nhân vật lần đầu.
- `/tutien profile` hoặc `/tutien the`: render thẻ hồ sơ tu sĩ.
- `/tutien tuluyen`: hấp thu linh khí, hồi chiêu 30 giây; gửi cảnh tu luyện kèm ảnh.
- `/tutien dotpha`: đột phá cảnh giới thông thường, tiêu hao 20 linh thạch.
- `/tutien bicanh`: thám hiểm bí cảnh (hồi chiêu 60 giây).
- `/tutien linhthu`: xem danh sách linh thú.
- `/tutien linhthu chon <số>`: chọn linh thú hộ đạo.
- `/tutien linhthu choan`: cho linh thú ăn, tiêu hao 15 linh thạch và nhận EXP.
- `/tutien dotkiem`: vượt Cửu Trọng Thiên Kiếp ở Độ Kiếp Cửu Trọng.

## Cơ chế V2
- Giữ nguyên tiến trình V1; normalize/migrate dữ liệu cũ sang version 2 và thêm inventory/pet/discovery.
- Bí cảnh tạo các sự kiện: linh tuyền, yêu thú, linh thú hoang và rương cổ. Kết quả do engine xác định và được lưu vào Users trước khi gửi thẻ.
- Linh thú: Vân Hồ, Lôi Điểu, Huyền Quy, Bạch Hổ và Chu Tước. Linh thú hộ đạo cộng chỉ số công/thủ; cho ăn để tăng cấp.
- Độ Kiếp Cửu Trọng là hành động riêng, không cho dùng đột phá thường để vượt cấp. Thắng sẽ mở Chân Tiên; thất bại gây hao tổn nhưng không xóa nhân vật.
- Canvas card được render bằng `core/workers/canvasWorker.js` thông qua `core/workerPool.js`. Ảnh gồm thẻ hồ sơ, cảnh tu luyện, đột phá, kết quả bí cảnh, linh thú và thiên kiếp.
- Nếu worker/Canvas render lỗi, bot vẫn gửi nội dung văn bản thay thế.

## An toàn và hiệu năng
- Tiến trình lưu trong namespace `Users.data.tuTien`, không ghi đè trường dữ liệu khác.
- Khóa theo UID trong process để chống cập nhật đồng thời trong cùng tiến trình.
- Không thêm API mạng cho game, không thêm package, không sửa các lệnh cũ.
- Render ảnh chạy trong worker pool hiện có, không chặn event loop chính và không dùng lane sticker/music.
- File ảnh tạm được lên lịch xóa sau khi gửi.

## Kiểm thử và giới hạn
- Unit tests cho tiến trình, cooldown, bí cảnh, linh thú, chuyển cấp, đột phá và độ kiếp.
- Canvas worker có test xác nhận ảnh hồ sơ là PNG hợp lệ.
- Chưa thể thực hiện live smoke test trên tài khoản Zalo ở môi trường GitHub connector; cần xác nhận thực tế API upload attachment/hiển thị ảnh khi deploy.
- Hiệu ứng hiện tại là ảnh thẻ tĩnh + chuỗi tin nhắn/reaction. Không giả định Zalo hỗ trợ animation HTML/CSS trong khung chat.
