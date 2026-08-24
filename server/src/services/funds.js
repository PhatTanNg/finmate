/** Quỹ = "phong bì ảo" phủ lên tiền thật. Thu nhập vào -> tự động chia theo tỷ lệ/ưu tiên. */
import { all, get, run, insert, update } from '../db.js';
import { today, monthsBetween } from '../util/date.js';
import { normalizeCurrency } from '../util/currency.js';
import { baseCurrency, convert } from './fx.js';

/**
 * Danh sách quỹ, mặc định chỉ lấy quỹ đang hoạt động.
 * @param {{includeArchived?:boolean}} [opts]
 */
export function listFunds(opts = {}) {
  const rows = all('SELECT * FROM funds ORDER BY priority ASC, id ASC');
  return opts.includeArchived ? rows : rows.filter((f) => !f.archived);
}

/**
 * Kế hoạch của một quỹ có mục tiêu: còn thiếu bao nhiêu, còn mấy tháng,
 * mỗi tháng cần bỏ vào bao nhiêu để kịp hạn.
 */
export function fundPlan(fund) {
  const target = Number(fund.target_amount) || 0;
  const bal = Number(fund.balance) || 0;
  if (!target) return { has_target: false, remaining: 0, months_left: null, monthly_needed: 0, on_track: true };
  const remaining = Math.max(0, target - bal);
  const progress = target > 0 ? Math.min(1, bal / target) : 0;
  if (!fund.target_date) {
    return { has_target: true, target_amount: target, remaining, progress, months_left: null, monthly_needed: 0, on_track: remaining === 0, status: remaining === 0 ? 'done' : 'no_deadline' };
  }
  const months = monthsBetween(today(), fund.target_date);
  const monthsLeft = Math.max(0, Math.round(months * 10) / 10);
  const monthlyNeeded = remaining === 0 ? 0 : monthsLeft <= 0 ? remaining : Math.ceil(remaining / monthsLeft);
  let status = 'on_track';
  if (remaining === 0) status = 'done';
  else if (months < 0) status = 'overdue';
  else if (monthsLeft <= 1) status = 'urgent';
  return {
    has_target: true,
    target_amount: target,
    target_date: fund.target_date,
    remaining,
    progress,
    months_left: monthsLeft,
    monthly_needed: monthlyNeeded,
    on_track: status === 'on_track' || status === 'done',
    status,
  };
}

/** Tổng số tiền cần bỏ vào tất cả quỹ có hạn trong tháng này. */
export function monthlyFundLoad() {
  const base = baseCurrency();
  const items = listFunds()
    .map((f) => ({ fund: f, plan: fundPlan(f) }))
    .filter((x) => x.plan.has_target && x.plan.monthly_needed > 0);
  return {
    // Quỹ có thể khác đồng tiền nhau (euro ở Ireland, đồng ở Việt Nam)
    // nên phải quy đổi trước khi cộng, không cộng thẳng đơn vị nhỏ nhất.
    total: items.reduce((s, x) => s + convert(x.plan.monthly_needed, normalizeCurrency(x.fund.currency || base), base), 0),
    currency: base,
    items: items.map((x) => ({
      id: x.fund.id,
      name: x.fund.name,
      currency: normalizeCurrency(x.fund.currency || base),
      monthly_needed_base: convert(x.plan.monthly_needed, normalizeCurrency(x.fund.currency || base), base),
      ...x.plan,
    })),
  };
}

export function fundBalance(fundId) {
  const r = get('SELECT COALESCE(SUM(amount),0) AS s FROM fund_ledger WHERE fund_id = ?', [fundId]);
  return r ? r.s : 0;
}

export function recomputeFundBalances() {
  for (const f of listFunds({ includeArchived: true })) update('funds', f.id, { balance: fundBalance(f.id) });
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

/** Tổng quan quỹ kèm cảnh báo vượt/âm và tiến độ theo hạn hoàn thành */
export function fundsOverview(opts = {}) {
  const base = baseCurrency();
  const funds = listFunds({ includeArchived: opts.includeArchived });
  const active = funds.filter((f) => !f.archived);
  const totalPct = active.reduce((s, f) => s + (f.percent || 0), 0);
  const inBase = (f) => convert(f.balance, normalizeCurrency(f.currency || base), base);
  return {
    funds: funds.map((f) => ({
      ...f,
      archived: Boolean(f.archived),
      currency: normalizeCurrency(f.currency || base),
      balance_base: inBase(f),
      plan: fundPlan(f),
      goals: all("SELECT id, name, target_amount, current_amount, deadline FROM goals WHERE fund_id = ? AND status = 'active'", [f.id]),
      status: f.balance < 0 ? 'over' : f.cap > 0 && f.balance >= f.cap ? 'full' : 'ok',
    })),
    base_currency: base,
    total_balance: active.reduce((s, f) => s + inBase(f), 0),
    total_percent: totalPct,
    balanced: Math.abs(totalPct - 100) < 0.01,
    monthly_load: monthlyFundLoad(),
  };
}

/**
 * Đóng quỹ: ngừng nhận phân bổ tự động nhưng giữ nguyên lịch sử.
 * Số dư còn lại được chuyển sang quỹ khác để tiền không bị "kẹt".
 * @param {number} fundId
 * @param {{to_fund_id?:number, date?:string}} [opts]
 */
export function archiveFund(fundId, opts = {}) {
  const f = get('SELECT * FROM funds WHERE id = ?', [fundId]);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ' };
  if (f.archived) return { ok: false, error: `Quỹ "${f.name}" đã đóng từ trước` };
  const date = opts.date || today();
  let moved = null;
  if (f.balance !== 0) {
    const target = opts.to_fund_id
      ? get('SELECT * FROM funds WHERE id = ? AND archived = 0', [opts.to_fund_id])
      : listFunds().find((x) => x.id !== fundId && x.currency === f.currency);
    if (!target) return { ok: false, error: `Quỹ "${f.name}" còn số dư, cần chọn quỹ nhận số dư trước khi đóng` };
    moveBetweenFunds({ from_fund_id: fundId, to_fund_id: target.id, amount: f.balance, date, note: `Đóng quỹ ${f.name}` });
    moved = { to: target.name, amount: f.balance };
  }
  // Trả % phân bổ về 0 để phần thu nhập đó chảy sang các quỹ còn lại.
  update('funds', fundId, { archived: 1, archived_at: date, percent: 0 });
  return { ok: true, fund: f.name, moved, freed_percent: f.percent || 0 };
}

/** Mở lại quỹ đã đóng. */
export function reopenFund(fundId, percent = null) {
  const f = get('SELECT * FROM funds WHERE id = ?', [fundId]);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ' };
  if (!f.archived) return { ok: false, error: `Quỹ "${f.name}" đang mở` };
  const patch = { archived: 0, archived_at: null };
  if (percent != null) patch.percent = Number(percent) || 0;
  update('funds', fundId, patch);
  return { ok: true, fund: f.name, percent: patch.percent ?? f.percent };
}
