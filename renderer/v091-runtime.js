(() => {
  const api = window.personalCode;
  if (!api || window.__chatcodeV091Loaded) return;
  window.__chatcodeV091Loaded = true;

  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  function replaceButton(id, label, handler) {
    const current = document.getElementById(id);
    if (!current || current.dataset.v091 === '1') return current;
    const next = current.cloneNode(true);
    next.dataset.v091 = '1';
    next.textContent = label;
    current.replaceWith(next);
    next.addEventListener('click', handler);
    return next;
  }

  function mount() {
    const card = document.getElementById('v07UpdateCard');
    if (!card) return;
    const heading = card.querySelector('h3');
    const description = heading?.nextElementSibling;
    if (heading) heading.textContent = 'Cập nhật ngay trong ChatCode';
    if (description) description.textContent = 'GitHub Releases · tải có progress · xác minh checksum · cài silent · tự mở lại ứng dụng.';

    const check = document.getElementById('checkUpdate');
    if (check) check.textContent = 'Kiểm tra bản mới';

    replaceButton('downloadUpdate', 'Cập nhật & khởi động lại', async () => {
      if (!confirm('ChatCode sẽ tải bản mới, cài silent và tự khởi động lại. Tiếp tục?')) return;
      try {
        text('updateState', 'Đang tải');
        text('updateText', 'Đang tải và xác minh bản cập nhật…');
        const downloaded = await api.downloadUpdate();
        if (downloaded?.state === 'up-to-date') {
          text('updateState', 'Đã mới nhất');
          text('updateText', `Bạn đang dùng bản mới nhất v${downloaded.currentVersion || ''}.`);
          return;
        }
        if (downloaded?.state !== 'downloaded') throw new Error(downloaded?.error || 'Bản cập nhật chưa tải xong.');
        text('updateState', 'Đang cài');
        text('updateText', 'Đã xác minh. ChatCode sẽ tự đóng, cài silent và mở lại…');
        await api.installUpdate();
      } catch (error) {
        text('updateState', 'Lỗi');
        text('updateText', String(error?.message || error));
      }
    });

    const install = document.getElementById('installUpdate');
    if (install) install.textContent = 'Khởi động lại & cài';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 80), { once:true });
  else setTimeout(mount, 80);
  setTimeout(mount, 700);
})();
