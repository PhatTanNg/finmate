/** Báo cáo & thống kê: dòng tiền theo tháng, cơ cấu chi, nguồn thu, tỷ lệ tiết kiệm. */
import { all, get } from '../db.js';
// Vòng import với fire.js là có chủ ý và an toàn: cả hai phía chỉ gọi nhau lúc
// chạy, và declaredIncomeMonthly là function declaration nên được hoisted.
import { declaredIncomeMonthly } from './fire.js';
import { today, monthKey, monthStart, monthEnd, lastMonths, addMonths, startOfMonth, endOfMonth, diffDays } from '../util/date.js';

const NOT_EXCLUDED = 't.excluded = 0';
// Đa tiền tệ: mọi tổng hợp dùng số đã quy đổi về đồng tiền gốc
const AMT = 'COALESCE(t.base_amount, t.amount)';

/**
 * Tiền chuyển sang tiết kiệm/đầu tư vẫn là một khoản "chi" trong sổ — người
 * dùng cần thấy nó rời khỏi ví. Nhưng nó KHÔNG phải chi phí sống: gộp vào thì
 * người tiết kiệm càng nhiều càng bị app đánh giá là tiêu hoang, quỹ khẩn cấp
 * đòi nhiều hơn thực tế, và con số tự do tài chính bị thổi phồng theo đúng
 * phần tiền họ đang dành dụm.
 */
const SAVINGS_GROUP = 'Tích luỹ';
const NOT_SAVINGS = `t.category_id IS NULL OR t.category_id NOT IN (SELECT id FROM categories WHERE group_name = '${SAVINGS_GROUP}')`;
/** Tổng chi tiêu dùng thật sự (đã bỏ phần đem đi tích luỹ). */
export function livingExpense(from, to) {
  return get(
    `SELECT COALESCE(SUM(${AMT}),0) s FROM transactions t
     WHERE type='expense' AND ${NOT_EXCLUDED} AND (${NOT_SAVINGS}) AND date BETWEEN ? AND ?`,
    [from, to]
  ).s;
}
/** Tiền đã đẩy sang tiết kiệm/đầu tư trong kỳ. */
export function savedAmount(from, to) {
  return get(
    `SELECT COALESCE(SUM(${AMT}),0) s FROM transactions t
     WHERE type='expense' AND ${NOT_EXCLUDED} AND NOT (${NOT_SAVINGS}) AND date BETWEEN ? AND ?`,
    [from, to]
  ).s;
}

export function totals(from, to) {
  const income = get(`SELECT COALESCE(SUM(${AMT}),0) s FROM transactions t WHERE type='income' AND ${NOT_EXCLUDED} AND date BETWEEN ? AND ?`, [from, to]).s;
  const expense = get(`SELECT COALESCE(SUM(${AMT}),0) s FROM transactions t WHERE type='expense' AND ${NOT_EXCLUDED} AND date BETWEEN ? AND ?`, [from, to]).s;
  const saved = savedAmount(from, to);
  return {
    income, expense, net: income - expense,
    living_expense: expense - saved,
    saved,
    // Tiền cất đi vẫn là tiền để dành, nên tính vào tỉ lệ tiết kiệm.
    savings_rate: income ? (income - expense + saved) / income : 0,
  };
}

export function categoryBreakdown(from, to, kind = 'expense') {
  return all(
    `SELECT c.id, c.name, c.icon, c.color, c.group_name, c.essential, COUNT(*) n, SUM(${AMT}) amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = ? AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY c.id ORDER BY amount DESC`,
    [kind, from, to]
  );
}

export function fundBreakdown(from, to) {
  return all(
    `SELECT f.id, f.name, f.color, SUM(${AMT}) amount, COUNT(*) n
     FROM transactions t JOIN funds f ON f.id = t.fund_id
     WHERE t.type='expense' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY f.id ORDER BY amount DESC`,
    [from, to]
  );
}

export function topMerchants(from, to, limit = 8) {
  return all(
    `SELECT COALESCE(NULLIF(t.merchant,''), NULLIF(t.note,''), 'Khác') name, SUM(${AMT}) amount, COUNT(*) n
     FROM transactions t WHERE t.type='expense' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ?
     GROUP BY lower(name) ORDER BY amount DESC LIMIT ?`,
    [from, to, limit]
  );
}

export function dailySeries(from, to) {
  return all(
    `SELECT date, SUM(CASE WHEN type='income' THEN ${AMT} ELSE 0 END) income,
            SUM(CASE WHEN type='expense' THEN ${AMT} ELSE 0 END) expense
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
    `SELECT s.id, s.name, s.type, SUM(${AMT}) amount, COUNT(*) n
     FROM transactions t JOIN income_streams s ON s.id = t.income_stream_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? GROUP BY s.id`,
    [from, to]
  );
  const byCategory = all(
    `SELECT c.id, c.name, c.icon, c.group_name, SUM(${AMT}) amount, COUNT(*) n
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? AND t.income_stream_id IS NULL
     GROUP BY c.id`,
    [from, to]
  );
  const passiveGroups = ['Thu nhập thụ động'];
  const passive = get(
    `SELECT COALESCE(SUM(${AMT}),0) s FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type='income' AND ${NOT_EXCLUDED} AND t.date BETWEEN ? AND ? AND c.group_name IN (${passiveGroups.map(() => '?').join(',')})`,
    [from, to, ...passiveGroups]
  ).s;
  const total = totals(from, to).income;

  // Nguồn thu ĐÃ KHAI trong tab Thu nhập nhưng chưa (hoặc chưa kịp) sinh giao
  // dịch nào. Bỏ qua chúng thì người nghỉ hưu sống bằng lương hưu + tiền cho
  // thuê bị app xếp là "chủ động 100%" — kết luận ngược hoàn toàn với thực tế.
  // Lấy giá trị lớn hơn của mỗi phía thay vì cộng dồn, để nguồn nào đã có giao
  // dịch không bị tính hai lần.
  const declared = declaredIncomeMonthly();
  const months = Math.max(1, Math.round(monthSpan(from, to)));
  const txPassive = passive / months;
  const txActive = (total - passive) / months;
  const mixPassive = Math.max(txPassive, declared.passive);
  const mixActive = Math.max(txActive, declared.active);
  const mixTotal = mixPassive + mixActive;

  return {
    streams: byStream, categories: byCategory, passive, active: total - passive, total,
    // Chưa ghi nhận khoản thu nào thì không có tỉ lệ để nói — trả null thay vì
    // 0, tránh hiển thị "Chủ động 100%" cho người sống hoàn toàn bằng thu nhập
    // thụ động mà chưa có giao dịch nào vào sổ.
    has_data: total > 0,
    declared,
    monthly_passive: mixPassive,
    monthly_active: mixActive,
    passive_ratio: mixTotal > 0 ? mixPassive / mixTotal : null,
  };
}

/** Số tháng (có phần lẻ) giữa hai ngày 'YYYY-MM-DD'. */
function monthSpan(from, to) {
  const a = new Date(from); const b = new Date(to);
  const d = (b - a) / 86400000;
  return Number.isFinite(d) && d > 0 ? d / 30.44 : 1;
}

/**
 * Chi phí SỐNG trung bình mỗi tháng (loại bỏ tháng chưa đủ dữ liệu, và loại
 * phần tiền đem đi tích luỹ). Đây là con số dùng để tính quỹ khẩn cấp và mốc
 * tự do tài chính, nên phải phản ánh số tiền thật sự cần để sống.
 */
export function averageMonthlyExpense(months = 6) {
  const list = monthlyTrend(months + 1).slice(0, -1); // bỏ tháng hiện tại (chưa xong)
  const valid = list.filter((m) => m.expense > 0);
  if (!valid.length) {
    const cur = totals(monthStart(monthKey()), today());
    const days = Math.max(1, diffDays(monthStart(monthKey()), today()) + 1);
    // Ngoại suy tuyến tính từ vài ngày đầu tháng phóng đại kinh khủng: một
    // người khai 17,5 triệu chi tiêu cả tháng vào ngày mùng 3 sẽ bị tính thành
    // 175 triệu/tháng, và mọi thứ dựa trên nó — quỹ khẩn cấp, ngày tự do tài
    // chính, tỉ lệ thu nhập thụ động — đều sai gấp mười lần. Nhưng lấy đúng số
    // đã chi thì "số tiền an toàn để tiêu" của người mới lại về 0. Dung hoà: coi
    // như ít nhất nửa tháng đã trôi qua, sai số tối đa còn 2 lần thay vì 10 lần;
    // `data_months` ở tầng trên vẫn nói rõ dự báo còn mỏng.
    return Math.round((cur.living_expense / Math.max(days, 15)) * 30);
  }
  return Math.round(valid.reduce((s, m) => s + (m.living_expense ?? m.expense), 0) / valid.length);
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
    `SELECT c.essential, SUM(${AMT}) amount FROM transactions t JOIN categories c ON c.id = t.category_id
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
