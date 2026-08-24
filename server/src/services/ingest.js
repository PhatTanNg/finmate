/**
 * Tự động ghi nhận giao dịch — không cần nhập tay.
 * Nguồn: SMS/thông báo ngân hàng, email, file CSV sao kê, webhook (iOS Shortcuts / Tasker / IFTTT / Zapier).
 */
import crypto from 'node:crypto';
import { all, get, insert, update, run } from '../db.js';
import { today, toISO } from '../util/date.js';
import { norm } from '../util/vi.js';
import { parseNumberFor, toMinor, normalizeCurrency, decimalsOf } from '../util/currency.js';
import { baseCurrency } from './fx.js';
import { createTransaction, defaultAccountId, accountCurrency } from './ledger.js';

const CREDIT_WORDS = [
  'ghi co', 'nhan duoc', 'nhan tien', 'cong tien', 'tien vao', 'credit', 'nhan chuyen khoan', 'da nhan',
  'received', 'credited', 'lodgement', 'lodged', 'deposit', 'refund', 'refunded', 'salary', 'wages',
  'money in', 'transfer in', 'incoming', 'cashback', 'dividend', 'interest paid',
];
const DEBIT_WORDS = [
  'ghi no', 'thanh toan', 'chuyen tien', 'rut tien', 'mua hang', 'tru tien', 'debit', 'da chi',
  'you spent', 'spent', 'payment of', 'paid', 'card payment', 'purchase', 'debited', 'withdrawal',
  'withdrew', 'direct debit', 'standing order', 'point of sale', 'atm', 'money out', 'outgoing',
  'contactless', 'transaction of',
];

const BANKS = [
  // Việt Nam
  { key: 'vietcombank', names: ['vietcombank', 'vcb'] },
  { key: 'techcombank', names: ['techcombank', 'tcb'] },
  { key: 'mbbank', names: ['mbbank', 'mb bank', 'quan doi'] },
  { key: 'acb', names: ['acb'] },
  { key: 'tpbank', names: ['tpbank'] },
  { key: 'vpbank', names: ['vpbank'] },
  { key: 'bidv', names: ['bidv'] },
  { key: 'vietinbank', names: ['vietinbank', 'ctg'] },
  { key: 'sacombank', names: ['sacombank'] },
  { key: 'agribank', names: ['agribank'] },
  { key: 'momo', names: ['momo'] },
  { key: 'zalopay', names: ['zalopay'] },
  { key: 'vnpay', names: ['vnpay'] },
  { key: 'shopeepay', names: ['shopeepay', 'airpay'] },
  { key: 'cake', names: ['cake'] },
  { key: 'timo', names: ['timo'] },
  // Ireland / châu Âu — người Việt ở nước ngoài dùng nhiều
  { key: 'aib', names: ['aib', 'allied irish'] },
  { key: 'boi', names: ['bank of ireland', 'boi365', 'boi '] },
  { key: 'revolut', names: ['revolut'] },
  { key: 'n26', names: ['n26'] },
  { key: 'ptsb', names: ['permanent tsb', 'ptsb'] },
  { key: 'wise', names: ['wise', 'transferwise'] },
  { key: 'monzo', names: ['monzo'] },
  { key: 'starling', names: ['starling'] },
  { key: 'creditunion', names: ['credit union'] },
  { key: 'anpost', names: ['an post'] },
  { key: 'paypal', names: ['paypal'] },
  { key: 'stripe', names: ['stripe'] },
];

/** Ký hiệu/mã tiền tệ nhận diện được trong tin nhắn ngân hàng. */
const CUR_TOKENS = [
  { code: 'EUR', re: /^(?:€|eur|euro?s?)$/i },
  { code: 'GBP', re: /^(?:£|gbp|stg)$/i },
  { code: 'USD', re: /^(?:\$|usd|us\$)$/i },
  { code: 'VND', re: /^(?:₫|vnd|vnđ|đ|d|dong|đồng)$/i },
];

const codeOf = (token) => CUR_TOKENS.find((c) => c.re.test(String(token).trim()))?.code || null;

/** Từ khoá đứng ngay trước một con số nghĩa là "đây là số dư", không phải số tiền giao dịch. */
const BAL_HINT = /(?:balance|bal|available|remaining|so du|số dư|sd|con lai|còn lại)[^\d€£$₫]{0,14}$/i;
/** Từ khoá cho biết con số phía sau là số thẻ/tài khoản — tuyệt đối không được coi là tiền.
 *  Phải chặn theo ranh giới từ, nếu không "ref" sẽ khớp vào giữa chữ "refund" và nuốt mất số tiền hoàn lại. */
const ID_HINT = /(?:\b(?:card|ending|acc(?:ount)?|a\/c|tk|ref|no|number|iban|bin)\b\.?|thẻ|tài khoản|tai khoan|\bthe\b)[^\d]{0,10}$/i;

/**
 * Tìm mọi cụm tiền tệ trong tin nhắn: "EUR 45.20", "45,20 EUR", "€1,450.00", "-350,000VND".
 * Trả kèm vị trí để phân biệt số tiền giao dịch với số dư.
 */
function findMoneyTokens(raw) {
  const out = [];
  const re = /(?:(€|£|\$|₫|EUR|USD|GBP|VND|VNĐ|Euros?)\s*([+-]?\d[\d.,]*)|([+-]?\d[\d.,]*)\s*(€|£|\$|₫|EUR|USD|GBP|VND|VNĐ|Euros?|đ|d)(?![a-z]))/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const token = m[1] || m[4];
    const numStr = m[2] || m[3];
    const code = codeOf(token);
    if (!code) continue;
    const before = raw.slice(Math.max(0, m.index - 24), m.index);
    if (ID_HINT.test(before)) continue;
    const value = parseNumberFor(numStr.replace(/^[+-]/, ''), code);
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    out.push({
      code,
      minor: toMinor(value, code),
      sign: /^-/.test(numStr) ? 'debit' : /^\+/.test(numStr) ? 'credit' : null,
      isBalance: BAL_HINT.test(before),
      index: m.index,
    });
  }
  return out;
}

/** Không có ký hiệu tiền tệ nào: bám vào từ khoá số tiền, và loại thẳng số thẻ/tài khoản. */
function fallbackAmount(raw, code) {
  const re = /(?:amount|so tien|số tiền|spent|payment of|paid|transaction of|gd|ps)[^\d]{0,12}(\d[\d.,]*)/i;
  const m = raw.match(re);
  if (m) {
    const v = parseNumberFor(m[1], code);
    if (v > 0) return toMinor(v, code);
  }
  // Chuỗi số dài không đi kèm từ khoá định danh nào — thường là tiền trong tin nhắn rút gọn.
  const re2 = /(?:^|[^\d.,])(\d[\d.,]{3,})(?![\d.,])/g;
  let x;
  while ((x = re2.exec(raw)) !== null) {
    const before = raw.slice(Math.max(0, x.index - 24), x.index + x[0].indexOf(x[1]));
    if (ID_HINT.test(before) || BAL_HINT.test(before)) continue;
    const v = parseNumberFor(x[1], code);
    if (v > 0) return toMinor(v, code);
  }
  return null;
}

function parseWhen(text) {
  const s = String(text);
  // 24/08/2026 hoặc 24-08-26
  const dmy = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    let [, d, mo, y, hh, mi] = dmy;
    y = Number(y);
    if (y < 100) y += 2000;
    return { date: `${y}-${String(Number(mo)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`, time: hh ? `${hh}:${mi}` : null };
  }
  // 2026-08-24
  const iso = s.match(/(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, time: iso[4] ? `${iso[4]}:${iso[5]}` : null };
  // 24 Aug 2026 / Aug 24, 2026
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const txt = s.match(/(\d{1,2})\s+([a-z]{3,9})\.?\s+(20\d{2})/i) || s.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (txt) {
    const isDayFirst = /^\d/.test(txt[1]);
    const d = isDayFirst ? txt[1] : txt[2];
    const mi = MONTHS.indexOf(String(isDayFirst ? txt[2] : txt[1]).slice(0, 3).toLowerCase());
    if (mi >= 0) return { date: `${txt[3]}-${String(mi + 1).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`, time: null };
  }
  return { date: today(), time: null };
}

function detectBank(text) {
  const n = norm(text);
  for (const b of BANKS) if (b.names.some((x) => n.includes(x.trim()))) return b.key;
  return null;
}

function extractDescription(text) {
  const patterns = [
    /(?:ND|N\.D|Noi dung|Nội dung|Mo ta|Description|Content|ND CK|Ref)\s*[:\-]\s*(.+)$/im,
    /\b(?:at|to|from)\s+([A-Z0-9][A-Za-z0-9\s\-&'.]{3,40})/,
    /(?:tai|tại)\s+([A-Z0-9\s\-\.]{4,40})/,
  ];
  for (const p of patterns) {
    const m = String(text).match(p);
    if (m && m[1]) return m[1].split(/\s{2,}|\.\s|\|| on \d|\. Your| Your /)[0].trim().slice(0, 160);
  }
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * Đọc 1 tin nhắn/email ngân hàng thành cấu trúc giao dịch.
 * Nhận diện được cả tin tiếng Việt (VND) lẫn tiếng Anh (EUR/GBP/USD) — quan trọng
 * với người sống ở nước ngoài, vì đọc sai đồng tiền là sai số tiền 100 lần.
 */
export function parseBankMessage(text, hint = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const n = norm(raw);

  const tokens = findMoneyTokens(raw);
  const hintCur = hint.currency ? normalizeCurrency(hint.currency) : null;
  // Đồng tiền của tin nhắn: ưu tiên thứ xuất hiện trong chính tin nhắn.
  const code = tokens[0]?.code || hintCur || baseCurrency();

  const spend = tokens.filter((t) => !t.isBalance);
  const balTok = tokens.find((t) => t.isBalance);

  let amount = spend[0]?.minor ?? null;
  let sign = spend[0]?.sign ?? null;
  let balance = balTok?.minor ?? null;

  // Chỉ có một con số và nó là số dư -> tin nhắn báo số dư, không phải giao dịch.
  if (amount == null && tokens.length && !balTok) amount = tokens[0].minor;
  if (amount == null) amount = fallbackAmount(raw, code);
  if (!amount || amount <= 0) return null;

  // Số dư không được nhỏ hơn số tiền giao dịch một cách vô lý -> nhiều khả năng đọc nhầm.
  if (balance != null && balance === amount) balance = null;

  if (!sign) {
    if (CREDIT_WORDS.some((w) => n.includes(w))) sign = 'credit';
    else if (DEBIT_WORDS.some((w) => n.includes(w))) sign = 'debit';
    else sign = 'debit';
  }

  const acctMatch = raw.match(/(?:TK|Tai khoan|Tài khoản|Account|a\/c|card|the|thẻ)\s*(?:ending|no\.?|number)?\s*[:\s]?\s*([0-9xX*]{4,20})/i);
  const when = parseWhen(raw);
  const bank = detectBank(raw) || hint.bank || null;
  const description = extractDescription(raw);

  return {
    type: sign === 'credit' ? 'income' : 'expense',
    amount,
    currency: code,
    balance,
    date: hint.date || when.date,
    time: when.time,
    account_hint: acctMatch ? acctMatch[1] : null,
    bank,
    description,
    raw,
  };
}

function matchAccount(parsed) {
  if (parsed.account_hint) {
    const tail = parsed.account_hint.replace(/[^0-9]/g, '').slice(-4);
    if (tail.length >= 3) {
      const acc = all("SELECT * FROM accounts WHERE account_no IS NOT NULL AND account_no != ''").find((a) => a.account_no.replace(/[^0-9]/g, '').endsWith(tail));
      if (acc) return acc.id;
    }
  }
  if (parsed.bank) {
    const byBank = all('SELECT * FROM accounts WHERE institution IS NOT NULL').filter((a) => norm(a.institution).includes(parsed.bank));
    // Cùng ngân hàng nhưng khác đồng tiền thì chọn tài khoản khớp đồng tiền của tin nhắn.
    const same = byBank.find((a) => normalizeCurrency(a.currency) === parsed.currency);
    if (same || byBank[0]) return (same || byBank[0]).id;
  }
  // Không nhận ra ngân hàng: ít nhất đừng ghi tiền euro vào tài khoản VND.
  if (parsed.currency) {
    const byCur = all('SELECT * FROM accounts').filter((a) => normalizeCurrency(a.currency) === parsed.currency);
    if (byCur.length === 1) return byCur[0].id;
  }
  return defaultAccountId(parsed.type);
}

function fingerprint(parsed, accountId) {
  const h = crypto.createHash('sha1');
  h.update([accountId, parsed.date, parsed.time || '', parsed.amount, parsed.currency || '', parsed.type, (parsed.description || '').slice(0, 40)].join('|'));
  return `ing:${h.digest('hex').slice(0, 16)}`;
}

/**
 * Nhận 1 tin nhắn/thông báo và tự tạo giao dịch.
 * @param {{text?:string, channel?:string, account_id?:number, date?:string, dry_run?:boolean}} payload
 */
export function ingestMessage(payload = {}) {
  const channel = payload.channel || 'sms';
  const parsed = parseBankMessage(payload.text, { date: payload.date, bank: payload.bank, currency: payload.currency });
  if (!parsed) {
    insert('ingest_log', { channel, payload: payload.text || '', parsed: null, status: 'ignored', message: 'Không đọc được số tiền' });
    return { status: 'ignored', reason: 'Không nhận diện được số tiền trong tin nhắn' };
  }
  const accountId = payload.account_id || matchAccount(parsed);
  const externalId = payload.external_id || fingerprint(parsed, accountId);

  if (payload.dry_run) return { status: 'preview', parsed: { ...parsed, account_id: accountId, external_id: externalId } };

  const res = createTransaction({
    type: parsed.type,
    amount: parsed.amount,
    currency: parsed.currency,
    date: parsed.date,
    account_id: accountId,
    note: parsed.description,
    merchant: guessMerchant(parsed.description),
    source: channel,
    external_id: externalId,
    raw: parsed.raw,
  });

  const status = res.duplicate ? 'duplicate' : 'created';
  insert('ingest_log', {
    channel,
    payload: payload.text || '',
    parsed: JSON.stringify(parsed),
    status,
    transaction_id: res.transaction.id,
    message: res.duplicate ? 'Đã tồn tại, bỏ qua' : `Đã ghi ${parsed.type === 'income' ? 'thu' : 'chi'} ${parsed.amount}`,
  });

  // đối soát số dư nếu tin nhắn có báo số dư
  let reconciled = null;
  if (!res.duplicate && parsed.balance && accountId) {
    reconciled = reconcile(accountId, parsed.balance, parsed.date);
  }
  return { status, transaction: res.transaction, allocation: res.allocation, parsed, reconciled };
}

function guessMerchant(desc = '') {
  const cleaned = String(desc)
    .replace(/\b(CT|CK|TU|TOI|GD|REF|MBVCB|VCB|TCB|FT\d+|TRACE\d+|IBFT)\b/gi, ' ')
    .replace(/\d{6,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(/[-|.]/)[0].trim().slice(0, 60) || null;
}

/** Đồng bộ số dư thực tế từ ngân hàng: tạo bút toán điều chỉnh nếu lệch. */
export function reconcile(accountId, reportedBalance, date = today()) {
  const acc = get('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) return null;
  const diff = Math.round(reportedBalance - acc.balance);
  update('accounts', accountId, { last_synced_at: date });
  // Ngưỡng bỏ qua phải theo đồng tiền: 1.000 đồng và 0,50 euro là hai chuyện khác nhau.
  const code = normalizeCurrency(acc.currency);
  const threshold = decimalsOf(code) === 0 ? 1000 : 50;
  if (Math.abs(diff) < threshold) return { diff: 0, adjusted: false };
  const res = createTransaction({
    type: diff > 0 ? 'income' : 'expense',
    amount: Math.abs(diff),
    date,
    account_id: accountId,
    note: `Điều chỉnh số dư ${acc.name} theo ngân hàng`,
    source: 'system',
    excluded: 1,
    needs_review: 1,
    external_id: `rec:${accountId}:${date}:${Math.abs(diff)}`,
  }, { allocate: false });
  return { diff, adjusted: !res.duplicate, transaction_id: res.transaction.id };
}

// ---- CSV -----------------------------------------------------------------

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const COL_ALIASES = {
  date: ['date', 'ngay', 'ngay giao dich', 'transaction date', 'ngay gd', 'thoi gian', 'posting date'],
  amount: ['amount', 'so tien', 'số tiền', 'gia tri', 'value'],
  debit: ['debit', 'ghi no', 'chi', 'tien ra', 'withdrawal', 'phat sinh no'],
  credit: ['credit', 'ghi co', 'thu', 'tien vao', 'deposit', 'phat sinh co'],
  description: ['description', 'noi dung', 'nội dung', 'dien giai', 'mo ta', 'detail', 'remark', 'memo'],
  balance: ['balance', 'so du', 'số dư', 'so du cuoi'],
  currency: ['currency', 'ccy', 'don vi', 'đơn vị', 'dong tien', 'đồng tiền', 'loai tien'],
};

function findCol(headers, key) {
  const hs = headers.map((h) => norm(h));
  for (const alias of COL_ALIASES[key]) {
    const i = hs.findIndex((h) => h === alias);
    if (i >= 0) return i;
  }
  for (const alias of COL_ALIASES[key]) {
    const i = hs.findIndex((h) => h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

/** Nhập sao kê CSV: tự dò cột, tự phân loại, tự bỏ qua trùng lặp. */
export function importCSV(text, { account_id = null, dry_run = false } = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { imported: 0, duplicates: 0, errors: ['File rỗng hoặc không đúng định dạng'], items: [] };
  const headers = rows[0];
  const idx = {
    date: findCol(headers, 'date'),
    amount: findCol(headers, 'amount'),
    debit: findCol(headers, 'debit'),
    credit: findCol(headers, 'credit'),
    description: findCol(headers, 'description'),
    balance: findCol(headers, 'balance'),
    currency: findCol(headers, 'currency'),
  };
  if (idx.date < 0) return { imported: 0, duplicates: 0, errors: ['Không tìm thấy cột ngày'], items: [] };

  const accountId = account_id || defaultAccountId('expense');
  const acctCode = accountCurrency(accountId, baseCurrency());
  let imported = 0;
  let duplicates = 0;
  const items = [];
  const errors = [];

  // Số tiền trong sao kê ghi theo đơn vị đời thường ("-12.30"), phải quy về
  // đơn vị nhỏ nhất của đúng đồng tiền — EUR ra cent, VND ra đồng.
  const toUnits = (raw, code) => {
    const n = parseNumberFor(raw, code);
    return n == null ? 0 : toMinor(Math.abs(n), code);
  };

  for (const r of rows.slice(1)) {
    try {
      const when = parseWhen(r[idx.date]);
      const date = /^\d{4}-\d{2}-\d{2}/.test(r[idx.date]) ? r[idx.date].slice(0, 10) : when.date;
      const code = idx.currency >= 0 ? (normalizeCurrency(r[idx.currency], acctCode) || acctCode) : acctCode;
      let amount = 0;
      let type = 'expense';
      if (idx.debit >= 0 || idx.credit >= 0) {
        const debit = idx.debit >= 0 ? toUnits(r[idx.debit], code) : 0;
        const credit = idx.credit >= 0 ? toUnits(r[idx.credit], code) : 0;
        if (credit > 0) { amount = credit; type = 'income'; }
        else { amount = debit; type = 'expense'; }
      } else if (idx.amount >= 0) {
        amount = toUnits(r[idx.amount], code);
        type = /^\s*[-(]/.test(String(r[idx.amount])) ? 'expense' : 'income';
      }
      if (!amount) continue;
      const description = idx.description >= 0 ? r[idx.description] : '';
      const parsed = { date, time: when.time, amount, type, description, currency: code };
      const externalId = fingerprint(parsed, accountId);
      if (dry_run) {
        items.push({ ...parsed, external_id: externalId });
        continue;
      }
      const res = createTransaction({
        type, amount, date, currency: code, account_id: accountId, note: description, merchant: guessMerchant(description),
        source: 'csv', external_id: externalId, raw: r.join(' | '),
      });
      if (res.duplicate) duplicates++;
      else { imported++; items.push(res.transaction); }
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  insert('ingest_log', { channel: 'csv', payload: `${rows.length - 1} dòng`, status: 'created', message: `Nhập ${imported}, trùng ${duplicates}` });
  return { imported, duplicates, errors, items };
}

export function ingestHistory(limit = 50) {
  return all('SELECT * FROM ingest_log ORDER BY id DESC LIMIT ?', [limit]);
}
