/** Thuế TNCN Việt Nam (biểu luỹ tiến từng phần) — mức giảm trừ cấu hình được trong Cài đặt. */
import { setting } from '../db.js';

export const BRACKETS = [
  { upTo: 5_000_000, rate: 0.05 },
  { upTo: 10_000_000, rate: 0.1 },
  { upTo: 18_000_000, rate: 0.15 },
  { upTo: 32_000_000, rate: 0.2 },
  { upTo: 52_000_000, rate: 0.25 },
  { upTo: 80_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

export function config() {
  return {
    self_deduction: Number(setting('tax_self_deduction') || 15_500_000),
    dependent_deduction: Number(setting('tax_dependent_deduction') || 6_200_000),
    insurance_rate: Number(setting('tax_insurance_rate') || 0.105),
    insurance_cap: Number(setting('tax_insurance_cap') || 46_800_000),
  };
}

export function taxOnTaxable(taxable) {
  let tax = 0;
  let prev = 0;
  for (const b of BRACKETS) {
    if (taxable <= prev) break;
    const slice = Math.min(taxable, b.upTo) - prev;
    tax += slice * b.rate;
    prev = b.upTo;
  }
  return Math.round(tax);
}

/** Từ lương GROSS -> NET (tháng) */
export function grossToNet(gross, { dependents = 0, insuranceBase = null } = {}) {
  const c = config();
  const base = Math.min(insuranceBase ?? gross, c.insurance_cap);
  const insurance = Math.round(base * c.insurance_rate);
  const deduction = c.self_deduction + dependents * c.dependent_deduction;
  const taxable = Math.max(0, gross - insurance - deduction);
  const tax = taxOnTaxable(taxable);
  const net = gross - insurance - tax;
  const bracket = BRACKETS.find((b) => taxable <= b.upTo);
  return {
    gross: Math.round(gross),
    insurance,
    deduction,
    taxable,
    tax,
    net: Math.round(net),
    effective_rate: gross ? tax / gross : 0,
    marginal_rate: bracket ? bracket.rate : 0,
    annual_tax: tax * 12,
  };
}

/** Từ lương NET -> GROSS (tìm nghiệm bằng chia đôi) */
export function netToGross(net, opts = {}) {
  let lo = net;
  let hi = net * 2.5 + 20_000_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (grossToNet(mid, opts).net >= net) hi = mid;
    else lo = mid;
  }
  return grossToNet(Math.round(hi), opts);
}

/** Thuế cho các nguồn thu khác (tham khảo) */
export const OTHER_RATES = {
  rental: { rate: 0.1, note: 'Cho thuê nhà >100 triệu/năm: 5% GTGT + 5% TNCN trên doanh thu' },
  stock_sale: { rate: 0.001, note: 'Chuyển nhượng chứng khoán: 0,1% trên giá trị bán' },
  dividend_cash: { rate: 0.05, note: 'Cổ tức tiền mặt: 5%' },
  deposit_interest: { rate: 0, note: 'Lãi tiền gửi cá nhân: miễn thuế TNCN' },
  business: { rate: 0.015, note: 'Hộ kinh doanh: 1,5% (1% TNCN + 0,5% GTGT) tuỳ ngành, doanh thu >100 triệu/năm' },
};

export function estimateAnnualTax(streams = []) {
  let total = 0;
  const detail = [];
  for (const s of streams) {
    if (!s.active) continue;
    if (s.type === 'salary' && s.tax_mode === 'gross_pit') {
      const r = grossToNet(s.gross_amount || 0, { dependents: 0, insuranceBase: s.insurance_base || null });
      total += r.annual_tax;
      detail.push({ name: s.name, kind: 'TNCN từ lương', amount: r.annual_tax });
    } else if (s.type === 'rental') {
      const revenue = (s.gross_amount || s.net_amount || 0) * 12;
      if (revenue > 100_000_000) {
        const t = Math.round(revenue * 0.1);
        total += t;
        detail.push({ name: s.name, kind: 'Thuế cho thuê (10% doanh thu)', amount: t });
      }
    } else if (s.type === 'dividend') {
      const t = Math.round((s.net_amount || 0) * 12 * 0.05);
      total += t;
      detail.push({ name: s.name, kind: 'Thuế cổ tức 5%', amount: t });
    }
  }
  return { total, detail };
}
