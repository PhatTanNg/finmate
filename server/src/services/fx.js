/**
 * Tỷ giá hối đoái.
 * - Lưu theo ngày để giao dịch cũ giữ đúng tỷ giá lúc phát sinh.
 * - Tự cập nhật 1 lần/ngày từ open.er-api.com (miễn phí, không cần key).
 * - Luôn có bảng dự phòng để app chạy được ngay cả khi không có mạng.
 */
import { all, get, run, setting } from '../db.js';
import { today } from '../util/date.js';
import { CURRENCY_CODES, toMajor, toMinor, currency } from '../util/currency.js';
import { setBaseCurrencyProvider } from '../util/money.js';

/** Dự phòng khi chưa từng tải được tỷ giá (đơn vị: bao nhiêu <quote> cho 1 EUR). */
const FALLBACK_EUR = {
  EUR: 1,
  VND: 30500,
  USD: 1.08,
  GBP: 0.85,
};

const SOURCE_URL = process.env.FINMATE_FX_URL || 'https://open.er-api.com/v6/latest/EUR';
/** Đặt FINMATE_FX_OFFLINE=1 để không bao giờ gọi mạng — chỉ dùng tỷ giá nhập tay. */
const OFFLINE = /^(1|true|yes)$/i.test(String(process.env.FINMATE_FX_OFFLINE || ''));

/** Ghi một tỷ giá. rate = số đơn vị `quote` đổi được từ 1 `base`. */
export function setRate(base, quote, rate, date = today(), source = 'manual') {
  const b = String(base).toUpperCase();
  const q = String(quote).toUpperCase();
  const r = Number(rate);
  if (!isFinite(r) || r <= 0 || b === q) return null;
  run(
    `INSERT INTO fx_rates (base, quote, rate, date, source) VALUES (?,?,?,?,?)
     ON CONFLICT(base, quote, date) DO UPDATE SET rate = excluded.rate, source = excluded.source`,
    [b, q, r, date, source]
  );
  return { base: b, quote: q, rate: r, date, source };
}

/** Tỷ giá đã lưu gần nhất tính đến `date` (không suy luận bắc cầu). */
function storedRate(base, quote, date) {
  const row = get(
    'SELECT rate, date FROM fx_rates WHERE base = ? AND quote = ? AND date <= ? ORDER BY date DESC LIMIT 1',
    [base, quote, date]
  );
  if (row) return row.rate;
  // Giao dịch cũ hơn mọi tỷ giá đã lưu -> dùng bản ghi sớm nhất còn hơn là bỏ qua
  const first = get('SELECT rate FROM fx_rates WHERE base = ? AND quote = ? ORDER BY date ASC LIMIT 1', [base, quote]);
  return first ? first.rate : null;
}

/**
 * Tỷ giá from -> to. Thử: cùng tiền -> trực tiếp -> nghịch đảo -> bắc cầu qua EUR
 * -> cuối cùng là bảng dự phòng. Không bao giờ trả về null.
 */
export function getRate(from, to, date = today()) {
  const f = String(from || 'VND').toUpperCase();
  const t = String(to || 'VND').toUpperCase();
  if (f === t) return 1;

  const direct = storedRate(f, t, date);
  if (direct) return direct;

  const inverse = storedRate(t, f, date);
  if (inverse) return 1 / inverse;

  // Bắc cầu qua EUR
  const fEur = f === 'EUR' ? 1 : storedRate('EUR', f, date);
  const tEur = t === 'EUR' ? 1 : storedRate('EUR', t, date);
  if (fEur && tEur) return tEur / fEur;

  const ff = FALLBACK_EUR[f];
  const ft = FALLBACK_EUR[t];
  if (ff && ft) return ft / ff;
  return 1;
}

/** Quy đổi số tiền **minor units** sang minor units của đồng tiền khác. */
export function convert(minorAmount, from, to, date = today()) {
  const f = String(from || 'VND').toUpperCase();
  const t = String(to || 'VND').toUpperCase();
  if (f === t) return Math.round(Number(minorAmount) || 0);
  const major = toMajor(Number(minorAmount) || 0, f);
  return toMinor(major * getRate(f, t, date), t);
}

/** Đồng tiền gốc dùng cho mọi báo cáo tổng hợp. */
export function baseCurrency() {
  const p = get('SELECT currency FROM profile WHERE id = 1');
  const c = (p && p.currency) || setting('base_currency') || 'VND';
  return currency(c).code;
}

/**
 * Quy đổi một hằng số vốn viết theo VND (ngưỡng cảnh báo, mốc "chi lớn"...)
 * sang đồng tiền gốc hiện tại. Nhờ vậy khi dùng EUR thì "2 triệu đồng" tự
 * thành "~65 €" chứ không so sánh sai đơn vị.
 */
export function vndThreshold(vndAmount, base = baseCurrency()) {
  if (base === 'VND') return vndAmount;
  return convert(vndAmount, 'VND', base, today());
}

/** Tải tỷ giá mới. Trả về {ok, updated, error} — không bao giờ ném lỗi ra ngoài. */
export async function refreshRates({ force = false } = {}) {
  const d = today();
  if (OFFLINE) return { ok: false, updated: 0, offline: true, error: 'Đang bật chế độ offline (FINMATE_FX_OFFLINE)', date: d };
  if (!force) {
    const last = setting('fx_last_fetch');
    if (last === d) return { ok: true, updated: 0, skipped: true, date: d };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(SOURCE_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rates = json && (json.rates || json.conversion_rates);
    if (!rates) throw new Error('Phản hồi không có tỷ giá');
    let updated = 0;
    for (const code of CURRENCY_CODES) {
      if (code === 'EUR') continue;
      const r = Number(rates[code]);
      if (isFinite(r) && r > 0) {
        setRate('EUR', code, r, d, 'ecb-api');
        updated++;
      }
    }
    setting('fx_last_fetch', d);
    if (updated) setting('fx_last_ok', new Date().toISOString());
    return { ok: true, updated, date: d };
  } catch (e) {
    setting('fx_last_error', `${d}: ${e.message}`);
    return { ok: false, updated: 0, error: e.message, date: d };
  }
}

/** Nạp bảng dự phòng nếu DB chưa có tỷ giá nào (chạy lúc khởi động). */
export function ensureSeedRates() {
  const c = get('SELECT COUNT(*) AS c FROM fx_rates').c;
  if (c) return 0;
  let n = 0;
  for (const [code, rate] of Object.entries(FALLBACK_EUR)) {
    if (code === 'EUR') continue;
    setRate('EUR', code, rate, today(), 'fallback');
    n++;
  }
  return n;
}

/** Bảng tỷ giá hiện tại so với đồng tiền gốc, để hiển thị trong Cài đặt. */
export function rateTable(base = baseCurrency()) {
  const d = today();
  return CURRENCY_CODES.filter((c) => c !== base).map((c) => ({
    code: c,
    name: currency(c).name,
    flag: currency(c).flag,
    rate: getRate(base, c, d),
    inverse: getRate(c, base, d),
  }));
}

export function rateHistory(base, quote, limit = 90) {
  return all('SELECT date, rate, source FROM fx_rates WHERE base = ? AND quote = ? ORDER BY date DESC LIMIT ?', [
    String(base).toUpperCase(),
    String(quote).toUpperCase(),
    limit,
  ]).reverse();
}

export function fxStatus() {
  return {
    last_fetch: setting('fx_last_fetch'),
    last_ok: setting('fx_last_ok'),
    last_error: setting('fx_last_error'),
    count: get('SELECT COUNT(*) AS c FROM fx_rates').c,
    source: SOURCE_URL,
  };
}

// Cho util/money.js biết đồng tiền hiển thị mặc định mà không tạo phụ thuộc vòng
setBaseCurrencyProvider(baseCurrency);
