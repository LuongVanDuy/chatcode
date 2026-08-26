# ChatCode Cá Nhân

Ứng dụng desktop làm cầu nối giữa **ChatGPT** và các dự án trên máy của bạn qua MCP. Ứng dụng không chứa AI chat riêng, không gọi OpenAI API và không cần OpenAI API key.

**ChatGPT → HTTPS / Cloudflare Tunnel → MCP cục bộ → dự án trên máy**

## v0.3

- Giao diện tiếng Việt, bố cục sáng và dễ đọc hơn.
- Thêm thư mục local thành các dự án độc lập.
- Đọc/tìm kiếm được bật mặc định.
- Quyền riêng cho từng dự án: ghi file, xóa/đổi tên, chạy tác vụ, Git stage/commit.
- Chặn `.env`, `.ssh`, private key và credentials.
- MCP chỉ listen ở `127.0.0.1:47820`.
- Hỗ trợ 2 kiểu Cloudflare:
  - **Domain riêng**: nhập domain + Tunnel Token/Key.
  - **Quick Tunnel**: không cần cấu hình, dùng URL `trycloudflare.com` tạm thời.
- Tunnel Token được lưu bằng Electron `safeStorage` (Windows DPAPI khi khả dụng).
- App chỉ báo **Đã kết nối** sau khi kiểm tra `https://<domain>/health` thực sự truy cập được MCP.
- MCP URL có secret path riêng và có thể rotate.
- Không telemetry, không license server.

## Cấu hình domain Cloudflare riêng

Cách khuyến nghị là dùng một **remotely-managed Cloudflare Tunnel**.

1. Trong Cloudflare Dashboard, tạo/chọn một Tunnel.
2. Thêm Published Application cho hostname, ví dụ `mcp.example.com`.
3. Service URL đặt thành:

```text
http://localhost:47820
```

4. Lấy Tunnel Token của tunnel (chuỗi thường bắt đầu bằng `eyJ...`).
5. Trong ChatCode Cá Nhân → **Kết nối** → **Domain của tôi**:
   - Domain: `mcp.example.com`
   - Tunnel Token / Key: dán token hoặc cả lệnh có `--token`.
6. Bấm **Lưu & Kết nối**.

Ứng dụng sẽ chạy:

```text
cloudflared tunnel run --token <TOKEN>
```

Sau đó tự kiểm tra domain qua HTTPS. Chỉ khi endpoint `/health` trả về đúng dịch vụ, trạng thái mới chuyển thành **Đã kết nối**.

> Tunnel Token cho phép chạy tunnel của bạn. Không commit token vào Git và không gửi cho người khác. Ứng dụng chỉ lưu bản mã hóa trong dữ liệu người dùng của Windows.

## Kết nối với ChatGPT

1. Thêm ít nhất một dự án.
2. Kết nối Cloudflare thành công.
3. Sao chép **URL MCP** trong ứng dụng.
4. Trong ChatGPT, tạo/thêm custom MCP app/connector và dán URL.
5. Trong chat, yêu cầu ChatGPT dùng ChatCode Cá Nhân để liệt kê hoặc làm việc với dự án.

Hãy giữ ứng dụng chạy khi ChatGPT đang truy cập máy.

## MCP tools

- `list_projects`
- `list_files`
- `search_project`
- `read_file` / `read_files`
- `write_file`
- `delete_file` / `rename_file`
- `run_task`
- `git_status` / `git_diff`
- `git_stage` / `git_commit`

## Chạy từ source

Cài Node.js 24+, sau đó:

```powershell
npm install
npm start
```

## Build installer Windows

```powershell
npm install
npm run test:syntax
npm run test:mcp
npm run dist:win
```

Installer NSIS nằm trong `dist/`. GitHub Actions cũng build và smoke-test MCP/Quick Tunnel trên Windows.

## Mô hình quyền

- **Đọc** — list/search/read và Git status/diff; luôn bật.
- **Ghi file** — tạo hoặc thay nội dung file văn bản.
- **Quản lý file** — xóa, đổi tên, di chuyển file.
- **Tác vụ** — chạy allow-list các lệnh phát triển thông dụng.
- **Ghi Git** — stage đường dẫn cụ thể và tạo commit local. Không có tool push.

Mọi đường dẫn đều bị giới hạn trong root của dự án đã chọn.

## Phần còn thiếu so với ChatCode đầy đủ

Hiện search vẫn dựa trên tên file/nội dung. Milestone lớn tiếp theo là **Project Brain** thực sự: index symbol/import/reference bền vững cho codebase lớn, sau đó là diff approval UI và auto-update có chữ ký.