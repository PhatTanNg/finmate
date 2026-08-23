/** Sổ cái giao dịch: mọi thay đổi số dư đi qua đây để dữ liệu luôn nhất quán. */
import { all, get, run, insert, update, remove, tx as transact } from '../db.js';
import { today, nowISO } from '../util/date.js';
import { autoCategorize } from './categorize.js';
import { allocateIncome, postFund, clearFundEntriesForTx } from './funds.js';
import { defaultFundIdForCategory } from '../bootstrap.js';

const TX_FIELDS = [
  'type', 'amount', 'currency', 'date', 'occurred_at', 'account_id', 'counter_account_id', 'category_id', 'fund_id',
  'income_stream_id', 'goal_id', 'debt_id', 'holding_id', 'merchant', 'note', 'tags', 'source', 'external_id', 'raw',
  'confidence', 'needs_review', 'excluded',
];

export function defaultAccountId(type = 'expense') {
  const pref = get("SELECT id FROM accounts WHERE is_active = 1 AND type IN ('bank','ewallet','cash') ORDER BY CASE type WHEN 'bank' THEN 0 WHEN 'ewallet' THEN 1 ELSE 2 END, balance DESC LIMIT 1");
  return pref ? pref.id : null;
}

function bumpAccount(accountId, delta) {
  if (!accountId || !delta) return;
  run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [Math.round(delta), accountId]);
}

function applyBalance(t, sign) {
  const amt = t.amount * sign;
  if (t.type === 'income') bumpAccount(t.account_id, amt);
  else if (t.type === 'expense') bumpAccount(t.account_id, -amt);
  else if (t.type === 'transfer') {
    bumpAccount(t.account_id, -amt);
    bumpAccount(t.counter_account_id, amt);
  }
}

function applySideEffects(t, sign) {
  if (t.goal_id) {
    run('UPDATE goals SET current_amount = MAX(0, current_amount + ?) WHERE id = ?', [t.amount * sign, t.goal_id]);
    const g = get('SELECT * FROM goals WHERE id = ?', [t.goal_id]);
    if (g && g.current_amount >= g.target_amount && g.status === 'active') run("UPDATE goals SET status='done', completed_at=? WHERE id=?", [t.date, g.id]);
  }
  if (t.debt_id && t.type === 'expense') {
    const d = get('SELECT * FROM debts WHERE id = ?', [t.debt_id]);
    if (d) {
      const interest = Math.round((d.balance * (d.interest_rate / 100)) / 12);
      const principalPart = Math.max(0, t.amount - interest);
      run('UPDATE debts SET balance = MAX(0, balance - ?) WHERE id = ?', [principalPart * sign, t.debt_id]);
      const after = get('SELECT balance FROM debts WHERE id = ?', [t.debt_id]);
      if (after && after.balance <= 0) run("UPDATE debts SET status='paid' WHERE id=?", [t.debt_id]);
    }
  }
}

/** Tạo giao dịch. Tự phân loại, tự gắn quỹ, tự phân bổ nếu là thu nhập. */
export function createTransaction(input = {}, opts = {}) {
  const type = input.type || 'expense';
  const amount = Math.round(Math.abs(Number(input.amount) || 0));
  if (!amount) throw new Error('Số tiền không hợp lệ');

  if (input.external_id) {
    const dup = get('SELECT * FROM transactions WHERE external_id = ?', [input.external_id]);
    if (dup) return { duplicate: true, transaction: dup, allocation: [] };
  }

  const data = {};
  for (const f of TX_FIELDS) if (input[f] !== undefined) data[f] = input[f];
  data.type = type;
  data.amount = amount;
  data.date = input.date || today();
  data.occurred_at = input.occurred_at || nowISO();
  data.source = input.source || 'manual';
  data.currency = input.currency || 'VND';

  if (!data.account_id) data.account_id = defaultAccountId(type);

  const text = [input.note, input.merchant, input.raw].filter(Boolean).join(' ');
  if (!data.category_id && type !== 'transfer') {
    const guess = autoCategorize({ text, merchant: input.merchant, type, amount, accountId: data.account_id });
    data.category_id = guess.category_id;
    if (!data.fund_id) data.fund_id = guess.fund_id;
    if (!data.merchant && guess.merchant) data.merchant = guess.merchant;
    data.confidence = input.confidence ?? guess.confidence;
    if (guess.excluded) data.excluded = 1;
    data.needs_review = (input.confidence ?? guess.confidence) < 0.6 ? 1 : 0;
  }
  if (type === 'expense' && !data.fund_id) data.fund_id = defaultFundIdForCategory(data.category_id);

  return transact(() => {
    const id = insert('transactions', data);
    const t = get('SELECT * FROM transactions WHERE id = ?', [id]);
    applyBalance(t, 1);
    applySideEffects(t, 1);

    let allocation = [];
    if (t.type === 'expense' && t.fund_id && !t.excluded) {
      postFund({ fund_id: t.fund_id, amount: -t.amount, date: t.date, kind: 'spend', ref_tx_id: t.id, note: t.note || t.merchant });
    }
    if (t.type === 'income' && opts.allocate !== false && !t.excluded) {
      allocation = allocateIncome({ amount: t.amount, date: t.date, txId: t.id, note: `Phân bổ: ${t.note || 'thu nhập'}` });
    }
    if (t.type === 'transfer' && t.fund_id) {
      postFund({ fund_id: t.fund_id, amount: -t.amount, date: t.date, kind: 'move', ref_tx_id: t.id, note: t.note });
    }
    return { transaction: get('SELECT * FROM transactions WHERE id = ?', [id]), allocation, duplicate: false };
  });
}

export function updateTransaction(id, patch = {}) {
  const old = get('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!old) throw new Error('Không tìm thấy giao dịch');
  return transact(() => {
    applyBalance(old, -1);
    applySideEffects(old, -1);
    clearFundEntriesForTx(id);

    const data = {};
    for (const f of TX_FIELDS) if (patch[f] !== undefined) data[f] = patch[f];
    if (data.amount !== undefined) data.amount = Math.round(Math.abs(Number(data.amount)));
    update('transactions', id, data);

    const t = get('SELECT * FROM transactions WHERE id = ?', [id]);
    applyBalance(t, 1);
    applySideEffects(t, 1);
    if (t.type === 'expense' && t.fund_id && !t.excluded) {
      postFund({ fund_id: t.fund_id, amount: -t.amount, date: t.date, kind: 'spend', ref_tx_id: t.id, note: t.note || t.merchant });
    }
    if (t.type === 'income' && !t.excluded) {
      allocateIncome({ amount: t.amount, date: t.date, txId: t.id, note: `Phân bổ: ${t.note || 'thu nhập'}` });
    }
    return get('SELECT * FROM transactions WHERE id = ?', [id]);
  });
}

export function deleteTransaction(id) {
  const old = get('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!old) return 0;
  return transact(() => {
    applyBalance(old, -1);
    applySideEffects(old, -1);
    clearFundEntriesForTx(id);
    return remove('transactions', id);
  });
}

const SELECT_TX = `
  SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.kind AS category_kind, c.essential,
         a.name AS account_name, a.type AS account_type,
         a2.name AS counter_account_name,
         f.name AS fund_name, f.color AS fund_color,
         s.name AS income_stream_name, s.type AS income_stream_type
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts a2 ON a2.id = t.counter_account_id
  LEFT JOIN funds f ON f.id = t.fund_id
  LEFT JOIN income_streams s ON s.id = t.income_stream_id
`;

export function listTransactions(filter = {}) {
  const where = [];
  const params = [];
  if (filter.from) { where.push('t.date >= ?'); params.push(filter.from); }
  if (filter.to) { where.push('t.date <= ?'); params.push(filter.to); }
  if (filter.type) { where.push('t.type = ?'); params.push(filter.type); }
  if (filter.account_id) { where.push('t.account_id = ?'); params.push(Number(filter.account_id)); }
  if (filter.category_id) { where.push('t.category_id = ?'); params.push(Number(filter.category_id)); }
  if (filter.fund_id) { where.push('t.fund_id = ?'); params.push(Number(filter.fund_id)); }
  if (filter.needs_review) where.push('t.needs_review = 1');
  if (filter.q) {
    where.push('(lower(t.note) LIKE ? OR lower(t.merchant) LIKE ? OR lower(t.raw) LIKE ?)');
    const q = `%${String(filter.q).toLowerCase()}%`;
    params.push(q, q, q);
  }
  const sql = `${SELECT_TX} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`;
  params.push(Number(filter.limit) || 100, Number(filter.offset) || 0);
  return all(sql, params);
}

export function getTransaction(id) {
  return get(`${SELECT_TX} WHERE t.id = ?`, [id]);
}

/** Đồng bộ lại số dư tài khoản từ toàn bộ giao dịch (dùng khi nghi ngờ lệch). */
export function rebuildBalances() {
  const accounts = all('SELECT * FROM accounts');
  for (const a of accounts) {
    const inc = get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = ? AND type='income'", [a.id]).s;
    const exp = get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = ? AND type='expense'", [a.id]).s;
    const out = get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = ? AND type='transfer'", [a.id]).s;
    const into = get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE counter_account_id = ? AND type='transfer'", [a.id]).s;
    update('accounts', a.id, { balance: a.opening_balance + inc - exp - out + into });
  }
  return accounts.length;
}
