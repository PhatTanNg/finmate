/** Dự báo dòng tiền: tiền sẽ về đâu trong 60 ngày / 12 tháng tới. */
import { all, get } from '../db.js';
import { today, addDays, addMonths, monthKey, monthStart, monthEnd, toISO, diffDays } from '../util/date.js';
import { projectRecurring, monthlyFixed } from './recurring.js';
import { averageMonthlyExpense, averageMonthlyIncome, totals } from './reports.js';
import { accountsBase } from './networth.js';

function liquidBalance() {
  return accountsBase(['cash', 'bank', 'ewallet']);
}

/** Dự báo số dư theo ngày — cảnh báo ngày có nguy cơ hụt tiền. */
export function dailyForecast(days = 60) {
  const start = today();
  const end = addDays(start, days);
  const events = projectRecurring(start, end);
  const fixed = monthlyFixed();
  const avgExpense = averageMonthlyExpense(3);
  const variableDaily = Math.max(0, (avgExpense - fixed.expense) / 30);

  let balance = liquidBalance();
  const series = [];
  let min = { date: start, balance };
  let shortfall = null;
  for (let i = 0; i <= days; i++) {
    const d = addDays(start, i);
    const dayEvents = events.filter((e) => e.date === d);
    for (const e of dayEvents) {
      if (e.type === 'income') balance += e.amount;
      else if (e.type === 'expense') balance -= e.amount;
    }
    if (i > 0) balance -= variableDaily;
    series.push({ date: d, balance: Math.round(balance), events: dayEvents.map((e) => ({ name: e.name, type: e.type, amount: e.amount })) });
    if (balance < min.balance) min = { date: d, balance: Math.round(balance) };
    if (balance < 0 && !shortfall) shortfall = d;
  }
  return { series, min, shortfall, variable_daily: Math.round(variableDaily), start_balance: liquidBalance() };
}

/** Dự báo 12 tháng: thu, chi, tích luỹ. */
export function monthlyForecast(months = 12) {
  const fixed = monthlyFixed();
  const avgIncome = averageMonthlyIncome(6);
  const avgExpense = averageMonthlyExpense(6);
  const income = Math.max(fixed.income, avgIncome || fixed.income);
  const expense = Math.max(fixed.expense, avgExpense || fixed.expense);
  let cumulative = liquidBalance();
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const m = monthKey(addMonths(monthStart(monthKey()), i));
    const extraEvents = projectRecurring(monthStart(m), monthEnd(m)).filter((e) => e.frequency !== 'monthly');
    cumulative += income - expense;
    rows.push({ month: m, income, expense, net: income - expense, cumulative: Math.round(cumulative) });
  }
  return { rows, monthly_income: income, monthly_expense: expense, monthly_net: income - expense };
}

/** Số tiền còn có thể tiêu an toàn trong tháng này */
export function safeToSpend() {
  const mk = monthKey();
  const from = monthStart(mk);
  const to = monthEnd(mk);
  const t = totals(from, to);
  const upcomingFixed = projectRecurring(today(), to).filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const liquid = liquidBalance();
  const daysLeft = Math.max(1, diffDays(today(), to) + 1);
  const buffer = Math.round(averageMonthlyExpense(3) * 0.1);
  const cashAvailable = Math.max(0, liquid - upcomingFixed - buffer);
  // Còn bao nhiêu trong "hạn mức chi tiêu bình thường" của tháng.
  // Hai vế phải cùng thước đo: `averageMonthlyExpense` là chi phí SỐNG bình
  // quân, nên phần đã dùng cũng phải là chi phí sống. Trừ cả tiền vừa đẩy vào
  // quỹ/ETF thì người tháng nào cũng tích luỹ đều bị báo "hết hạn mức, 0đ/ngày"
  // ngay sau ngày lương về.
  const spentLiving = t.living_expense ?? t.expense;
  const budgetRemaining = Math.max(0, Math.round(averageMonthlyExpense(3)) - spentLiving - upcomingFixed);
  const available = Math.min(cashAvailable, budgetRemaining);
  return {
    liquid,
    upcoming_fixed: upcomingFixed,
    buffer,
    cash_available: cashAvailable,
    budget_remaining: budgetRemaining,
    available,
    days_left: daysLeft,
    per_day: Math.round(available / daysLeft),
    spent_this_month: spentLiving,
    total_out_this_month: t.expense,
    saved_this_month: t.saved || 0,
    income_this_month: t.income,
  };
}
