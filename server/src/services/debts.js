/** Nợ vay: lịch trả nợ, chiến lược tất toán (avalanche/snowball), ngày hết nợ. */
import { all, get } from '../db.js';
import { today, addMonths } from '../util/date.js';
import { pmt } from '../util/money.js';
import { declaredIncomeMonthly } from './fire.js';
import { baseCurrency, convert } from './fx.js';
import { normalizeCurrency } from '../util/currency.js';

export function listDebts() {
  return all("SELECT * FROM debts WHERE status != 'archived' ORDER BY interest_rate DESC");
}

/** Lịch trả nợ chi tiết cho 1 khoản vay (có thể kèm trả thêm mỗi tháng). */
export function amortize(debt, extraMonthly = 0, maxMonths = 600) {
  const rate = (debt.interest_rate || 0) / 100 / 12;
  let balance = debt.balance || 0;
  let payment = debt.monthly_payment || 0;
  if (!payment && debt.term_months) payment = Math.round(pmt(balance, (debt.interest_rate || 0) / 100, debt.term_months));
  if (!payment) payment = Math.max(Math.round(balance * 0.03), Math.round(balance * rate) + 1);
  const rows = [];
  let date = today();
  let totalInterest = 0;
  let m = 0;
  while (balance > 0 && m < maxMonths) {
    const interest = Math.round(balance * rate);
    let principal = payment + extraMonthly - interest;
    if (principal <= 0) return { rows, payoff_date: null, total_interest: null, months: null, never: true };
    principal = Math.min(principal, balance);
    balance -= principal;
    totalInterest += interest;
    date = addMonths(date, 1);
    m++;
    rows.push({ month: m, date, payment: principal + interest, interest, principal, balance });
  }
  return { rows, payoff_date: rows.length ? rows[rows.length - 1].date : today(), total_interest: totalInterest, months: m, never: false };
}

/**
 * Kế hoạch trả nợ tổng thể.
 * avalanche = ưu tiên lãi suất cao (tiết kiệm tiền nhất) | snowball = ưu tiên dư nợ nhỏ (tạo động lực)
 */
export function payoffPlan(strategy = 'avalanche', extraMonthly = 0) {
  const base = baseCurrency();
  // Quy mọi khoản về đồng tiền gốc trước khi xếp thứ tự và cộng lãi. Nếu để
  // nguyên tệ thì "bóng tuyết" sẽ tưởng khoản 20 triệu₫ lớn hơn khoản €5.000,
  // và tổng tiền lãi là phép cộng của hai đơn vị khác nhau.
  const debts = listDebts()
    .filter((d) => d.balance > 0)
    .map((d) => {
      const c = normalizeCurrency(d.currency) || base;
      const balance = convert(d.balance, c, base);
      const min = convert(d.min_payment || d.monthly_payment || 0, c, base) || Math.max(Math.round(balance * 0.03), 1);
      return { ...d, currency: base, balance, min };
    });
  if (!debts.length) return { strategy, months: 0, payoff_date: today(), total_interest: 0, order: [], debt_free: true };

  const order = [...debts].sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.interest_rate - a.interest_rate));
  const state = order.map((d) => ({ ...d }));
  let month = 0;
  let totalInterest = 0;
  const cleared = [];
  let date = today();

  while (state.some((d) => d.balance > 0) && month < 600) {
    month++;
    date = addMonths(date, 1);
    let extra = extraMonthly;
    for (const d of state) {
      if (d.balance <= 0) continue;
      const interest = Math.round((d.balance * (d.interest_rate / 100)) / 12);
      totalInterest += interest;
      d.balance += interest;
      const pay = Math.min(d.min, d.balance);
      d.balance -= pay;
    }
    for (const d of state) {
      if (extra <= 0) break;
      if (d.balance <= 0) continue;
      const pay = Math.min(extra, d.balance);
      d.balance -= pay;
      extra -= pay;
    }
    for (const d of state) {
      if (d.balance <= 0 && !cleared.find((c) => c.id === d.id)) {
        cleared.push({ id: d.id, name: d.name, date, month });
        extraMonthly += d.min; // hiệu ứng quả cầu tuyết: dồn tiền sang khoản kế tiếp
      }
    }
  }
  const paid = state.every((d) => d.balance <= 0);
  return {
    strategy,
    months: month,
    payoff_date: date,
    total_interest: totalInterest,
    monthly_minimum: debts.reduce((s, d) => s + d.min, 0),
    order: order.map((d) => ({ id: d.id, name: d.name, balance: d.balance, interest_rate: d.interest_rate, cleared_at: cleared.find((c) => c.id === d.id)?.date || null })),
    debt_free: paid,
  };
}

export function debtSummary(monthlyIncome = 0) {
  const base = baseCurrency();
  const raw = listDebts().filter((d) => d.balance > 0);
  // Nợ có thể nằm ở nhiều đồng tiền — người làm ở Ireland vay mua nhà ở Việt
  // Nam là chuyện thường. Phải quy về đồng tiền gốc trước khi cộng, nếu không
  // 1,68 tỷ₫ bị cộng thẳng vào tổng tính bằng euro và tỉ lệ nợ/thu nhập vọt
  // lên hàng nghìn phần trăm.
  const toBase = (v, c) => convert(v, normalizeCurrency(c) || base, base);
  const debts = raw.map((d) => ({
    ...d,
    balance_base: toBase(d.balance, d.currency),
    monthly_payment_base: toBase(d.monthly_payment || d.min_payment || 0, d.currency),
  }));
  const total = debts.reduce((s, d) => s + d.balance_base, 0);
  const monthly = debts.reduce((s, d) => s + d.monthly_payment_base, 0);
  const avgRate = total ? debts.reduce((s, d) => s + d.balance_base * d.interest_rate, 0) / total : 0;
  const avalanche = payoffPlan('avalanche', 0);
  // Chưa biết thu nhập thì không có tỉ lệ nợ/thu nhập — trả null thay vì 0.
  // Người đang ngập nợ mà thấy "trả 9 triệu/tháng (0% thu nhập)" sẽ tưởng gánh
  // nợ nhẹ, trong khi thực ra app chỉ đang chia cho 0.
  const income = monthlyIncome > 0 ? monthlyIncome : declaredIncomeMonthly().total;
  return {
    debts: debts.map((d) => ({ ...d, payoff: amortize(d).payoff_date })),
    total_balance: total,
    monthly_payment: monthly,
    currency: base,
    avg_rate: avgRate,
    dti: income > 0 ? monthly / income : null,
    dti_income: income || null,
    debt_free_date: avalanche.payoff_date,
    total_interest_remaining: avalanche.total_interest,
    high_interest: debts.filter((d) => d.interest_rate >= 15).map((d) => d.name),
  };
}
