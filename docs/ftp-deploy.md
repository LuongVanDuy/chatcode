# Deploy FTP bằng danh sách file

Bộ mẫu chạy độc lập với phiên bản ChatCode đang cài, dùng Windows PowerShell 5.1 và `curl.exe` có sẵn trên Windows. Không cần Node.js, không sinh lại lệnh FTP cho từng task.

## Cài một lần cho mỗi project

Copy `tools/deploy-ftp.ps1` vào `<project>/.chatcode/deploy-ftp.ps1`. Tạo `<project>/.chatcode/ftp-files.json`:

```json
{
  "files": [
    "wp-content/themes/bricks-child/functions.php",
    "wp-content/themes/bricks-child/assets/css/promotion.css"
  ]
}
```

File mẫu đầy đủ: `tools/ftp-files.example.json`. Mỗi phần tử là đường dẫn tương đối tính từ root project; dùng dấu `/`. Dùng tên file cụ thể, không dùng wildcard, thư mục hoặc lệnh shell. Danh sách hỗ trợ tối đa 500 file và loại trùng, không âm thầm cắt bớt.

## Lệnh cố định cho AI

Từ root project, chỉ cập nhật `files` theo các file vừa sửa và đã kiểm tra, rồi chạy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .chatcode\deploy-ftp.ps1
```

Kiểm tra danh sách trước, không kết nối mạng:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .chatcode\deploy-ftp.ps1 -DryRun
```

Nếu chạy từ thư mục khác, truyền đường dẫn tuyệt đối tới script. Root mặc định luôn là thư mục cha của `.chatcode`, không phụ thuộc thư mục terminal hiện tại. Có thể chỉ định `-ProjectRoot` và `-Manifest` khi dùng bản chung trong repository.

Thử kết nối đầy đủ, không đụng file của website:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .chatcode\deploy-ftp.ps1 -Probe
```

Probe tạo một file văn bản tên ngẫu nhiên, upload, tải về so SHA-256, chạy lại để kiểm tra nhận diện nội dung không đổi, rồi xóa chính file thử và xác nhận không còn trên FTP.

## Cách đọc kết quả

- `ok:true`, exit code `0`: các file yêu cầu đã được xác nhận bằng SHA-256; `uploaded` hoặc `unchanged`. Dry-run chỉ trả `planned`, không phải đã deploy.
- `ok:false`, exit code `2`: đọc `files[].error`, `not_attempted`, `cleanup_warnings`. Không báo website đã cập nhật đầy đủ.
- Sửa nguyên nhân rồi chạy lại cùng manifest. Runner tải bản remote để so hash, bỏ qua file đã đúng; không cần áp lại patch, viết lệnh curl hoặc mở task mới chỉ để retry FTP.
- Gửi kết quả deploy về task đang làm. Runner không tự chốt Work Session của ChatCode; nếu session còn active, cần chốt trạng thái bằng công cụ của app. Không dùng thành công FTP để bỏ qua kiểm thử code.

## Hành vi và giới hạn

Đọc cấu hình duy nhất từ `.vscode/sftp.json`: `protocol:ftp`, host, port, username, password, remotePath, passive và secure. `remotePath` phải là đường dẫn FTP tuyệt đối. Hỗ trợ FTP và FTPS qua `secure:true`/`explicit`/`implicit`; không giả định SFTP là FTP. Không in credential hay đưa mật khẩu vào tham số tiến trình. Giữ kiểm tra chứng chỉ TLS.

Đây là deploy được gọi rõ ràng, không phụ thuộc `uploadOnSave`. Script không bật watcher. Thiếu file local gây lỗi trước khi kết nối, không kích hoạt `autoDelete`. Các đường dẫn `.vscode`, `.git`, `.chatcode`, `.env*`, `wp-config.php`, đường dẫn vượt root và symlink/junction bị từ chối.

Runner chụp nội dung local, so bản remote, upload thành file tạm cạnh đích, tải lại để so hash, đổi tên sang đích rồi kiểm tra bản cuối. Server phải cho phép đọc, ghi, đổi tên và dọn file tạm. Không xóa file đích để ép rename thành công. Nếu server không cho rename ghi đè, báo lỗi và giữ bản cũ. Việc publish theo từng file, không phải transaction cho cả website; nên tránh hai tác vụ cùng sửa/deploy một file đồng thời.

Mỗi request mặc định tối đa 45 giây, kết nối tối đa 10 giây, mỗi file tối đa hai lượt thử cho nhóm lỗi mạng tạm thời. Có thể đặt `-TimeoutSec` (5–300) và `-MaxAttempts` (1–3). Sai xác thực, lỗi hash và lỗi file không retry mù. Dừng khi gặp file thất bại; báo những file chưa thử.

SHA-256 xác nhận nội dung file qua FTP. Sau deploy, AI vẫn phải kiểm tra hành vi trang, cache và dữ liệu WordPress phù hợp với task; không dùng HTTP 200 làm bằng chứng duy nhất.

## Kiểm thử

`npm run test:ftp-runner` chạy PowerShell/curl thật với FTP server giả lập trên loopback. Bao gồm thiếu file, đường dẫn bị chặn, UTF-8, escaping mật khẩu, thư mục mới, kiểm tra hash trước publish, retry mạng, sai mật khẩu, chạy lại không upload thừa và dọn probe. Bộ test không đọc credential hoặc ghi lên FTP production.

Ngày 09/09/2026 đã thử `-Probe` thành công trên cấu hình FTP của `mimo.duyanhweb.org`: upload, so hash, nhận diện file không đổi và cleanup; 8 request curl trong khoảng 3 giây. Đây không phải benchmark cho mọi dung lượng/server. FTPS cần kiểm thử thêm trên server dùng TLS thực tế.
