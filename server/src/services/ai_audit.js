/**
 * Nhật ký và hoàn tác thao tác của AI.
 *
 * Một cố vấn tài chính thật phải giải trình được: đã đụng vào cái gì, lúc nào,
 * vì sao, và trả lại nguyên trạng được nếu bạn không đồng ý. Nếu không có phần
 * này thì mọi thao tác tự động đều là chuyện đã rồi.
 */
import { all, get, run } from '../db.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** Mô tả một thao tác bằng tiếng Việt dễ đọc, kèm số hàng dữ liệu bị đổi. */
function describe(a) {
  const args = parse(a.args) || {};
  const bits = [];
  for (const k of ['ten', 'quy', 'tai_khoan', 'so_tien', 'phan_tram', 'muc_tieu', 'danh_muc']) {
    if (args[k] != null && typeof args[k] !== 'object') bits.push(`${k}=${args[k]}`);
  }
  return `${a.tool}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

export function listActions({ limit = 50, batch = null, mutating_only = false } = {}) {
  const where = [];
  const params = [];
  if (batch) { where.push('batch = ?'); params.push(batch); }
  if (mutating_only) where.push('mutates = 1');
  const rows = all(
    `SELECT * FROM ai_actions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    [...params, limit],
  );
  return rows.map((a) => ({
    id: a.id,
    batch: a.batch,
    nguon: a.source,
    cong_cu: a.tool,
    mo_ta: describe(a),
    ly_do: a.reason,
    thay_doi_du_lieu: !!a.mutates,
    thanh_cong: !!a.ok,
    da_hoan_tac: !!a.undone_at,
    so_hang_doi: get('SELECT COUNT(*) n FROM ai_changes WHERE action_id = ?', [a.id])?.n || 0,
    luc: a.created_at,
  }));
}

/** Chi tiết từng hàng dữ liệu bị đổi — để người dùng soi được trước khi hoàn tác. */
export function actionDetail(id) {
  const a = get('SELECT * FROM ai_actions WHERE id = ?', [id]);
  if (!a) return null;
  const changes = all('SELECT * FROM ai_changes WHERE action_id = ? ORDER BY id', [id]);
  return {
    id: a.id,
    batch: a.batch,
    nguon: a.source,
    cong_cu: a.tool,
    mo_ta: describe(a),
    ly_do: a.reason,
    thay_doi_du_lieu: !!a.mutates,
    thanh_cong: !!a.ok,
    da_hoan_tac: !!a.undone_at,
    luc: a.created_at,
    tham_so: parse(a.args),
    ket_qua: parse(a.result),
    thay_doi: changes.map((c) => ({
      bang: c.tbl, thao_tac: c.op, hang: c.row_id,
      truoc: parse(c.before), sau: parse(c.after),
    })),
  };
}

const cols = (o) => Object.keys(o).filter((k) => k !== 'id');

/**
 * Hoàn tác một thao tác: áp ngược từng hàng dữ liệu về đúng trạng thái trước đó.
 * Đi ngược thứ tự ghi để hàng phụ thuộc được xử lý trước hàng gốc.
 */
function revertOne(actionId) {
  const a = get('SELECT * FROM ai_actions WHERE id = ?', [actionId]);
  if (!a) return { ok: false, error: `Không tìm thấy thao tác #${actionId}.` };
  if (a.undone_at) return { ok: false, error: `Thao tác #${actionId} đã được hoàn tác lúc ${a.undone_at}.` };

  const changes = all('SELECT * FROM ai_changes WHERE action_id = ? ORDER BY id DESC', [actionId]);
  if (!changes.length) {
    run("UPDATE ai_actions SET undone_at = datetime('now') WHERE id = ?", [actionId]);
    return { ok: true, khong_co_gi_de_hoan: true, thao_tac: a.tool };
  }

  let n = 0;
  for (const c of changes) {
    const before = parse(c.before);
    const after = parse(c.after);
    try {
      if (c.op === 'insert') {
        run(`DELETE FROM ${c.tbl} WHERE id = ?`, [c.row_id]);
      } else if (c.op === 'update' && before) {
        const ks = cols(before);
        run(`UPDATE ${c.tbl} SET ${ks.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...ks.map((k) => before[k]), c.row_id]);
      } else if (c.op === 'delete' && before) {
        const ks = Object.keys(before);
        run(`INSERT OR REPLACE INTO ${c.tbl} (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`,
          ks.map((k) => before[k]));
      }
      n += 1;
    } catch (e) {
      return { ok: false, error: `Hoàn tác hỏng ở bảng ${c.tbl}: ${e.message}`, da_hoan: n, con_lai: changes.length - n };
    }
    void after;
  }

  run("UPDATE ai_actions SET undone_at = datetime('now') WHERE id = ?", [actionId]);
  return { ok: true, thao_tac: a.tool, so_hang_khoi_phuc: n };
}

export function undoAction(id) {
  const r = revertOne(Number(id));
  return r.ok ? { ...r, mutates: true } : r;
}

/**
 * Hoàn tác cả một lượt chat: nhiều công cụ chạy nối nhau thì phải trả lại theo
 * thứ tự ngược, nếu không thao tác sau sẽ ghi đè kết quả khôi phục của thao tác
 * trước.
 */
export function undoBatch(batch) {
  const acts = all('SELECT id FROM ai_actions WHERE batch = ? AND undone_at IS NULL AND mutates = 1 ORDER BY id DESC', [batch]);
  if (!acts.length) return { ok: false, error: 'Lượt này không có thao tác nào thay đổi dữ liệu để hoàn tác.' };
  const done = [];
  for (const a of acts) {
    const r = revertOne(a.id);
    if (!r.ok) return { ok: false, error: r.error, da_hoan_tac: done };
    done.push(a.id);
  }
  return { ok: true, mutates: true, so_thao_tac_hoan_tac: done.length, cac_thao_tac: done };
}

/** Hoàn tác N thao tác thay đổi dữ liệu gần nhất, bất kể thuộc lượt nào. */
export function undoLast(n = 1) {
  const acts = all('SELECT id FROM ai_actions WHERE undone_at IS NULL AND mutates = 1 ORDER BY id DESC LIMIT ?', [Math.max(1, Math.min(50, Number(n) || 1))]);
  if (!acts.length) return { ok: false, error: 'Không có thao tác nào để hoàn tác.' };
  const done = [];
  for (const a of acts) {
    const r = revertOne(a.id);
    if (!r.ok) return { ok: false, error: r.error, da_hoan_tac: done };
    done.push(a.id);
  }
  return { ok: true, mutates: true, so_thao_tac_hoan_tac: done.length, cac_thao_tac: done };
}

/** Dọn nhật ký cũ để DB không phình mãi. Giữ mặc định 90 ngày. */
export function pruneActions(days = 90) {
  const cut = `-${Math.max(1, Number(days) || 90)} days`;
  run("DELETE FROM ai_changes WHERE action_id IN (SELECT id FROM ai_actions WHERE created_at < datetime('now', ?))", [cut]);
  const r = run("DELETE FROM ai_actions WHERE created_at < datetime('now', ?)", [cut]);
  return { xoa: r.changes };
}

export function actionStats() {
  const s = get(`SELECT COUNT(*) tong,
    SUM(CASE WHEN mutates = 1 THEN 1 ELSE 0 END) thay_doi,
    SUM(CASE WHEN undone_at IS NOT NULL THEN 1 ELSE 0 END) da_hoan_tac,
    SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) that_bai FROM ai_actions`) || {};
  return {
    tong: s.tong || 0,
    thay_doi_du_lieu: s.thay_doi || 0,
    da_hoan_tac: s.da_hoan_tac || 0,
    that_bai: s.that_bai || 0,
    theo_cong_cu: all('SELECT tool, COUNT(*) n FROM ai_actions GROUP BY tool ORDER BY n DESC LIMIT 10')
      .map((r) => ({ cong_cu: r.tool, lan: r.n })),
  };
}
