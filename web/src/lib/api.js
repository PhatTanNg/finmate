const KEY_STORE = 'finmate_key';

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

const j = async (res) => {
  const data = await res.json().catch(() => ({ ok: false, error: 'Phản hồi không hợp lệ' }));
  if (res.status === 401 && data.locked) {
    setKey('');
    onLocked();
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
};

const json = { 'Content-Type': 'application/json' };

export const api = {
  get: (p) => fetch(`/api${p}`, { headers: headers() }).then(j),
  post: (p, body) => fetch(`/api${p}`, { method: 'POST', headers: headers(json), body: JSON.stringify(body || {}) }).then(j),
  patch: (p, body) => fetch(`/api${p}`, { method: 'PATCH', headers: headers(json), body: JSON.stringify(body || {}) }).then(j),
  del: (p) => fetch(`/api${p}`, { method: 'DELETE', headers: headers() }).then(j),
  /** Tải file (sao lưu, xuất dữ liệu) kèm khoá phiên. */
  download: async (p, filename) => {
    const res = await fetch(`/api${p}`, { headers: headers() });
    if (!res.ok) throw new Error(`Không tải được (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
