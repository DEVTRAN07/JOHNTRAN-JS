# JOHNTRAN – Tiên Đạo Vô Hạn (V1)

## Mục tiêu
Game nhập vai tu tiên chạy trực tiếp trong chat Zalo, dùng chung hệ thống tài khoản Users hiện có. Không thêm dependency và không sửa pipeline xử lý lệnh.

## Lệnh
- `/tutien batdau`: tạo nhân vật lần đầu.
- `/tutien profile`: xem cảnh giới, tu vi, sinh lực, chỉ số và linh thạch.
- `/tutien tuluyen`: hấp thu linh khí, hồi chiêu 30 giây.
- `/tutien dotpha`: tiêu hao 20 linh thạch để thử đột phá.
- `/tutien help`: hướng dẫn.

## Cơ chế V1
- Tiến trình lưu trong `Users.data.tuTien`, không tạo bảng dữ liệu riêng.
- Mỗi người chơi có cảnh giới, tầng tu luyện, tu vi, linh thạch, HP, công kích và phòng ngự.
- Đột phá có xác suất thành công; thất bại làm hao tổn một phần tu vi và HP.
- Các cảnh giới: Phàm Nhân, Luyện Khí, Trúc Cơ, Kim Đan, Nguyên Anh, Hóa Thần, Luyện Hư, Hợp Thể, Đại Thừa, Độ Kiếp, Chân Tiên, Tiên Đế.
- Hiệu ứng chat theo từng pha bằng thông điệp mở cảnh và kết quả; reaction xử lý chung của bot vẫn được giữ.

## An toàn và hiệu năng
- Không gọi API ngoài, không thêm package.
- Dữ liệu game nằm trong namespace `tuTien`, không ghi đè các trường người dùng khác.
- Có khóa theo UID trong tiến trình để tránh hai lệnh tu luyện cùng người chạy đồng thời.
- Tác vụ chỉ dùng CPU nhẹ; không đụng hàng đợi sticker/media/music và không chặn worker pool.

## Giới hạn V1
- Hiệu ứng hiện tại là chuỗi tin nhắn văn bản/emoji, chưa phải ảnh động hoặc âm thanh.
- Chưa có chiến đấu, bí cảnh, linh thú, tông môn, giao dịch hay bảng xếp hạng.
- Cần kiểm thử trên tài khoản Zalo thật để xác nhận trải nghiệm gửi tin nhắn/reaction sau khi deploy.
