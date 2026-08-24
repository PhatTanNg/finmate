/**
 * Thuế thu nhập Ireland (áp dụng năm thuế 2026).
 *
 * Mọi số tiền vào/ra đều tính bằng **cent EUR** (đơn vị nhỏ nhất), đúng quy
 * ước lưu trữ của app: 44.000 € = 4_400_000.
 *
 * Ba khoản khấu trừ trên lương ở Ireland:
 *   1. Income Tax (PAYE) — 20% đến mức cắt, 40% phần vượt, rồi TRỪ tín dụng thuế
 *   2. USC  — tính trên thu nhập gộp, theo bậc
 *   3. PRSI — tỷ lệ phẳng, có ngưỡng miễn và tín dụng giảm dần
 *
 * Lưu ý quan trọng: đóng góp hưu trí chỉ được giảm trừ cho **Income Tax**,
 * KHÔNG được giảm cho USC và PRSI.
 */
import { setting } from '../db.js';

const E = (euro) => Math.round(euro * 100); // euro -> cent

export const TAX_YEAR = 2026;

/** Mức cắt thuế suất chuẩn (Standard Rate Cut-Off Point) theo hoàn cảnh. */
export const SRCOP = {
  single: E(44_000),
  married_one_income: E(53_000),
  married_two_incomes: E(88_000), // tối đa, phần chuyển nhượng giữa 2 vợ chồng có giới hạn
  single_parent: E(48_000),
};

export const RATES = {
  standard: 0.2,
  higher: 0.4,
};

/** Tín dụng thuế phổ biến (đơn vị: cent/năm) */
export const CREDITS = {
  personal_single: E(2_000),
  personal_married: E(4_000),
  employee_paye: E(2_000),
  rent: E(1_000), // Rent Tax Credit, tối đa cho người độc thân
  single_person_child_carer: E(1_900),
};

/** Bậc USC 2026 (ngưỡng luỹ tiến từng phần) */
export const USC_BANDS = [
  { upTo: E(12_012), rate: 0.005 },
  { upTo: E(28_700), rate: 0.02 },
  { upTo: E(70_044), rate: 0.03 },
  { upTo: Infinity, rate: 0.08 },
];
/** Thu nhập năm không quá mức này thì được miễn USC hoàn toàn */
export const USC_EXEMPTION = E(13_000);

/** PRSI người lao động (Class A) */
export const PRSI = {
  rate: 0.042,          // 4,2% — từ 01/10/2026 lên 4,35%
  rate_from_october: 0.0435,
  weekly_threshold: E(352),      // dưới mức này: miễn PRSI
  credit_max_weekly: E(12),
  credit_upper_weekly: E(424),
};

/** Giới hạn giảm trừ đóng góp hưu trí theo tuổi (% thu nhập liên quan) */
export const PENSION_AGE_LIMITS = [
  { maxAge: 29, pct: 0.15 },
  { maxAge: 39, pct: 0.2 },
  { maxAge: 49, pct: 0.25 },
  { maxAge: 54, pct: 0.3 },
  { maxAge: 59, pct: 0.35 },
  { maxAge: 200, pct: 0.4 },
];
export const PENSION_EARNINGS_CAP = E(115_000);

/** Thuế trên các nguồn thu khác */
export const OTHER_RATES_IE = {
  dirt: { rate: 0.33, note: 'DIRT 33% trên lãi tiền gửi — ngân hàng khấu trừ tại nguồn.' },
  cgt: { rate: 0.33, exemption: E(1_270), note: 'Lãi vốn 33%, được miễn 1.270 €/năm đầu tiên.' },
  dwt: { rate: 0.25, note: 'Cổ tức Ireland bị khấu trừ 25% tại nguồn, sau đó tính theo thuế suất biên.' },
  etf_exit: { rate: 0.38, note: 'ETF thuộc EU: thuế 38% khi bán và "deemed disposal" mỗi 8 năm, không bù lỗ được.' },
  rental: { note: 'Thu nhập cho thuê tính theo thuế suất biên + USC + PRSI, được trừ chi phí và 100% lãi vay.' },
};

export function config() {
  return {
    status: setting('ie_tax_status') || 'single',
    srcop: Number(setting('ie_srcop') || SRCOP.single),
    credits: Number(setting('ie_credits') || CREDITS.personal_single + CREDITS.employee_paye),
    rent_credit: setting('ie_rent_credit') === '0' ? 0 : CREDITS.rent,
    prsi_rate: Number(setting('ie_prsi_rate') || PRSI.rate),
  };
}

/** Thuế thu nhập luỹ tiến 20%/40% TRƯỚC khi trừ tín dụng thuế. */
export function incomeTaxGross(taxable, srcop) {
  const t = Math.max(0, taxable);
  const atStandard = Math.min(t, srcop);
  const atHigher = Math.max(0, t - srcop);
  return Math.round(atStandard * RATES.standard + atHigher * RATES.higher);
}

/** USC cả năm trên thu nhập gộp. */
export function usc(gross) {
  const g = Math.max(0, gross);
  if (g <= USC_EXEMPTION) return 0;
  let total = 0;
  let prev = 0;
  for (const b of USC_BANDS) {
    if (g <= prev) break;
    total += (Math.min(g, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return Math.round(total);
}

/**
 * PRSI cả năm. Tính theo tuần vì ngưỡng miễn và tín dụng đều theo tuần.
 * Thu nhập dưới 352 €/tuần được miễn; từ 352,01 đến 424 € có tín dụng giảm dần.
 */
export function prsi(gross, { rate = null } = {}) {
  const r = rate ?? config().prsi_rate;
  const weekly = Math.max(0, gross) / 52;
  if (weekly < PRSI.weekly_threshold) return 0;
  let weeklyCharge = weekly * r;
  if (weekly <= PRSI.credit_upper_weekly) {
    const taper = (weekly - PRSI.weekly_threshold) / 6;
    const credit = Math.max(0, PRSI.credit_max_weekly - taper);
    weeklyCharge = Math.max(0, weeklyCharge - credit);
  }
  return Math.round(weeklyCharge * 52);
}

/** Trần đóng góp hưu trí được giảm thuế theo tuổi. */
export function pensionReliefLimit(gross, age = 30) {
  const band = PENSION_AGE_LIMITS.find((b) => age <= b.maxAge) || PENSION_AGE_LIMITS[PENSION_AGE_LIMITS.length - 1];
  const capped = Math.min(Math.max(0, gross), PENSION_EARNINGS_CAP);
  return { pct: band.pct, limit: Math.round(capped * band.pct) };
}

/**
 * Lương GỘP năm -> lương THỰC NHẬN năm.
 * @param {number} gross      thu nhập năm (cent)
 * @param {object} opts       { status, age, pension, rentCredit, extraCredits, srcop }
 */
export function grossToNetIE(gross, opts = {}) {
  const c = config();
  const status = opts.status || c.status;
  const srcop = opts.srcop ?? (SRCOP[status] || c.srcop);
  const age = opts.age ?? 30;

  const pensionCap = pensionReliefLimit(gross, age);
  const pensionPaid = Math.max(0, Math.round(Number(opts.pension) || 0));
  const pensionRelieved = Math.min(pensionPaid, pensionCap.limit);

  // Hưu trí chỉ giảm cho thuế thu nhập, không giảm USC/PRSI
  const taxable = Math.max(0, gross - pensionRelieved);
  const grossTax = incomeTaxGross(taxable, srcop);

  let credits = opts.extraCredits ?? 0;
  credits += status === 'married_one_income' || status === 'married_two_incomes'
    ? CREDITS.personal_married
    : CREDITS.personal_single;
  credits += CREDITS.employee_paye;
  if (opts.rentCredit) credits += CREDITS.rent;

  const incomeTax = Math.max(0, grossTax - credits);
  const uscAmount = usc(gross);
  const prsiAmount = prsi(gross, { rate: opts.prsiRate });

  const totalTax = incomeTax + uscAmount + prsiAmount;
  const net = gross - totalTax - pensionPaid;

  return {
    country: 'IE',
    year: TAX_YEAR,
    gross: Math.round(gross),
    srcop,
    pension: pensionPaid,
    pension_relief_limit: pensionCap.limit,
    pension_relief_pct: pensionCap.pct,
    pension_excess: Math.max(0, pensionPaid - pensionCap.limit),
    taxable,
    income_tax_gross: grossTax,
    credits,
    income_tax: incomeTax,
    usc: uscAmount,
    prsi: prsiAmount,
    total_tax: totalTax,
    net: Math.round(net),
    effective_rate: gross ? totalTax / gross : 0,
    marginal_rate: marginalRate(gross, srcop),
    monthly_net: Math.round(net / 12),
    monthly_gross: Math.round(gross / 12),
    monthly_tax: Math.round(totalTax / 12),
  };
}

/** Thuế suất biên tổng hợp (thu nhập + USC + PRSI) cho 1 € kiếm thêm. */
export function marginalRate(gross, srcop = SRCOP.single) {
  const rate = gross >= srcop ? RATES.higher : RATES.standard;
  const uscBand = USC_BANDS.find((b) => gross <= b.upTo) || USC_BANDS[USC_BANDS.length - 1];
  const uscRate = gross <= USC_EXEMPTION ? 0 : uscBand.rate;
  const prsiRate = gross / 52 < PRSI.weekly_threshold ? 0 : config().prsi_rate;
  return rate + uscRate + prsiRate;
}

/** Thực nhận -> gộp (chia đôi tìm nghiệm). */
export function netToGrossIE(net, opts = {}) {
  let lo = net;
  let hi = net * 2.5 + E(20_000);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (grossToNetIE(mid, opts).net >= net) hi = mid;
    else lo = mid;
  }
  return grossToNetIE(Math.round(hi), opts);
}

/** DIRT trên lãi tiền gửi (ngân hàng đã khấu trừ sẵn). */
export function dirt(interest) {
  const gross = Math.max(0, Math.round(interest));
  const tax = Math.round(gross * OTHER_RATES_IE.dirt.rate);
  return { gross, tax, net: gross - tax, rate: OTHER_RATES_IE.dirt.rate };
}

/** Thuế lãi vốn: 33% sau khi trừ miễn 1.270 €/năm. */
export function cgt(gain, { usedExemption = 0 } = {}) {
  const g = Math.max(0, Math.round(gain));
  const exemptionLeft = Math.max(0, OTHER_RATES_IE.cgt.exemption - usedExemption);
  const exempt = Math.min(g, exemptionLeft);
  const taxable = g - exempt;
  const tax = Math.round(taxable * OTHER_RATES_IE.cgt.rate);
  return { gain: g, exempt, taxable, tax, net: g - tax, rate: OTHER_RATES_IE.cgt.rate };
}

/** Ước tính thuế năm từ danh sách nguồn thu (đơn vị cent, đã quy về EUR). */
export function estimateAnnualTaxIE(streams = [], opts = {}) {
  let salary = 0;
  const detail = [];
  let total = 0;

  for (const s of streams) {
    if (!s.active) continue;
    const monthly = s.gross_amount || s.net_amount || 0;
    if (s.type === 'salary') salary += monthly * 12;
    else if (s.type === 'interest') {
      const r = dirt(monthly * 12);
      total += r.tax;
      detail.push({ name: s.name, kind: 'DIRT 33% trên lãi tiền gửi', amount: r.tax });
    } else if (s.type === 'dividend') {
      const t = Math.round(monthly * 12 * OTHER_RATES_IE.dwt.rate);
      total += t;
      detail.push({ name: s.name, kind: 'Khấu trừ cổ tức 25%', amount: t });
    } else if (s.type === 'rental') {
      const marg = marginalRate(salary || monthly * 12);
      const t = Math.round(monthly * 12 * marg);
      total += t;
      detail.push({ name: s.name, kind: `Cho thuê theo thuế suất biên ${Math.round(marg * 100)}%`, amount: t });
    }
  }

  if (salary > 0) {
    const r = grossToNetIE(salary, opts);
    total += r.total_tax;
    detail.unshift({ name: 'Lương', kind: 'PAYE + USC + PRSI', amount: r.total_tax });
  }
  return { total, detail, country: 'IE' };
}
