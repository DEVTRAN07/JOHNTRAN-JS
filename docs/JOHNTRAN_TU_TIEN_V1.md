# JOHNTRAN – Tiên Đạo Vô Hạn (V3)

## Hướng game
V3 tập trung hoàn toàn vào hành trình tu luyện cá nhân, đột phá cảnh giới và Cửu Trọng Thiên Kiếp. Không có lập tông môn, linh thú hoặc bí cảnh.

## Lệnh
- `/tutien batdau`: lập mệnh đăng, tạo nhân vật.
- `/tutien profile`: xem mệnh bàn, cảnh giới, tu vi và chỉ số.
- `/tutien tuluyen`: nhập định, tụ khí, vận chu thiên và nhận tu vi; hồi chiêu 30 giây.
- `/tutien dotpha`: dựng trận, nghịch chuyển linh lực và thử đột phá; cần đủ tu vi, 20 linh thạch.
- `/tutien dotkiem`: vượt Cửu Trọng Thiên Kiếp tại Độ Kiếp Cửu Trọng; cần đủ tu vi, 80 linh thạch.
- `/tutien help`: xem hướng dẫn.

## Hiệu ứng chat thật (không dùng ảnh)
- Dùng API `sendTypingEvent(threadId, type)` có sẵn trong `vendor/zalo-client/dist/api/sendTypingEvent` để bật tín hiệu đang nhập của Zalo trước từng giai đoạn.
- Bot gửi các thông điệp diễn biến theo từng pha; mỗi pha có tín hiệu đang nhập trước khi xuất hiện.
- Tu luyện có 3 pha: nhập định → tụ khí → vận chu thiên → kết quả và thanh tiến trình ký tự.
- Đột phá có 3 pha: dựng trận → nghịch chuyển linh lực → kim đan chấn động → kết quả.
- Độ kiếp có 4 pha: mây kiếp → đệ nhất lôi → đệ ngũ lôi → đệ cửu lôi → kết quả thành tiên/thất bại.
- Bắt đầu game có các pha dò căn cốt, khai mở linh khí và ghi danh Tiên Lục.
- Hồ sơ có các pha kết nối mệnh đăng và đọc kinh mạch.
- Pipeline của bot vẫn thả reaction xử lý và reaction kết quả như các lệnh khác.

## Giới hạn Zalo cần nói rõ
Zalo client hiện có typing-event và send-message; không có API sửa nội dung bong bóng tin đã gửi. Vì vậy hiệu ứng thực tế là typing indicator + chuỗi thông điệp chat nối tiếp, không phải chữ chạy trong cùng một tin, không phải HTML/CSS animation hoặc ảnh GIF. Nếu typing endpoint lỗi/không khả dụng, bot vẫn gửi các bước bằng văn bản.

## Dữ liệu và tương thích
- Tiến trình vẫn lưu trong `Users.data.tuTien`; những trường người dùng khác không bị thay đổi.
- Dữ liệu V1/V2 được migrate sang version 3, giữ cảnh giới, tu vi, linh thạch và chỉ số; xóa dữ liệu pet/bí cảnh cũ trong namespace tuTien theo yêu cầu bỏ các hệ thống đó.
- Không thêm dependency; không sửa lệnh cũ; không gọi API ngoài.
- Chưa có live smoke test trên tài khoản Zalo production.
