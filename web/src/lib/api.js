import { xepHang, xepDuoc, guiHangCho, nhan } from './queue.js';

const KEY_STORE = 'finmate_key';

/** Bản chạy ngay trên điện thoại: không có máy chủ, gọi thẳng router trong tiến trình. */
export const EMBEDDED = import.meta.env.VITE_EMBEDDED === '1';

/** localStorage có thể không tồn tại (test/SSR) -> dùng bộ nhớ tạm. */
const mem = new Map();
const store = typeof localStorage !== 'undefined' && localStorage
  ? localStorage
  : { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };

export const getKey = () => store.getItem(KEY_STORE) || '';
export const setKey = (k) => (k ? store.setItem(KEY_STORE, k) : store.removeItem(KEY_STORE));

/** App tự khoá lại khi phiên hết hạn hoặc server khởi động lại. */
let onLocked = () => {};
export const setLockHandler = (fn) => (onLocked = fn);

const headers = (extra = {}) => {
  const k = getKey();
  return { ...extra, ...(k ? { 'x-finmate-key': k } : {}) };
};

const handle = (status, data) => {
  if (status === 401 && data?.locked) {
    setKey('');
    onLocked();
  }
  if (status >= 400 || data?.ok === false) throw new Error(data?.error || `Lỗi ${status}`);
  return data;
};

const j = async (res) => {
  const data = await res.json().catch(() => ({ ok: false, error: 'Phản hồi không hợp lệ' }));
  return handle(res.status, data);
};

// ---- bản nhúng: engine trong tiến trình -----------------------------------
let engine = null;
export const setEngine = (e) => { engine = e; };
const local = async (method, p, body, opts = {}) => {
  if (!engine) throw new Error('Engine chưa khởi động');
  const r = await engine.dispatch(method, `/api${p}`, { body, headers: headers(), ...opts });
  return { r, data: handle(r.status, r.body) };
};

/** Lưu một Blob xuống máy: Web Share (iOS) nếu có, không thì tải xuống. */
export async function saveBlob(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const json = { 'Content-Type': 'application/json' };

/**
 * Bản chụp câu trả lời GET gần nhất, để mất mạng vẫn mở được các trang.
 *
 * Không có lớp này thì hàng chờ ghi ở dưới gần như vô dụng: mở trang Giao dịch
 * lúc mất mạng chỉ ra một trang lỗi trống, không có cả nút thêm khoản chi để
 * mà xếp hàng. Số liệu hiện ra là số CŨ — app đã có băng "đang ngoại tuyến"
 * chạy suốt bên trên nên người dùng biết mình đang nhìn bản chụp.
 */
const KHO_GET = 'finmate.getcache';
const TRAN_MOI_TRANG = 200_000;   // trang nào to quá thì thôi, đừng làm đầy bộ nhớ
const TRAN_SO_TRANG = 60;

const docKho = () => {
  try { return JSON.parse(store.getItem(KHO_GET) || '{}') || {}; } catch { return {}; }
};
export const xoaKhoGet = () => { try { store.removeItem(KHO_GET); } catch { /* riêng tư */ } };

const luuKho = (p, data) => {
  try {
    const chuoi = JSON.stringify(data);
    if (chuoi.length > TRAN_MOI_TRANG) return;
    const kho = docKho();
    kho[p] = { at: Date.now(), data };
    const khoa = Object.keys(kho);
    if (khoa.length > TRAN_SO_TRANG) {
      // Bỏ những trang lâu không xem nhất.
      khoa.sort((a, b) => kho[a].at - kho[b].at).slice(0, khoa.length - TRAN_SO_TRANG).forEach((k) => delete kho[k]);
    }
    store.setItem(KHO_GET, JSON.stringify(kho));
  } catch { /* hết chỗ hoặc chế độ riêng tư: bỏ qua, chỉ mất khả năng xem offline */ }
};

const layKho = (p) => docKho()[p]?.data ?? null;

/**
 * Mất mạng (không phải máy chủ trả lỗi).
 *
 * fetch chỉ ném TypeError cho mọi trục trặc đường truyền, nên phân biệt bằng
 * chính việc "chưa có phản hồi nào cả". Chỗ này quyết định việc ghi được xếp
 * vào hàng chờ hay báo hỏng, nên đoán sai là hoặc nuốt mất lỗi thật, hoặc xếp
 * hàng một việc mà máy chủ đã từ chối.
 */
const matMang = (e) => e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || '');

/**
 * Ghi khi mất mạng: giữ việc lại trong máy, tự gửi khi có sóng.
 *
 * Trả về `{ ok: true, da_xep_hang: true }` để luồng giao diện chạy tiếp bình
 * thường (đóng ô nhập, nạp lại danh sách) thay vì đứng lại với một ô nhập mở
 * và một lỗi không ai hiển thị. Đây KHÔNG phải là nói dối đã ghi xong: khoản
 * vừa nhập không hề xuất hiện trong danh sách, và app treo một băng thông báo
 * "N việc đang chờ gửi" ở ngay dưới thanh tiêu đề cho tới khi gửi được.
 *
 * Cái không được phép làm là chèn một dòng giả vào sổ cho đẹp — số dư sai là
 * thứ người dùng phát hiện ra muộn và không bao giờ tin lại nữa.
 */
const guiHoacXep = async (method, p, body) => {
  try {
    const res = await fetch(`/api${p}`, {
      method,
      headers: headers(body === undefined ? {} : json),
      ...(body === undefined ? {} : { body: JSON.stringify(body || {}) }),
    });
    return await j(res);
  } catch (e) {
    if (!matMang(e) || !xepDuoc(method, p)) throw e;
    const v = xepHang(method, p, body);
    return { ok: true, da_xep_hang: true, viec: nhan(v) };
  }
};

const docHoacKho = async (p) => {
  try {
    const data = await fetch(`/api${p}`, { headers: headers() }).then(j);
    luuKho(p, data);
    return data;
  } catch (e) {
    if (!matMang(e)) throw e;
    const cu = layKho(p);
    if (!cu) throw new Error('Đang mất mạng và máy chưa có bản nào của trang này.');
    // Đánh dấu để nơi nào cần thì nói rõ đây là số cũ.
    return { ...cu, tu_bo_nho: true };
  }
};

/** Gửi hết hàng chờ. Gọi khi có mạng lại, khi mở app, và khi người dùng bấm tay. */
export const guiHangChoNgay = () => guiHangCho(async (v) => {
  let res;
  try {
    res = await fetch(`/api${v.path}`, {
      method: v.method,
      // Mã chống trùng: máy chủ đã ghi rồi thì trả lại câu trả lời cũ chứ không ghi thêm.
      headers: headers({ ...(v.body === undefined || v.body === null ? {} : json), 'x-finmate-op': v.id }),
      ...(v.body === undefined || v.body === null ? {} : { body: JSON.stringify(v.body) }),
    });
  } catch (e) {
    const err = new Error(e?.message || 'Mất mạng');
    err.mat_mang = true;
    throw err;
  }
  return j(res);
});

export const api = {
  get: (p) => (EMBEDDED ? local('GET', p).then((x) => x.data) : docHoacKho(p)),
  post: (p, body) => (EMBEDDED ? local('POST', p, body || {}).then((x) => x.data) : guiHoacXep('POST', p, body || {})),
  patch: (p, body) => (EMBEDDED ? local('PATCH', p, body || {}).then((x) => x.data) : guiHoacXep('PATCH', p, body || {})),
  put: (p, body) => (EMBEDDED ? local('PUT', p, body || {}).then((x) => x.data) : guiHoacXep('PUT', p, body || {})),
  del: (p) => (EMBEDDED ? local('DELETE', p).then((x) => x.data) : guiHoacXep('DELETE', p)),

  /** Tải file (sao lưu, xuất dữ liệu) kèm khoá phiên. */
  download: async (p, filename) => {
    if (EMBEDDED) {
      const { r } = await local('GET', p);
      if (r.file?.bytes) return saveBlob(new Blob([r.file.bytes], { type: 'application/octet-stream' }), r.file.name || filename);
      return saveBlob(new Blob([JSON.stringify(r.body, null, 2)], { type: 'application/json' }), filename);
    }
    const res = await fetch(`/api${p}`, { headers: headers() });
    if (!res.ok) throw new Error(`Không tải được (${res.status})`);
    return saveBlob(await res.blob(), filename);
  },

  /**
   * Một lượt chat dạng luồng: gọi onEvent(ev, data) cho từng bước, trả payload
   * cuối (y hệt POST /chat). Máy chủ cũ/proxy không có luồng thì ném lỗi có
   * `status` để nơi gọi lùi về POST /chat.
   */
  chatStream: async (body, onEvent) => {
    if (EMBEDDED) {
      const { r, data } = await local('POST', '/chat/stream', body, { onEvent: (ev, d) => { if (ev === 'done') body.__done = d; else if (ev === 'error') throw new Error(d.error); else onEvent?.(ev, d); } });
      void data;
      if (r.status !== 200) throw new Error(r.body?.error || 'Lỗi luồng');
      if (!body.__done) throw new Error('Luồng kết thúc mà chưa có câu trả lời');
      return body.__done;
    }
    const res = await fetch('/api/chat/stream', { method: 'POST', headers: headers(json), body: JSON.stringify(body) });
    if (!res.ok || !/text\/event-stream/.test(res.headers.get('content-type') || '')) {
      const err = new Error(res.status === 401 ? 'locked' : `Không mở được luồng (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const raw = /^data: (.+)$/m.exec(block)?.[1];
        if (!ev || !raw) continue;
        let data = {};
        try { data = JSON.parse(raw); } catch { continue; }
        if (ev === 'done') done = data;
        else if (ev === 'error') throw new Error(data.error || 'Lỗi không rõ');
        else onEvent?.(ev, data);
      }
    }
    if (!done) throw new Error('Luồng kết thúc mà chưa có câu trả lời');
    return done;
  },
};
