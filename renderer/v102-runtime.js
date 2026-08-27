(() => {
  if (window.__chatcodeV102Loaded) return;
  window.__chatcodeV102Loaded = true;

  function refreshLabels() {
    const notify = document.getElementById('settingNotify');
    const row = notify?.closest?.('.setting');
    const title = row?.querySelector?.('strong');
    const detail = row?.querySelector?.('span');
    if (title) title.textContent = 'Thông báo khi công việc hoàn tất';
    if (detail) detail.textContent = 'Mỗi yêu cầu ChatGPT tối đa một thông báo khi hoàn tất; patch, terminal, verify và Git trung gian chỉ ghi vào Hoạt động.';

    const addButtons = [document.getElementById('addProject'), document.getElementById('dashboardAddProject')].filter(Boolean);
    for (const button of addButtons) button.title = 'Dự án mới mặc định dùng Trusted Workspace với đầy đủ quyền local; secrets và Git push vẫn tắt.';
  }

  refreshLabels();
  setTimeout(refreshLabels, 350);
})();
