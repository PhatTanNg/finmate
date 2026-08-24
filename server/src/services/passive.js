/**
 * Lộ trình xây thu nhập thụ động.
 *
 * Điểm sức khoẻ tài chính chấm "Thu nhập thụ động 10/100" rồi bỏ đó — người
 * dùng biết mình yếu nhưng không biết làm gì tiếp. Module này trả lời đúng ba
 * câu hỏi kế tiếp: **bỏ bao nhiêu tiền, vào kênh nào, thì mỗi tháng nhận về
 * bao nhiêu và bao giờ đủ sống**.
 *
 * Mọi con số đều tính từ dữ liệu thật của người dùng: tiền nhàn rỗi sau khi
 * chừa quỹ khẩn cấp, khoản dư mỗi tháng, hồ sơ rủi ro và đồng tiền gốc.
 */
import { get, all } from '../db.js';
import { baseCurrency, convert } from './fx.js';
import { short, pct } from '../util/money.js';
import { averageMonthlyExpense, averageMonthlyIncome } from './reports.js';
import { passiveIncomeMonthly, emergencyStatus, marketAssumptions } from './fire.js';
import { netWorth } from './networth.js';
import { debtSummary } from './debts.js';
import { addMonths, today } from '../util/date.js';

const profile = () => get('SELECT * FROM profile WHERE id = 1') || {};

/**
 * Các kênh tạo dòng tiền thụ động, kèm lợi suất giả định theo đồng tiền gốc.
 *
 * Lợi suất khác nhau rất xa giữa Việt Nam và châu Âu: gửi tiết kiệm VND được
 * ~5,5%/năm trong khi EUR chỉ ~2,5%. Dùng chung một bộ số cho cả hai thì lời
 * khuyên sai hẳn một bậc — người ở Ireland sẽ tưởng gửi ngân hàng là đủ sống.
 */
const CHANNELS = [
  {
    key: 'savings',
    name: 'Gửi tiết kiệm ngân hàng',
    icon: '🏦',
    risk: 1,
    liquidity: 'cao',
    yield: { VND: 0.055, EUR: 0.025, USD: 0.04, GBP: 0.04, JPY: 0.005, KRW: 0.03, TWD: 0.015, AUD: 0.045, CAD: 0.04, SGD: 0.03 },
    min: { VND: 1_000_000, EUR: 100_00 },
    effort: 'thấp',
    note: 'Chắc chắn nhất, dòng tiền đều. Lãi thực tế sau lạm phát rất mỏng nên chỉ nên giữ phần cần an toàn.',
  },
  {
    key: 'bond',
    name: 'Trái phiếu / quỹ trái phiếu',
    icon: '📜',
    risk: 2,
    liquidity: 'trung bình',
    yield: { VND: 0.075, EUR: 0.035, USD: 0.045, GBP: 0.045, JPY: 0.01, KRW: 0.04, TWD: 0.02, AUD: 0.05, CAD: 0.045, SGD: 0.035 },
    min: { VND: 10_000_000, EUR: 500_00 },
    effort: 'thấp',
    note: 'Trả lãi định kỳ, cao hơn tiết kiệm một bậc. Chọn quỹ trái phiếu thay vì trái phiếu doanh nghiệp lẻ để không dồn rủi ro vào một cái tên.',
  },
  {
    key: 'dividend',
    name: 'Cổ phiếu / ETF trả cổ tức',
    icon: '📈',
    risk: 3,
    liquidity: 'cao',
    yield: { VND: 0.05, EUR: 0.035, USD: 0.03, GBP: 0.04, JPY: 0.025, KRW: 0.025, TWD: 0.04, AUD: 0.045, CAD: 0.04, SGD: 0.05 },
    min: { VND: 5_000_000, EUR: 200_00 },
    effort: 'trung bình',
    note: 'Cổ tức tiền mặt cộng thêm phần giá tăng. Biến động mạnh, chỉ hợp với tiền chưa cần dùng trong 5 năm tới.',
  },
  {
    key: 'reit',
    name: 'Quỹ bất động sản (REIT)',
    icon: '🏢',
    risk: 3,
    liquidity: 'cao',
    yield: { VND: 0.07, EUR: 0.045, USD: 0.045, GBP: 0.05, JPY: 0.04, KRW: 0.05, TWD: 0.045, AUD: 0.055, CAD: 0.05, SGD: 0.06 },
    min: { VND: 5_000_000, EUR: 200_00 },
    effort: 'thấp',
    note: 'Hưởng tiền thuê bất động sản mà không phải mua nhà, không phải tìm khách thuê.',
  },
  {
    key: 'rental',
    name: 'Bất động sản cho thuê',
    icon: '🏠',
    risk: 3,
    liquidity: 'thấp',
    yield: { VND: 0.045, EUR: 0.05, USD: 0.055, GBP: 0.05, JPY: 0.04, KRW: 0.035, TWD: 0.025, AUD: 0.04, CAD: 0.045, SGD: 0.03 },
    min: { VND: 800_000_000, EUR: 80_000_00 },
    effort: 'cao',
    note: 'Dòng tiền lớn nhưng cần vốn lớn, tốn công quản lý và khó bán gấp. Lợi suất đã trừ phí quản lý, sửa chữa và tháng trống.',
  },
  {
    key: 'p2p_business',
    name: 'Góp vốn kinh doanh / cho vay có tài sản đảm bảo',
    icon: '🤝',
    risk: 4,
    liquidity: 'thấp',
    yield: { VND: 0.12, EUR: 0.08, USD: 0.09, GBP: 0.08, JPY: 0.05, KRW: 0.07, TWD: 0.06, AUD: 0.08, CAD: 0.08, SGD: 0.07 },
    min: { VND: 50_000_000, EUR: 5_000_00 },
    effort: 'cao',
    note: 'Lợi suất cao nhất nhưng có thể mất trắng. Chỉ dùng phần tiền mà mất đi cũng không đổi kế hoạch sống.',
  },
];

/** Hồ sơ rủi ro quyết định trần rủi ro và cách chia vốn. */
const RISK_MIX = {
  conservative: { maxRisk: 2, weights: { savings: 0.5, bond: 0.35, reit: 0.15 } },
  moderate: { maxRisk: 3, weights: { savings: 0.25, bond: 0.25, dividend: 0.3, reit: 0.2 } },
  balanced: { maxRisk: 3, weights: { savings: 0.25, bond: 0.25, dividend: 0.3, reit: 0.2 } },
  aggressive: { maxRisk: 4, weights: { savings: 0.1, bond: 0.15, dividend: 0.4, reit: 0.2, p2p_business: 0.15 } },
};

const yieldOf = (ch, code) => ch.yield[code] ?? ch.yield.USD ?? 0.03;
/** Vốn tối thiểu quy về đồng tiền gốc; các đồng tiền khác quy đổi từ mốc EUR. */
function minOf(ch, code) {
  if (ch.min[code] !== undefined) return ch.min[code];
  return convert(ch.min.EUR, 'EUR', code);
}

/**
 * Số vốn cần để một kênh tạo ra `monthly` mỗi tháng.
 *
 * Lợi suất 0 thì không có số vốn hữu hạn nào đẻ ra thu nhập — trả `null` chứ
 * không phải 0, vì 0 đọc lên thành "bạn chẳng cần đồng vốn nào cả".
 * @returns {number|null} vốn tính bằng đơn vị nhỏ nhất của đồng tiền gốc
 */
export function capitalNeeded(monthly, annualYield) {
  if (!monthly) return 0;
  if (!(annualYield > 0)) return null;
  return Math.round((monthly * 12) / annualYield);
}

/**
 * Tiền có thể đem đi đầu tư ngay: tiền mặt/ngân hàng trừ đi phần phải chừa
 * cho quỹ khẩn cấp. Không trừ thì app sẽ khuyên người ta đem sạch tiền phòng
 * thân đi mua cổ phiếu.
 */
function investableNow() {
  const nw = netWorth();
  const ef = emergencyStatus();
  const liquid = nw.breakdown?.liquid || 0;
  const reserve = ef.has_data ? ef.target_amount : 0;
  return { liquid, reserve, investable: Math.max(0, liquid - reserve), emergency_ok: ef.ok, emergency_gap: ef.gap };
}

/**
 * Lộ trình đầy đủ: đang ở đâu, cần bao nhiêu vốn, chia vào kênh nào, bao giờ
 * tới đích.
 *
 * @param {object} [opts]
 * @param {number} [opts.monthly_contribution] tiền dành ra mỗi tháng, mặc định lấy từ khoản dư thực tế
 * @param {string} [opts.risk] ghi đè hồ sơ rủi ro
 */
export function passiveRoadmap(opts = {}) {
  const code = baseCurrency();
  const p = profile();
  const risk = String(opts.risk || p.risk_profile || 'moderate').toLowerCase();
  const mix = RISK_MIX[risk] || RISK_MIX.moderate;
  const assume = marketAssumptions(code);

  const passive = passiveIncomeMonthly();
  const expense = averageMonthlyExpense(6) || 0;
  const cash = investableNow();
  const debt = debtSummary();

  // Khoản dư mỗi tháng: ưu tiên số người dùng chỉ định, sau đó tới thực tế.
  const contribution = Math.max(0, Math.round(
    opts.monthly_contribution ?? monthlySurplusEstimate(),
  ));

  const coverage = expense > 0 ? passive.total / expense : 0;
  const milestones = [
    { key: 'first', label: 'Tự trả tiền điện nước', target: Math.round(expense * 0.1) },
    { key: 'quarter', label: 'Phủ 1/4 chi phí sống', target: Math.round(expense * 0.25) },
    { key: 'half', label: 'Phủ nửa chi phí sống', target: Math.round(expense * 0.5) },
    { key: 'full', label: 'Không cần đi làm vẫn đủ sống', target: Math.round(expense) },
  ];

  const channels = CHANNELS
    .filter((ch) => ch.risk <= mix.maxRisk)
    .map((ch) => {
      const y = yieldOf(ch, code);
      const min = minOf(ch, code);
      const weight = mix.weights[ch.key] || 0;
      const suggested = Math.round(cash.investable * weight);
      return {
        key: ch.key,
        name: ch.name,
        icon: ch.icon,
        risk: ch.risk,
        liquidity: ch.liquidity,
        effort: ch.effort,
        note: ch.note,
        annual_yield: y,
        min_capital: min,
        suggested_capital: suggested,
        // Vốn chưa đủ mức tối thiểu thì đừng hứa hẹn dòng tiền.
        affordable: cash.investable >= min,
        monthly_income: suggested >= min ? Math.round((suggested * y) / 12) : 0,
        capital_for_1pct_expense: expense ? (capitalNeeded(Math.round(expense * 0.01), y) ?? 0) : 0,
      };
    })
    .sort((a, b) => b.monthly_income - a.monthly_income || a.risk - b.risk);

  const plannedCapital = channels.reduce((s, c) => s + (c.suggested_capital >= c.min_capital ? c.suggested_capital : 0), 0);
  const plannedIncome = channels.reduce((s, c) => s + c.monthly_income, 0);
  const blendedYield = plannedCapital > 0 ? (plannedIncome * 12) / plannedCapital : weightedYield(channels, code);

  const plan = milestones.map((m) => {
    const gap = Math.max(0, m.target - passive.total);
    const reached = passive.total >= m.target && m.target > 0;
    const capital = capitalNeeded(gap, blendedYield);
    // `capital === null` nghĩa là không kênh nào sinh lời — mốc này không tới
    // được bằng vốn, đừng để nó lọt xuống `monthsToCapital` và ra "0 tháng".
    const months = reached ? 0 : capital === null ? null : monthsToCapital(cash.investable, contribution, blendedYield, capital);
    return {
      ...m,
      reached,
      gap_monthly: gap,
      capital_needed: capital,
      capital_missing: capital === null ? null : Math.max(0, capital - cash.investable),
      months: months === null ? null : Math.ceil(months),
      date: months === null ? null : addMonths(today(), Math.ceil(months)),
    };
  });

  return {
    currency: code,
    risk_profile: risk,
    // Đang ở đâu
    current_passive: passive.total,
    passive_breakdown: passive,
    monthly_expense: expense,
    coverage,
    coverage_pct: Math.round(coverage * 100),
    // Có gì trong tay
    liquid: cash.liquid,
    emergency_reserve: cash.reserve,
    investable: cash.investable,
    emergency_ok: cash.emergency_ok,
    monthly_contribution: contribution,
    blended_yield: Math.round(blendedYield * 10000) / 10000,
    expected_return: assume.expected_return,
    inflation: assume.inflation,
    // Làm gì
    channels,
    planned_capital: plannedCapital,
    planned_monthly_income: plannedIncome,
    milestones: plan,
    next_steps: nextSteps({ cash, debt, channels, contribution }),
    blocked_by: blockersOf(cash, debt),
  };
}

/** Những việc phải xong trước khi bàn tới đầu tư. */
function blockersOf(cash, debt) {
  const out = [];
  if (!cash.emergency_ok && cash.emergency_gap > 0) out.push({ key: 'emergency', amount: cash.emergency_gap });
  const costly = (debt.debts || []).filter((d) => Number(d.interest_rate) > 8);
  if (costly.length) out.push({ key: 'debt', amount: costly.reduce((s, d) => s + (d.balance_base ?? d.balance), 0) });
  return out;
}

/** Lợi suất bình quân gia quyền của bộ kênh, dùng khi chưa có vốn để chia. */
function weightedYield(channels, code) {
  const ch = CHANNELS.filter((c) => channels.some((x) => x.key === c.key));
  if (!ch.length) return 0.05;
  return ch.reduce((s, c) => s + yieldOf(c, code), 0) / ch.length;
}

/**
 * Bao nhiêu tháng nữa thì vốn đạt mức cần, với lãi kép hàng tháng.
 * Trả null khi không bao giờ tới (không góp thêm mà vốn lại không sinh đủ).
 */
export function monthsToCapital(current, monthly, annualYield, target) {
  if (target <= current) return 0;
  if (monthly <= 0 && annualYield <= 0) return null;
  const r = annualYield / 12;
  let balance = current;
  for (let m = 1; m <= 1200; m++) {
    balance = balance * (1 + r) + monthly;
    if (balance >= target) return m;
  }
  return null;
}

/**
 * Khoản dư thực tế mỗi tháng.
 *
 * Dùng đúng bộ số mà `fireStats` dùng: thu nhập bình quân trừ chi phí SỐNG bình
 * quân. Lấy hiệu thu-chi thô của 3 tháng gần nhất thì một lần bán cổ phiếu hay
 * một tháng thưởng Tết đủ đẩy con số lên gấp năm, và app sẽ hứa với người dùng
 * một lộ trình mà họ không bao giờ theo kịp.
 */
function monthlySurplusEstimate() {
  const income = averageMonthlyIncome(6) || 0;
  const expense = averageMonthlyExpense(6) || 0;
  return Math.max(0, Math.round(income - expense));
}

/**
 * Việc cần làm ngay, xếp theo đúng thứ tự ưu tiên tài chính cá nhân:
 * quỹ khẩn cấp trước, nợ lãi cao trước, rồi mới tới đầu tư.
 *
 * Thứ tự này phải được tôn trọng thật, không chỉ đánh số: vừa bảo "trả dứt thẻ
 * tín dụng 32%/năm" vừa bảo "đưa 42 triệu vào ETF sinh 5%/năm" là hai lời
 * khuyên triệt tiêu nhau, và người dùng sẽ chọn cái vui hơn.
 */
function nextSteps({ cash, debt, channels, contribution }) {
  const steps = [];
  const blockers = [];
  if (!cash.emergency_ok && cash.emergency_gap > 0) {
    blockers.push('quỹ khẩn cấp');
    steps.push({
      order: 1,
      key: 'emergency',
      title: 'Lấp quỹ khẩn cấp trước đã',
      body: `Còn thiếu ${short(cash.emergency_gap)} để đủ số tháng dự phòng. Đầu tư khi chưa có đệm nghĩa là gặp biến cố phải bán lỗ đúng lúc thị trường xấu.`,
      amount: cash.emergency_gap,
    });
  }
  // `interest_rate` trong bảng nợ là phần trăm (12 = 12%/năm), không phải tỉ lệ.
  const costly = (debt.debts || []).filter((d) => Number(d.interest_rate) > 8);
  if (costly.length) {
    const worst = [...costly].sort((a, b) => b.interest_rate - a.interest_rate)[0];
    blockers.push('nợ lãi cao');
    steps.push({
      order: 2,
      key: 'debt',
      title: `Trả dứt "${worst.name}" trước khi đầu tư`,
      body: `Khoản này lãi ${worst.interest_rate}%/năm — cao hơn mọi kênh đầu tư an toàn. Trả nợ lãi cao là khoản "lợi nhuận" chắc chắn nhất bạn có thể mua.`,
      amount: worst.balance_base ?? worst.balance,
    });
  }
  const top = channels.filter((c) => c.affordable && c.suggested_capital >= c.min_capital).slice(0, 2);
  if (blockers.length) {
    // Còn cửa chặn thì không rải tiếp gợi ý rót vốn, chỉ hé cho thấy đích đến.
    steps.push({
      order: 3,
      key: 'invest_later',
      title: 'Rót vốn vào các kênh sinh lời — sau khi xong hai việc trên',
      body: top.length
        ? `Xong ${blockers.join(' và ')}, bước kế tiếp sẽ là ${top.map((c) => `${c.icon} ${c.name} (${pct(c.annual_yield)}/năm)`).join(' và ')}. `
          + 'Đầu tư trước khi dọn xong hai việc kia là lấy lợi suất một chữ số đi đấu với rủi ro và lãi vay hai chữ số.'
        : 'Khi đã có đệm và hết nợ đắt, mình sẽ chia vốn nhàn rỗi vào các kênh phù hợp khẩu vị rủi ro của bạn.',
      amount: 0,
      blocked_by: blockers,
    });
  } else {
    for (const [i, c] of top.entries()) {
      steps.push({
        order: 3 + i,
        key: `invest_${c.key}`,
        title: `${c.icon} Đưa ${short(c.suggested_capital)} vào ${c.name}`,
        body: `Lợi suất giả định ${pct(c.annual_yield)}/năm → khoảng ${short(c.monthly_income)}/tháng. ${c.note}`,
        amount: c.suggested_capital,
        channel: c.key,
      });
    }
  }
  if (contribution > 0) {
    steps.push({
      order: 9,
      key: 'auto',
      title: `Tự động trích ${short(contribution)} mỗi tháng`,
      body: 'Đặt lệnh chuyển tự động ngay ngày lương về. Tiền chưa kịp nằm trong tài khoản chi tiêu thì không có gì để do dự.',
      amount: contribution,
    });
  }
  if (!steps.length) {
    steps.push({
      order: 1,
      key: 'start',
      title: 'Ghi nhận thu chi thêm vài tuần nữa',
      body: 'Chưa đủ dữ liệu để nói bạn dư bao nhiêu mỗi tháng. Cứ ghi tiếp, khi có nhịp thu chi rõ ràng mình sẽ dựng lộ trình cụ thể.',
      amount: 0,
    });
  }
  return steps;
}
