/** Tiền tệ: lưu số nguyên VND. */

export const round = (n) => Math.round(Number(n) || 0);

export function fmt(n, currency = 'VND') {
  const v = Math.round(Number(n) || 0);
  if (currency !== 'VND') return `${v.toLocaleString('en-US')} ${currency}`;
  return `${v.toLocaleString('vi-VN')}đ`;
}

/** Rút gọn: 1.500.000 -> "1,5 triệu" */
export function short(n) {
  const v = Math.round(Number(n) || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} tỷ`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)} triệu`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  return `${sign}${abs}đ`;
}

function trim(x) {
  return String(Number(x.toFixed(x >= 100 ? 0 : 1))).replace('.', ',');
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
