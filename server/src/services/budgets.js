/** Ngân sách theo danh mục/quỹ: đang tiêu nhanh hay chậm so với nhịp tháng. */
import { all, get, insert, update } from '../db.js';
import { actorId } from '../db_context.js';
import { today, monthKey, monthStart, monthEnd, diffDays, addMonths, lastMonths } from '../util/date.js';

export function listBudgets(mk = monthKey()) {
  return all('SELECT * FROM budgets WHERE active = 1 AND (month IS NULL OR month = ?)', [mk]);
}

/**
 * Mệnh đề lọc "khoản này của ai" cho một hạn mức.
 *
 * user_id trống = hạn mức của CẢ NHÀ: đếm mọi khoản, kể cả khoản chưa biết ai
 * ghi (những gì có trước khi sổ thành sổ chung). user_id có giá trị = hạn mức
 * riêng của một người: chỉ đếm khoản mang tên người đó.
 *
 * Trả về mảnh SQL kèm tham số chứ không phải chuỗi nối tay, để không có đường
 * nào nhét được giá trị lạ vào câu truy vấn.
 */
const locNguoi = (b) => (b.user_id == null
  ? { sql: '', p: [] }
  : { sql: ' AND created_by = ?', p: [Number(b.user_id)] });

export function budgetStatus(mk = monthKey()) {
  const from = monthStart(mk);
  const to = monthEnd(mk);
  const isCurrent = mk === monthKey();
  const dayNow = isCurrent ? diffDays(from, today()) + 1 : diffDays(from, to) + 1;
  const daysTotal = diffDays(from, to) + 1;
  const pace = dayNow / daysTotal;

  const items = listBudgets(mk).map((b) => {
    const target = b.category_id
      ? get('SELECT name, icon, color FROM categories WHERE id = ?', [b.category_id])
      : get('SELECT name, icon, color FROM funds WHERE id = ?', [b.fund_id]);
    const ai = locNguoi(b);
    const spent = b.category_id
      ? get(`SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE type='expense' AND excluded=0 AND category_id = ? AND date BETWEEN ? AND ?${ai.sql}`, [b.category_id, from, to, ...ai.p]).s
      : get(`SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE type='expense' AND excluded=0 AND fund_id = ? AND date BETWEEN ? AND ?${ai.sql}`, [b.fund_id, from, to, ...ai.p]).s;
    let limit = b.amount;
    if (b.rollover) limit += rolloverAmount(b, mk);
    const pctUsed = limit ? spent / limit : 0;
    const projected = pace > 0 ? Math.round(spent / pace) : spent;
    return {
      ...b,
      name: target?.name || 'Ngân sách',
      icon: target?.icon,
      color: target?.color,
      limit,
      spent,
      remaining: limit - spent,
      pct: pctUsed,
      projected,
      pace,
      // Hạn mức của riêng ai — giao diện cần để ghi tên lên thẻ, và để người
      // ta không tưởng hạn mức của vợ là hạn mức của cả nhà.
      cua_toi: b.user_id != null && Number(b.user_id) === actorId(),
      status: pctUsed >= 1 ? 'over' : pctUsed > pace + 0.15 ? 'fast' : pctUsed >= b.alert_threshold ? 'warn' : 'ok',
      daily_left: isCurrent && daysTotal - dayNow > 0 ? Math.round(Math.max(0, limit - spent) / (daysTotal - dayNow + 1)) : 0,
    };
  });
  const totalLimit = items.reduce((s, i) => s + i.limit, 0);
  const totalSpent = items.reduce((s, i) => s + i.spent, 0);
  return { month: mk, items, total_limit: totalLimit, total_spent: totalSpent, pace, over: items.filter((i) => i.status === 'over').length };
}

function rolloverAmount(budget, mk) {
  const prev = monthKey(addMonths(monthStart(mk), -1));
  const from = monthStart(prev);
  const to = monthEnd(prev);
  const ai = locNguoi(budget);
  const spent = budget.category_id
    ? get(`SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE type='expense' AND excluded=0 AND category_id = ? AND date BETWEEN ? AND ?${ai.sql}`, [budget.category_id, from, to, ...ai.p]).s
    : get(`SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE type='expense' AND excluded=0 AND fund_id = ? AND date BETWEEN ? AND ?${ai.sql}`, [budget.fund_id, from, to, ...ai.p]).s;
  return Math.max(0, budget.amount - spent);
}

/**
 * Gợi ý ngân sách dựa trên trung bình 3 tháng gần nhất.
 *
 * Bỏ qua nhóm "Tích luỹ": đặt hạn mức cho tiền đem đi đầu tư rồi khuyên cắt
 * 10% là lời khuyên ngược — app sẽ giục người dùng tiết kiệm ít đi.
 */
export function suggestBudgets(months = 3) {
  const list = lastMonths(months);
  const rows = all(
    `SELECT c.id, c.name, c.icon, c.essential, SUM(COALESCE(t.base_amount, t.amount)) total, COUNT(DISTINCT substr(t.date,1,7)) nm
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='expense' AND t.excluded=0 AND COALESCE(c.group_name,'') != 'Tích luỹ'
       AND substr(t.date,1,7) IN (${list.map(() => '?').join(',')})
     GROUP BY c.id ORDER BY total DESC`,
    list
  );
  return rows.map((r) => ({
    category_id: r.id,
    name: r.name,
    icon: r.icon,
    essential: r.essential,
    average: Math.round(r.total / Math.max(1, r.nm)),
    suggested: Math.round((r.total / Math.max(1, r.nm)) * (r.essential ? 1.05 : 0.9) / 10000) * 10000,
  }));
}

export function upsertBudget(data) {
  if (data.amount !== undefined) {
    const amt = Math.round(Number(data.amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Hạn mức ngân sách phải là số dương');
    data = { ...data, amount: amt };
  }
  if (data.id) {
    update('budgets', data.id, data);
    return get('SELECT * FROM budgets WHERE id = ?', [data.id]);
  }
  // "Đã có hạn mức này chưa" phải tính cả CHỦ của hạn mức. Bỏ user_id ra khỏi
  // đây thì trong sổ chung, đặt hạn mức ăn ngoài cho vợ sẽ ĐÈ lên hạn mức ăn
  // ngoài của chồng — cùng danh mục, cùng tháng, khớp ngay điều kiện cũ.
  const ai = data.user_id ?? null;
  const existing = data.category_id
    ? get('SELECT * FROM budgets WHERE category_id = ? AND (month IS ? OR month = ?) AND (user_id IS ? OR user_id = ?)',
      [data.category_id, data.month ?? null, data.month ?? null, ai, ai])
    : data.fund_id
    ? get('SELECT * FROM budgets WHERE fund_id = ? AND (month IS ? OR month = ?) AND (user_id IS ? OR user_id = ?)',
      [data.fund_id, data.month ?? null, data.month ?? null, ai, ai])
    : null;
  if (existing) {
    update('budgets', existing.id, { amount: data.amount, rollover: data.rollover, alert_threshold: data.alert_threshold, active: 1 });
    return get('SELECT * FROM budgets WHERE id = ?', [existing.id]);
  }
  const id = insert('budgets', data);
  return get('SELECT * FROM budgets WHERE id = ?', [id]);
}
