/** Tự do tài chính (FIRE): số tiền cần, ngày đạt được, và các kịch bản rút ngắn. */
import { all, get } from '../db.js';
import { today, addMonths, age } from '../util/date.js';
import { futureValue, monthsToTarget } from '../util/money.js';
import { netWorth, accountsBase } from './networth.js';
import { averageMonthlyExpense, averageMonthlyIncome, essentialSplit, incomeSources, totals } from './reports.js';
import { monthStart, monthEnd, monthKey, addMonths as addM, lastMonths } from '../util/date.js';
import { projectedAnnualInterest } from './interest.js';
import { portfolio, realEstate } from './investments.js';
import { baseCurrency, convert } from './fx.js';
import { normalizeCurrency } from '../util/currency.js';

export function profile() {
  return get('SELECT * FROM profile WHERE id = 1') || {};
}

/**
 * Giả định mặc định theo đồng tiền gốc. Thị trường VN lợi nhuận danh nghĩa cao
 * nhưng lạm phát cũng cao; khu vực đồng euro thì ngược lại. Nếu người dùng đã
 * tự đặt trong hồ sơ thì luôn ưu tiên số của họ.
 */
export function marketAssumptions(code = baseCurrency()) {
  if (code === 'VND') return { expected_return: 0.09, inflation: 0.04 };
  if (code === 'EUR') return { expected_return: 0.07, inflation: 0.025 };
  if (code === 'GBP') return { expected_return: 0.07, inflation: 0.025 };
  return { expected_return: 0.075, inflation: 0.025 };
}

/** Thu nhập thụ động hàng tháng hiện tại (lãi NH + cổ tức + cho thuê) */
export function passiveIncomeMonthly() {
  const modelInterest = Math.round(projectedAnnualInterest() / 12);
  const pf = portfolio();
  const modelDividend = Math.round(pf.projected_dividend / 12);
  const re = realEstate();
  const modelRent = re.net_monthly;

  // Người dùng có thể khai thẳng nguồn thu thụ động (lãi ngân hàng, cổ tức, tiền
  // thuê nhà) mà chưa nhập chi tiết sổ tiết kiệm hay danh mục cổ phiếu. Lấy số
  // lớn hơn giữa mô hình và số đã khai để không bỏ sót, cũng không cộng trùng.
  const declared = declaredPassiveByType();
  const interest = Math.max(modelInterest, declared.interest);
  const dividend = Math.max(modelDividend, declared.dividend);
  const rent = Math.max(modelRent, declared.rent);
  const other = declared.other;
  // Lương hưu không mô hình hoá được từ tài sản — chỉ có khi người dùng tự khai.
  const pension = declared.pension;

  const months = lastMonths(6);
  const observed = months.length
    ? Math.round(months.reduce((s, m) => s + (Number(incomeSources(monthStart(m), monthEnd(m)).passive) || 0), 0) / months.length)
    : 0;
  const modeled = interest + dividend + rent + other + pension;
  return { interest, dividend, rent, other, pension, modeled, observed, total: Math.max(modeled, observed) };
}

const PASSIVE_TYPES = {
  interest: 'interest', savings: 'interest', deposit: 'interest',
  dividend: 'dividend', investment: 'dividend', stock: 'dividend',
  rental: 'rent', rent: 'rent', property: 'rent',
  royalty: 'other', passive: 'other',
  // Lương hưu và trợ cấp là dòng tiền không cần đi làm — bỏ sót thì người đã
  // nghỉ hưu bị app xếp vào nhóm "sống bằng thu nhập chủ động 100%".
  pension: 'pension', retirement: 'pension', annuity: 'pension', social_security: 'pension',
};
const PER_MONTH = { monthly: 1, weekly: 52 / 12, biweekly: 26 / 12, quarterly: 1 / 3, yearly: 1 / 12, annual: 1 / 12, irregular: 1 };

/** Số tiền mỗi tháng của một nguồn thu đã khai, quy về đồng tiền gốc. */
export function streamMonthly(s) {
  const amount = Number(s.net_amount) || Number(s.gross_amount) || 0;
  if (amount <= 0) return 0;
  const perMonth = amount * (PER_MONTH[String(s.frequency || 'monthly').toLowerCase()] ?? 1);
  return convert(Math.round(perMonth), normalizeCurrency(s.currency) || baseCurrency(), baseCurrency());
}

/** Nguồn thu đã khai có phải thu nhập thụ động không. */
export const isPassiveStream = (s) => Boolean(PASSIVE_TYPES[String(s?.type || '').toLowerCase()]);

/** Tổng thu nhập mỗi tháng người dùng đã khai, tách chủ động / thụ động. */
export function declaredIncomeMonthly() {
  let active = 0;
  let passive = 0;
  for (const s of all('SELECT * FROM income_streams WHERE active = 1')) {
    const m = streamMonthly(s);
    if (!m) continue;
    if (isPassiveStream(s)) passive += m;
    else active += m;
  }
  return { active: Math.round(active), passive: Math.round(passive), total: Math.round(active + passive) };
}

/** Thu nhập thụ động do người dùng tự khai trong mục "Nguồn thu", quy về mỗi tháng. */
function declaredPassiveByType() {
  // Mọi nhóm trong PASSIVE_TYPES đều phải có ô sẵn ở đây, nếu không `out[bucket]`
  // là undefined và phép cộng cho ra NaN — con số hỏng lặng lẽ lan sang mọi báo
  // cáo thu nhập thụ động.
  const out = {};
  for (const bucket of new Set(Object.values(PASSIVE_TYPES))) out[bucket] = 0;
  const base = baseCurrency();
  for (const s of all('SELECT * FROM income_streams WHERE active = 1')) {
    const bucket = PASSIVE_TYPES[String(s.type || '').toLowerCase()];
    if (!bucket) continue;
    const amount = Number(s.net_amount) || Number(s.gross_amount) || 0;
    if (amount <= 0) continue;
    const perMonth = amount * (PER_MONTH[String(s.frequency || 'monthly').toLowerCase()] ?? 1);
    out[bucket] += convert(Math.round(perMonth), normalizeCurrency(s.currency) || base, base);
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

export function fireStats(overrides = {}) {
  const p = { ...profile(), ...overrides };
  const assume = marketAssumptions();
  const swr = Number(p.swr) || 0.04;
  const nominalReturn = Number(p.expected_return) || assume.expected_return;
  const inflation = Number(p.inflation) || assume.inflation;
  const realReturn = (1 + nominalReturn) / (1 + inflation) - 1;

  const monthlyExpense = overrides.monthly_expense || averageMonthlyExpense(6) || 0;
  const monthlyIncome = overrides.monthly_income || averageMonthlyIncome(6) || 0;
  const annualExpense = monthlyExpense * 12;

  const mk = monthKey();
  const split = essentialSplit(monthStart(addM(monthStart(mk), -5)), monthEnd(mk));
  const essentialRatio = split.total ? split.essential / split.total : 0.6;
  const leanAnnual = Math.round(annualExpense * (essentialRatio || 0.6));
  const fatAnnual = Math.round(annualExpense * 1.5);

  const nw = netWorth();
  const re = realEstate();
  const invested = nw.breakdown.savings + nw.breakdown.investments + re.total_value;
  const fiNumber = Math.round(annualExpense / swr);
  const leanNumber = Math.round(leanAnnual / swr);
  const fatNumber = Math.round(fatAnnual / swr);

  const monthlySurplus = overrides.monthly_surplus ?? Math.max(0, monthlyIncome - monthlyExpense);
  const months = monthsToTarget(invested, monthlySurplus, realReturn, fiNumber);
  const fiDate = months === null ? null : addMonths(today(), Math.ceil(months));
  const currentAge = age(p.birth_year);
  const passive = passiveIncomeMonthly();

  const targetAge = p.retire_age_target || 50;
  const yearsToTargetAge = currentAge ? Math.max(0, targetAge - currentAge) : 20;
  const coastNumber = Math.round(fiNumber / Math.pow(1 + realReturn, yearsToTargetAge));

  const scenarios = [
    { key: 'base', label: 'Hiện tại', surplus: monthlySurplus, expense: monthlyExpense },
    { key: 'save_more_10', label: 'Tiết kiệm thêm 10% thu nhập', surplus: monthlySurplus + monthlyIncome * 0.1, expense: monthlyExpense },
    { key: 'cut_10', label: 'Cắt 10% chi tiêu', surplus: monthlySurplus + monthlyExpense * 0.1, expense: monthlyExpense * 0.9 },
    { key: 'income_20', label: 'Tăng thu nhập 20%', surplus: monthlySurplus + monthlyIncome * 0.2, expense: monthlyExpense },
  ].map((s) => {
    const target = Math.round((s.expense * 12) / swr);
    const m = monthsToTarget(invested, s.surplus, realReturn, target);
    return {
      ...s,
      surplus: Math.round(s.surplus),
      target,
      months: m === null ? null : Math.ceil(m),
      date: m === null ? null : addMonths(today(), Math.ceil(m)),
      age: m === null || !currentAge ? null : Math.round((currentAge + m / 12) * 10) / 10,
    };
  });

  const projection = [];
  for (let y = 0; y <= Math.min(40, Math.ceil((months || 360) / 12) + 5); y++) {
    projection.push({
      year: Number(today().slice(0, 4)) + y,
      age: currentAge ? currentAge + y : null,
      invested: Math.round(futureValue(invested, monthlySurplus, realReturn, y * 12)),
      target: fiNumber,
    });
  }

  return {
    monthly_expense: monthlyExpense,
    monthly_income: monthlyIncome,
    monthly_surplus: monthlySurplus,
    savings_rate: monthlyIncome ? monthlySurplus / monthlyIncome : 0,
    annual_expense: annualExpense,
    swr,
    expected_return: nominalReturn,
    inflation,
    real_return: realReturn,
    invested,
    net_worth: nw.net,
    fi_number: fiNumber,
    lean_number: leanNumber,
    fat_number: fatNumber,
    coast_number: coastNumber,
    coast_reached: invested >= coastNumber,
    progress: fiNumber ? Math.min(1, invested / fiNumber) : 0,
    months_to_fi: months === null ? null : Math.ceil(months),
    fi_date: fiDate,
    fi_age: months === null || !currentAge ? null : Math.round((currentAge + months / 12) * 10) / 10,
    current_age: currentAge,
    passive_income: passive,
    passive_coverage: monthlyExpense ? passive.total / monthlyExpense : 0,
    years_of_freedom: monthlyExpense ? Math.round((invested / monthlyExpense / 12) * 10) / 10 : 0,
    scenarios,
    projection,
    data_months: monthsWithData(),
  };
}

/** Số tháng đã thực sự có chi tiêu được ghi nhận — dự báo dựa trên càng ít tháng thì càng kém tin cậy. */
function monthsWithData() {
  return lastMonths(12)
    .filter((m) => {
      const t = totals(monthStart(m), monthEnd(m));
      return (t.expense || 0) > 0;
    }).length;
}

/** Quỹ khẩn cấp: đủ mấy tháng? */
export function emergencyStatus() {
  const p = profile();
  const target = p.emergency_months_target || 6;
  const monthlyExpense = averageMonthlyExpense(3) || 0;
  const fund = get("SELECT * FROM funds WHERE type = 'emergency'");
  const liquid = accountsBase(['cash', 'bank', 'ewallet', 'savings']);
  const current = fund && fund.balance > 0 ? fund.balance : liquid;
  const hasData = monthlyExpense > 0;
  const months = hasData ? current / monthlyExpense : 0;
  return {
    current,
    monthly_expense: monthlyExpense,
    // Chưa ghi nhận chi tiêu nào thì không thể biết trụ được mấy tháng —
    // trả null thay vì 0 để nơi dùng không hiểu nhầm là "quỹ rỗng".
    has_data: hasData,
    months_covered: hasData ? Math.round(months * 10) / 10 : null,
    target_months: target,
    target_amount: hasData ? Math.round(monthlyExpense * target) : 0,
    gap: hasData ? Math.max(0, Math.round(monthlyExpense * target - current)) : 0,
    ok: hasData ? months >= target : false,
  };
}
