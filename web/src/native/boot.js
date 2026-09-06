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
import * as sync from '../lib/sync.js';

export const ENV_KEY = 'finmate.env';

export function readEnv() {
  try { return JSON.parse(localStorage.getItem(ENV_KEY) || '{}') || {}; } catch { return {}; }
}
export function writeEnv(env) {
  let luuDuoc = false;
  try { localStorage.setItem(ENV_KEY, JSON.stringify(env)); luuDuoc = true; } catch { /* riêng tư */ }
  // Áp dụng NGAY vào tiến trình đang chạy, đừng bắt người dùng tải lại mới
  // có tác dụng: lớp gọi model đọc process.env mỗi lần dùng. Phải xoá các
  // khoá cũ đã bị bỏ đi, nếu không gỡ key xong app vẫn tưởng còn key.
  const g = globalThis;
  if (g.process?.env) {
    for (const k of Object.keys(g.process.env)) {
      if (k.startsWith('FINMATE_') && k !== 'FINMATE_EMBEDDED' && !(k in (env || {}))) delete g.process.env[k];
    }
    Object.assign(g.process.env, env || {});
  }
  return luuDuoc;
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

  // Chụp lại "máy này có thay đổi chưa gửi hay không" NGAY BÂY GIỜ, trước khi
  // import db.js — vì chính việc dựng schema và chạy migration lúc import cũng
  // ghi vào sổ và sẽ làm dấu này bẩn. Không chụp trước thì lần mở app nào cũng
  // tưởng máy này vừa có thay đổi, và mọi sửa đổi bên máy chủ đều hoá xung đột.
  const coSuaTuTruoc = sync.daNoi() && sync.coThayDoi();

  const T = typeof performance !== 'undefined' ? () => Math.round(performance.now()) : () => Date.now();
  const t0 = T();
  const store = storage || (typeof indexedDB !== 'undefined' ? indexedDbStorage() : memoryStorage());
  attachStore(store);
  await loadVfs();
  const SQL = await initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : {});
  let bytes = null;
  try { bytes = await store.loadDb(); } catch (e) { console.warn('[finmate] không đọc được DB đã lưu:', e?.message || e); }
  const t1 = T();
  // Mỗi lần sổ đổi thì ghi lại một dấu: chức năng đồng bộ nhờ dấu này mà biết
  // máy này có gì mới để gửi lên hay không, thay vì lần nào mở app cũng đẩy cả
  // cuốn sổ lên mạng.
  const danhDau = (sql, params) => { if (sync.daNoi() && sync.laThayDoiThat(sql, params)) sync.danhDauDaSua(); };
  prepareEngine({ SQL, bytes: bytes ? new Uint8Array(bytes) : null, storage: store, onDirty: danhDau });

  const dbMod = await import('../../../server/src/db.js');
  const api = await import('../../../server/src/routes/api.js');
  const auth = await import('../../../server/src/services/auth.js');
  const chat = await import('../../../server/src/services/chat/index.js');

  // Khoá PIN vẫn có tác dụng: cùng middleware với máy chủ.
  useMiddleware(auth.requireAuth);
  mountRouter(api.router);

  // Lấy sổ mới từ máy chủ về TRƯỚC KHI chạy tự động hoá.
  //
  // Thứ tự này là cả thiết kế: tự động hoá cũng ghi vào sổ, nên nếu để nó chạy
  // trước thì lần nào mở app máy này cũng "có thay đổi", và mọi thay đổi bên
  // máy chủ đều biến thành xung đột phải hỏi người dùng. Kiểm tra ở đây, lúc
  // sổ còn đúng như lúc đóng app lần trước, thì chuyện thường ngày (sửa ở máy
  // khác) tự chảy về êm, chỉ còn xung đột thật mới phải hỏi.
  await keoSoVe(dbMod, coSuaTuTruoc).catch((e) => console.info('[finmate] chưa lấy được sổ từ máy chủ:', e?.message || e));

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

/**
 * Nếu máy này đang nối với một tài khoản và KHÔNG có thay đổi nào chưa gửi thì
 * lấy bản mới hơn trên máy chủ về. Có thay đổi chưa gửi thì để yên — chỗ đó là
 * xung đột thật, do người dùng quyết trong Cài đặt.
 */
async function keoSoVe(dbMod, coSuaTuTruoc) {
  if (!sync.daNoi() || coSuaTuTruoc) return;
  const may = await sync.trangThaiMayChu({ timeoutMs: 2500 });
  if (!(may.rev > sync.cauHinh().rev)) return;
  const { bytes, rev } = await sync.taiVe();
  dbMod.db.replace(bytes);
  // Sổ vừa nhận có thể do một bản FinMate cũ hơn ghi ra: dựng lại schema,
  // chạy migration và gắn lại trigger nhật ký trước khi ai đó đọc nó.
  dbMod.prepareLedger();
  sync.luuCauHinh({ rev, at: new Date().toISOString(), doi: 0 });
  console.info(`[finmate] đã lấy sổ bản ${rev} từ máy chủ về`);
}

export const embedded = () => engineApi;
