# JOHNTRAN – Tiên Đạo Vô Hạn (V4)

## Hướng game
V4 tập trung vào tu luyện cá nhân, một con đường thăng cảnh giới duy nhất bằng Độ Kiếp, và hệ thống nhiệm vụ của một tông môn cố định. Không có lệnh đột phá riêng, không có lập tông môn, linh thú hoặc bí cảnh.

## Nhân vật Zalo
- Lần đầu dùng `/tutien batdau`, bot gọi API `getUserInfo(uid, 240)` của `zalo-client`.
- Lưu `displayName` và URL `avatar` trong `Users.data.tuTien`; fallback sang tên/avatar của event nếu API hồ sơ không trả dữ liệu.
- Hồ sơ nhân vật hiển thị tên Zalo và trạng thái đồng bộ avatar. URL avatar được lưu cùng nhân vật, không gửi ảnh trong hiệu ứng chat.

## Tông môn cố định
- Chỉ tồn tại một tông môn: `DEVTRAN TIÊN TÔNG` với ID cố định `devtran-tien-tong`.
- Tông Chủ là admin đầu tiên trong `global.users.admin`, nạp từ `admin_bot` trong `config.yml`.
- Mọi nhân vật được tự động gắn vào tông môn này; không có lệnh gia nhập, đổi tông hoặc tạo tông môn khác.
- `/tutien tongmon` hiển thị thông tin Tông Chủ và số môn đồ.

## Lệnh
- `/tutien batdau`: lập nhân vật theo tên và avatar Zalo.
- `/tutien profile`: xem hồ sơ, cảnh giới, tu vi, linh thạch thường và linh thạch tông môn.
- `/tutien tuluyen`: tu luyện thường, hồi chiêu 30 giây; mỗi lần thành công tăng tu vi, linh thạch thường và tiến độ nhiệm vụ.
- `/tutien dotkiem`: con đường duy nhất để thăng tầng/cảnh giới. Tiểu thiên kiếp cho từng tầng; đại thiên kiếp khi chuyển đại cảnh giới; Cửu Trọng Thiên Kiếp để bước vào Chân Tiên.
- `/tutien tongmon`: xem Tông Môn DEVTRAN duy nhất.
- `/tutien nhiemvu`: xem nhiệm vụ hằng ngày.
- `/tutien nhiemvu diem-danh`: hoàn thành nhiệm vụ điểm danh hằng ngày.
- `/tutien nhiemvu nhan`: nhận toàn bộ thưởng nhiệm vụ đủ điều kiện.
- `/tutien luyennhanh`: tiêu 30 linh thạch tông môn để nhận 100+ tu vi; hồi chiêu 60 giây.
- `/tutien help`: hướng dẫn.

## Nhiệm vụ tông môn và linh thạch
Nhiệm vụ reset theo ngày UTC+7:
- Điểm danh tiên môn: 20 linh thạch tông môn.
- Tu luyện 3 lần: 35 linh thạch tông môn.
- Tu luyện 6 lần: 70 linh thạch tông môn.

Thưởng được ghi vào số dư riêng `sectStones`, không trộn với linh thạch thường. Lệnh luyện nhanh chỉ tiêu `sectStones`, và lượt luyện nhanh không tự tăng tiến độ nhiệm vụ để tránh vòng lặp tự farm.

## Hiệu ứng Zalo thật (không dùng ảnh)
- Mỗi pha gọi API `sendTypingEvent(threadId, type)` để hiển thị trạng thái đang nhập của Zalo.
- Sau đó gửi từng thông điệp diễn biến riêng; reaction xử lý chung của bot vẫn giữ nguyên.
- Tu luyện có các pha nhập định → tụ khí → vận chu thiên.
- Luyện nhanh có các pha kích hoạt Tụ Linh Trận → hiến tế linh thạch tông môn → tăng tốc linh khí.
- Nhiệm vụ có các pha điểm danh/kiểm duyệt công tích/chuyển linh thạch.
- Độ kiếp có tiểu kiếp, đại kiếp hoặc Cửu Trọng Thiên Kiếp tùy cấp cảnh giới.
- Không render Canvas, không gửi ảnh/GIF/video trong luồng game.
- Nếu typing endpoint lỗi/không có, bot vẫn gửi từng tin nhắn văn bản.

## Dữ liệu và tương thích
- Tiến trình lưu trong `Users.data.tuTien`; các trường dữ liệu ngoài namespace game không bị thay đổi.
- Migration giữ tên/avatar, cảnh giới, tu vi, linh thạch thường và chỉ số; trường pet/bí cảnh cũ bị loại khỏi game state.
- Cooldown cũ `lastBreakthroughAt` được chuyển thành `lastTribulationAt`.
- Không thêm dependency và không sửa các lệnh bot khác.
- Unit tests bao phủ identity, tông môn cố định, nhiệm vụ, nhận thưởng, luyện nhanh, độ kiếp và typing phases.
- Chưa thực hiện live smoke test trên tài khoản Zalo production.

## Runtime effect engine – sử dụng trong bot thật
- Module dùng trực tiếp: `core/games/tuTienEffects.js`.
- Command `plugins/commands/tutien.js` tạo một effect session cho mỗi lần chạy lệnh và chuyển mọi phản hồi qua session này.
- Trước mỗi pha, engine gọi `api.sendTypingEvent(event.threadId, event.type)`; sau đó gọi `api.sendMessage({ msg }, threadId, type)` để gửi tin thật.
- Khi bắt đầu, engine gọi `reply.working()` để reaction của tin nhắn gọi lệnh chuyển sang trạng thái đang xử lý. Khi lệnh kết thúc, pipeline `handleCommand` vẫn là nơi kết thúc reaction bằng OK hoặc CRY; không tạo hai luồng reaction tranh chấp.
- `sequence()` dùng cho hoạt cảnh nhiều pha; `phase()` dùng cho pha trung gian; `result()` gửi kết quả cuối và đóng session; `respond()` xử lý phản hồi ngắn một pha.
- Nếu typing endpoint không có hoặc lỗi, engine chỉ fallback thời gian chờ ngắn rồi vẫn gửi tin nhắn; không chặn lệnh và không làm mất kết quả.
- Độ trễ từng pha bị giới hạn tối đa 2.2 giây; engine không dùng timer nền, không gửi media và không render ảnh/GIF.
- Unit test mô phỏng API Zalo để xác nhận thứ tự typing → sendMessage, fallback khi lỗi, reaction đang chạy và lệnh thực tế được nối vào effect engine.
