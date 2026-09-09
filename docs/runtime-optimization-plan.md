# Kế hoạch tối ưu ChatCode: giảm vòng lặp và thời gian chờ

Ngày: 09/09/2026. Baseline: commit `1e15a3b`, package `1.0.36`.
Đây là kế hoạch cho các thay đổi tiếp theo; chưa phải các tính năng đã triển khai.

## Kết luận từ lịch sử và source

Đã truy xuất 234 lượt trong 8 cuộc chat hiện truy cập được. Nội dung ảnh đính kèm và toàn bộ tool trace không có trong dữ liệu chat trả về; lời báo hoàn thành của assistant không tự chứng minh website đã đúng. Nhận định dưới đây kết hợp nội dung chat, source và kiểm thử tái hiện.

| Bằng chứng | Ý nghĩa |
| --- | --- |
| Mimo có lượt khoảng 25 phút 46 giây rồi dừng vì giới hạn công cụ; nhiều lượt chuyển giữa patch, terminal, seed và kiểm tra live | Có vòng thử lại ở cấp tác vụ, không chỉ tiến trình chạy lâu |
| `prepareTask` trước bản sửa luôn mở Work Session mới | Chuẩn bị lại có thể để nhiều session tồn tại; rollback về runtime cũ cũng đưa hành vi này trở lại |
| Lệnh FTP cho một file dài khoảng 10.430 ký tự, trước đây đi qua `cmd.exe` | Vượt giới hạn dòng lệnh CMD; cần sửa transport, không tăng lời nhắc retry |
| File rác `'ASC'`, `'DESC'`, `'ids'`, `(int)`, `esc_html__(` trùng token trong PHP | Script nhiều dòng đi qua CMD có thể bị hiểu thành redirect |
| MCP audit trước bản sửa ghi `ok:true` khi hàm trả về bình thường dù command thất bại | Log thành công không phản ánh kết quả thật, gây chẩn đoán sai |
| Skill nhắc recovery budget không còn trong runtime sau rollback | Hướng dẫn và khả năng thực thi không đồng bộ |
| Các chat nhiều lần báo HTTP 200 nhưng người dùng vẫn thấy giao diện hoặc dữ liệu sai | HTTP 200 chỉ chứng minh có response; phải kiểm tra đúng yêu cầu đã thay đổi |

Phần đã sửa ở `1e15a3b`: PowerShell chạy trực tiếp, tái sử dụng prepare trùng yêu cầu, re-plan bằng task ID, hủy session active và tiến trình gắn với nó, retry FTP chưa thành công, phản ánh lỗi MCP và đồng bộ hướng dẫn. Kiểm tra cú pháp và 16 bộ kiểm thử đã PASS ở local. Đây chưa phải cam kết loại bỏ mọi vòng lặp của model.

## Những khoảng trống còn lại

- Reuse hiện dựa vào cùng project/yêu cầu hoặc task ID được truyền rõ. Model đổi cách diễn đạt mà bỏ task ID vẫn có thể mở session mới. Không nên khắc phục bằng khóa toàn bộ project vì người dùng có nhiều cuộc chat chạy song song.
- `finish_work(cancel:true)` xử lý work đang active. FTP khởi chạy sau khi work được đánh dấu completed và chưa gắn cùng vòng đời hủy. Cần một trạng thái tổng thể bao gồm cả deploy.
- Session và kết quả FTP đang nằm trong bộ nhớ. Mất kết nối hoặc restart app chưa có cơ chế phục hồi tác vụ và kiểm tra trạng thái remote đủ tin cậy.
- FTP retry nhớ tên file thành công, chưa gắn kết quả với hash nội dung, config đích và lần thực thi. Hai task sửa cùng file hoặc một task thay đổi file sau upload có thể làm thông tin này lỗi thời.
- `complete_task` vẫn buộc nhận unified diff. Model có thể tiếp tục mất thời gian tạo hunk và chuyển sang shell khi sửa file lớn.
- `runtime-bootstrap.js` lắp 13 lớp mở rộng theo thứ tự; tác dụng phụ và việc truyền tham số giữa các lớp khó kiểm soát. Bản sửa vừa phải sửa chỗ lớp skill bỏ mất tham số re-plan.
- FAST/DEEP vẫn vừa phân loại task vừa quyết định giới hạn file/khả năng sửa. Dự đoán sai về owner hoặc scope có thể biến một yêu cầu hợp lệ thành nhiều lần re-plan.

## Thứ tự triển khai

### 1. Đo được thời gian và xác định một tác vụ xuyên suốt

Owner: `agent-runtime.js`, `work-runtime.js`, `mcp-server.mjs`, `usage.js`, `support.js`.

Gắn `task_id`, `operation_id`, phase, thời điểm bắt đầu/kết thúc, mã kết quả và dấu mốc tiến độ vào cùng một trace. Phân biệt thời gian model chưa gọi tool, thời gian lấy context, ghi file, verify, chờ network và deploy. Nếu không quan sát được thời gian suy luận của ChatGPT, ghi rõ phần thời gian đó là khoảng chờ giữa các tool call.

Tách fingerprint yêu cầu phục vụ gợi ý khỏi khóa idempotency do runtime cấp. Cùng operation ID không được ghi hoặc deploy lần hai. Với yêu cầu khác chữ nhưng có vẻ cùng việc, trả thông tin tác vụ liên quan để model tiếp tục đúng ID; không tự nhập hai cuộc chat độc lập vào một session.

Tiêu chí nghiệm thu:

- Mọi thao tác ghi/verify/deploy truy ngược được về task và operation.
- Gửi lại cùng operation, kể cả đồng thời, chỉ tạo một tác dụng phụ.
- Hai project và hai task độc lập vẫn chạy được; ghi cùng file phải kiểm tra phiên bản trước khi áp dụng.
- Trace không chứa credential hoặc toàn bộ nội dung nhạy cảm.

### 2. Một vòng đời task và đường dừng xuyên suốt

Owner: `work-runtime.js`, `agent-runtime.js`, `terminal-runtime.js`, `ftp-deploy.js`, `project-scope.js`, UI Work Session.

Trạng thái cần thể hiện rõ: preparing → editing → verifying → deploying → completed. Khi lỗi, lưu phase thất bại và trạng thái có thể tiếp tục. Khi dừng: cancelling → cancelled, hoặc stop_failed nếu hệ điều hành chưa dừng được tiến trình. Local verified không đồng nghĩa task đã deploy xong.

Truyền cancellation token tới verify, terminal, deploy và callback hậu xử lý. Chặn khởi chạy bước tiếp theo sau khi đã nhận yêu cầu dừng. Đưa tác vụ dài về dạng trả job ID sớm, chờ sự kiện hoặc lấy output theo cursor. Không polling dày khi chưa có trạng thái mới.

Lưu checkpoint tối thiểu để sau restart hiển thị interrupted/recoverable, đối chiếu tiến trình/file trước khi tiếp tục. Không tự phát lại lệnh ghi dữ liệu hoặc upload chỉ vì app mở lại.

Tiêu chí nghiệm thu:

- Dừng giữa verify, giữa batch FTP hoặc ngay trước finalize không chạy bước kế tiếp.
- Không báo cancelled thành công nếu còn process chưa dừng; trả đúng tình trạng cần xử lý.
- Không tạo ghost holder sau lỗi, timeout hoặc reconnect.
- Mục tiêu nghiệm thu: UI nhận yêu cầu dừng dưới 1 giây; process local thông thường kết thúc dưới 5 giây. Trường hợp không đạt phải hiển thị nguyên nhân, không giả báo đã dừng.

### 3. Chống lặp dựa trên thay đổi thực tế

Owner: task lifecycle ở bước 2; chính sách completion hiện có.

Fingerprint lỗi theo operation, error code, tập file và revision/hash. Retry được cho phép khi có thay đổi liên quan: patch đã sửa, input/config đã đổi, hoặc lỗi network thuộc loại tạm thời. Không dùng việc đổi câu prompt hoặc gọi prepare làm dấu hiệu tiến triển.

- Lỗi quyền, đường dẫn, parse hoặc xác thực: trả nguyên nhân và hành động có thể sửa; không retry mù.
- Lỗi context patch: trả đoạn context hiện tại đủ để sửa, vẫn dùng cùng task.
- Network tạm thời: retry ít lần có backoff, thời hạn tổng và khả năng hủy; cấu hình dựa trên số đo.
- Cùng lỗi sau lần sửa mà revision không đổi: dừng operation và báo rõ file local/live đang ở trạng thái nào.

Không đặt một deadline cứng cho mọi task. Đặt timeout cho từng operation, theo dõi khoảng không có tiến độ; build/import dài có tín hiệu tiến triển vẫn được chạy. Connector chỉ kiểm soát các tool call và tiến trình nó quản lý, không thể bảo đảm model không suy luận lâu ở phía ChatGPT.

Tiêu chí nghiệm thu: tái hiện chuỗi Mimo prepare → exec → prepare không làm mất danh tính task hoặc khởi động lại operation đã thất bại mà chưa có thay đổi.

### 4. Runtime sở hữu việc ghi file và deploy

Owner: `work-runtime.js`, schema MCP, `ftp-deploy.js`.

Thêm tùy chọn edit có cấu trúc vào luồng completion hiện có: path, nội dung mới hoặc đoạn find/replace duy nhất, expected hash. Runtime kiểm tra revision, tạo transaction/recovery và ghi file. Vẫn nhận unified diff cho công cụ tương thích. Không mở thêm một workflow cạnh tranh chỉ để né lỗi hunk.

Một bộ thực thi FTP duy nhất tạo manifest gồm path, operation, content hash, đích và kết quả. Chỉ retry nội dung chưa được xác nhận. Kiểm tra local thay đổi trong lúc upload, thay đổi config đích, file thiếu và tập file quá giới hạn; không im lặng cắt danh sách rồi báo hoàn tất. Phân biệt unsupported/skipped với đã deploy.

Đưa script cố định sang file được đóng gói hoặc runner có input có cấu trúc; model không phải tự sinh lệnh dài cho các việc lặp lại. Giữ credential đọc tại máy từ config. Không mặc định xóa remote chỉ vì file local vắng; thao tác delete phải có trong manifest của task được phép thực hiện.

Tiêu chí nghiệm thu: patch sai, hai người sửa cùng file, mất kết nối giữa upload, config đổi và app restart đều trả trạng thái có thể hiểu/tiếp tục, không upload trùng hoặc đè dữ liệu mới.

### 5. Tách quy tắc kỹ thuật khỏi sở thích và kiến thức Bricks

Owner: `task-planner.js`, `owner-resolver.js`, `skill-runtime.js`, skill WordPress/Bricks.

Quyền truy cập, project binding, kiểm tra revision và transaction là invariant trong runtime. Tên file, số file thường gặp, owner được dự đoán và cách tổ chức CSS là guidance có evidence. Yêu cầu người dùng được phép bổ sung page/file hợp lệ mà không phải tìm cách viết prompt để vượt classifier.

Thu gọn FAST/DEEP thành gợi ý về context/rủi ro khi thích hợp, dùng cùng vòng đời thực thi ở bước 2. Thực hiện sau benchmark, không khôi phục lại thiết kế khóa mọi thao tác thủ công của v1.0.33.

Với Bricks, cung cấp thao tác theo phiên bản đã phát hiện: đọc tree và revision → sửa phần được chỉ định → validate quan hệ → lưu bằng đường ghi được kiểm chứng → đọc lại persisted data. Chỉ kiểm tra trang/breakpoint liên quan. Không lấy HTTP 200 thay cho kiểm tra tree, nội dung và giao diện. Không đưa thủ thuật tắt sanitizer trong một website thành quy tắc chung.

Tái sử dụng cấu trúc child theme hiện hành; seed/setup có trạng thái terminal và bảo toàn chỉnh sửa trong Builder. Skill nạp đúng domain cần thiết, có metadata phiên bản tương thích runtime và hướng dẫn phục hồi ở một nơi.

### 6. Kiểm thử bằng tình huống thật và phát hành có kiểm soát

Tạo fixture đã loại dữ liệu riêng tư từ Mimo, Longkhai và các task CSS nhỏ. Chạy dưới Windows để kiểm tra CMD/PowerShell thật; fixture FTP/DB không ghi production.

Ma trận tối thiểu: sửa CSS một file; tạo page native Bricks; sửa dữ liệu đã lưu mà giữ element ID; patch conflict; prepare lặp và đổi cách diễn đạt; ngắt mạng giữa FTP; cancel lúc verify/deploy; restart; hai project song song; hai task đụng cùng file; tác vụ thành công rồi bị gọi lại.

Ghi baseline trước mỗi giai đoạn và so sánh cùng tập case. Mục tiêu đề xuất để nghiệm thu, không phải kết quả đã đo:

| Chỉ số | Mục tiêu |
| --- | --- |
| Tác dụng phụ trùng do replay operation | 0 trong fixture |
| Session/holder mồ côi sau kết thúc | 0 trong fixture |
| Báo hoàn tất dù verify/deploy bắt buộc thất bại | 0 trong fixture |
| Task sửa nhỏ phải prepare lại vô ích | 0 trong fixture |
| Thời gian p95 runtime cho task sửa nhỏ | Giảm ít nhất 30% so với baseline đo được; tách thời gian model/network |
| Lượng context cho sửa nhỏ | Giảm ít nhất 30%, giữ tỷ lệ sửa đúng ngay lần đầu |

Mỗi giai đoạn là một thay đổi có kiểm thử và có thể quay lại riêng. CI kiểm tra hợp đồng giữa các lớp, hành vi Windows và tương thích schema. Chỉ tăng version/phát hành installer sau khi gate PASS và đã được yêu cầu phát hành. Không sửa lại asset của release cũ để đưa source mới vào cùng version.

## Bước nên làm đầu tiên

Triển khai bước 1 và 2 trước: trace/operation identity và vòng đời có thể hủy tới tận FTP. Sau đó xử lý retry theo trạng thái, edit có cấu trúc và manifest deploy. Chỉ gộp/bỏ các lớp orchestration khi đã có fixture đo được hành vi trước/sau.

Mục tiêu là một luồng runtime dễ quan sát, có điểm tiếp tục và điểm dừng rõ ràng; skill chỉ bổ sung kiến thức cần thiết để model chọn đúng việc.
