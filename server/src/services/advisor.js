/** Cố vấn: chấm điểm sức khoẻ tài chính, xếp thứ tự ưu tiên đồng tiền, gợi ý tiêu tiền dư. */
import { all, get } from '../db.js';
import { today, diffDays, monthKey, monthStart, monthEnd, addMonths } from '../util/date.js';
import { short } from '../util/money.js';
import { averageMonthlyExpense, averageMonthlyIncome, totals, incomeSources } from './reports.js';
import { emergencyStatus, fireStats, passiveIncomeMonthly } from './fire.js';
import { debtSummary, payoffPlan } from './debts.js';
import { netWorth } from './networth.js';
import { budgetStatus } from './budgets.js';
import { monthsToTarget } from '../util/money.js';

const num = (x, fallback = 0) => (Number.isFinite(Number(x)) ? Number(x) : fallback);
const clamp01 = (x) => Math.max(0, Math.min(1, num(x)));

export function healthScore() {
  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  const avgIncome = averageMonthlyIncome(6);
  const avgExpense = averageMonthlyExpense(6);
  const ef = emergencyStatus();
  const ds = debtSummary(avgIncome);
  const nw = netWorth();
  const passive = passiveIncomeMonthly();
  const streams = all('SELECT * FROM income_streams WHERE active = 1');
  const bs = budgetStatus();

  const savingsRate = avgIncome ? (avgIncome - avgExpense) / avgIncome : 0;
  const investRatio = nw.assets ? (nw.breakdown.investments + nw.breakdown.real_estate) / nw.assets : 0;

  const components = [
    { key: 'emergency', label: 'Quỹ khẩn cấp', weight: 20, score: clamp01(ef.months_covered / (ef.target_months || 6)) * 100,
      detail: `${num(ef.months_covered)} / ${ef.target_months} tháng chi phí` },
    { key: 'savings', label: 'Tỷ lệ tiết kiệm', weight: 20, score: clamp01(savingsRate / (p.savings_rate_target || 0.3)) * 100,
      detail: `${Math.round(num(savingsRate) * 100)}% thu nhập` },
    { key: 'debt', label: 'Gánh nặng nợ', weight: 15, score: (1 - clamp01(ds.dti / 0.4)) * 100 * (ds.high_interest.length ? 0.6 : 1),
      detail: ds.total_balance ? `Nợ ${short(ds.total_balance)}, DTI ${Math.round(clamp01(ds.dti) * 100)}%` : 'Không có nợ' },
    { key: 'invest', label: 'Tài sản sinh lời', weight: 15, score: clamp01(investRatio / 0.6) * 100,
      detail: `${Math.round(num(investRatio) * 100)}% tài sản đang sinh lời` },
    { key: 'passive', label: 'Thu nhập thụ động', weight: 10, score: clamp01(passive.total / Math.max(1, avgExpense)) * 100,
      detail: `${short(passive.total)}/tháng, phủ ${Math.round(clamp01(passive.total / Math.max(1, avgExpense)) * 100)}% chi phí` },
    { key: 'budget', label: 'Kỷ luật ngân sách', weight: 10, score: bs.items.length ? clamp01(1 - bs.over / bs.items.length) * 100 : 60,
      detail: bs.items.length ? `${bs.over}/${bs.items.length} danh mục vượt` : 'Chưa đặt ngân sách' },
    { key: 'diversify', label: 'Đa dạng nguồn thu', weight: 10, score: clamp01(streams.length / 3) * 100,
      detail: `${streams.length} nguồn thu nhập` },
  ];
  const total = Math.round(components.reduce((s, c) => s + (num(c.score) * c.weight) / 100, 0));
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'E';
  const label = { A: 'Rất khoẻ', B: 'Khoẻ', C: 'Ổn nhưng có điểm yếu', D: 'Cần chấn chỉnh', E: 'Rủi ro cao' }[grade];
  return { score: total, grade, label, components: components.map((c) => ({ ...c, score: Math.round(num(c.score)) })) };
}

const RISK_SPLITS = {
  conservative: [
    { key: 'savings', label: 'Gửi tiết kiệm / trái phiếu an toàn', weight: 0.55 },
    { key: 'fund', label: 'Quỹ mở cân bằng / ETF', weight: 0.3 },
    { key: 'gold', label: 'Vàng / tài sản phòng thủ', weight: 0.15 },
  ],
  balanced: [
    { key: 'fund', label: 'ETF / quỹ chỉ số (VN30, VNDiamond)', weight: 0.45 },
    { key: 'savings', label: 'Tiết kiệm kỳ hạn / trái phiếu', weight: 0.3 },
    { key: 'stock', label: 'Cổ phiếu cơ bản tốt', weight: 0.15 },
    { key: 'gold', label: 'Vàng', weight: 0.1 },
  ],
  aggressive: [
    { key: 'stock', label: 'Cổ phiếu tăng trưởng', weight: 0.45 },
    { key: 'fund', label: 'ETF / quỹ chỉ số', weight: 0.3 },
    { key: 'alt', label: 'Tài sản rủi ro cao (crypto, startup) — tối đa 10%', weight: 0.1 },
    { key: 'savings', label: 'Tiền mặt chờ cơ hội', weight: 0.15 },
  ],
};

export function investmentSplit(amount, risk = 'balanced') {
  const split = RISK_SPLITS[risk] || RISK_SPLITS.balanced;
  return split.map((s) => ({ ...s, amount: Math.round(amount * s.weight) }));
}

/**
 * Thác nước ưu tiên cho một khoản tiền dư — trả về các bước kèm số tiền và lý do.
 * Thứ tự: đệm sống còn -> nợ lãi cao -> quỹ khẩn cấp đủ -> mục tiêu gấp -> đầu tư -> bản thân -> tự thưởng.
 */
export function surplusPlan(amount) {
  let left = Math.round(Number(amount) || 0);
  const steps = [];
  if (left <= 0) return { amount: 0, steps, left: 0 };

  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  const ef = emergencyStatus();
  const ds = debtSummary(averageMonthlyIncome(6));
  const fire = fireStats();

  const take = (n) => {
    const v = Math.max(0, Math.min(left, Math.round(n)));
    left -= v;
    return v;
  };

  if (ef.months_covered < 1 && ef.monthly_expense > 0) {
    const need = Math.max(0, ef.monthly_expense - ef.current);
    const amt = take(need);
    if (amt) steps.push({ key: 'mini_ef', priority: 1, label: 'Đệm sống còn 1 tháng chi phí', amount: amt,
      why: 'Không có đệm tiền mặt thì mọi sự cố nhỏ đều biến thành nợ lãi cao.', target: 'Quỹ khẩn cấp' });
  }

  const highRate = all("SELECT * FROM debts WHERE status='active' AND balance > 0 AND interest_rate >= 12 ORDER BY interest_rate DESC");
  for (const d of highRate) {
    if (left <= 0) break;
    const amt = take(d.balance);
    if (amt) steps.push({ key: `debt_${d.id}`, priority: 2, label: `Tất toán nợ ${d.name} (${d.interest_rate}%/năm)`, amount: amt,
      why: `Trả nợ ${d.interest_rate}%/năm = kênh "đầu tư" chắc chắn sinh lời ${d.interest_rate}%, hơn hầu hết kênh an toàn.`, target: d.name });
  }

  if (ef.gap > 0 && left > 0) {
    const amt = take(ef.gap);
    if (amt) steps.push({ key: 'ef_full', priority: 3, label: `Nạp đủ quỹ khẩn cấp ${ef.target_months} tháng`, amount: amt,
      why: `Đủ đệm mới dám đầu tư dài hạn mà không bị ép bán lúc thị trường xấu.`, target: 'Quỹ khẩn cấp' });
  }

  const urgentGoals = all("SELECT * FROM goals WHERE status='active' AND deadline IS NOT NULL AND deadline <= ? ORDER BY priority ASC", [addMonths(today(), 18)]);
  for (const g of urgentGoals) {
    if (left <= 0) break;
    const need = Math.max(0, g.target_amount - g.current_amount);
    const amt = take(Math.min(need, left * 0.5));
    if (amt) steps.push({ key: `goal_${g.id}`, priority: 4, label: `Mục tiêu "${g.name}" (hạn ${g.deadline})`, amount: amt,
      why: `Tiền cho mục tiêu <18 tháng nên để ở kênh an toàn, không nên bỏ vào cổ phiếu.`, target: g.name });
  }

  if (left > 0) {
    const invest = Math.round(left * 0.75);
    const amt = take(invest);
    if (amt) steps.push({ key: 'invest', priority: 5, label: 'Đầu tư dài hạn (quỹ Tự do tài chính)', amount: amt,
      why: `Mỗi ${short(amt)} bỏ vào đây rút ngắn ngày tự do tài chính. Lợi suất kỳ vọng ${Math.round((p.expected_return ?? 0.09) * 100)}%/năm.`,
      target: 'Tự do tài chính', breakdown: investmentSplit(amt, p.risk_profile || 'balanced'),
      impact: impactOnFire(amt, fire) });
  }
  if (left > 0) {
    const amt = take(left * 0.6);
    if (amt) steps.push({ key: 'self', priority: 6, label: 'Đầu tư cho bản thân (kỹ năng, sức khoẻ)', amount: amt,
      why: 'ROI cao nhất trong 10 năm đầu sự nghiệp là tăng năng lực kiếm tiền.', target: 'Phát triển bản thân' });
  }
  if (left > 0) {
    const amt = take(left);
    steps.push({ key: 'fun', priority: 7, label: 'Tự thưởng, không cảm thấy tội lỗi', amount: amt,
      why: 'Kế hoạch tài chính bền vững phải có phần thưởng, nếu không sẽ bỏ cuộc.', target: 'Hưởng thụ' });
  }
  return { amount: Math.round(Number(amount) || 0), steps, left };
}

/** Khoản tiền thêm này rút ngắn ngày tự do tài chính bao nhiêu tháng? */
function impactOnFire(amount, fire) {
  if (!fire || !fire.fi_number || fire.months_to_fi === null) return null;
  const before = fire.months_to_fi;
  const after = monthsToTarget(fire.invested + amount, fire.monthly_surplus, fire.real_return, fire.fi_number);
  if (after === null) return null;
  const saved = Math.max(0, before - Math.ceil(after));
  return { months_saved: saved, text: saved > 0 ? `Rút ngắn ~${saved} tháng tới ngày tự do tài chính` : 'Tăng nhẹ tốc độ tích luỹ' };
}

/** Danh sách hành động nên làm tiếp theo, sắp theo tác động. */
export function nextActions(limit = 6) {
  const actions = [];
  const avgIncome = averageMonthlyIncome(6);
  const avgExpense = averageMonthlyExpense(6);
  const surplus = Math.max(0, avgIncome - avgExpense);
  const ef = emergencyStatus();
  const ds = debtSummary(avgIncome);
  const fire = fireStats();
  const nw = netWorth();
  const p = get('SELECT * FROM profile WHERE id = 1') || {};

  if (ds.high_interest.length) {
    actions.push({ impact: 100, title: `Tất toán nợ lãi cao: ${ds.high_interest.join(', ')}`,
      detail: `Trả trước hạn tiết kiệm được phần lớn trong ${short(ds.total_interest_remaining || 0)} tiền lãi còn lại.`, tab: 'debts' });
  }
  if (!ef.ok) {
    actions.push({ impact: 90, title: `Nạp thêm ${short(ef.gap)} vào quỹ khẩn cấp`,
      detail: `Đang có ${ef.months_covered} tháng, mục tiêu ${ef.target_months} tháng.`, tab: 'funds' });
  }
  if (surplus > 0 && nw.breakdown.liquid > avgExpense * 6) {
    actions.push({ impact: 80, title: `Đưa ${short(nw.breakdown.liquid - avgExpense * 6)} tiền nhàn rỗi vào kênh sinh lời`,
      detail: 'Tiền để trong tài khoản thanh toán mất giá theo lạm phát mỗi năm.', tab: 'advisor' });
  }
  if (avgIncome && surplus / avgIncome < (p.savings_rate_target ?? 0.3)) {
    actions.push({ impact: 70, title: 'Nâng tỷ lệ tiết kiệm',
      detail: `Cắt ${short(Math.max(0, avgIncome * (p.savings_rate_target ?? 0.3) - surplus))}/tháng ở nhóm chi tuỳ ý, hoặc tăng thu nhập.`, tab: 'reports' });
  }
  const noBudget = budgetStatus().items.length === 0;
  if (noBudget) actions.push({ impact: 60, title: 'Đặt ngân sách cho 3 danh mục tốn nhất', detail: 'Có ngân sách thì app mới cảnh báo sớm được.', tab: 'budgets' });

  const streams = all('SELECT * FROM income_streams WHERE active=1');
  if (streams.length < 2) actions.push({ impact: 55, title: 'Xây thêm nguồn thu thứ 2', detail: 'Một nguồn thu duy nhất là rủi ro tập trung lớn nhất của tài chính cá nhân.', tab: 'income' });
  if (fire.passive_coverage < 0.2) actions.push({ impact: 50, title: 'Tăng thu nhập thụ động',
    detail: `Hiện thụ động phủ ${Math.round(fire.passive_coverage * 100)}% chi phí sống. Mốc 100% = tự do tài chính.`, tab: 'fire' });
  if (!get("SELECT id FROM goals WHERE status='active'")) actions.push({ impact: 45, title: 'Đặt mục tiêu tài chính đầu tiên', detail: 'Mục tiêu cụ thể giúp app tự động phân bổ tiền mỗi khi có thu nhập.', tab: 'goals' });

  return actions.sort((a, b) => b.impact - a.impact).slice(0, limit);
}
