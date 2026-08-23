/** Báo cáo & thống kê: dòng tiền theo tháng, cơ cấu chi, nguồn thu, tỷ lệ tiết kiệm. */
import { all, get } from '../db.js';
import { today, monthKey, monthStart, monthEnd, lastMonths, addMonths, startOfMonth, endOfMonth, diffDays } from '../util/date.js';

const NOT_EXCLUDED = 't.excluded = 0';

export function totals(from, to) {
  const income = get(`SELECT COALESCE(SUM(amount),0) s FROM transactions t WHERE type='income' AND ${NOT_EXCLUDED} AND date BETWEEN ? AND ?`, [from, to]).s;
  const expense = get(`SELECT COALESCE(SUM(amount),0) s FROM transactions t WHERE type='expense' AND ${NOT_EXCLUDED} AND date BETWEEN ? AND ?`, [from, to]).s;
  return { income, expense, net: income - expense, savings_rate: income ? (income - expense) / income : 0 };
}

export function categoryBreakdown(from, to, kind = 'expense') {
  return all(
    `SELECT c.id, c.name, c.icon, c.color, c.group_name, c.essential, COUNT(*) n, SUM(t.amount) amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = ? AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY c.id ORDER BY amount DESC`,
    [kind, from, to]
  );
}

export function fundBreakdown(from, to) {
  return all(
    `SELECT f.id, f.name, f.color, SUM(t.amount) amount, COUNT(*) n
     FROM transactions t JOIN funds f ON f.id = t.fund_id
     WHERE t.type='expense' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY f.id ORDER BY amount DESC`,
    [from, to]
  );
}

export function topMerchants(from, to, limit = 8) {
  return all(
    `SELECT COALESCE(NULLIF(t.merchant,''), NULLIF(t.note,''), 'Khác') name, SUM(t.amount) amount, COUNT(*) n
     FROM transactions t WHERE t.type='expense' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY lower(name) ORDER BY amount DESC LIMIT ?`,
    [from, to, limit]
  );
}

export function dailySeries(from, to) {
  return all(
    `SELECT date, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) income,
            SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) expense
     FROM transactions t WHERE ${NOT_EXCLUDED} AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
    [from, to]
  );
}

export function monthlyTrend(n = 12) {
  const months = lastMonths(n);
  return months.map((m) => {
    const t = totals(monthStart(m), monthEnd(m));
    return { month: m, ...t };
  });
}

/** Cơ cấu thu nhập theo nguồn (lương, đầu tư, cho thuê, lãi ngân hàng...) */
export function incomeSources(from, to) {
  const byStream = all(
    `SELECT s.id, s.name, s.type, SUM(t.amount) amount, COUNT(*) n
     FROM transactions t JOIN income_streams s ON s.id = t.income_stream_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? GROUP BY s.id`,
    [from, to]
  );
  const byCategory = all(
    `SELECT c.id, c.name, c.icon, c.group_name, SUM(t.amount) amount, COUNT(*) n
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? AND t.income_stream_id IS NULL
     GROUP BY c.id`,
    [from, to]
  );
  const passiveGroups = ['Thu nhập thụ động'];
  const passive = get(
    `SELECT COALESCE(SUM(t.amount),0) s FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? AND c.group_name IN (${passiveGroups.map(() => '?').join(',')})`,
    [from, to, ...passiveGroups]
  ).s;
  const total = totals(from, to).income;
  return { streams: byStream, categories: byCategory, passive, active: total - passive, total, passive_ratio: total ? passive / total : 0 };
}

/** Chi tiêu trung bình/tháng (loại bỏ tháng chưa đủ dữ liệu) */
export function averageMonthlyExpense(months = 6) {
  const list = monthlyTrend(months + 1).slice(0, -1); // bỏ tháng hiện tại (chưa xong)
  const valid = list.filter((m) => m.expense > 0);
  if (!valid.length) {
    const cur = totals(monthStart(monthKey()), today());
    const days = Math.max(1, diffDays(monthStart(monthKey()), today()) + 1);
    return Math.round((cur.expense / days) * 30);
  }
  return Math.round(valid.reduce((s, m) => s + m.expense, 0) / valid.length);
}

export function averageMonthlyIncome(months = 6) {
  const list = monthlyTrend(months + 1).slice(0, -1);
  const valid = list.filter((m) => m.income > 0);
  if (!valid.length) return totals(monthStart(monthKey()), today()).income;
  return Math.round(valid.reduce((s, m) => s + m.income, 0) / valid.length);
}

/** Chi thiết yếu vs chi tuỳ ý */
export function essentialSplit(from, to) {
  const rows = all(
    `SELECT c.essential, SUM(t.amount) amount FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='expense' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? GROUP BY c.essential`,
    [from, to]
  );
  const essential = rows.find((r) => r.essential === 1)?.amount || 0;
  const discretionary = rows.find((r) => r.essential === 0)?.amount || 0;
  return { essential, discretionary, total: essential + discretionary };
}

export function monthReport(mk = monthKey()) {
  const from = monthStart(mk);
  const to = monthEnd(mk);
  const prev = monthKey(addMonths(from, -1));
  const cur = totals(from, to);
  const previous = totals(monthStart(prev), monthEnd(prev));
  return {
    month: mk,
    ...cur,
    prev: previous,
    change: {
      income: previous.income ? (cur.income - previous.income) / previous.income : 0,
      expense: previous.expense ? (cur.expense - previous.expense) / previous.expense : 0,
    },
    categories: categoryBreakdown(from, to),
    income_categories: categoryBreakdown(from, to, 'income'),
    funds: fundBreakdown(from, to),
    merchants: topMerchants(from, to),
    daily: dailySeries(from, to),
    essential: essentialSplit(from, to),
    sources: incomeSources(from, to),
    count: get(`SELECT COUNT(*) c FROM transactions t WHERE ${NOT_EXCLUDED} AND date BETWEEN ? AND ?`, [from, to]).c,
  };
}
