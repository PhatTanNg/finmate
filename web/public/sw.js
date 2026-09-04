/* Service worker cho bản chạy trên điện thoại: mở được app kể cả khi không có mạng.
 *
 * Danh sách tài nguyên được NHÚNG LÚC BUILD (xem nativePlugin trong
 * vite.config.js). Không thể trông vào việc "gặp request nào thì đệm request
 * đó": tên tệp build có hash nên trình duyệt tự đệm sẵn ở tầng HTTP, request
 * không bao giờ chạm tới service worker, và thế là lúc mất mạng chẳng có gì
 * trong kho — app mở ra trang trắng. Phải nạp đủ ngay lúc cài đặt.
 */
const BUILD = '__FINMATE_BUILD__';
const ASSETS = ['./', './index.html'].concat(
  Array.isArray(self.__FINMATE_ASSETS__) ? self.__FINMATE_ASSETS__ : [],
);
const CACHE = 'finmate-' + (BUILD.startsWith('__') ? 'dev' : BUILD);

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // addAll hỏng cả mẻ nếu một tệp lỗi -> nạp từng tệp để một thứ thiếu không
  // kéo sập toàn bộ khả năng chạy ngoại tuyến.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})),
  )));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Điều hướng: ưu tiên mạng để luôn lấy bản mới, mất mạng thì lấy bản đã đệm.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return r; })
      .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))));
    return;
  }

  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)
    .then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
});
