/**
 * Tự động ghi nhận giao dịch — không cần nhập tay.
 * Nguồn: SMS/thông báo ngân hàng, email, file CSV sao kê, webhook (iOS Shortcuts / Tasker / IFTTT / Zapier).
 */
import crypto from 'node:crypto';
import { all, get, insert, update, run } from '../db.js';
import { today, toISO } from '../util/date.js';
import { norm } from '../util/vi.js';
import { createTransaction, defaultAccountId } from './ledger.js';

const CREDIT_WORDS = ['ghi co', 'nhan duoc', 'nhan tien', 'cong tien', 'tien vao', 'credit', 'nhan chuyen khoan', 'da nhan'];
const DEBIT_WORDS = ['ghi no', 'thanh toan', 'chuyen tien', 'rut tien', 'mua hang', 'tru tien', 'debit', 'da chi', 'thanh toán'];

const BANKS = [
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
];

function parseMoney(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  // 1,234,567.00 hoặc 1.234.567,00 hoặc 1234567
  let v = cleaned;
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  const decSep = lastDot > lastComma ? '.' : lastComma > lastDot ? ',' : null;
  if (decSep && v.length - v.lastIndexOf(decSep) - 1 <= 2 && (v.match(/[.,]/g) || []).length > 0 && v.length - v.lastIndexOf(decSep) - 1 !== 3) {
    const intPart = v.slice(0, v.lastIndexOf(decSep)).replace(/[.,]/g, '');
    const frac = v.slice(v.lastIndexOf(decSep) + 1);
    return Math.round(Number(`${intPart}.${frac}`));
  }
  return Math.round(Number(v.replace(/[.,]/g, '')));
}

function parseWhen(text) {
  const m = String(text).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return { date: today(), time: null };
  let [, d, mo, y, hh, mi] = m;
  y = Number(y);
  if (y < 100) y += 2000;
  const date = `${y}-${String(Number(mo)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
  return { date, time: hh ? `${hh}:${mi}` : null };
}

function detectBank(text) {
  const n = norm(text);
  for (const b of BANKS) if (b.names.some((x) => n.includes(x))) return b.key;
  return null;
}

function extractDescription(text) {
  const patterns = [
    /(?:ND|N\.D|Noi dung|Nội dung|Mo ta|Description|Content|ND CK|Ref)\s*[:\-]\s*(.+)$/im,
    /(?:tai|tại)\s+([A-Z0-9\s\-\.]{4,40})/,
  ];
  for (const p of patterns) {
    const m = String(text).match(p);
    if (m && m[1]) return m[1].split(/\s{2,}|\.\s|\|/)[0].trim().slice(0, 160);
  }
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Đọc 1 tin nhắn/email ngân hàng thành cấu trúc giao dịch. */
export function parseBankMessage(text, hint = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const n = norm(raw);

  // số dư sau giao dịch
  const balMatch = raw.match(/(?:SD|So du|Số dư|Balance|SD hien tai|So du hien tai|So du kha dung)[^\d+-]{0,12}([\d.,]+)/i);
  const balance = balMatch ? parseMoney(balMatch[1]) : null;

  // số tiền giao dịch: ưu tiên dạng có dấu +/- và đơn vị tiền
  let amount = null;
  let sign = null;
  const signed = raw.match(/(?:GD|PS|thay doi|thay đổi|amount|so tien|số tiền)?\s*[:\s]\s*([+-])\s*([\d.,]+)\s*(?:VND|VNĐ|đ|d)\b/i)
    || raw.match(/([+-])\s*([\d.,]+)\s*(?:VND|VNĐ|đ|d)\b/i);
  if (signed) {
    sign = signed[1] === '-' ? 'debit' : 'credit';
    amount = parseMoney(signed[2]);
  } else {
    const plainAmt = raw.match(/([\d.,]{4,})\s*(?:VND|VNĐ|đ|d)\b/i);
    if (plainAmt) amount = parseMoney(plainAmt[1]);
  }
  if (!amount && balance) {
    const other = raw.match(/([\d.,]{4,})/g)?.map(parseMoney).filter((x) => x && x !== balance);
    if (other && other.length) amount = other[0];
  }
  if (!amount || amount <= 0) return null;

  if (!sign) {
    if (CREDIT_WORDS.some((w) => n.includes(w))) sign = 'credit';
    else if (DEBIT_WORDS.some((w) => n.includes(w))) sign = 'debit';
    else sign = 'debit';
  }

  const acctMatch = raw.match(/(?:TK|Tai khoan|Tài khoản|Account|the|thẻ)\s*[:\s]?\s*([0-9xX*]{4,20})/i);
  const when = parseWhen(raw);
  const bank = detectBank(raw) || hint.bank || null;
  const description = extractDescription(raw);

  return {
    type: sign === 'credit' ? 'income' : 'expense',
    amount,
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
    const acc = all('SELECT * FROM accounts WHERE institution IS NOT NULL').find((a) => norm(a.institution).includes(parsed.bank));
    if (acc) return acc.id;
  }
  return defaultAccountId(parsed.type);
}

function fingerprint(parsed, accountId) {
  const h = crypto.createHash('sha1');
  h.update([accountId, parsed.date, parsed.time || '', parsed.amount, parsed.type, (parsed.description || '').slice(0, 40)].join('|'));
  return `ing:${h.digest('hex').slice(0, 16)}`;
}

/**
 * Nhận 1 tin nhắn/thông báo và tự tạo giao dịch.
 * @param {{text?:string, channel?:string, account_id?:number, date?:string, dry_run?:boolean}} payload
 */
export function ingestMessage(payload = {}) {
  const channel = payload.channel || 'sms';
  const parsed = parseBankMessage(payload.text, { date: payload.date, bank: payload.bank });
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
  if (Math.abs(diff) < 1000) return { diff: 0, adjusted: false };
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
  };
  if (idx.date < 0) return { imported: 0, duplicates: 0, errors: ['Không tìm thấy cột ngày'], items: [] };

  const accountId = account_id || defaultAccountId('expense');
  let imported = 0;
  let duplicates = 0;
  const items = [];
  const errors = [];

  for (const r of rows.slice(1)) {
    try {
      const when = parseWhen(r[idx.date]) ;
      const date = /^\d{4}-\d{2}-\d{2}/.test(r[idx.date]) ? r[idx.date].slice(0, 10) : when.date;
      let amount = 0;
      let type = 'expense';
      if (idx.debit >= 0 || idx.credit >= 0) {
        const debit = idx.debit >= 0 ? parseMoney(r[idx.debit]) || 0 : 0;
        const credit = idx.credit >= 0 ? parseMoney(r[idx.credit]) || 0 : 0;
        if (credit > 0) { amount = credit; type = 'income'; }
        else { amount = debit; type = 'expense'; }
      } else if (idx.amount >= 0) {
        const v = parseMoney(r[idx.amount]) || 0;
        const negative = String(r[idx.amount]).trim().startsWith('-');
        amount = Math.abs(v);
        type = negative ? 'expense' : 'income';
      }
      if (!amount) continue;
      const description = idx.description >= 0 ? r[idx.description] : '';
      const parsed = { date, time: when.time, amount, type, description };
      const externalId = fingerprint(parsed, accountId);
      if (dry_run) {
        items.push({ ...parsed, external_id: externalId });
        continue;
      }
      const res = createTransaction({
        type, amount, date, account_id: accountId, note: description, merchant: guessMerchant(description),
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
