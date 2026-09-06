/**
 * Engine SQLite cho bản chạy ngay trên điện thoại: sql.js (SQLite biên dịch
 * sang WebAssembly), cùng giao diện với node:sqlite mà db.js đang dùng:
 *   db.exec(sql) · db.prepare(sql).all(...p) / .get(...p) / .run(...p) -> { changes, lastInsertRowid }
 *
 * Toàn bộ DB nằm trong bộ nhớ; mỗi lần ghi xong thì chép xuống IndexedDB
 * (gộp các lần ghi sát nhau lại). `VACUUM INTO 'file'` — cách sao lưu của app —
 * được dịch thành ghi một bản export vào hệ tệp ảo.
 */
import { vfs } from './vfs.js';

let prepared = null;   // { SQL, bytes, storage } do boot.js đặt trước khi db.js được import
export function prepareEngine(p) { prepared = p; }

const toParam = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
};

export function openEngine() {
  if (!prepared?.SQL) throw new Error('Engine chưa sẵn sàng: boot.js phải gọi prepareEngine() trước khi import db.js');
  const { SQL, bytes, storage, onDirty } = prepared;
  let raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  raw.exec('PRAGMA foreign_keys = ON');

  let timer = null;
  let dirty = false;
  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    try {
      const data = raw.export();
      // sql.js đóng và mở lại DB khi export -> pragma bị reset, phải bật lại.
      raw.exec('PRAGMA foreign_keys = ON');
      await storage?.saveDb?.(data);
    } catch (e) { console.warn('[finmate] lưu DB lỗi:', e?.message || e); }
  };
  const markDirty = (sql, params) => {
    dirty = true;
    onDirty?.(sql, params);
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  };

  // PRAGMA không sửa dữ liệu. Xếp nó vào nhóm "có ghi" thì hỏng thật: mỗi lần
  // lưu xong, sql.js đóng/mở lại DB nên phải bật lại PRAGMA foreign_keys — và
  // thế là lần lưu nào cũng tự đánh dấu "vừa sửa", hẹn giờ lưu tiếp, lặp vô
  // tận: máy chép cả cuốn sổ xuống IndexedDB mỗi 700ms cho tới khi đóng app.
  const isWrite = (sql) => !/^\s*(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(sql);

  const db = {
    exec(sql) {
      const m = /^\s*VACUUM\s+INTO\s+'((?:[^']|'')+)'\s*;?\s*$/i.exec(sql);
      if (m) {
        const file = m[1].replace(/''/g, "'");
        if (vfs.exists(file)) throw new Error(`output file already exists: ${file}`);
        const data = raw.export();
        raw.exec('PRAGMA foreign_keys = ON');
        vfs.write(file, data);
        return;
      }
      if (/^\s*PRAGMA\s+journal_mode/i.test(sql)) return;
      raw.exec(sql);
      if (isWrite(sql)) markDirty(sql);
    },
    prepare(sql) {
      const runStmt = (params, collect) => {
        const st = raw.prepare(sql);
        try {
          st.bind(params.map(toParam));
          const rows = [];
          while (st.step()) { rows.push(st.getAsObject()); if (!collect) break; }
          return rows;
        } finally { st.free(); }
      };
      return {
        all: (...params) => runStmt(params, true),
        get: (...params) => runStmt(params, false)[0],
        run: (...params) => {
          raw.run(sql, params.map(toParam));
          const changes = raw.getRowsModified();
          const r = raw.exec('SELECT last_insert_rowid() AS id');
          const lastInsertRowid = Number(r?.[0]?.values?.[0]?.[0] ?? 0);
          markDirty(sql, params);
          return { changes, lastInsertRowid };
        },
      };
    },
    /** Chép ngay xuống kho, không chờ gộp — gọi khi app sắp bị ẩn/đóng. */
    flush,
    export: () => { const d = raw.export(); raw.exec('PRAGMA foreign_keys = ON'); return d; },
    /** Thay toàn bộ DB bằng file khác (nhập bản sao lưu). Gọi xong phải tải lại app. */
    replace(newBytes) { raw.close(); raw = new SQL.Database(newBytes); raw.exec('PRAGMA foreign_keys = ON'); dirty = true; return flush(); },
  };
  return { db, DB_PATH: '/finmate/finmate.db', kind: 'wasm' };
}
