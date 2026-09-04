/**
 * Khởi động FinMate ngay trên điện thoại — không máy chủ, không cổng.
 *
 * Thứ tự bắt buộc: dựng môi trường giả Node (process.env, Buffer), nạp SQLite
 * WebAssembly và bản DB đã lưu, đăng ký engine, RỒI mới import routes/api.js
 * (vì db.js chạy schema ngay lúc import). Sau đó chạy tự động hoá như máy chủ
 * vẫn làm mỗi giờ.
 */
import initSqlJs from 'sql.js';
import { prepareEngine } from './db_engine.browser.js';
import { attachStore, loadAll as loadVfs, vfs } from './vfs.js';
import { indexedDbStorage, memoryStorage } from './storage.js';
import { mountRouter, useMiddleware, dispatch } from './router.js';
import { Bytes } from './shims/crypto.js';

export const ENV_KEY = 'finmate.env';

export function readEnv() {
  try { return JSON.parse(localStorage.getItem(ENV_KEY) || '{}') || {}; } catch { return {}; }
}
export function writeEnv(env) {
  try { localStorage.setItem(ENV_KEY, JSON.stringify(env)); } catch { /* riêng tư */ }
}

let engineApi = null;   // { db, api, auth, chat }

/**
 * @param {{ storage?: object, wasmUrl?: string, env?: object }} opts
 */
export async function bootEmbedded({ storage = null, wasmUrl = null, env = null } = {}) {
  if (engineApi) return engineApi;
  const g = globalThis;
  g.process = g.process || {};
  g.process.env = { ...(g.process.env || {}), FINMATE_EMBEDDED: '1', ...(env || readEnv()) };
  if (!g.Buffer) g.Buffer = Bytes;

  const T = typeof performance !== 'undefined' ? () => Math.round(performance.now()) : () => Date.now();
  const t0 = T();
  const store = storage || (typeof indexedDB !== 'undefined' ? indexedDbStorage() : memoryStorage());
  attachStore(store);
  await loadVfs();
  const SQL = await initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : {});
  let bytes = null;
  try { bytes = await store.loadDb(); } catch (e) { console.warn('[finmate] không đọc được DB đã lưu:', e?.message || e); }
  const t1 = T();
  prepareEngine({ SQL, bytes: bytes ? new Uint8Array(bytes) : null, storage: store });

  const dbMod = await import('../../../server/src/db.js');
  const api = await import('../../../server/src/routes/api.js');
  const auth = await import('../../../server/src/services/auth.js');
  const chat = await import('../../../server/src/services/chat/index.js');

  // Khoá PIN vẫn có tác dụng: cùng middleware với máy chủ.
  useMiddleware(auth.requireAuth);
  mountRouter(api.router);

  const t2 = T();
  const boot = api.runAutomation();
  chat.ensureWelcome();
  console.info(`[finmate] khởi động nhúng: wasm+dữ liệu ${t1 - t0}ms · engine+schema ${t2 - t1}ms · tự động hoá ${T() - t2}ms`);
  if (typeof setInterval === 'function') {
    const t = setInterval(() => { try { api.runAutomation(); } catch (e) { console.warn('[finmate] tự động hoá lỗi:', e?.message || e); } }, 60 * 60 * 1000);
    t.unref?.();
  }
  if (typeof addEventListener === 'function') {
    const flush = () => { dbMod.db.flush?.(); };
    addEventListener('pagehide', flush);
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  engineApi = {
    db: dbMod.db,
    api,
    dispatch: (method, url, opts = {}) => dispatch(method, url, { ...opts, readFile: (f) => vfs.read(f) }),
    exportDb: () => dbMod.db.export(),
    importDb: (b) => dbMod.db.replace(new Uint8Array(b)),
    files: () => vfs.all(),
    boot,
  };
  return engineApi;
}

export const embedded = () => engineApi;
