# ChatCode Cá Nhân

[![Latest Release](https://img.shields.io/github/v/release/LuongVanDuy/chatcode?label=release)](https://github.com/LuongVanDuy/chatcode/releases/latest)
[![Windows Build](https://github.com/LuongVanDuy/chatcode/actions/workflows/build-windows.yml/badge.svg)](https://github.com/LuongVanDuy/chatcode/actions/workflows/build-windows.yml)
[![WordPress + Bricks Skill](https://github.com/LuongVanDuy/chatcode/actions/workflows/test-chatcode-gpt-skills.yml/badge.svg)](https://github.com/LuongVanDuy/chatcode/actions/workflows/test-chatcode-gpt-skills.yml)

**ChatCode Cá Nhân** là ứng dụng desktop Windows làm cầu nối an toàn giữa **ChatGPT** và các dự án trên máy tính thông qua **Model Context Protocol (MCP)**.

Ứng dụng không nhúng một AI chat riêng và không cần OpenAI API key. ChatGPT thực hiện suy luận; ChatCode cung cấp quyền truy cập có kiểm soát vào source code, filesystem, Git, terminal và ngữ cảnh dự án cục bộ.

> Phiên bản hiện tại: **v1.0.7**

## Kiến trúc

```text
ChatGPT
   │
   │ MCP over HTTPS
   ▼
Cloudflare Tunnel
   │
   ▼
127.0.0.1:47820
   │
   ▼
ChatCode MCP Server
   │
   ├─ Safety / permissions / approvals
   ├─ Project Brain + framework detection
   ├─ Fast Agent Path + Work Sessions
   ├─ Trusted Terminal
   ├─ Git operations
   ├─ Recovery / backups
   └─ Built-in Skill Runtime
            │
            └─ CHATCODE-GPT / WordPress + Bricks
   │
   ▼
Các project được người dùng chia sẻ trên máy
```

MCP server chỉ listen tại **`127.0.0.1:47820`**. Truy cập từ ChatGPT đi qua HTTPS tunnel và một MCP URL có secret path riêng.

## Tính năng chính

### Quản lý project cục bộ

- Thêm nhiều thư mục local thành các project độc lập.
- Giới hạn mọi thao tác trong đúng project root đã chia sẻ.
- List, search và đọc source code/text file.
- Ghi, xóa, đổi tên hoặc di chuyển file theo quyền của từng project.
- Tự index lại project sau thay đổi quan trọng.

### Project Brain

ChatCode xây dựng ngữ cảnh codebase để AI không phải chỉ dựa vào tìm kiếm text đơn giản:

- Phát hiện ngôn ngữ và framework.
- Nhận diện entrypoint và manifest.
- Index symbol, import và dependency relation.
- Tìm definition/reference của symbol.
- Xếp hạng file liên quan theo task.
- Phân tích dependency graph và hotspot.
- Có lớp nhận diện riêng cho WordPress/WooCommerce.

Project Brain hỗ trợ nhiều loại source phổ biến như JavaScript/TypeScript, PHP, Python, Go, Rust, Java/Kotlin, C#, C/C++, Swift, Ruby, CSS/SCSS, SQL, Shell và PowerShell.

### Fast Agent Path

Luồng coding ưu tiên được thiết kế để giảm số round-trip MCP:

```text
prepare_task
   │
   ├─ inspect project
   ├─ Project Brain context
   ├─ framework / WordPress context
   ├─ relevant source contents
   ├─ Git baseline
   ├─ verification hints
   └─ applicable built-in skills
   │
   ▼
AI tạo unified diff
   │
   ▼
complete_task
   │
   ├─ apply patch transactionally
   ├─ run verification
   ├─ refresh Brain
   ├─ collect Git diff/status
   └─ finalize Work Session
```

Một task thông thường được tối ưu cho **2 MCP calls**: `prepare_task` và `complete_task`.

Nếu verification fail, task giữ nguyên trạng thái để AI tạo corrective patch với cùng `task_id` thay vì inspect lại từ đầu.

### Work Sessions & recovery

- Tạo baseline trước khi chỉnh sửa.
- Apply unified diff nhiều file theo transaction.
- Preflight patch trước khi ghi.
- Lưu recovery point cho file bị thay đổi.
- Theo dõi changed files, commands và Git state.
- Có thể rollback toàn bộ Work Session.
- Verification có thể chạy tối đa nhiều lệnh phù hợp với task.

### Safe Workspace và Trusted Workspace

Mỗi project có thể hoạt động theo hai mức:

| Chế độ | Mục đích |
| --- | --- |
| **Safe Workspace** | Quyền hạn chặt, approval và task allow-list được áp dụng. |
| **Trusted Workspace** | Dành cho project tin cậy; hỗ trợ real shell, chaining, pipes và background jobs. |

Trusted Workspace không biến terminal thành OS sandbox. Người dùng vẫn nên chỉ bật chế độ này cho project đáng tin cậy.

### Trusted Terminal

Ở Trusted Workspace, MCP có thể:

- Chạy shell command trong project cwd.
- Hỗ trợ pipes và command chaining.
- Chạy foreground hoặc background job.
- Đọc incremental stdout/stderr.
- Dừng process tree của background job.
- Gắn command vào Work Session để audit và recovery dễ hơn.

Các thao tác nguy hiểm như **Git push** và **`reset --hard`** không được cung cấp trong agent contract mặc định.

### Git

- Đọc branch/status.
- Đọc staged/unstaged diff.
- Stage các đường dẫn cụ thể.
- Tạo local commit.
- Không có MCP tool để push Git.

### Built-in Skill Runtime — `CHATCODE-GPT`

ChatCode có thư viện skill tích hợp và đóng gói cùng ứng dụng.

Skill hiện tại:

**`wordpress-bricks` — WordPress + Bricks Native Delivery, version 2**

Skill bao gồm rule và resource cho:

- Bricks native architecture.
- Header/footer/template tree.
- WooCommerce archive, single product, cart, checkout, thank-you.
- Query loop và dynamic data.
- Migration Bricks data có kiểm soát.
- CSS/cache regeneration.
- Responsive patterns.
- Child-theme architecture và design-system ownership.
- Reusable product/post item layouts.
- Builder-editable custom elements và controls.
- Concurrency-safe seeding/duplicate repair.
- Validation và acceptance cases.

Khi `prepare_task` phát hiện đủ bằng chứng **WordPress + Bricks**, skill được tự động attach và **bắt buộc** cho task, kể cả khi prompt không nhắc tới Bricks. Runtime dùng progressive routing để chỉ nạp resource phù hợp với task; các rule bắt buộc không bị loại bỏ chỉ để giảm context.

Để tương thích với connector/schema legacy, skill cũng được expose dưới virtual project read-only:

```text
CHATCODE-GPT/
└─ skills/
   └─ wordpress-bricks/
      ├─ SKILL.md
      ├─ manifest.json
      ├─ resources/
      └─ tests/
```

Virtual project `CHATCODE-GPT` chỉ cho phép `list/search/read`; không cho ghi file, chạy task hay Git mutation.

## MCP tools

Source hiện tại đăng ký **31 MCP tools**.

### Project & source

- `list_projects`
- `list_files`
- `search_project`
- `read_file`
- `read_files`

### Project Brain

- `project_brain`
- `find_symbols`
- `find_references`
- `related_files`
- `project_context`

### Fast Agent Path

- `prepare_task`
- `complete_task`

### Compatibility fast path

- `inspect_project`
- `apply_and_verify`
- `operation_status`

### Work Sessions

- `start_work`
- `apply_patch`
- `work_status`
- `finish_work`
- `rollback_work`

### Filesystem & task runner

- `write_file`
- `delete_file`
- `rename_file`
- `run_task`

### Trusted Terminal

- `exec`
- `job_status`
- `job_stop`

### Git

- `git_status`
- `git_diff`
- `git_stage`
- `git_commit`

> Một số ChatGPT connector đã cache schema cũ có thể vẫn hiển thị bộ **13 legacy tools** cho đến khi connector/runtime được refresh. Từ v1.0.5, built-in skill vẫn có thể được discovery và đọc qua virtual project `CHATCODE-GPT` trong trường hợp này.

## Bảo mật và giới hạn quyền

### Sensitive files

Mặc định ChatCode chặn các path/file nhạy cảm như:

- `.env`
- `.env.local`
- `.env.production`
- `.ssh`
- `wp-config.php`
- `id_rsa`
- `id_ed25519`
- `credentials.json`
- private key tương tự

Trusted Workspace chỉ được đọc/ghi sensitive file khi người dùng bật rõ quyền **Allow secrets**.

### Project boundary

Mọi path đều được resolve và kiểm tra để không escape khỏi root của project. Built-in skill library cũng dùng path resolution riêng và là read-only.

### Cloudflare credentials

Với custom Cloudflare Tunnel, Tunnel Token được lưu bằng Electron `safeStorage` khi Windows secure storage khả dụng.

Không commit Tunnel Token hoặc secret MCP URL vào Git.

## Kết nối Cloudflare

ChatCode hỗ trợ hai chế độ.

### Quick Tunnel

Không cần domain riêng. ChatCode tự chạy Cloudflare Quick Tunnel và nhận URL dạng:

```text
https://<random>.trycloudflare.com
```

Phù hợp để test nhanh. URL có thể thay đổi sau khi reconnect.

### Domain riêng

Cách ổn định hơn là dùng remotely-managed Cloudflare Tunnel.

1. Tạo/chọn Tunnel trong Cloudflare Dashboard.
2. Tạo Published Application cho hostname, ví dụ `mcp.example.com`.
3. Service URL:

```text
http://localhost:47820
```

4. Lấy Tunnel Token.
5. Mở **ChatCode Cá Nhân → Kết nối → Domain của tôi**.
6. Nhập domain và Tunnel Token.
7. Bấm **Lưu & Kết nối**.

ChatCode chạy cloudflared với `windowsHide`, kiểm tra local/public `/health` và chỉ báo connected khi public endpoint thực sự truy cập được MCP.

Watchdog có cơ chế health-check và auto reconnect theo backoff khi tunnel bị mất kết nối.

## Kết nối với ChatGPT

1. Cài và mở ChatCode Cá Nhân.
2. Thêm ít nhất một project local.
3. Chọn quyền phù hợp cho project.
4. Kết nối Quick Tunnel hoặc domain riêng.
5. Sao chép **MCP URL** do ứng dụng tạo.
6. Thêm URL này vào custom MCP connector/app trong ChatGPT.
7. Giữ ChatCode chạy khi ChatGPT cần truy cập máy.

Sau khi kết nối, có thể yêu cầu ChatGPT liệt kê project, đọc code, phân tích kiến trúc hoặc thực hiện coding task theo quyền đã cấp.

## Cài đặt Windows

Bản cài mới nhất nằm tại:

**[GitHub Releases → Latest](https://github.com/LuongVanDuy/chatcode/releases/latest)**

Installer được build bằng Electron Builder + NSIS:

```text
ChatCode-Ca-Nhan-Setup-<version>.exe
```

Ứng dụng có updater dựa trên **GitHub Releases + electron-updater**, hỗ trợ check, download và cài bản cập nhật mới từ giao diện.

## Chạy từ source

Yêu cầu:

- Windows khuyến nghị cho full desktop flow.
- Node.js **24+**.
- npm.

```powershell
git clone https://github.com/LuongVanDuy/chatcode.git
cd chatcode
npm install
npm start
```

Chạy development:

```powershell
npm run dev
```

## Test

Các smoke/regression test chính:

```powershell
npm run test:syntax
npm run test:mcp
npm run test:safety
npm run test:trusted
npm run test:terminal
npm run test:editing
npm run test:agent
npm run test:brain
npm run test:wordpress
npm run test:wordpress-bricks-skill
npm run test:builtin-skills-project
npm run test:fastpath
npm run test:regression
npm run test:support
npm run test:update
npm run test:notifications
npm run test:tunnel
```

CI Windows chạy các lớp kiểm tra này trước khi build/publish installer.

## Build Windows

Build NSIS installer:

```powershell
npm install
npm run test:syntax
npm run test:mcp
npm run dist:win
```

Build portable:

```powershell
npm run dist:portable
```

Output nằm trong `dist/`.

## CI/CD

Workflow `build-windows.yml` chạy trên `windows-latest` và thực hiện:

1. Install dependencies với Node.js 24.
2. Syntax check.
3. MCP protocol smoke test.
4. Safety & Recovery tests.
5. Trusted Workspace/Terminal tests.
6. Codex-style editing và Fast Agent Path tests.
7. Project Brain + WordPress Brain tests.
8. WordPress + Bricks skill tests.
9. Legacy 13-tool skill exposure test.
10. Filesystem regression, Support, updater và notification tests.
11. Build NSIS installer.
12. Verify `latest.yml` updater metadata.
13. Smoke test remote MCP tunnel.
14. Publish/update GitHub Release khi phù hợp.

Skill-only changes còn có workflow riêng tại `test-chatcode-gpt-skills.yml`.

## Cấu trúc repository

```text
.
├─ CHATCODE-GPT/              # Built-in skill library
│  └─ skills/
│     └─ wordpress-bricks/
├─ core/                      # Runtime, Brain, safety, terminal, updater...
├─ docs/                      # Thiết kế/acceptance theo từng stage
├─ renderer/                  # Electron UI
├─ scripts/                   # Smoke/regression/build helper tests
├─ support/                   # Support documentation
├─ .github/workflows/         # CI/CD
├─ bootstrap-main.js          # Runtime patch bootstrap
├─ main.js                    # Electron main process
├─ preload.js                 # IPC bridge
├─ mcp-server.mjs             # MCP HTTP server + tool registration
└─ package.json
```

### Core modules đáng chú ý

| Module | Vai trò |
| --- | --- |
| `core/projects.js` | Project filesystem, indexing và boundary validation. |
| `core/safety-tools.js` | Permission, approval và safe mutation layer. |
| `core/brain.js` | Symbol/framework/dependency indexing. |
| `core/wordpress.js` | WordPress-specific analysis. |
| `core/agent-runtime.js` | `prepare_task` / `complete_task`. |
| `core/work-runtime.js` | Work Session, patch transaction và rollback. |
| `core/terminal-runtime.js` | Trusted shell và background jobs. |
| `core/trusted-workspace.js` | Trusted Workspace behavior và secret access. |
| `core/skill-runtime.js` | Auto-detect và attach built-in skills. |
| `core/builtin-skills-project.js` | Read-only `CHATCODE-GPT` compatibility layer. |
| `core/connection.js` | MCP local server + Cloudflare tunnel/watchdog. |
| `core/updater.js` | GitHub Releases auto-update. |
| `core/support.js` | Support journal và child-process audit. |

## Nguyên tắc thiết kế

ChatCode được phát triển theo một số nguyên tắc chính:

- **Local-first:** source code nằm trên máy người dùng; ChatCode chỉ expose project được chia sẻ.
- **Least privilege:** quyền được cấu hình theo từng project.
- **Recoverable mutations:** thay đổi quan trọng có recovery point hoặc Work Session rollback.
- **Read before write:** agent được cung cấp context, Brain và baseline trước khi patch.
- **Verify after write:** coding flow có verification và Git diff/status sau thay đổi.
- **No automatic Git push:** agent không được tự push code ra remote.
- **Framework-aware:** WordPress/WooCommerce/Bricks có lớp phân tích và skill chuyên biệt thay vì xử lý như codebase generic.

## Release hiện tại

**v1.0.7** tập trung nâng cấp sâu WordPress + Bricks skill: skill trở thành mandatory project policy cho project Bricks, progressive resource routing theo task/Project Brain, context budget không làm mất rule bắt buộc, Builder-editable custom elements, reusable product/post layouts, design-system/CSS ownership, concurrency-safe seeding và regression tests cho multi-project/legacy workflow.

Xem bản phát hành mới nhất tại **[Releases](https://github.com/LuongVanDuy/chatcode/releases/latest)**.
