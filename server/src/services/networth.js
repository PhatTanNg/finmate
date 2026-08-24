/** Tài sản ròng: tài sản - nợ, kèm lịch sử để vẽ đường tăng trưởng. */
import { all, get, run } from '../db.js';
import { today, monthKey } from '../util/date.js';
import { portfolio, realEstate } from './investments.js';
import { convert, baseCurrency } from './fx.js';
import { currency as cur } from '../util/currency.js';

const LIQUID_TYPES = ['cash', 'bank', 'ewallet'];
const CREDIT_TYPES = ['credit', 'credit_card', 'loan'];
const BROKER_TYPES = ['investment', 'brokerage'];

/**
 * Tổng số dư của các loại tài khoản chỉ định, đã quy về đồng tiền gốc.
 * Dùng thay cho `SUM(balance)` trong SQL — SQL không biết đổi tiền tệ.
 */
export function accountsBase(types) {
  const base = baseCurrency();
  const d = today();
  const list = all('SELECT balance, currency, type FROM accounts WHERE is_active = 1');
  return list
    .filter((a) => types.includes(a.type))
    .reduce((s, a) => s + convert(a.balance, cur(a.currency || base).code, base, d), 0);
}

export function netWorth() {
  const base = baseCurrency();
  const d = today();
  const accounts = all('SELECT * FROM accounts WHERE is_active = 1 AND include_in_networth = 1');
  let liquid = 0;
  let savings = 0;
  let brokerCash = 0;
  let liabilities = 0;
  let otherAssets = 0;
  const byCurrency = {};

  for (const a of accounts) {
    const ac = cur(a.currency || base).code;
    // Mọi số dư quy về đồng tiền gốc trước khi cộng — nếu không sẽ cộng
    // nhầm 1.000 € với 1.000 ₫ thành 2.000.
    const bal = convert(a.balance, ac, base, d);
    if (CREDIT_TYPES.includes(a.type)) {
      liabilities += Math.max(0, -bal);
      continue;
    }
    byCurrency[ac] = (byCurrency[ac] || 0) + bal;
    if (LIQUID_TYPES.includes(a.type)) liquid += bal;
    else if (a.type === 'savings') savings += bal;
    else if (BROKER_TYPES.includes(a.type)) brokerCash += bal;
    else otherAssets += bal;
  }

  const pf = portfolio();
  const re = realEstate();
  for (const h of pf.holdings) byCurrency[h.currency] = (byCurrency[h.currency] || 0) + h.value_base;
  for (const p of re.properties) byCurrency[p.currency] = (byCurrency[p.currency] || 0) + p.value_base;

  const debts = all("SELECT * FROM debts WHERE status = 'active'");
  const debtTotal = debts.reduce((s, x) => s + convert(x.balance, cur(x.currency || base).code, base, d), 0);

  const assets = liquid + savings + brokerCash + otherAssets + pf.total_value + re.total_value;
  const liab = liabilities + debtTotal;
  const total = Object.values(byCurrency).reduce((s, v) => s + v, 0);
  return {
    date: today(),
    currency: base,
    assets,
    liabilities: liab,
    net: assets - liab,
    breakdown: {
      liquid,
      savings,
      investments: pf.total_value + brokerCash,
      real_estate: re.total_value,
      other: otherAssets,
      credit_debt: liabilities,
      loans: debtTotal,
    },
    by_currency: Object.entries(byCurrency)
      .filter(([, v]) => v !== 0)
      .map(([code, value]) => ({ currency: code, value, weight: total ? value / total : 0 }))
      .sort((a, b) => b.value - a.value),
    invested: pf.total_value + brokerCash + savings,
    liquid,
  };
}

export function snapshot(date = today()) {
  const nw = netWorth();
  run(
    `INSERT INTO networth_snapshots (date, assets, liabilities, net, breakdown) VALUES (?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET assets=excluded.assets, liabilities=excluded.liabilities, net=excluded.net, breakdown=excluded.breakdown`,
    [date, nw.assets, nw.liabilities, nw.net, JSON.stringify(nw.breakdown)]
  );
  return nw;
}

export function history(limit = 36) {
  return all('SELECT * FROM networth_snapshots ORDER BY date DESC LIMIT ?', [limit])
    .map((r) => ({ ...r, breakdown: safeParse(r.breakdown) }))
    .reverse();
}

function safeParse(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
