/** Sao lưu dữ liệu: dữ liệu tài chính mất là mất thật, nên sao lưu tự động hàng ngày. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, DB_PATH, all, setting } from '../db.js';
import { today } from '../util/date.js';

export const BACKUP_DIR = process.env.FINMATE_BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = Number(process.env.FINMATE_BACKUP_KEEP) || 14;

const ensureDir = (d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
};

/** VACUUM INTO tạo bản sao nhất quán ngay cả khi server đang ghi. */
function vacuumInto(file) {
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function snapshotToTemp() {
  const file = path.join(os.tmpdir(), `finmate-${Date.now()}.db`);
  return vacuumInto(file);
}

export function listBackups() {
  ensureDir(BACKUP_DIR);
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

function prune() {
  const olds = listBackups().slice(KEEP);
  for (const b of olds) fs.rmSync(path.join(BACKUP_DIR, b.file), { force: true });
  return olds.length;
}

export function createBackup(date = today()) {
  ensureDir(BACKUP_DIR);
  const file = path.join(BACKUP_DIR, `finmate-${date}.db`);
  vacuumInto(file);
  const removed = prune();
  setting('last_backup', date);
  const st = fs.statSync(file);
  return { file: path.basename(file), path: file, size: st.size, pruned: removed };
}

/** Sao lưu tối đa 1 lần/ngày, gọi trong vòng lặp tự động hoá. */
export function autoBackup() {
  const d = today();
  if (setting('last_backup') === d) return null;
  try {
    return createBackup(d);
  } catch (e) {
    console.error('[finmate] sao lưu lỗi:', e.message);
    return null;
  }
}

const TABLES = () =>
  all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);

/** Xuất toàn bộ dữ liệu ra JSON để mang đi nơi khác (không kèm mã PIN). */
export function exportAll() {
  const out = {};
  for (const t of TABLES()) {
    out[t] = all(`SELECT * FROM ${t}`);
    if (t === 'settings') out[t] = out[t].filter((r) => r.key !== 'app_pin');
  }
  return out;
}
