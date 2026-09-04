/**
 * Lưu trữ bền trên điện thoại: IndexedDB. Hai kho — bản DB nguyên khối (một
 * mảng byte) và các file sao lưu. Đủ đơn giản để không cần thư viện.
 */
const NAME = 'finmate';
const VER = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (db, store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const r = fn(t.objectStore(store));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

export function indexedDbStorage() {
  let dbp = null;
  const conn = () => (dbp ||= open());
  return {
    async loadDb() { const db = await conn(); return (await tx(db, 'kv', 'readonly', (s) => s.get('db'))) || null; },
    async saveDb(bytes) { const db = await conn(); await tx(db, 'kv', 'readwrite', (s) => s.put(bytes, 'db')); },
    async loadFiles() {
      const db = await conn();
      const out = {};
      await new Promise((resolve, reject) => {
        const t = db.transaction('files', 'readonly');
        const req = t.objectStore('files').openCursor();
        req.onsuccess = () => { const c = req.result; if (!c) return resolve(); out[c.key] = c.value; c.continue(); };
        req.onerror = () => reject(req.error);
      });
      return out;
    },
    async saveFile(path, rec) { const db = await conn(); await tx(db, 'files', 'readwrite', (s) => s.put(rec, path)); },
    async deleteFile(path) { const db = await conn(); await tx(db, 'files', 'readwrite', (s) => s.delete(path)); },
  };
}

/** Bộ nhớ tạm — dùng trong test và khi trình duyệt chặn IndexedDB (chế độ riêng tư). */
export function memoryStorage(initial = null) {
  let dbBytes = initial;
  const files = {};
  return {
    async loadDb() { return dbBytes; },
    async saveDb(b) { dbBytes = b; },
    async loadFiles() { return { ...files }; },
    async saveFile(p, rec) { files[p] = rec; },
    async deleteFile(p) { delete files[p]; },
    _peek: () => ({ dbBytes, files }),
  };
}
