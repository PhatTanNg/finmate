/**
 * Đồng bộ sổ giữa bản chạy thẳng trên máy và tài khoản trên máy chủ.
 *
 * Mô hình: đồng bộ NGUYÊN CẢ SỔ, có số hiệu bản (rev) để phát hiện lệch.
 *
 * Vì sao không trộn từng dòng: mỗi bản ghi ở đây đánh số bằng id tự tăng của
 * chính máy đó, nên hai máy dùng offline cùng lúc sẽ đẻ ra hai giao dịch khác
 * nhau mang cùng id. Trộn kiểu đó chỉ đúng khi mọi dòng có mã toàn cục và có
 * nhật ký thao tác — chưa có thì trộn là nhân đôi hoặc nuốt mất giao dịch, mà
 * với sổ tiền thì sai kiểu đó tệ hơn hẳn việc không trộn.
 *
 * Nên ở đây: một bản là một bản. Máy chủ giữ số hiệu; máy gửi lên phải nói
 * mình dựa trên số hiệu nào. Trùng thì nhận, lệch thì TRẢ VỀ 409 và để người
 * dùng chọn — không bao giờ tự quyết hộ. Bên nào bị ghi đè cũng được sao lưu
 * trước, nên chọn nhầm vẫn lấy lại được.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setting } from '../db.js';
import { ledgerPath } from './accounts.js';
import { closeLedger } from './ledgers.js';
import { backupDir } from './backup.js';

/** Số hiệu bản của sổ đang dùng. Mỗi lần sổ đổi là tăng một. */
export const rev = () => Number(setting('sync_rev') || 0);

/**
 * Đánh dấu sổ vừa đổi. Gọi sau MỌI request ghi thành công — kể cả request từ
 * giao diện web — nếu không thì máy chủ đổi mà máy điện thoại không hay biết,
 * rồi lần gửi lên sau sẽ xoá mất thay đổi đó mà không ai kịp thấy.
 */
export function bumpRev() {
  const n = rev() + 1;
  setting('sync_rev', String(n));
  setting('sync_at', new Date().toISOString());
  return n;
}

/** Máy chủ có đang chỉ đóng vai nơi cất sổ cho một thiết bị hay không. */
export const deviceOwned = () => setting('sync_owner') === 'device';

/** Ai vừa ghi lần cuối, để câu báo lệch nói được điều có ích. */
export const syncInfo = () => ({
  rev: rev(),
  at: setting('sync_at') || null,
  device: setting('sync_device') || null,
  owner: setting('sync_owner') || 'server',
});

const MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/**
 * Kiểm tra thứ vừa nhận có đúng là một sổ FinMate không.
 *
 * Đây là file sẽ THAY THẾ sổ thật của một người, nên phải soi kỹ: sai định
 * dạng, hỏng bên trong, hay là một cơ sở dữ liệu nào khác đều phải bị chặn
 * trước khi động vào sổ đang có.
 */
export function checkLedgerBytes(buf) {
  if (!buf || buf.length < 512) throw new Error('File rỗng hoặc quá nhỏ để là một sổ FinMate');
  if (!buf.subarray(0, 16).equals(MAGIC)) throw new Error('File này không phải cơ sở dữ liệu SQLite');
  const tmp = path.join(os.tmpdir(), `finmate-kiem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.writeFileSync(tmp, buf);
  try {
    const d = new DatabaseSync(tmp, { readOnly: true });
    try {
      const ic = d.prepare('PRAGMA integrity_check').get();
      const kq = ic?.integrity_check || Object.values(ic || {})[0];
      if (kq !== 'ok') throw new Error(`Sổ bị hỏng bên trong (${kq})`);
      const co = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
      for (const t of ['transactions', 'accounts', 'settings', 'categories']) {
        if (!co.has(t)) throw new Error(`Thiếu bảng "${t}" — đây không phải sổ FinMate`);
      }
      const n = d.prepare('SELECT COUNT(*) c FROM transactions').get().c;
      return { transactions: Number(n) };
    } finally { d.close(); }
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Chép sổ hiện tại sang thư mục sao lưu trước khi ghi đè lên nó. */
export function backupBeforeReplace(userId, nhan) {
  const p = ledgerPath(userId);
  if (!fs.existsSync(p)) return null;
  // backupDir() đã là thư mục riêng của người đang gửi (…/backups/users/<id>).
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  // Hai lần gửi sát nhau mà trùng tên thì bản sao lưu trước bị đè — mất đúng
  // cái mình định giữ. Tên phải chắc chắn không đụng.
  let file = path.join(dir, `truoc-khi-${nhan}-${stamp}.db`);
  for (let i = 2; fs.existsSync(file); i += 1) file = path.join(dir, `truoc-khi-${nhan}-${stamp}-${i}.db`);
  fs.copyFileSync(p, file);
  return path.basename(file);
}

/**
 * Thay sổ của một người bằng file vừa nhận.
 *
 * Đóng handle đang mở trước (SQLite không thích bị tráo file dưới chân), ghi
 * ra file tạm cạnh sổ rồi mới đổi tên đè lên — đổi tên trong cùng thư mục là
 * thao tác nguyên tử, nên mất điện giữa chừng cũng không để lại sổ dở dang.
 */
export function replaceLedger(userId, buf, { device = null } = {}) {
  const dich = ledgerPath(userId);
  closeLedger(userId);
  // File -wal/-shm của sổ cũ nói về nội dung cũ; để lại là SQLite đọc nhầm.
  for (const hau of ['-wal', '-shm']) fs.rmSync(dich + hau, { force: true });
  const tam = `${dich}.dang-nhan`;
  fs.writeFileSync(tam, buf);
  fs.renameSync(tam, dich);
  // Đánh dấu ngay trong chính sổ vừa nhận: từ nay máy chủ chỉ là nơi cất giữ,
  // còn sổ gốc do thiết bị giữ. Nhờ vậy tự động hoá phía máy chủ không đụng vào
  // (nếu đụng thì lần gửi lên sau lúc nào cũng báo lệch).
  const d = new DatabaseSync(dich);
  try {
    const moi = Number(d.prepare("SELECT value FROM settings WHERE key='sync_rev'").get()?.value || 0) + 1;
    const dat = d.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    dat.run('sync_rev', String(moi));
    dat.run('sync_at', new Date().toISOString());
    dat.run('sync_owner', 'device');
    if (device) dat.run('sync_device', String(device).slice(0, 80));
    return { rev: moi };
  } finally { d.close(); }
}
