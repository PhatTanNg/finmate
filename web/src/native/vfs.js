/**
 * Hệ tệp ảo cho bản chạy trên điện thoại.
 *
 * Engine và dịch vụ sao lưu vẫn "ghi file" như trên máy chủ (VACUUM INTO,
 * readdir, stat, rm). Ở đây file nằm trong bộ nhớ và được chép xuống
 * IndexedDB, nên bản sao lưu sống qua lần đóng app. Đường dẫn chỉ là chuỗi.
 */
const files = new Map();   // path -> { bytes: Uint8Array, mtime: number }
let store = null;          // { loadFiles(), saveFile(path, rec), deleteFile(path) }

export function attachStore(s) { store = s; }
export async function loadAll() {
  if (!store?.loadFiles) return;
  for (const [p, rec] of Object.entries(await store.loadFiles())) files.set(p, rec);
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/');
const dirOf = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); };

export const vfs = {
  exists: (p) => files.has(norm(p)) || [...files.keys()].some((k) => k.startsWith(`${norm(p)}/`)),
  write(p, bytes) {
    const rec = { bytes: bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes)), mtime: Date.now() };
    files.set(norm(p), rec);
    store?.saveFile?.(norm(p), rec);
  },
  read: (p) => files.get(norm(p))?.bytes ?? null,
  stat(p) {
    const r = files.get(norm(p));
    if (!r) { const e = new Error(`ENOENT: no such file, stat '${p}'`); e.code = 'ENOENT'; throw e; }
    return { size: r.bytes.length, mtime: new Date(r.mtime), isFile: () => true, isDirectory: () => false };
  },
  remove(p) { const k = norm(p); if (files.delete(k)) store?.deleteFile?.(k); },
  list: (dir) => [...files.keys()].filter((k) => dirOf(k) === norm(dir)).map((k) => k.slice(norm(dir).length + 1)),
  all: () => [...files.entries()].map(([path, r]) => ({ path, size: r.bytes.length, mtime: r.mtime })),
};
