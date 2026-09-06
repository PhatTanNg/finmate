/**
 * Engine SQLite cho máy chủ Node: `node:sqlite` có sẵn, ghi thẳng ra file.
 *
 * Tách riêng khỏi db.js để bản chạy trên điện thoại (web/src/native) thay
 * bằng SQLite WebAssembly mà phần schema, trigger nhật ký và helper trong
 * db.js vẫn dùng chung một nguồn — hai bản không bao giờ lệch nhau.
 *
 * Giao diện engine: { db: { exec(sql), prepare(sql) -> { all(...p), get(...p), run(...p) } }, DB_PATH }.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function openEngine() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const DB_PATH = process.env.FINMATE_DB
    || path.join(process.env.FINMATE_DATA_DIR || path.resolve(here, '..', 'data'), 'finmate.db');
  // Chỉ tạo thư mục THẬT SỰ chứa sổ. Bản cũ tạo server/data vô điều kiện rồi
  // mới xét FINMATE_DB — trên máy chủ thật, thư mục mã nguồn không ghi được nên
  // app chết ngay lúc khởi động với EACCES dù mọi đường dẫn đã trỏ vào ổ đĩa.
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  return { db, DB_PATH, kind: 'node' };
}
