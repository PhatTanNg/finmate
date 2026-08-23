import fs from 'node:fs';
import { DB_PATH, db } from '../db.js';

/**
 * Xoá sạch dữ liệu. Ưu tiên xoá file; nếu file đang bị server giữ (EPERM trên
 * Windows) thì xoá bằng SQL để lệnh vẫn dùng được mà không phải tắt server.
 */
function dropTables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const r of rows) db.exec(`DROP TABLE IF EXISTS "${r.name}"`);
  db.exec('PRAGMA foreign_keys = ON');
}

let viaSql = false;
try {
  db.close();
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
} catch (e) {
  if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
  viaSql = true;
  dropTables();
}

console.log(`[finmate] đã xoá sạch dữ liệu${viaSql ? ' (xoá bảng vì file đang được server dùng)' : ''}:`, DB_PATH);
if (viaSql) console.log('[finmate] khởi động lại server để tạo lại schema trước khi chạy `npm run seed`.');

