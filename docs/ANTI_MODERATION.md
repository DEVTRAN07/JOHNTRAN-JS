# Anti moderation cho nhóm Zalo

Bốn lệnh mới chỉ cho phép **trưởng nhóm hoặc phó nhóm** bật/tắt. Bot kiểm tra quyền bằng getGroupInfo và từ chối khi API không xác minh được vai trò.

| Lệnh | Cơ chế |
|---|---|
| **/antinude on/off** | Quét ảnh chat.photo bằng OpenAI omni-moderation-latest và chỉ xử lý khi điểm sexual đạt ngưỡng mặc định 0.90. Khi xác nhận vi phạm, bot thử xóa ảnh và kick người gửi. |
| **/antirecall on/off** | Bật/tắt cơ chế thu hồi sẵn có (anti_undo), dùng cache tin nhắn để khôi phục chữ, ảnh, video, voice, sticker và tệp ở các loại Zalo mà handler hỗ trợ. |
| **/antilink on/off** | Chặn link mời nhóm Zalo khác (zalo.me/g/...) và URL Zalo scanURL đánh dấu không an toàn. Link thường được scanner xác nhận an toàn vẫn gửi được. Khi scanner lỗi, bot không tự xóa link thường. |
| **/antispam on/off** | Tính theo từng thành viên; khi có hơn 5 sticker trong 4 giây, bot thử xóa loạt sticker vừa gửi và cảnh báo, không tự kick. |

## Cấu hình AI cho antinude

Thêm biến môi trường trên Render hoặc môi trường chạy bot:

~~~env
OPENAI_API_KEY=your_openai_api_key
JT_ANTINUDE_SEXUAL_THRESHOLD=0.90
~~~

api.openai.com đã được thêm vào allowlist outbound của core/http. Không ghi API key trực tiếp vào Git.

**Lưu ý quyền riêng tư và an toàn:** khi antinude chạy, URL ảnh được gửi tới OpenAI Moderation để phân loại. Không dùng endpoint omni-moderation-latest để gửi nội dung đã biết hoặc nghi ngờ là tài liệu xâm hại tình dục trẻ em; tài liệu OpenAI yêu cầu không gửi loại nội dung đó tới model này. Chỉ bật khi chấp nhận luồng xử lý ảnh này.

Không thể cam kết xử lý đúng 0,5 giây: thời gian tải ảnh của Zalo, gọi model và quyền xóa/kick phụ thuộc mạng và trạng thái nhóm. Bot bắt đầu kiểm tra ngay khi nhận ảnh, đặt timeout 8 giây và chỉ xóa/kick sau khi model trả về điểm đủ cao. Nếu AI lỗi hoặc timeout, bot không tự kick.

## Kiểm thử

~~~bash
npm test
~~~

Antirecall chỉ khôi phục được nội dung đã vào cache trước khi sự kiện thu hồi đến; không thể bảo đảm 100% với tin cũ trước lúc bot bật, media hết hạn hoặc loại nội dung Zalo không cung cấp cho API.
