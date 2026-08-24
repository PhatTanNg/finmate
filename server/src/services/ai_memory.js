/**
 * Trí nhớ dài hạn của cố vấn.
 *
 * Hội thoại chỉ giữ 14 lượt gần nhất, nên mọi thứ cần nhớ lâu — bạn ghét rủi
 * ro, mẹ bạn cần 5 triệu mỗi tháng, đã chốt hoãn mua nhà tới 2028 vì lãi suất —
 * phải nằm ở đây. Không có nó thì tháng sau AI lại hỏi lại từ đầu và khuyên
 * ngược với chính lời khuyên tháng trước.
 */
import { all, get, run } from '../db.js';

export const KINDS = ['fact', 'preference', 'constraint', 'decision', 'plan'];
const KIND_VI = {
  fact: 'Hoàn cảnh', preference: 'Sở thích', constraint: 'Ràng buộc',
  decision: 'Quyết định đã chốt', plan: 'Kế hoạch',
};

const clampImportance = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || 3)));

export function remember({ kind = 'fact', key, value, reason = null, importance = 3, source = 'chat', expires_at = null }) {
  const k = String(key || '').trim();
  const v = String(value ?? '').trim();
  if (!k) throw new Error('Thiếu tên mục cần nhớ.');
  if (!v) throw new Error('Thiếu nội dung cần nhớ.');
  const kd = KINDS.includes(kind) ? kind : 'fact';

  const existing = get('SELECT * FROM ai_memory WHERE kind = ? AND key = ?', [kd, k]);
  if (existing) {
    run("UPDATE ai_memory SET value = ?, reason = ?, importance = ?, source = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?",
      [v, reason, clampImportance(importance), source, expires_at, existing.id]);
    return { id: existing.id, kind: kd, key: k, value: v, cap_nhat_de_len: existing.value !== v ? existing.value : null };
  }
  const res = run('INSERT INTO ai_memory (kind, key, value, reason, importance, source, expires_at) VALUES (?,?,?,?,?,?,?)',
    [kd, k, v, reason, clampImportance(importance), source, expires_at]);
  return { id: Number(res.lastInsertRowid), kind: kd, key: k, value: v, moi: true };
}

export function forget({ key, kind = null, id = null }) {
  if (id) return { xoa: run('DELETE FROM ai_memory WHERE id = ?', [id]).changes };
  if (!key) throw new Error('Cần tên mục hoặc id để xoá.');
  const sql = kind ? 'DELETE FROM ai_memory WHERE key = ? AND kind = ?' : 'DELETE FROM ai_memory WHERE key = ?';
  return { xoa: run(sql, kind ? [key, kind] : [key]).changes };
}

function live() {
  return all("SELECT * FROM ai_memory WHERE expires_at IS NULL OR expires_at >= date('now') ORDER BY importance DESC, updated_at DESC");
}

export function listMemory({ kind = null } = {}) {
  const rows = live().filter((r) => !kind || r.kind === kind);
  return rows.map((r) => ({
    id: r.id, loai: r.kind, loai_vi: KIND_VI[r.kind] || r.kind,
    muc: r.key, noi_dung: r.value, ly_do: r.reason,
    do_quan_trong: r.importance, het_han: r.expires_at, cap_nhat: r.updated_at,
  }));
}

/**
 * Bản rút gọn nhét vào prompt mỗi lượt chat. Cắt theo độ quan trọng để không
 * ngốn hết cửa sổ ngữ cảnh: giữ tối đa 20 mục, mỗi mục 160 ký tự.
 */
export function memoryBrief(limit = 20) {
  const rows = live().slice(0, limit);
  if (!rows.length) return null;
  const out = {};
  for (const r of rows) {
    const bucket = KIND_VI[r.kind] || r.kind;
    (out[bucket] ||= []).push(`${r.key}: ${String(r.value).slice(0, 160)}`);
  }
  return out;
}

/** Xoá mục đã hết hạn — gọi trong tác vụ định kỳ. */
export function pruneMemory() {
  const r = run("DELETE FROM ai_memory WHERE expires_at IS NOT NULL AND expires_at < date('now')");
  return { xoa: r.changes };
}
