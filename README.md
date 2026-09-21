# Team Check-in

Ứng dụng chấm công nội bộ dùng key riêng cho từng thành viên, lưu event ledger mã hóa, bảng đối chiếu tổng thời gian và thông báo Telegram. Admin key mở khóa dữ liệu sau mỗi lần dịch vụ khởi động và mã hóa file backup.

## Triển khai trên VPS

Yêu cầu: một VPS có Docker Engine, Docker Compose plugin, domain trỏ A/AAAA record về VPS và cổng 80/443 được mở.

```bash
cp .env.example .env
openssl rand -base64 36
```

Điền password vừa sinh, domain và cấu hình Telegram vào `.env`, rồi chạy:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Truy cập domain. Vì thiết kế cho phép người truy cập đầu tiên trở thành admin, hãy hoàn thành bước khởi tạo ngay sau khi hệ thống online. Admin key chỉ hiện một lần; lưu nó trong password manager và một bản offline an toàn.

Sau khi container `app` restart, hệ thống ở trạng thái khóa. Admin mở trang và nhập admin key trước khi thành viên đăng nhập.

### Chạy bằng IP/HTTP để thử nghiệm

Không dùng cấu hình này cho production. Trong `.env` đặt:

```dotenv
SITE_ADDRESS=:80
APP_ORIGIN=http://YOUR_SERVER_IP
COOKIE_SECURE=false
```

## Telegram

1. Tạo bot với `@BotFather` và lấy token.
2. Thêm bot vào nhóm chung.
3. Gửi một tin nhắn trong nhóm, gọi `https://api.telegram.org/bot<TOKEN>/getUpdates` và lấy `chat.id` (nhóm thường có ID âm).
4. Điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` trong `.env`, sau đó chạy `docker compose up -d`.

Check-in/out vẫn thành công khi Telegram lỗi. Hệ thống giữ tin trong outbox, tự thử lại và cho admin thử lại thủ công trong trang Vận hành.

## Backup và cập nhật

Admin xuất backup mã hóa trong trang Vận hành và phải nhập lại admin key. Hãy lưu file ở vị trí tách khỏi VPS. File chỉ phục hồi được bằng admin key tương ứng.

Trước khi cập nhật image, nên có cả file backup trong ứng dụng và snapshot volume PostgreSQL:

```bash
docker compose exec -T postgres pg_dump -U checkin -d checkin > checkin-db.sql
docker compose build --pull app
docker compose up -d
```

Khôi phục snapshot PostgreSQL chỉ dành cho tình huống vận hành; chức năng Import trong web kiểm tra mã hóa và integrity chain trước khi thay dữ liệu.

## Phát triển

```bash
npm install
npm test
npm run typecheck
npm run build
```

Chạy PostgreSQL rồi đặt `DATABASE_URL`, `APP_ORIGIN=http://localhost:5173`, `COOKIE_SECURE=false`. Chạy API bằng `npm run dev` và Vite bằng `npm run dev:client`.

## Giới hạn bảo mật

- Mất admin key đồng nghĩa không thể mở khóa dữ liệu hoặc phục hồi backup.
- Mã hóa và HMAC chain phát hiện sửa/xóa từng record, nhưng không thể ngăn người có toàn quyền VPS rollback hoặc xóa toàn bộ database cùng mọi backup.
- Bản hiện tại chạy một instance ứng dụng vì data key chỉ tồn tại trong RAM của process đó.
