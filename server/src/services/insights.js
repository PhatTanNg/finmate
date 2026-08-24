/** Máy phát hiện vấn đề & cơ hội — chạy sau mỗi lần đồng bộ, đẩy cảnh báo vào feed. */
import { all, get, run, insert } from '../db.js';
import { today, monthKey, monthStart, monthEnd, addMonths, lastMonths, diffDays, vnDate } from '../util/date.js';
import { short, fmt } from '../util/money.js';
import { vndThreshold } from './fx.js';
import { totals, categoryBreakdown, averageMonthlyExpense, averageMonthlyIncome, monthlyTrend } from './reports.js';
import { budgetStatus } from './budgets.js';
import { dailyForecast } from './forecast.js';
import { emergencyStatus, fireStats } from './fire.js';
import { debtSummary } from './debts.js';
import { netWorth } from './networth.js';
import { upcoming } from './recurring.js';
import { listFunds } from './funds.js';

function push(list, key, kind, severity, title, body, data = {}, action = null) {
  list.push({ key, kind, severity, title, body, data, action });
}

export function generateInsights() {
  const out = [];
  const mk = monthKey();
  const from = monthStart(mk);
  const to = monthEnd(mk);
  const cur = totals(from, to);
  const avgExpense = averageMonthlyExpense(3);
  const avgIncome = averageMonthlyIncome(3);

  // 1. Ngân sách
  const bs = budgetStatus(mk);
  for (const b of bs.items) {
    if (b.status === 'over') {
      push(out, `budget_over_${b.id}_${mk}`, 'alert', 'danger', `Vượt ngân sách ${b.name}`,
        `Đã tiêu ${short(b.spent)} / ${short(b.limit)} (${Math.round(b.pct * 100)}%). Vượt ${short(b.spent - b.limit)}.`,
        { budget_id: b.id }, 'Xem lại chi tiêu danh mục này hoặc chuyển tiền từ quỹ Hưởng thụ.');
    } else if (b.status === 'fast') {
      push(out, `budget_fast_${b.id}_${mk}`, 'alert', 'warn', `${b.name} đang tiêu nhanh hơn nhịp tháng`,
        `Mới qua ${Math.round(b.pace * 100)}% tháng nhưng đã dùng ${Math.round(b.pct * 100)}% ngân sách. Dự phóng cả tháng: ${short(b.projected)}.`,
        { budget_id: b.id }, `Giới hạn còn ${short(b.daily_left)}/ngày để về đích.`);
    }
  }

  // 2. Danh mục tăng đột biến so với 3 tháng trước
  const prevMonths = lastMonths(4).slice(0, 3);
  const curCats = categoryBreakdown(from, to);
  for (const c of curCats) {
    const hist = get(
      `SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE type='expense' AND excluded=0 AND category_id = ? AND substr(date,1,7) IN (${prevMonths.map(() => '?').join(',')})`,
      [c.id, ...prevMonths]
    ).s;
    const avg = hist / 3;
    if (avg > vndThreshold(200_000) && c.amount > avg * 1.5 && c.amount - avg > vndThreshold(300_000)) {
      push(out, `spike_${c.id}_${mk}`, 'alert', 'warn', `${c.icon || ''} ${c.name} tăng ${Math.round((c.amount / avg - 1) * 100)}%`,
        `Tháng này ${short(c.amount)} so với trung bình ${short(avg)}.`, { category_id: c.id });
    }
  }

  // 3. Giao dịch bất thường (lớn hơn 5 lần chi tiêu trung vị)
  const median = get(`SELECT COALESCE(base_amount, amount) AS amount FROM transactions WHERE type='expense' AND excluded=0 ORDER BY amount LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM transactions WHERE type='expense' AND excluded=0)`);
  if (median) {
    const bigs = all("SELECT t.*, c.name cname FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.type='expense' AND t.excluded=0 AND t.date >= ? AND COALESCE(t.base_amount, t.amount) > ? ORDER BY COALESCE(t.base_amount, t.amount) DESC LIMIT 3", [from, Math.max(median.amount * 5, vndThreshold(2_000_000))]);
    for (const b of bigs) {
      push(out, `big_${b.id}`, 'alert', 'info', `Chi lớn: ${short(b.base_amount ?? b.amount)}`,
        `${b.note || b.merchant || b.cname || 'Giao dịch'} ngày ${vnDate(b.date)}.`, { transaction_id: b.id });
    }
  }

  // 4. Dự báo hụt tiền
  const fc = dailyForecast(60);
  if (fc.shortfall) {
    push(out, `shortfall_${fc.shortfall}`, 'forecast', 'danger', `Nguy cơ hết tiền ngày ${vnDate(fc.shortfall)}`,
      `Với nhịp chi hiện tại (~${short(fc.variable_daily)}/ngày) và các khoản cố định sắp tới, số dư khả dụng sẽ về âm.`,
      { date: fc.shortfall }, 'Hoãn khoản chi lớn hoặc rút từ quỹ khẩn cấp/tiết kiệm.');
  } else if (fc.min.balance < avgExpense * 0.3 && avgExpense > 0) {
    push(out, `lowpoint_${fc.min.date}`, 'forecast', 'warn', `Số dư xuống thấp quanh ${vnDate(fc.min.date)}`,
      `Điểm thấp nhất dự kiến ${short(fc.min.balance)}.`, { date: fc.min.date });
  }

  // 5. Quỹ khẩn cấp
  const ef = emergencyStatus();
  if (!ef.ok && ef.monthly_expense > 0) {
    push(out, `ef_gap`, 'risk', ef.months_covered < 1 ? 'danger' : 'warn', `Quỹ khẩn cấp mới đủ ${ef.months_covered} tháng`,
      `Mục tiêu ${ef.target_months} tháng (${short(ef.target_amount)}). Còn thiếu ${short(ef.gap)}.`,
      { gap: ef.gap }, 'Ưu tiên nạp quỹ khẩn cấp trước khi đầu tư thêm.');
  }

  // 6. Tỷ lệ tiết kiệm
  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  const target = p.savings_rate_target ?? 0.3;
  if (avgIncome > 0) {
    const rate = (avgIncome - avgExpense) / avgIncome;
    if (rate < target) {
      push(out, `savings_rate_${mk}`, 'risk', rate < 0 ? 'danger' : 'warn', `Tỷ lệ tiết kiệm ${Math.round(rate * 100)}% (mục tiêu ${Math.round(target * 100)}%)`,
        `Thu ~${short(avgIncome)}/tháng, chi ~${short(avgExpense)}/tháng. Cần dôi thêm ${short(Math.max(0, avgIncome * target - (avgIncome - avgExpense)))}/tháng.`,
        { rate });
    } else {
      push(out, `savings_ok_${mk}`, 'win', 'success', `Tiết kiệm ${Math.round(rate * 100)}% thu nhập`,
        `Vượt mục tiêu ${Math.round(target * 100)}%. Giữ nhịp này.`, { rate });
    }
  }

  // 7. Nợ lãi cao
  const ds = debtSummary(avgIncome);
  for (const name of ds.high_interest) {
    push(out, `debt_high_${name}`, 'risk', 'danger', `Nợ lãi suất cao: ${name}`,
      `Lãi ≥15%/năm ăn mòn nhanh hơn mọi kênh đầu tư an toàn. Ưu tiên tất toán trước.`, {}, 'Dồn tiền dư vào khoản này (chiến lược avalanche).');
  }
  if (ds.dti > 0.4) {
    push(out, `dti_high`, 'risk', 'warn', `Nợ chiếm ${Math.round(ds.dti * 100)}% thu nhập`,
      `Ngưỡng an toàn là dưới 40%. Trả nợ hàng tháng ${short(ds.monthly_payment)}.`, { dti: ds.dti });
  }

  // 8. Quỹ bị âm
  for (const f of listFunds()) {
    if (f.balance < 0) {
      push(out, `fund_neg_${f.id}`, 'alert', 'warn', `Quỹ ${f.name} đang âm ${short(-f.balance)}`,
        `Bạn đã tiêu vượt phần được phân bổ. Cần bù từ quỹ khác hoặc giảm chi.`, { fund_id: f.id });
    }
  }

  // 9. Tiền nhàn rỗi
  const nw = netWorth();
  const idleThreshold = Math.max(avgExpense * 6, vndThreshold(20_000_000));
  if (nw.breakdown.liquid > idleThreshold && avgExpense > 0) {
    const idle = nw.breakdown.liquid - avgExpense * 6;
    push(out, `idle_cash`, 'tip', 'info', `Có ${short(idle)} tiền nhàn rỗi`,
      `Tiền trong tài khoản thanh toán gần như không sinh lãi, lại bị lạm phát bào mòn (~${Math.round((p.inflation ?? 0.04) * 100)}%/năm).`,
      { amount: idle }, 'Xem gợi ý phân bổ tiền dư ở tab Cố vấn.');
  }

  // 10. Mục tiêu gặp rủi ro
  const goals = all("SELECT * FROM goals WHERE status='active' AND deadline IS NOT NULL");
  for (const g of goals) {
    const monthsLeft = Math.max(0.1, diffDays(today(), g.deadline) / 30);
    const need = (g.target_amount - g.current_amount) / monthsLeft;
    if (need > Math.max(0, avgIncome - avgExpense) * 1.2 && need > 0) {
      push(out, `goal_risk_${g.id}`, 'risk', 'warn', `Mục tiêu "${g.name}" khó kịp hạn`,
        `Cần ${short(need)}/tháng trong ${Math.round(monthsLeft)} tháng, trong khi dôi dư hiện tại ~${short(Math.max(0, avgIncome - avgExpense))}/tháng.`,
        { goal_id: g.id }, 'Giãn hạn, giảm mục tiêu, hoặc tăng thu nhập.');
    }
  }

  // 11. Hoá đơn sắp tới
  const bills = upcoming(7).filter((e) => e.type === 'expense');
  if (bills.length) {
    const totalBills = bills.reduce((s, b) => s + b.amount, 0);
    push(out, `bills_${today()}`, 'forecast', 'info', `${bills.length} khoản cố định trong 7 ngày tới`,
      bills.map((b) => `${vnDate(b.date)}: ${b.name} ${short(b.amount)}`).join(' · '), { total: totalBills });
  }

  // 12. Thu nhập giảm
  const trend = monthlyTrend(4);
  if (trend.length >= 3) {
    const [a, b, c] = trend.slice(-3);
    if (a.income > 0 && c.income > 0 && c.income < a.income * 0.7 && c.month !== mk) {
      push(out, `income_drop_${c.month}`, 'risk', 'warn', 'Thu nhập đang giảm',
        `Từ ${short(a.income)} xuống ${short(c.income)}/tháng.`, {});
    }
  }

  // 13. Giao dịch cần xem lại
  const review = get('SELECT COUNT(*) c FROM transactions WHERE needs_review = 1').c;
  if (review > 0) {
    push(out, `review_${today()}`, 'tip', 'info', `${review} giao dịch chưa chắc danh mục`,
      'Xác nhận nhanh để app học và lần sau tự phân loại đúng.', { count: review }, 'Mở tab Giao dịch → lọc "Cần xem lại".');
  }

  // 14. Cột mốc tài sản ròng
  const best = get('SELECT MAX(net) m FROM networth_snapshots').m || 0;
  if (nw.net > best && nw.net > 0) {
    push(out, `nw_record_${mk}`, 'win', 'success', `Tài sản ròng đạt đỉnh mới: ${short(nw.net)}`,
      'Kỷ lục cá nhân mới. Tiếp tục giữ nhịp tích luỹ.', { net: nw.net });
  }

  // 15. Chưa có gì để phân tích -> nói thẳng thiếu gì, thay vì im lặng
  if (out.length === 0) {
    const missing = [];
    if (avgExpense === 0) missing.push('chưa có khoản chi nào được ghi');
    if (avgIncome === 0) missing.push('chưa có khoản thu nào được ghi');
    if (!all('SELECT id FROM accounts LIMIT 1').length) missing.push('chưa khai tài khoản nào');
    push(out, `need_data_${mk}`, 'tip', 'info', 'Cần thêm dữ liệu để cố vấn cho bạn',
      missing.length
        ? `Hiện ${missing.join(', ')}. Bật đọc tin nhắn ngân hàng ở tab Tự động hoá, hoặc nhắn cho cố vấn kiểu "hôm nay tiêu 200k ăn trưa" — app sẽ tự ghi sổ.`
        : 'Dữ liệu mới chỉ đủ để hiển thị số dư. Sau vài tuần giao dịch, app sẽ chỉ ra được xu hướng chi tiêu và rủi ro dòng tiền.',
      { missing }, 'Mở tab Tự động hoá để bật ghi nhận tự động.');
  }

  // Lưu (nâng cấp nội dung nếu key đã tồn tại và chưa bị ẩn)
  for (const i of out) {
    const existing = get('SELECT * FROM insights WHERE key = ?', [i.key]);
    if (existing) {
      run('UPDATE insights SET title=?, body=?, severity=?, data=?, action=? WHERE id=?', [i.title, i.body, i.severity, JSON.stringify(i.data), i.action, existing.id]);
    } else {
      insert('insights', { ...i, data: JSON.stringify(i.data) });
    }
  }
  return out;
}

export function listInsights({ includeDismissed = false, limit = 40 } = {}) {
  const rows = all(
    `SELECT * FROM insights ${includeDismissed ? '' : 'WHERE dismissed = 0'} ORDER BY
     CASE severity WHEN 'danger' THEN 0 WHEN 'warn' THEN 1 WHEN 'success' THEN 3 ELSE 2 END, created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({ ...r, data: safeParse(r.data) }));
}

function safeParse(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
