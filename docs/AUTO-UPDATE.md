# Tự cập nhật JOHNTRAN-JS trên Mac và Android

## Cài đặt lần đầu

Updater yêu cầu thư mục dự án được tạo bằng Git clone, không phải thư mục tải từ nút Download ZIP.

```bash
git clone https://github.com/DEVTRAN07/JOHNTRAN-JS.git
cd JOHNTRAN-JS
npm ci
```

Giữ `.env`, `config.yml`, `account.json`, `cookie.json` và `data/` theo cấu hình riêng của từng máy. Không sao chép `node_modules` hay addon Rust đã build từ Mac sang Android.

## Cập nhật khi bot đang chạy

Khởi động bằng supervisor:

```bash
npm start
```

Từ tài khoản admin bot (role 2), gửi lệnh Zalo:

```text
/update
```

Supervisor sẽ dừng tiến trình bot con trước khi thay đổi file, fetch `origin/main`, chỉ fast-forward, giữ nguyên dữ liệu cục bộ, chạy `npm ci` chỉ khi `package.json` hoặc `package-lock.json` đổi, build sticker Rust addon nếu mã nguồn addon đổi và máy có Cargo/N-API CLI, sau đó tự khởi động lại bot.

Lệnh chỉ hoạt động trong chế độ chạy `npm start` thông thường, không phải chạy trực tiếp `JohnTran.js` hoặc bot con do Panel quản lý.

## Cập nhật khi bot đã tắt

```bash
npm run update
npm start
```

`npm run update` chỉ cập nhật code và dependency; lệnh này không tự chạy tiến trình bot mới.

## Android (Termux)

```bash
pkg update
pkg install git nodejs-lts
git clone https://github.com/DEVTRAN07/JOHNTRAN-JS.git
cd JOHNTRAN-JS
npm ci
npm start
```

Kiểm tra Node.js đáp ứng yêu cầu trong `package.json` (Node >=20.18).

## iPhone

iPhone có thể gửi `/update` qua Zalo để yêu cầu máy Mac hoặc Android đang chạy bot cập nhật. iPhone không phù hợp làm máy chủ Node.js chạy bot liên tục trong nền.

## Bảo vệ dữ liệu và điều kiện

- Updater chỉ chấp nhận remote `DEVTRAN07/JOHNTRAN-JS`, nhánh local `main`, và thao tác fast-forward.
- Nếu có thay đổi local chưa commit hoặc commit local chưa push, updater dừng và không ghi đè file.
- `.env`, `data/`, tài khoản/cookie và file Git-ignore không bị thay thế bởi Git update.
- Các file đang được Git theo dõi, như `config.yml`, nếu đã sửa local thì updater sẽ dừng để bạn xử lý thay đổi trước.
- Nếu `npm ci` thất bại, updater cố gắng rollback mã nguồn về commit cũ và khôi phục dependency cũ.
- Đây là cập nhật theo lệnh, không tự tải/ghi code mỗi lần mở app; tránh cập nhật bất ngờ khi mạng hoặc GitHub không sẵn sàng.
