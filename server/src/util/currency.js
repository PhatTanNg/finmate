/**
 * Lớp tiền tệ đa quốc gia.
 *
 * QUY ƯỚC LƯU TRỮ: mọi số tiền là **số nguyên đơn vị nhỏ nhất** (minor unit)
 * của chính đồng tiền đó.
 *   - VND có 0 chữ số thập phân  -> 1 đơn vị = 1đ      (giống hệt bản cũ)
 *   - EUR có 2 chữ số thập phân  -> 1 đơn vị = 1 cent  (12,50€ = 1250)
 * Nhờ VND decimals = 0 nên toàn bộ dữ liệu VND cũ vẫn đúng, không cần đổi.
 */

export const CURRENCIES = {
  VND: {
    code: 'VND',
    name: 'Việt Nam Đồng',
    symbol: '₫',
    decimals: 0,
    locale: 'vi-VN',
    symbolFirst: false,
    flag: '🇻🇳',
    step: 1000,
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    decimals: 2,
    locale: 'en-IE',
    symbolFirst: true,
    flag: '🇪🇺',
    step: 1,
  },
  USD: {
    code: 'USD',
    name: 'Đô la Mỹ',
    symbol: '$',
    decimals: 2,
    locale: 'en-US',
    symbolFirst: true,
    flag: '🇺🇸',
    step: 1,
  },
  GBP: {
    code: 'GBP',
    name: 'Bảng Anh',
    symbol: '£',
    decimals: 2,
    locale: 'en-GB',
    symbolFirst: true,
    flag: '🇬🇧',
    step: 1,
  },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export const DEFAULT_CURRENCY = 'VND';

export function isCurrency(code) {
  return !!(code && CURRENCIES[String(code).toUpperCase()]);
}

/** Thông tin đồng tiền; không rõ thì trả về VND để không bao giờ ném lỗi. */
export function currency(code) {
  return CURRENCIES[String(code || '').toUpperCase()] || CURRENCIES[DEFAULT_CURRENCY];
}

export const decimalsOf = (code) => currency(code).decimals;
export const symbolOf = (code) => currency(code).symbol;
/** Hệ số quy đổi major <-> minor: VND = 1, EUR = 100 */
export const factorOf = (code) => Math.pow(10, currency(code).decimals);

/** 12.5 EUR -> 1250 ; 50000 VND -> 50000 */
export function toMinor(major, code) {
  const n = Number(major);
  if (!isFinite(n)) return 0;
  return Math.round(n * factorOf(code));
}

/** 1250 EUR-cent -> 12.5 ; 50000 VND -> 50000 */
export function toMajor(minor, code) {
  const n = Number(minor);
  if (!isFinite(n)) return 0;
  return n / factorOf(code);
}

/** Làm tròn về số nguyên minor unit hợp lệ */
export function roundMinor(minor) {
  const n = Number(minor);
  return isFinite(n) ? Math.round(n) : 0;
}

/**
 * Định dạng đầy đủ. Nhận **minor units**.
 *   fmtMoney(123456, 'EUR')  -> "€1,234.56"
 *   fmtMoney(1500000, 'VND') -> "1.500.000đ"
 */
export function fmtMoney(minor, code = DEFAULT_CURRENCY, opts = {}) {
  const c = currency(code);
  const major = toMajor(roundMinor(minor), c.code);
  const digits = opts.maxDigits ?? c.decimals;
  // Số tròn thì bỏ ",00" cho gọn: €44,000 thay vì €44,000.00
  const hasFraction = Math.abs(major % 1) > 1e-9;
  const body = Math.abs(major).toLocaleString(c.locale, {
    minimumFractionDigits: opts.minDigits ?? (hasFraction && !opts.compactZero ? c.decimals : 0),
    maximumFractionDigits: digits,
  });
  const sign = major < 0 ? '-' : '';
  if (c.code === 'VND') return `${sign}${body}đ`;
  return c.symbolFirst ? `${sign}${c.symbol}${body}` : `${sign}${body} ${c.symbol}`;
}

/** Rút gọn cho biểu đồ/tiêu đề. Nhận minor units. */
export function shortMoney(minor, code = DEFAULT_CURRENCY) {
  const c = currency(code);
  const v = toMajor(roundMinor(minor), c.code);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (c.code === 'VND') {
    if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} tỷ`;
    if (abs >= 1e6) return `${sign}${trim(abs / 1e6)} triệu`;
    if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
    return `${sign}${Math.round(abs)}đ`;
  }
  const p = (x, u) => `${sign}${c.symbol}${trimEn(x)}${u}`;
  if (abs >= 1e9) return p(abs / 1e9, 'B');
  if (abs >= 1e6) return p(abs / 1e6, 'M');
  if (abs >= 1e3) return p(abs / 1e3, 'k');
  return `${sign}${c.symbol}${abs.toFixed(abs < 10 && abs % 1 ? 2 : 0)}`;
}

function trim(x) {
  return String(Number(x.toFixed(x >= 100 ? 0 : 1))).replace('.', ',');
}
function trimEn(x) {
  return String(Number(x.toFixed(x >= 100 ? 0 : 1)));
}

/**
 * Đọc chuỗi số theo quy ước hỗn hợp (người Việt dùng EUR hay viết lẫn kiểu).
 * Quy tắc:
 *   - Có cả "." và "," -> dấu XUẤT HIỆN SAU CÙNG là dấu thập phân
 *     "1.500,75" = 1500,75   |   "1,500.75" = 1500.75
 *   - Chỉ một loại dấu, lặp nhiều lần -> phân tách nghìn  ("1.500.000" = 1500000)
 *   - Chỉ một dấu, sau nó đúng 3 chữ số -> phân tách nghìn ("1.500" = "1,500" = 1500)
 *   - Chỉ một dấu, sau nó 1-2 chữ số -> thập phân  ("1,2" = 1,2 ; "12.50" = 12,5)
 * Trả về giá trị **major**, hoặc null.
 */
export function parseNumberFor(str, code = DEFAULT_CURRENCY) {
  const s = String(str ?? '').trim().replace(/\s/g, '');
  if (!s || !/\d/.test(s)) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;

  let cleaned;
  if (!dots && !commas) {
    cleaned = s;
  } else if (dots && commas) {
    const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    cleaned = `${s.slice(0, sep).replace(/[.,]/g, '')}.${s.slice(sep + 1)}`;
  } else {
    const total = dots + commas;
    const sepIdx = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const tail = s.slice(sepIdx + 1);
    if (total > 1 || /^\d{3}$/.test(tail)) cleaned = s.replace(/[.,]/g, '');
    else cleaned = `${s.slice(0, sepIdx).replace(/[.,]/g, '')}.${tail}`;
  }
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/** Chuẩn hoá mã tiền tệ người dùng gõ: "euro", "eur", "€" -> EUR */
const ALIASES = {
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', ơ: 'EUR',
  '₫': 'VND', vnd: 'VND', 'vnđ': 'VND', d: 'VND', đ: 'VND', dong: 'VND', 'đồng': 'VND',
  $: 'USD', usd: 'USD', dollar: 'USD', dola: 'USD', 'đô': 'USD', do: 'USD',
  'đô la': 'USD', 'do la': 'USD', 'đôla': 'USD',
  '£': 'GBP', gbp: 'GBP', pound: 'GBP', bang: 'GBP', 'bảng': 'GBP',
};

export function normalizeCurrency(input, fallback = null) {
  if (!input) return fallback;
  const raw = String(input).trim();
  const up = raw.toUpperCase();
  if (CURRENCIES[up]) return up;
  const key = raw.toLowerCase();
  return ALIASES[key] || ALIASES[raw] || fallback;
}
