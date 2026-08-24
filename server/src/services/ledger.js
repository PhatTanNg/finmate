/** Sổ cái giao dịch: mọi thay đổi số dư đi qua đây để dữ liệu luôn nhất quán. */
import { all, get, run, insert, update, remove, tx as transact } from '../db.js';
import { today, nowISO } from '../util/date.js';
import { autoCategorize } from './categorize.js';
import { allocateIncome, postFund, clearFundEntriesForTx } from './funds.js';
import { defaultFundIdForCategory } from '../bootstrap.js';
import { convert, getRate, baseCurrency } from './fx.js';
import { currency as cur } from '../util/currency.js';

const TX_FIELDS = [
  'type', 'amount', 'currency', 'date', 'occurred_at', 'account_id', 'counter_account_id', 'category_id', 'fund_id',
  'income_stream_id', 'goal_id', 'debt_id', 'holding_id', 'merchant', 'note', 'tags', 'source', 'external_id', 'raw',
  'confidence', 'needs_review', 'excluded', 'base_amount', 'base_currency', 'fx_rate', 'counter_amount',
  'counter_currency', 'fee', 'original_amount', 'original_currency',
];

export function defaultAccountId(type = 'expense', currency = null) {
  const code = currency ? cur(currency).code : null;
  if (code) {
    const match = get(
      "SELECT id FROM accounts WHERE is_active = 1 AND COALESCE(currency, ?) = ? AND type IN ('bank','ewallet','cash') ORDER BY CASE type WHEN 'bank' THEN 0 WHEN 'ewallet' THEN 1 ELSE 2 END, balance DESC LIMIT 1",
      [baseCurrency(), code]
    );
    if (match) return match.id;
  }
  const pref = get("SELECT id FROM accounts WHERE is_active = 1 AND type IN ('bank','ewallet','cash') ORDER BY CASE type WHEN 'bank' THEN 0 WHEN 'ewallet' THEN 1 ELSE 2 END, balance DESC LIMIT 1");
  return pref ? pref.id : null;
}

/** Đồng tiền của một tài khoản (mặc định = đồng tiền gốc). */
export function accountCurrency(accountId, fallback = null) {
  if (accountId) {
    const a = get('SELECT currency FROM accounts WHERE id = ?', [accountId]);
    if (a && a.currency) return cur(a.currency).code;
  }
  return fallback || baseCurrency();
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
    // Khác đồng tiền: số tiền vào tài khoản đích là counter_amount (đã trừ phí)
    const received = t.counter_amount != null ? t.counter_amount : t.amount;
    bumpAccount(t.counter_account_id, received * sign);
  }
}

function applySideEffects(t, sign) {
  if (t.goal_id) {
    const g = get('SELECT * FROM goals WHERE id = ?', [t.goal_id]);
    if (g) {
      const delta = convert(t.amount, t.currency, g.currency || t.currency, t.date) * sign;
      run('UPDATE goals SET current_amount = MAX(0, current_amount + ?) WHERE id = ?', [delta, t.goal_id]);
      const after = get('SELECT * FROM goals WHERE id = ?', [t.goal_id]);
      if (after && after.current_amount >= after.target_amount && after.status === 'active') {
        run("UPDATE goals SET status='done', completed_at=? WHERE id=?", [t.date, after.id]);
      }
    }
  }
  if (t.debt_id && t.type === 'expense') {
    const d = get('SELECT * FROM debts WHERE id = ?', [t.debt_id]);
    if (d) {
      const paid = convert(t.amount, t.currency, d.currency || t.currency, t.date);
      const interest = Math.round((d.balance * (d.interest_rate / 100)) / 12);
      const principalPart = Math.max(0, paid - interest);
      run('UPDATE debts SET balance = MAX(0, balance - ?) WHERE id = ?', [principalPart * sign, t.debt_id]);
      const after = get('SELECT balance FROM debts WHERE id = ?', [t.debt_id]);
      if (after && after.balance <= 0) run("UPDATE debts SET status='paid' WHERE id=?", [t.debt_id]);
    }
  }
}

/**
 * Điền các trường đa tiền tệ: đồng tiền theo tài khoản, số quy đổi về đồng
 * tiền gốc, và số thực nhận phía tài khoản đích khi chuyển khác đồng tiền.
 */
function fillCurrency(data, input = {}) {
  const base = baseCurrency();
  const acct = accountCurrency(data.account_id, base);
  const given = input.currency ? cur(input.currency).code : null;

  // Số dư tài khoản luôn ghi theo đồng tiền của chính tài khoản đó. Nếu người
  // dùng nói số tiền bằng đồng tiền khác ("trả 50 euro" trên ví VND) thì quy
  // đổi trước khi ghi, tránh cộng nhầm cent vào đồng.
  if (given && given !== acct) {
    data.original_amount = data.amount;
    data.original_currency = given;
    data.amount = convert(data.amount, given, acct, data.date);
  }
  data.currency = acct;
  data.fee = Math.max(0, Math.round(Number(input.fee) || 0));

  data.base_currency = base;
  data.fx_rate = getRate(data.currency, base, data.date);
  data.base_amount = convert(data.amount, data.currency, base, data.date);

  if (data.type === 'transfer' && data.counter_account_id) {
    const toCur = cur(input.counter_currency || accountCurrency(data.counter_account_id, data.currency)).code;
    data.counter_currency = toCur;
    if (input.counter_amount != null && Number(input.counter_amount) > 0) {
      data.counter_amount = Math.round(Math.abs(Number(input.counter_amount)));
    } else {
      const net = Math.max(0, data.amount - data.fee);
      data.counter_amount = toCur === data.currency ? net : convert(net, data.currency, toCur, data.date);
    }
  } else {
    data.counter_amount = null;
    data.counter_currency = null;
  }
  return data;
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

  if (!data.account_id) data.account_id = defaultAccountId(type, input.currency);
  fillCurrency(data, input);

  const text = [input.note, input.merchant, input.raw].filter(Boolean).join(' ');
  if (!data.category_id && type !== 'transfer') {
    const guess = autoCategorize({ text, merchant: input.merchant, type, amount: data.base_amount, accountId: data.account_id });
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

    // Quỹ là "phong bì" quy về đồng tiền gốc -> luôn dùng base_amount
    let allocation = [];
    if (t.type === 'expense' && t.fund_id && !t.excluded) {
      postFund({ fund_id: t.fund_id, amount: -t.base_amount, date: t.date, kind: 'spend', ref_tx_id: t.id, note: t.note || t.merchant });
    }
    if (t.type === 'income' && opts.allocate !== false && !t.excluded) {
      allocation = allocateIncome({ amount: t.base_amount, date: t.date, txId: t.id, note: `Phân bổ: ${t.note || 'thu nhập'}` });
    }
    if (t.type === 'transfer' && t.fund_id) {
      postFund({ fund_id: t.fund_id, amount: -t.base_amount, date: t.date, kind: 'move', ref_tx_id: t.id, note: t.note });
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

    // Tính lại các trường quy đổi từ trạng thái sau khi vá
    const merged = { ...old, ...data };
    const recalc = {
      type: merged.type,
      amount: merged.amount,
      date: merged.date,
      account_id: merged.account_id,
      counter_account_id: merged.counter_account_id,
    };
    fillCurrency(recalc, {
      currency: patch.currency ?? (patch.account_id !== undefined ? undefined : old.currency),
      fee: patch.fee ?? old.fee,
      counter_amount: patch.counter_amount,
      counter_currency: patch.counter_currency,
    });
    Object.assign(data, {
      currency: recalc.currency,
      fee: recalc.fee,
      base_currency: recalc.base_currency,
      fx_rate: recalc.fx_rate,
      base_amount: recalc.base_amount,
      counter_amount: recalc.counter_amount,
      counter_currency: recalc.counter_currency,
    });
    update('transactions', id, data);

    const t = get('SELECT * FROM transactions WHERE id = ?', [id]);
    applyBalance(t, 1);
    applySideEffects(t, 1);
    if (t.type === 'expense' && t.fund_id && !t.excluded) {
      postFund({ fund_id: t.fund_id, amount: -t.base_amount, date: t.date, kind: 'spend', ref_tx_id: t.id, note: t.note || t.merchant });
    }
    if (t.type === 'income' && !t.excluded) {
      allocateIncome({ amount: t.base_amount, date: t.date, txId: t.id, note: `Phân bổ: ${t.note || 'thu nhập'}` });
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
         a.name AS account_name, a.type AS account_type, a.currency AS account_currency,
         a2.name AS counter_account_name, a2.currency AS counter_account_currency,
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
    // Tiền vào từ chuyển khoản = số thực nhận (khác đồng tiền thì khác amount)
    const into = get(
      "SELECT COALESCE(SUM(COALESCE(counter_amount, amount)),0) s FROM transactions WHERE counter_account_id = ? AND type='transfer'",
      [a.id]
    ).s;
    update('accounts', a.id, { balance: a.opening_balance + inc - exp - out + into });
  }
  return accounts.length;
}

/** Tính lại base_amount cho toàn bộ giao dịch (khi đổi đồng tiền gốc). */
export function recomputeBaseAmounts() {
  const base = baseCurrency();
  const rows = all('SELECT id, amount, currency, date FROM transactions');
  let n = 0;
  transact(() => {
    for (const r of rows) {
      const c = cur(r.currency || base).code;
      run('UPDATE transactions SET base_amount = ?, base_currency = ?, fx_rate = ? WHERE id = ?', [
        convert(r.amount, c, base, r.date),
        base,
        getRate(c, base, r.date),
        r.id,
      ]);
      n++;
    }
  });
  return { updated: n, base };
}
