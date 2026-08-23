/** Quỹ = "phong bì ảo" phủ lên tiền thật. Thu nhập vào -> tự động chia theo tỷ lệ/ưu tiên. */
import { all, get, run, insert, update } from '../db.js';
import { today } from '../util/date.js';

export function listFunds() {
  return all('SELECT * FROM funds ORDER BY priority ASC, id ASC');
}

export function fundBalance(fundId) {
  const r = get('SELECT COALESCE(SUM(amount),0) AS s FROM fund_ledger WHERE fund_id = ?', [fundId]);
  return r ? r.s : 0;
}

export function recomputeFundBalances() {
  for (const f of listFunds()) update('funds', f.id, { balance: fundBalance(f.id) });
}

export function postFund({ fund_id, amount, date = today(), kind = 'adjust', ref_tx_id = null, goal_id = null, note = null }) {
  if (!fund_id || !amount) return null;
  const id = insert('fund_ledger', { fund_id, amount: Math.round(amount), date, kind, ref_tx_id, goal_id, note });
  run('UPDATE funds SET balance = balance + ? WHERE id = ?', [Math.round(amount), fund_id]);
  return id;
}

export function clearFundEntriesForTx(txId) {
  const rows = all('SELECT * FROM fund_ledger WHERE ref_tx_id = ?', [txId]);
  for (const r of rows) run('UPDATE funds SET balance = balance - ? WHERE id = ?', [r.amount, r.fund_id]);
  run('DELETE FROM fund_ledger WHERE ref_tx_id = ?', [txId]);
  return rows.length;
}

export function moveBetweenFunds({ from_fund_id, to_fund_id, amount, date = today(), note = '' }) {
  const amt = Math.round(amount);
  if (!amt || from_fund_id === to_fund_id) return null;
  postFund({ fund_id: from_fund_id, amount: -amt, date, kind: 'move', note: note || 'Chuyển quỹ' });
  postFund({ fund_id: to_fund_id, amount: amt, date, kind: 'move', note: note || 'Chuyển quỹ' });
  return true;
}

/**
 * Phân bổ một khoản thu nhập vào các quỹ theo % và ưu tiên.
 * Quỹ chạm trần (cap) sẽ tự đẩy phần dư sang quỹ ưu tiên kế tiếp còn chỗ.
 * @returns {{fund_id:number, name:string, amount:number}[]}
 */
export function allocateIncome({ amount, date = today(), txId = null, note = 'Phân bổ thu nhập' }) {
  const total = Math.round(amount);
  if (total <= 0) return [];
  const funds = listFunds().filter((f) => f.percent > 0);
  if (!funds.length) return [];

  const totalPct = funds.reduce((s, f) => s + f.percent, 0) || 100;
  const plan = [];
  let allocated = 0;
  for (const f of funds) {
    const share = Math.round((total * f.percent) / totalPct);
    plan.push({ fund: f, amount: share });
    allocated += share;
  }
  // bù chênh lệch làm tròn vào quỹ ưu tiên cao nhất
  if (plan.length) plan[0].amount += total - allocated;

  // xử lý trần quỹ: phần vượt đẩy sang quỹ tích luỹ ưu tiên kế tiếp
  let overflow = 0;
  for (const p of plan) {
    const cap = p.fund.cap || 0;
    if (cap > 0) {
      const room = Math.max(0, cap - p.fund.balance);
      if (p.amount > room) {
        overflow += p.amount - room;
        p.amount = room;
      }
    }
  }
  if (overflow > 0) {
    const sink =
      plan.find((p) => !p.fund.spendable && !(p.fund.cap > 0) && p.fund.type === 'ltss') ||
      plan.find((p) => !p.fund.spendable && !(p.fund.cap > 0)) ||
      plan[0];
    sink.amount += overflow;
  }

  const result = [];
  for (const p of plan) {
    if (p.amount === 0) continue;
    postFund({ fund_id: p.fund.id, amount: p.amount, date, kind: 'allocation', ref_tx_id: txId, note });
    fundGoalsFromFund(p.fund.id, p.amount, date);
    result.push({ fund_id: p.fund.id, name: p.fund.name, amount: p.amount, percent: p.fund.percent });
  }
  return result;
}

/** Tiền vào quỹ được "gắn nhãn" cho các mục tiêu đang chạy trong quỹ đó. */
export function fundGoalsFromFund(fundId, amount, date = today()) {
  let left = Math.round(amount);
  if (left <= 0) return [];
  const goals = all("SELECT * FROM goals WHERE fund_id = ? AND status = 'active' AND auto_contribute = 1 ORDER BY priority ASC, deadline ASC", [fundId]);
  const out = [];
  for (const g of goals) {
    if (left <= 0) break;
    const need = Math.max(0, g.target_amount - g.current_amount);
    if (need <= 0) continue;
    const want = g.monthly_contribution > 0 ? Math.min(g.monthly_contribution, need) : need;
    const give = Math.min(want, left, need);
    if (give <= 0) continue;
    run('UPDATE goals SET current_amount = current_amount + ? WHERE id = ?', [give, g.id]);
    left -= give;
    out.push({ goal_id: g.id, name: g.name, amount: give });
    const after = g.current_amount + give;
    if (after >= g.target_amount) run("UPDATE goals SET status = 'done', completed_at = ? WHERE id = ?", [date, g.id]);
  }
  return out;
}

/** Tổng quan quỹ kèm cảnh báo vượt/âm */
export function fundsOverview() {
  const funds = listFunds();
  const totalPct = funds.reduce((s, f) => s + (f.percent || 0), 0);
  return {
    funds: funds.map((f) => ({
      ...f,
      goals: all("SELECT id, name, target_amount, current_amount, deadline FROM goals WHERE fund_id = ? AND status = 'active'", [f.id]),
      status: f.balance < 0 ? 'over' : f.cap > 0 && f.balance >= f.cap ? 'full' : 'ok',
    })),
    total_balance: funds.reduce((s, f) => s + f.balance, 0),
    total_percent: totalPct,
    balanced: Math.abs(totalPct - 100) < 0.01,
  };
}
