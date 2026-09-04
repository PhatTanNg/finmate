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

export const api = {
  get: (p) => (EMBEDDED ? local('GET', p).then((x) => x.data) : fetch(`/api${p}`, { headers: headers() }).then(j)),
  post: (p, body) => (EMBEDDED ? local('POST', p, body || {}).then((x) => x.data) : fetch(`/api${p}`, { method: 'POST', headers: headers(json), body: JSON.stringify(body || {}) }).then(j)),
  patch: (p, body) => (EMBEDDED ? local('PATCH', p, body || {}).then((x) => x.data) : fetch(`/api${p}`, { method: 'PATCH', headers: headers(json), body: JSON.stringify(body || {}) }).then(j)),
  put: (p, body) => (EMBEDDED ? local('PUT', p, body || {}).then((x) => x.data) : fetch(`/api${p}`, { method: 'PUT', headers: headers(json), body: JSON.stringify(body || {}) }).then(j)),
  del: (p) => (EMBEDDED ? local('DELETE', p).then((x) => x.data) : fetch(`/api${p}`, { method: 'DELETE', headers: headers() }).then(j)),

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
