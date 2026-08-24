/**
 * Định dạng tiền đa tiền tệ. Số tiền luôn là **đơn vị nhỏ nhất** của đồng tiền
 * (VND: 1đ, EUR: 1 cent) — giống hệt quy ước phía server.
 */
export const CURRENCIES = {
  VND: { code: 'VND', name: 'Việt Nam Đồng', symbol: '₫', decimals: 0, locale: 'vi-VN', flag: '🇻🇳', step: 1000 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, locale: 'en-IE', flag: '🇪🇺', step: 1 },
  USD: { code: 'USD', name: 'Đô la Mỹ', symbol: '$', decimals: 2, locale: 'en-US', flag: '🇺🇸', step: 1 },
  GBP: { code: 'GBP', name: 'Bảng Anh', symbol: '£', decimals: 2, locale: 'en-GB', flag: '🇬🇧', step: 1 },
  JPY: { code: 'JPY', name: 'Yên Nhật', symbol: '¥', decimals: 0, locale: 'ja-JP', flag: '🇯🇵', step: 100 },
  KRW: { code: 'KRW', name: 'Won Hàn Quốc', symbol: '₩', decimals: 0, locale: 'ko-KR', flag: '🇰🇷', step: 1000 },
  TWD: { code: 'TWD', name: 'Đài tệ', symbol: 'NT$', decimals: 0, locale: 'zh-TW', flag: '🇹🇼', step: 10 },
  AUD: { code: 'AUD', name: 'Đô la Úc', symbol: 'A$', decimals: 2, locale: 'en-AU', flag: '🇦🇺', step: 1 },
  CAD: { code: 'CAD', name: 'Đô la Canada', symbol: 'C$', decimals: 2, locale: 'en-CA', flag: '🇨🇦', step: 1 },
  SGD: { code: 'SGD', name: 'Đô la Singapore', symbol: 'S$', decimals: 2, locale: 'en-SG', flag: '🇸🇬', step: 1 },
};

const LS_KEY = 'finmate.base_currency';
const readCached = () => {
  try { const v = globalThis.localStorage?.getItem(LS_KEY); return v && CURRENCIES[v] ? v : null; } catch { return null; }
};

let BASE = readCached() || 'VND';
/**
 * Đặt đồng tiền gốc. Gọi ngay khi tải profile/dashboard từ API.
 * Giá trị được nhớ trong localStorage để lần tải sau không hiển thị nhầm
 * đồng tiền trong lúc chờ API trả về.
 * @returns {boolean} true nếu đồng tiền gốc thay đổi so với trước đó.
 */
export function setBaseCurrency(code) {
  const next = String(code || '').toUpperCase();
  if (!CURRENCIES[next]) return false;
  const changed = next !== BASE;
  BASE = next;
  try { globalThis.localStorage?.setItem(LS_KEY, next); } catch { /* bỏ qua */ }
  return changed;
}
export const baseCurrency = () => BASE;
export const cur = (code) => CURRENCIES[String(code || '').toUpperCase()] || CURRENCIES[BASE];
export const factorOf = (code) => Math.pow(10, cur(code).decimals);
export const toMajor = (minor, code) => (Number(minor) || 0) / factorOf(code);
export const toMinor = (major, code) => Math.round((Number(major) || 0) * factorOf(code));

export function fmt(n, code) {
  const c = cur(code);
  const major = toMajor(Math.round(Number(n) || 0), c.code);
  const hasFraction = Math.abs(major % 1) > 1e-9;
  const body = Math.abs(major).toLocaleString(c.locale, {
    minimumFractionDigits: hasFraction ? c.decimals : 0,
    maximumFractionDigits: c.decimals,
  });
  const sign = major < 0 ? '-' : '';
  if (c.code === 'VND') return `${sign}${body}đ`;
  return `${sign}${c.symbol}${body}`;
}

export function short(n, code) {
  const c = cur(code);
  const v = toMajor(Math.round(Number(n) || 0), c.code);
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (c.code === 'VND') {
    const d = (x, u) => `${s}${(a / x).toFixed(a / x >= 100 ? 0 : 1).replace(/\.0$/, '').replace('.', ',')} ${u}`;
    if (a >= 1e9) return d(1e9, 'tỷ');
    if (a >= 1e6) return d(1e6, 'tr');
    if (a >= 1e3) return `${s}${Math.round(a / 1e3)}k`;
    return `${v}`;
  }
  const p = (x, u) => `${s}${c.symbol}${Number((a / x).toFixed(a / x >= 100 ? 0 : 1))}${u}`;
  if (a >= 1e9) return p(1e9, 'B');
  if (a >= 1e6) return p(1e6, 'M');
  if (a >= 1e3) return p(1e3, 'k');
  return `${s}${c.symbol}${a % 1 ? a.toFixed(2) : a}`;
}

/** Hiển thị kép: "€1,200 (≈36,6 tr)" — dùng khi có tỷ giá từ API. */
export function dual(n, code, rate, otherCode) {
  const main = fmt(n, code);
  if (!rate || !otherCode || cur(code).code === cur(otherCode).code) return main;
  const converted = (toMajor(n, code) * rate * factorOf(otherCode));
  return `${main} (≈${short(converted, otherCode)})`;
}

export const pct = (x, d = 0) => `${((Number(x) || 0) * 100).toFixed(d).replace('.', ',')}%`;

export function vnDate(s) {
  if (!s) return '—';
  const [y, m, dd] = String(s).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

export const monthLabel = (mk) => (mk ? `T${Number(mk.slice(5, 7))}/${mk.slice(0, 4)}` : '');

/** Markdown tối giản: **đậm**, _nghiêng_, `code`, danh sách, tiêu đề, xuống dòng. */
export function mdToHtml(text = '') {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,)!?]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
