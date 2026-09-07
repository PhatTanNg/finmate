/**
 * Mở và giữ sổ tài chính.
 *
 * Mỗi sổ một file SQLite riêng: sổ riêng ở data/users/<id>.db, sổ chung của
 * một nhà ở data/families/<id>.db. Handle được giữ lại trong bộ nhớ vì mở
 * file SQLite mỗi request là phí; số handle có trần để một máy chủ đông người
 * dùng không cạn file descriptor — sổ lâu không đụng tới sẽ bị đóng, lần sau
 * cần thì mở lại, dữ liệu không mất gì.
 *
 * Bộ đệm khoá theo KHOÁ SỔ ('u12', 'g3') chứ không theo id người dùng. Nếu
 * khoá theo người thì hai vợ chồng cùng mở một sổ chung sẽ có HAI handle trỏ
 * vào cùng một file — hai kết nối SQLite ghi song song vào một file trong
 * cùng một tiến trình, và cái vừa ghi của người này không hiện ra cho người
 * kia cho tới khi giao dịch đóng. Một sổ, một handle.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runInCtx } from '../db_context.js';
import { prepareLedger } from '../db.js';
import { bootstrap } from '../bootstrap.js';
import { ensureWelcome } from './chat/index.js';
import { ingestToken } from './auth.js';
import { ledgerPathFor, khoaCaNhan } from './accounts.js';

const MAX_OPEN = Number(process.env.FINMATE_MAX_OPEN_LEDGERS) || 200;
const open = new Map();   // khoá sổ -> { db, path, at }

function openLedger(key) {
  const p = ledgerPathFor(key);
  const moi = !fs.existsSync(p);
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode = WAL;');
  // userId ở đây là CHỦ SỔ (sổ riêng) hoặc null (sổ chung, không của riêng ai).
  // Đừng nhầm với "người đang gửi request" — cái đó là ctx.actorId, đặt lại ở
  // mỗi request, và là thứ quyết định khoản mới ghi mang tên ai.
  const ctx = { db, path: p, key, userId: /^u\d+$/.test(key) ? Number(key.slice(1)) : null };
  // Sổ mới thì dựng bảng và gieo danh mục/quỹ mặc định — chạy TRONG ngữ cảnh
  // của chính sổ đó, dùng đúng đoạn mã đã dựng sổ mặc định.
  // Sổ mới cũng cần lời chào mở đầu như bản một người dùng — người mới đăng ký
  // mở app ra thấy màn chat trống trơn thì không biết bắt đầu từ đâu.
  // ingestToken() vừa sinh token webhook cho người này vừa ghi băm của nó vào
  // sổ danh bạ — làm ngay lúc tạo sổ thì tin nhắn ngân hàng bắn vào lúc nào
  // cũng tìm được đúng chủ, không phải chờ họ mở tab Tự động hoá.
  // ingestToken() chỉ có nghĩa với sổ riêng: nó ghi băm token vào hàng users
  // của chủ sổ để tin nhắn ngân hàng tìm được đúng chủ. Sổ chung không có chủ
  // duy nhất nên bỏ qua — token ngân hàng vẫn đổ vào sổ riêng của từng người.
  runInCtx(ctx, () => { prepareLedger(); bootstrap(); ensureWelcome(); if (ctx.userId) ingestToken(); });
  if (moi) console.info(`[finmate] tạo sổ mới: ${key}`);
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

/**
 * Ngữ cảnh của một sổ, mở nếu chưa mở.
 *
 * Nhận khoá sổ ('u12', 'g3'). Nhận cả số cho gọn — số nghĩa là sổ RIÊNG của
 * người đó, giữ nguyên cách gọi cũ ở những chỗ vốn chỉ biết tới sổ riêng
 * (tự động hoá lúc khởi động, webhook ngân hàng).
 */
export function ledgerFor(keyOrUserId) {
  const key = typeof keyOrUserId === 'number' || /^\d+$/.test(String(keyOrUserId))
    ? khoaCaNhan(keyOrUserId)
    : String(keyOrUserId);
  let ctx = open.get(key);
  if (!ctx) { ctx = openLedger(key); open.set(key, ctx); trim(); }
  ctx.at = Date.now();
  return ctx;
}

/**
 * Chạy `fn` trên một sổ. Mọi truy vấn bên trong tự trỏ đúng sổ.
 *
 * `actorId` là NGƯỜI đang thao tác — khác chủ sổ khi nhiều người dùng chung
 * một sổ. Khoản mới ghi mang tên người này (xem created_by trong db.js).
 */
export const withLedger = (keyOrUserId, fn, actorId = null) => {
  const ctx = ledgerFor(keyOrUserId);
  return runInCtx({ ...ctx, actorId: actorId ?? ctx.userId }, fn);
};

/** Đóng một sổ (xoá tài khoản, hoặc test). */
export function closeLedger(keyOrUserId) {
  const key = typeof keyOrUserId === 'number' || /^\d+$/.test(String(keyOrUserId))
    ? khoaCaNhan(keyOrUserId)
    : String(keyOrUserId);
  const ctx = open.get(key);
  if (!ctx) return false;
  try { ctx.db.close(); } catch { /* đã đóng */ }
  open.delete(key);
  return true;
}

export const openCount = () => open.size;

/**
 * Đóng mọi sổ đang mở. Gọi lúc tắt máy chủ để SQLite gộp nốt file -wal vào
 * file chính; không làm thì lần khởi động sau phải phục hồi từ WAL, và một
 * bản sao lưu chép đúng lúc đó sẽ thiếu những gì còn nằm trong WAL.
 */
export function closeAll() {
  let n = 0;
  for (const [id, ctx] of open) {
    try { ctx.db.close(); n += 1; } catch { /* đang bận */ }
    open.delete(id);
  }
  return n;
}
