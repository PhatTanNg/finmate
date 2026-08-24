/**
 * Tiền tệ & công thức tài chính.
 * Số tiền luôn là **số nguyên đơn vị nhỏ nhất** của đồng tiền tương ứng
 * (VND: 1đ, EUR: 1 cent) — xem util/currency.js.
 */
import { fmtMoney, shortMoney, DEFAULT_CURRENCY } from './currency.js';

export const round = (n) => Math.round(Number(n) || 0);

/**
 * Đồng tiền hiển thị mặc định. Dùng provider để util không phải import
 * tầng service (tránh phụ thuộc vòng và giữ test chạy được độc lập).
 */
let baseProvider = () => DEFAULT_CURRENCY;
export function setBaseCurrencyProvider(fn) {
  if (typeof fn === 'function') baseProvider = fn;
}
export function displayCurrency() {
  try {
    return baseProvider() || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

export function fmt(n, currency = null) {
  return fmtMoney(n, currency || displayCurrency());
}

/** Rút gọn: 1.500.000đ -> "1,5 triệu" ; 150000 EUR-cent -> "€1.5k" */
export function short(n, currency = null) {
  return shortMoney(n, currency || displayCurrency());
}

export const pct = (x, digits = 1) => `${((Number(x) || 0) * 100).toFixed(digits).replace('.', ',')}%`;

/** Lãi kép: giá trị tương lai của khoản gốc + đóng góp định kỳ hàng tháng */
export function futureValue(present, monthlyContribution, annualRate, months) {
  const r = annualRate / 12;
  if (Math.abs(r) < 1e-12) return present + monthlyContribution * months;
  const fvPresent = present * Math.pow(1 + r, months);
  const fvSeries = monthlyContribution * ((Math.pow(1 + r, months) - 1) / r);
  return fvPresent + fvSeries;
}

/** Số tháng cần để đạt target với đóng góp hàng tháng (null nếu không bao giờ đạt) */
export function monthsToTarget(present, monthlyContribution, annualRate, target) {
  if (present >= target) return 0;
  if (monthlyContribution <= 0 && annualRate <= 0) return null;
  const r = annualRate / 12;
  let lo = 0;
  let hi = 1200; // 100 năm
  if (futureValue(present, monthlyContribution, annualRate, hi) < target) return null;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (futureValue(present, monthlyContribution, annualRate, mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Khoản trả hàng tháng của khoản vay trả góp đều (annuity) */
export function pmt(principal, annualRate, months) {
  const r = annualRate / 12;
  if (months <= 0) return principal;
  if (Math.abs(r) < 1e-12) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
export const safeDiv = (a, b) => (b ? a / b : 0);
