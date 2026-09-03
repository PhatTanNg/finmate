/**
 * Đề xuất của AI — việc cụ thể chờ người dùng gật đầu.
 *
 * Vì sao cần: cảnh báo kiểu "ngân sách sắp vượt" bắt người dùng tự nghĩ xem
 * phải bấm gì, ở tab nào. Một cố vấn thật thì nói "tôi định làm X, đồng ý
 * không?" và làm ngay khi được gật. Mỗi đề xuất ở đây là một chuỗi lời gọi
 * công cụ có tham số sẵn — cùng bộ công cụ AI dùng trong chat — nên "Đồng ý"
 * (hay nhắn "ừ") là app tự làm, có nhật ký và hoàn tác được như mọi việc AI làm.
 */
import { all, get, run, insert, update, beginAudit, endAudit, abortAudit } from '../db.js';
import { runTool } from './chat/tools.js';

const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

function normalizeActions(actions) {
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  const out = list
    .map((a) => ({ tool: String(a?.tool || a?.cong_cu || '').trim(), args: (a?.args ?? a?.tham_so ?? {}) }))
    .filter((a) => a.tool);
  if (!out.length) throw new Error('Đề xuất phải có ít nhất một hành động (tool + args).');
  for (const a of out) if (a.args && typeof a.args !== 'object') throw new Error(`Tham số của ${a.tool} phải là object.`);
  return out;
}

const row = (p) => (p ? {
  id: p.id, key: p.key, tieu_de: p.title, noi_dung: p.body, hanh_dong: parse(p.actions, []),
  nguon: p.source, muc_do: p.severity, tu_lam_duoc: !!p.auto_ok, trang_thai: p.status,
  ket_qua: parse(p.result), tin_nhan: p.message_id, luc: p.created_at, quyet_dinh_luc: p.decided_at, het_han: p.expires_at,
} : null);

/**
 * Tạo (hoặc cập nhật) một đề xuất. Cùng `key` mà đang chờ thì chỉ làm mới nội
 * dung, không đẻ thêm bản trùng; cùng `key` mà vừa bị từ chối trong 30 ngày thì
 * thôi — người dùng đã nói không, đừng hỏi lại mỗi giờ.
 */
export function propose({ key = null, title, body = '', actions, source = 'autopilot', severity = 'info', auto_ok = false, expires_days = 14 }) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Đề xuất cần tiêu đề.');
  const acts = normalizeActions(actions);
  if (key) {
    const pending = get("SELECT * FROM ai_proposals WHERE key = ? AND status = 'pending'", [key]);
    if (pending) {
      update('ai_proposals', pending.id, { title: t, body, actions: JSON.stringify(acts), severity, auto_ok: auto_ok ? 1 : 0 });
      return { ...row(get('SELECT * FROM ai_proposals WHERE id = ?', [pending.id])), moi: false };
    }
    const declined = get("SELECT id FROM ai_proposals WHERE key = ? AND status = 'rejected' AND decided_at >= datetime('now', '-30 days')", [key]);
    if (declined) return null;
    const doneRecently = get("SELECT id FROM ai_proposals WHERE key = ? AND status = 'accepted' AND decided_at >= datetime('now', '-7 days')", [key]);
    if (doneRecently) return null;
  }
  const id = insert('ai_proposals', {
    key, title: t, body: String(body || ''), actions: JSON.stringify(acts), source, severity,
    auto_ok: auto_ok ? 1 : 0, status: 'pending',
    expires_at: expires_days ? new Date(Date.now() + expires_days * 86400000).toISOString().slice(0, 10) : null,
  });
  return { ...row(get('SELECT * FROM ai_proposals WHERE id = ?', [id])), moi: true };
}

export function listProposals({ status = 'pending', limit = 20 } = {}) {
  const rows = status
    ? all('SELECT * FROM ai_proposals WHERE status = ? ORDER BY id DESC LIMIT ?', [status, limit])
    : all('SELECT * FROM ai_proposals ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(row);
}

export const getProposal = (id) => row(get('SELECT * FROM ai_proposals WHERE id = ?', [Number(id)]));
export const latestPending = () => row(get("SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY id DESC LIMIT 1"));
export const pendingCount = () => get("SELECT COUNT(*) n FROM ai_proposals WHERE status = 'pending'")?.n || 0;

/** Bản rút gọn nhét vào prompt của agent, để "ừ" của người dùng có chỗ để hiểu. */
export function pendingBrief(limit = 5) {
  return listProposals({ status: 'pending', limit }).map((p) => ({ ma: p.id, tieu_de: p.tieu_de }));
}

/**
 * Thực hiện một đề xuất: chạy lần lượt từng công cụ, tất cả trong một lượt
 * (batch) để hoàn tác được cả cụm. Công cụ nào hỏng thì dừng, đánh dấu thất
 * bại và nói rõ hỏng ở đâu — không im lặng làm nửa chừng.
 */
export function acceptProposal(id, { source = 'proposal' } = {}) {
  const p = get('SELECT * FROM ai_proposals WHERE id = ?', [Number(id)]);
  if (!p) return { ok: false, error: `Không có đề xuất #${id}.` };
  if (p.status !== 'pending') return { ok: false, error: `Đề xuất #${id} đã ${p.status === 'accepted' ? 'được thực hiện' : p.status === 'rejected' ? 'bị bỏ qua' : 'hết hạn'} rồi.` };

  const actions = parse(p.actions, []);
  const batch = `proposal-${p.id}-${Date.now().toString(36)}`;
  const outs = [];
  let mutated = false;
  for (const a of actions) {
    let out;
    beginAudit({ tool: a.tool, args: a.args, batch, source, reason: `Đề xuất #${p.id}: ${p.title}` });
    try {
      out = runTool(a.tool, a.args || {});
    } finally {
      try { endAudit(out, out?.ok !== false); } catch { abortAudit(); }
    }
    outs.push({ tool: a.tool, ...out });
    if (out?.mutates) mutated = true;
    if (out?.ok === false) {
      update('ai_proposals', p.id, { status: 'failed', result: JSON.stringify(outs).slice(0, 4000), decided_at: new Date().toISOString() });
      return { ok: false, error: `Hỏng ở bước ${a.tool}: ${out.error}`, batch, ket_qua: outs, mutates: mutated };
    }
  }
  update('ai_proposals', p.id, { status: 'accepted', result: JSON.stringify(outs).slice(0, 4000), decided_at: new Date().toISOString() });
  return { ok: true, mutates: mutated, batch, tieu_de: p.title, ket_qua: outs, so_buoc: outs.length };
}

export function rejectProposal(id) {
  const p = get('SELECT * FROM ai_proposals WHERE id = ?', [Number(id)]);
  if (!p) return { ok: false, error: `Không có đề xuất #${id}.` };
  if (p.status !== 'pending') return { ok: false, error: `Đề xuất #${id} không còn chờ nữa.` };
  update('ai_proposals', p.id, { status: 'rejected', decided_at: new Date().toISOString() });
  return { ok: true, tieu_de: p.title };
}

/** Đề xuất quá hạn thì tự đóng — để danh sách chờ không chất đống việc cũ. */
export function expireProposals() {
  const r = run("UPDATE ai_proposals SET status = 'expired', decided_at = datetime('now') WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < date('now')");
  return { het_han: r.changes };
}

export function proposalStats() {
  const s = get(`SELECT COUNT(*) tong,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) cho,
    SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) da_lam,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) bo_qua FROM ai_proposals`) || {};
  return { tong: s.tong || 0, dang_cho: s.cho || 0, da_lam: s.da_lam || 0, bo_qua: s.bo_qua || 0 };
}

export const _internals = { normalizeActions };
