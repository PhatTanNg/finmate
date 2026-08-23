/** Nợ vay: lịch trả nợ, chiến lược tất toán (avalanche/snowball), ngày hết nợ. */
import { all, get } from '../db.js';
import { today, addMonths } from '../util/date.js';
import { pmt } from '../util/money.js';

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
  const debts = listDebts()
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, min: d.min_payment || d.monthly_payment || Math.max(Math.round(d.balance * 0.03), 100000) }));
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
  const debts = listDebts().filter((d) => d.balance > 0);
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const monthly = debts.reduce((s, d) => s + (d.monthly_payment || d.min_payment || 0), 0);
  const avgRate = total ? debts.reduce((s, d) => s + d.balance * d.interest_rate, 0) / total : 0;
  const avalanche = payoffPlan('avalanche', 0);
  return {
    debts: debts.map((d) => ({ ...d, payoff: amortize(d).payoff_date })),
    total_balance: total,
    monthly_payment: monthly,
    avg_rate: avgRate,
    dti: monthlyIncome ? monthly / monthlyIncome : 0,
    debt_free_date: avalanche.payoff_date,
    total_interest_remaining: avalanche.total_interest,
    high_interest: debts.filter((d) => d.interest_rate >= 15).map((d) => d.name),
  };
}
