/** Lãi ngân hàng: tự động cộng lãi tiết kiệm/tài khoản, không cần nhập tay. */
import { all, get, update } from '../db.js';
import { today, addMonths, monthsBetween, toISO, parseISO } from '../util/date.js';
import { createTransaction } from './ledger.js';
import { categoryByName } from '../bootstrap.js';

const PAYOUT_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

/**
 * Cộng lãi cho các tài khoản tiết kiệm/ngân hàng tới thời điểm asOf.
 * - interest_payout = monthly|quarterly|yearly: ghi nhận lãi định kỳ
 * - maturity: chỉ ghi nhận khi tới ngày đáo hạn
 */
export function accrueInterest(asOf = today()) {
  const cat = categoryByName('Lãi ngân hàng', 'income');
  const accounts = all("SELECT * FROM accounts WHERE is_active = 1 AND interest_rate > 0 AND type IN ('savings','bank')");
  const posted = [];
  for (const a of accounts) {
    const rate = a.interest_rate / 100;
    if (a.interest_payout === 'maturity') {
      if (a.maturity_date && a.maturity_date <= asOf && a.last_accrued_at !== a.maturity_date) {
        const months = a.term_months || Math.max(1, Math.round(monthsBetween(a.opened_at || a.maturity_date, a.maturity_date)));
        const interest = Math.round((a.balance * rate * months) / 12);
        if (interest > 0) {
          const res = createTransaction({
            type: 'income', amount: interest, date: a.maturity_date, account_id: a.id, category_id: cat?.id,
            note: `Lãi đáo hạn ${a.name}`, source: 'system', external_id: `int:${a.id}:${a.maturity_date}`,
          });
          if (!res.duplicate) posted.push({ account: a.name, amount: interest, date: a.maturity_date });
        }
        update('accounts', a.id, { last_accrued_at: a.maturity_date });
      }
      continue;
    }
    const step = PAYOUT_MONTHS[a.interest_payout] || 1;
    let last = a.last_accrued_at || a.opened_at || addMonths(asOf, -1);
    let guard = 0;
    let next = addMonths(last, step);
    while (next <= asOf && guard++ < 120) {
      const bal = get('SELECT balance FROM accounts WHERE id = ?', [a.id]).balance;
      const interest = Math.round((bal * rate * step) / 12);
      if (interest > 0) {
        const res = createTransaction({
          type: 'income', amount: interest, date: next, account_id: a.id, category_id: cat?.id,
          note: `Lãi ${a.name}`, source: 'system', external_id: `int:${a.id}:${next}`,
        }, { allocate: false });
        if (!res.duplicate) posted.push({ account: a.name, amount: interest, date: next });
      }
      update('accounts', a.id, { last_accrued_at: next });
      next = addMonths(next, step);
    }
  }
  return posted;
}

/** Lãi ngân hàng dự kiến trong 12 tháng tới (thu nhập thụ động) */
export function projectedAnnualInterest() {
  const accounts = all("SELECT * FROM accounts WHERE is_active = 1 AND interest_rate > 0 AND type IN ('savings','bank')");
  return Math.round(accounts.reduce((s, a) => s + (a.balance * a.interest_rate) / 100, 0));
}
