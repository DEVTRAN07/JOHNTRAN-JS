# Hệ thống Anti của JOHNTRAN-JS

Các lệnh Anti chỉ bật/tắt trong nhóm và chỉ trưởng nhóm hoặc phó nhóm đã được Zalo xác minh mới được thay đổi trạng thái. Cấu hình được lưu theo từng nhóm.

| Lệnh | Chức năng | Ghi chú |
|---|---|---|
| `/anti` | Hiển thị toàn bộ trạng thái bảo vệ | Canvas hiển thị ON/OFF |
| `/anticard` | Chặn chia sẻ danh thiếp | Dựa vào payload contact-card của Zalo |
| `/antidoodle` | Chặn nét vẽ doodle | Dựa vào loại payload được SDK trả về |
| `/antifile` | Chặn tệp đính kèm | `share.file` |
| `/antigif` | Chặn GIF | Dựa vào msgType/MIME/đuôi .gif |
| `/antiinvite` | Chặn link mời nhóm Zalo khác | Không đồng nghĩa chặn mọi URL |
| `/antijoin` | Chống spam vào/ra nhóm | Kick khi thành viên vào nhóm lần thứ 3 trong 10 phút |
| `/antilink` | Chặn URL và link mời nhóm | Bao gồm link trong payload chia sẻ đã nhận diện |
| `/antilocation` | Chặn chia sẻ vị trí | Dựa vào loại location/tọa độ trong payload |
| `/antiother` | Chặn payload không xác định/lỗi | Chỉ chặn khi Zalo đánh dấu unknown/unsupported/error |
| `/antiphoto` | Chặn ảnh | Ảnh được SDK nhận diện là photo/image |
| `/antiqr` | Chặn payload QR | Chỉ nhận QR có marker rõ trong payload; không OCR ảnh thông thường |
| `/antireaction` | Chống spam reaction | Hơn 5 reaction/10 giây; cảnh cáo 3 lần, lần 4 thử kick |
| `/antisex`, `/antinude` | AI kiểm tra ảnh nhạy cảm | Cần `OPENAI_API_KEY` |
| `/antispam` | Chống spam tin nhắn và sticker burst | Hơn 5 tin/5 giây hoặc hơn 5 sticker/4 giây |
| `/antistk` | Chặn mọi sticker | Không phụ thuộc tốc độ gửi |
| `/antistklag` | Chặn dội bom sticker | Xóa loạt sticker nhận dạng được |
| `/antitaghide` | Chặn mention ẩn/sai metadata | Dựa vào metadata mention |
| `/antivideo` | Chặn video | `chat.video.msg` |
| `/antivoice` | Chặn tin nhắn thoại | `chat.voice` |
| `/antiword` | Chặn từ/cụm từ trong danh sách | Dùng từ khóa tích hợp và `assets/spam/badwords.txt` |
| `/antirecall` | Khôi phục tin bị thu hồi | Phụ thuộc cache và loại nội dung còn hỗ trợ |

## Quy tắc cảnh cáo

Với các vi phạm nội dung (link, ảnh nhạy cảm, media, từ cấm, spam, mention ẩn và payload lỗi), bot xóa/thu hồi tin nếu API Zalo cho phép, lưu cảnh cáo theo từng nhóm và thành viên. Ba lần vi phạm đầu là cảnh cáo; vi phạm lần thứ tư mới thử kick. Nếu Zalo từ chối kick, số cảnh cáo được giữ ở 3 để thử lại khi người đó tái phạm. Anti-Reaction dùng cùng ngưỡng cảnh cáo nhưng Zalo SDK không cung cấp thao tác gỡ reaction của người khác.

## Giới hạn theo payload/API

Không phải mọi loại nội dung đều có marker nhất quán trong mọi phiên bản Zalo. Các chế độ card, doodle, GIF, location, QR, video, voice và hidden mention chỉ hoạt động khi payload thực tế chứa các trường nhận dạng tương ứng. Anti-QR không quét ảnh bằng OCR/vision; Anti-Other không đoán loại dữ liệu; cả hai tránh chặn nhầm nội dung bình thường. Anti-Recall chỉ khôi phục được nội dung có dữ liệu gốc trong cache và API gửi lại tương ứng.
