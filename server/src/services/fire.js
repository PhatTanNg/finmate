/** Tự do tài chính (FIRE): số tiền cần, ngày đạt được, và các kịch bản rút ngắn. */
import { all, get } from '../db.js';
import { today, addMonths, age } from '../util/date.js';
import { futureValue, monthsToTarget } from '../util/money.js';
import { netWorth } from './networth.js';
import { averageMonthlyExpense, averageMonthlyIncome, essentialSplit, incomeSources } from './reports.js';
import { monthStart, monthEnd, monthKey, addMonths as addM, lastMonths } from '../util/date.js';
import { projectedAnnualInterest } from './interest.js';
import { portfolio, realEstate } from './investments.js';

export function profile() {
  return get('SELECT * FROM profile WHERE id = 1') || {};
}

/** Thu nhập thụ động hàng tháng hiện tại (lãi NH + cổ tức + cho thuê) */
export function passiveIncomeMonthly() {
  const interest = Math.round(projectedAnnualInterest() / 12);
  const pf = portfolio();
  const dividend = Math.round(pf.projected_dividend / 12);
  const re = realEstate();
  const rent = re.net_monthly;
  const months = lastMonths(6);
  const observed = months.length
    ? Math.round(months.reduce((s, m) => s + (Number(incomeSources(monthStart(m), monthEnd(m)).passive) || 0), 0) / months.length)
    : 0;
  const modeled = interest + dividend + rent;
  return { interest, dividend, rent, modeled, observed, total: Math.max(modeled, observed) };
}

export function fireStats(overrides = {}) {
  const p = { ...profile(), ...overrides };
  const swr = Number(p.swr) || 0.04;
  const nominalReturn = Number(p.expected_return) || 0.09;
  const inflation = Number(p.inflation) || 0.04;
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
  };
}

/** Quỹ khẩn cấp: đủ mấy tháng? */
export function emergencyStatus() {
  const p = profile();
  const target = p.emergency_months_target || 6;
  const monthlyExpense = averageMonthlyExpense(3) || 0;
  const fund = get("SELECT * FROM funds WHERE type = 'emergency'");
  const liquid = get("SELECT COALESCE(SUM(balance),0) s FROM accounts WHERE is_active=1 AND type IN ('cash','bank','ewallet','savings')").s;
  const current = fund && fund.balance > 0 ? fund.balance : liquid;
  const months = monthlyExpense ? current / monthlyExpense : 0;
  return {
    current,
    monthly_expense: monthlyExpense,
    months_covered: Math.round(months * 10) / 10,
    target_months: target,
    target_amount: Math.round(monthlyExpense * target),
    gap: Math.max(0, Math.round(monthlyExpense * target - current)),
    ok: months >= target,
  };
}
