/** Giao dịch định kỳ: lương, tiền nhà, subscription... tự động ghi sổ, không cần nhập tay. */
import { all, get, run, insert, update } from '../db.js';
import { today, addPeriod, addMonths, toISO, parseISO, daysInMonth } from '../util/date.js';
import { createTransaction } from './ledger.js';

export function normalizeNext(rec, from = today()) {
  let next = rec.next_date || rec.start_date || from;
  if (rec.frequency === 'monthly' && rec.day_of_month) {
    const d = parseISO(next);
    const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    d.setDate(Math.min(rec.day_of_month, dim));
    next = toISO(d);
  }
  return next;
}

export function createRecurring(data) {
  const start = data.start_date || today();
  const rec = {
    ...data,
    start_date: start,
    next_date: data.next_date || start,
    frequency: data.frequency || 'monthly',
    interval_n: data.interval_n || 1,
  };
  const id = insert('recurring', rec);
  const saved = get('SELECT * FROM recurring WHERE id = ?', [id]);
  update('recurring', id, { next_date: normalizeNext(saved) });
  return get('SELECT * FROM recurring WHERE id = ?', [id]);
}

/** Chạy tất cả khoản định kỳ đã tới hạn (bù cả những kỳ bị bỏ lỡ). */
export function runDueRecurring(asOf = today()) {
  const list = all('SELECT * FROM recurring WHERE active = 1 AND auto_post = 1 AND variable = 0');
  const posted = [];
  for (const rec of list) {
    let next = normalizeNext(rec, asOf);
    let guard = 0;
    while (next <= asOf && (!rec.end_date || next <= rec.end_date) && guard++ < 60) {
      const res = createTransaction({
        type: rec.type,
        amount: rec.amount,
        date: next,
        account_id: rec.account_id,
        counter_account_id: rec.counter_account_id,
        category_id: rec.category_id,
        fund_id: rec.fund_id,
        income_stream_id: rec.income_stream_id,
        debt_id: rec.debt_id,
        note: rec.name,
        source: 'recurring',
        external_id: `rec:${rec.id}:${next}`,
      });
      if (!res.duplicate) posted.push({ recurring_id: rec.id, name: rec.name, date: next, amount: rec.amount, type: rec.type, allocation: res.allocation });
      next = addPeriod(next, rec.frequency, rec.interval_n || 1);
    }
    update('recurring', rec.id, { next_date: next, last_posted: asOf });
  }
  return posted;
}

/** Bung các khoản định kỳ thành danh sách sự kiện trong khoảng (dùng cho dự báo dòng tiền). */
export function projectRecurring(from, to) {
  const list = all('SELECT * FROM recurring WHERE active = 1');
  const events = [];
  for (const rec of list) {
    let d = normalizeNext(rec, from);
    let guard = 0;
    while (d < from && guard++ < 400) d = addPeriod(d, rec.frequency, rec.interval_n || 1);
    guard = 0;
    while (d <= to && (!rec.end_date || d <= rec.end_date) && guard++ < 400) {
      events.push({
        date: d,
        name: rec.name,
        type: rec.type,
        amount: rec.amount,
        account_id: rec.account_id,
        category_id: rec.category_id,
        recurring_id: rec.id,
        variable: rec.variable,
      });
      d = addPeriod(d, rec.frequency, rec.interval_n || 1);
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function upcoming(days = 30) {
  const to = toISO(new Date(Date.now() + days * 86400000));
  return projectRecurring(today(), to);
}

/** Tổng thu/chi cố định hàng tháng (quy đổi về tháng) */
export function monthlyFixed() {
  const list = all('SELECT * FROM recurring WHERE active = 1');
  const factor = { daily: 30, weekly: 4.345, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
  let income = 0;
  let expense = 0;
  for (const r of list) {
    const per = (factor[r.frequency] ?? 1) / (r.interval_n || 1);
    if (r.type === 'income') income += r.amount * per;
    else if (r.type === 'expense') expense += r.amount * per;
  }
  return { income: Math.round(income), expense: Math.round(expense) };
}
