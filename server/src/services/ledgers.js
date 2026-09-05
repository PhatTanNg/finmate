/**
 * Mở và giữ sổ tài chính của từng người dùng.
 *
 * Mỗi người một file SQLite riêng (data/users/<id>.db). Handle được giữ lại
 * trong bộ nhớ vì mở file SQLite mỗi request là phí; số handle có trần để
 * một máy chủ đông người dùng không cạn file descriptor — sổ lâu không đụng
 * tới sẽ bị đóng, lần sau cần thì mở lại, dữ liệu không mất gì.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runInCtx } from '../db_context.js';
import { prepareLedger } from '../db.js';
import { bootstrap } from '../bootstrap.js';
import { ledgerPath } from './accounts.js';

const MAX_OPEN = Number(process.env.FINMATE_MAX_OPEN_LEDGERS) || 200;
const open = new Map();   // userId -> { db, path, at }

function openLedger(userId) {
  const p = ledgerPath(userId);
  const moi = !fs.existsSync(p);
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode = WAL;');
  const ctx = { db, path: p, userId: Number(userId) };
  // Sổ mới thì dựng bảng và gieo danh mục/quỹ mặc định — chạy TRONG ngữ cảnh
  // của chính sổ đó, dùng đúng đoạn mã đã dựng sổ mặc định.
  runInCtx(ctx, () => { prepareLedger(); bootstrap(); });
  if (moi) console.info(`[finmate] tạo sổ mới cho người dùng #${userId}`);
  return ctx;
}

/** Đóng bớt sổ ít dùng nhất khi vượt trần. */
function trim() {
  if (open.size <= MAX_OPEN) return;
  const cu = [...open.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, open.size - MAX_OPEN);
  for (const [id, ctx] of cu) {
    try { ctx.db.close(); } catch { /* đang bận thì để lần sau */ }
    open.delete(id);
  }
}

/** Ngữ cảnh sổ của một người, mở nếu chưa mở. */
export function ledgerFor(userId) {
  const id = Number(userId);
  let ctx = open.get(id);
  if (!ctx) { ctx = openLedger(id); open.set(id, ctx); trim(); }
  ctx.at = Date.now();
  return ctx;
}

/** Chạy `fn` trên sổ của một người. Mọi truy vấn bên trong tự trỏ đúng sổ. */
export const withLedger = (userId, fn) => runInCtx(ledgerFor(userId), fn);

/** Đóng sổ của một người (xoá tài khoản, hoặc test). */
export function closeLedger(userId) {
  const ctx = open.get(Number(userId));
  if (!ctx) return false;
  try { ctx.db.close(); } catch { /* đã đóng */ }
  open.delete(Number(userId));
  return true;
}

export const openCount = () => open.size;
