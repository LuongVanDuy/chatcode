FTP DEPLOY - HUONG DAN CHO AI

1. Chay trong dung project co .vscode/sftp.json.
2. Chi dien duong dan cac file vua sua/verify vao .chatcode/ftp-files.json:
   { "files": ["wp-content/themes/bricks-child/functions.php"] }
3. Khong viet lai lenh curl/FTP, khong doc/in password ra chat.
4. Kiem tra: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .chatcode\deploy-ftp.ps1 -DryRun
5. Deploy:   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .chatcode\deploy-ftp.ps1
6. Chi bao deploy thanh cong khi exit code 0, ok:true va mode:deploy.
7. Neu loi, doc files[].error/not_attempted/cleanup_warnings, sua nguyen nhan,
   chay lai cung manifest. File remote da dung SHA-256 duoc bo qua.
8. Sau FTP van can kiem tra hanh vi trang va chot task dang lam trong ChatCode.

Script tu lay project root tu thu muc cha cua .chatcode.
Khong upload thu muc, wildcard, .vscode, .chatcode, .env, wp-config.php.
Khong xoa file website khi file local khong ton tai.
Thu ket noi va don file thu: them -Probe (khong deploy manifest).
Chi FTP/FTPS; khong ho tro SFTP.
