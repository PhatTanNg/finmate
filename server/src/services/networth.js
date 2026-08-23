/** Tài sản ròng: tài sản - nợ, kèm lịch sử để vẽ đường tăng trưởng. */
import { all, get, run } from '../db.js';
import { today, monthKey } from '../util/date.js';
import { portfolio, realEstate } from './investments.js';

const LIQUID_TYPES = ['cash', 'bank', 'ewallet'];
const CREDIT_TYPES = ['credit', 'credit_card', 'loan'];
const BROKER_TYPES = ['investment', 'brokerage'];

export function netWorth() {
  const accounts = all('SELECT * FROM accounts WHERE is_active = 1 AND include_in_networth = 1');
  let liquid = 0;
  let savings = 0;
  let brokerCash = 0;
  let liabilities = 0;
  let otherAssets = 0;
  for (const a of accounts) {
    if (CREDIT_TYPES.includes(a.type)) {
      liabilities += Math.max(0, -a.balance);
      continue;
    }
    if (LIQUID_TYPES.includes(a.type)) liquid += a.balance;
    else if (a.type === 'savings') savings += a.balance;
    else if (BROKER_TYPES.includes(a.type)) brokerCash += a.balance;
    else otherAssets += a.balance;
  }
  const pf = portfolio();
  const re = realEstate();
  const debts = all("SELECT * FROM debts WHERE status = 'active'");
  const debtTotal = debts.reduce((s, d) => s + d.balance, 0);

  const assets = liquid + savings + brokerCash + otherAssets + pf.total_value + re.total_value;
  const liab = liabilities + debtTotal;
  return {
    date: today(),
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
