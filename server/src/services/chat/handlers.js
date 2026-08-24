/** Thực thi ý định người dùng: ghi sổ, trả lời, ra quyết định tài chính. */
import { all, get, run, insert, update, remove } from '../../db.js';
import { today, monthKey, monthStart, monthEnd, addMonths, vnDate, diffDays, lastMonths } from '../../util/date.js';
import { short, fmt, pct, monthsToTarget } from '../../util/money.js';
import { norm, parseAmount, findAmounts, parsePercent } from '../../util/vi.js';
import { parseNamedAmounts, splitItems } from './nlu.js';
import { createTransaction, deleteTransaction, listTransactions } from '../ledger.js';
import { listFunds, fundsOverview, moveBetweenFunds } from '../funds.js';
import { totals, categoryBreakdown, monthlyTrend, incomeSources, averageMonthlyExpense, averageMonthlyIncome, essentialSplit } from '../reports.js';
import { netWorth } from '../networth.js';
import { fireStats, emergencyStatus, passiveIncomeMonthly, declaredIncomeMonthly, streamMonthly, isPassiveStream } from '../fire.js';
import { debtSummary, payoffPlan } from '../debts.js';
import { budgetStatus, upsertBudget, suggestBudgets } from '../budgets.js';
import { dailyForecast, monthlyForecast, safeToSpend } from '../forecast.js';
import { portfolio, realEstate, upsertHolding, guessSymbolCurrency } from '../investments.js';
import { healthScore, surplusPlan, nextActions, investmentSplit } from '../advisor.js';
import { createRecurring } from '../recurring.js';
import { categoryByName, fundByName } from '../../bootstrap.js';
import { listInsights } from '../insights.js';
import { findTopic, answerTopic } from './knowledge.js';
import { parseNumberFor, normalizeCurrency, currency as curInfo, toMajor, toMinor } from '../../util/currency.js';
import { baseCurrency, convert, getRate, rateTable, fxStatus } from '../fx.js';
import { quote as fxQuote, timingAdvice, remittanceSummary, costInsight } from '../remittance.js';
import { taxCountry, taxConfigAuto, grossToNetAuto, COUNTRIES } from '../tax_router.js';

const P = () => get('SELECT * FROM profile WHERE id = 1') || {};

const bullet = (arr) => arr.filter(Boolean).join('\n');

// Bỏ các từ ra lệnh ở đầu/cuối câu để lấy đúng tên thực thể người dùng muốn tạo.
const LEAD_DROP = new Set(['minh', 'toi', 'em', 'tao', 'hay', 'vui', 'long', 'them', 'mo', 'khai', 'bao', 'dat', 'lap', 'ghi', 'nhap', 'cap', 'nhat', 'add', 'set', 'dang', 'co', 'mot', '1', 'moi', 'tai', 'khoan', 'nguon', 'thu', 'muc', 'tieu', 'ngan', 'sach', 'no', 'vay', 'vi', 'the', 'so']);
const TAIL_DROP = new Set(['moi', 'hang', 'thang', 'tuan', 'nam', 'ngay', 'dinh', 'ky', 'lai', 'suat', 'tra', 'gop', 'la', 'o', 'tai', 'voi', 'nhe', 'nha', 'a', 'oi', 'cua', 'minh', 'toi', 'va', 'cho', 'moi', '%']);

function cleanEntityName(text, ent = {}) {
  let s = String(text || '');
  for (const a of ent.amounts || []) if (a.raw) s = s.split(a.raw).join(' ');
  s = s.replace(/\d+([.,]\d+)?\s*%/g, ' ').replace(/[?!.,]+/g, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  while (words.length && LEAD_DROP.has(norm(words[0]))) words.shift();
  while (words.length && TAIL_DROP.has(norm(words[words.length - 1]))) words.pop();
  return words.join(' ').trim();
}

// ---------- ghi sổ ---------------------------------------------------------

function addExpense(text, ent) {
  if (!ent.amount) return { reply: 'Bạn cho mình biết số tiền nhé — ví dụ: _"trưa nay ăn 60k"_ hoặc _"đổ xăng 100 nghìn"_.' };
  const note = cleanNote(text, ent);
  const res = createTransaction({
    type: 'expense', amount: ent.amount, currency: ent.currency, date: ent.date, note, source: 'chat',
    category_id: ent.category && ent.category.kind === 'expense' ? ent.category.id : undefined,
    account_id: ent.account?.id, fund_id: ent.fund?.id,
  });
  const t = res.transaction;
  const cat = t.category_id ? get('SELECT * FROM categories WHERE id = ?', [t.category_id]) : null;
  const fund = t.fund_id ? get('SELECT * FROM funds WHERE id = ?', [t.fund_id]) : null;
  const bs = budgetStatus().items.find((b) => b.category_id === t.category_id);
  const sts = safeToSpend();
  return {
    reply: bullet([
      `✍️ Đã ghi chi **${fmt(t.amount, t.currency)}** — ${cat ? `${cat.icon || ''} ${cat.name}` : 'Chưa phân loại'}${t.date !== today() ? ` (${vnDate(t.date)})` : ''}`,
      fund ? `${fund.icon || '🧺'} Trừ vào quỹ *${fund.name}*, còn ${short(fund.balance, fund.currency)}` : null,
      bs ? `📊 ${bs.name}: ${short(bs.spent)}/${short(bs.limit)} (${Math.round(bs.pct * 100)}%)${bs.status === 'over' ? ' ⚠️ đã vượt' : bs.status === 'fast' ? ' ⚠️ đang nhanh hơn nhịp' : ''}` : null,
      `💡 Còn tiêu thoải mái ~${short(sts.per_day)}/ngày trong ${sts.days_left} ngày cuối tháng.`,
    ]),
    data: { transaction: t },
    refresh: true,
  };
}

function addIncome(text, ent) {
  if (!ent.amount) return { reply: 'Bạn nhận được bao nhiêu? Ví dụ: _"vừa nhận lương 25 triệu"_.' };
  const note = cleanNote(text, ent);
  const res = createTransaction({
    type: 'income', amount: ent.amount, currency: ent.currency, date: ent.date, note, source: 'chat',
    category_id: ent.category && ent.category.kind === 'income' ? ent.category.id : undefined,
    account_id: ent.account?.id,
  });
  const t = res.transaction;
  const alloc = res.allocation || [];
  const goals = all("SELECT name, current_amount, target_amount FROM goals WHERE status='active' ORDER BY priority LIMIT 3");
  return {
    reply: bullet([
      `💰 Đã ghi thu **${fmt(t.amount, t.currency)}**${t.date !== today() ? ` (${vnDate(t.date)})` : ''} và chia tự động:`,
      alloc.map((a) => `• ${a.name}: ${fmt(a.amount)} (${a.percent}%)`).join('\n'),
      goals.length ? `\n🎯 Mục tiêu: ${goals.map((g) => `${g.name} ${Math.round((g.current_amount / Math.max(1, g.target_amount)) * 100)}%`).join(' · ')}` : null,
      `\nBạn không cần làm gì thêm — tiền đã vào đúng hũ.`,
    ]),
    data: { transaction: t, allocation: alloc },
    refresh: true,
  };
}

function addTransfer(text, ent) {
  if (!ent.amount) return { reply: 'Chuyển bao nhiêu và vào đâu? Ví dụ: _"chuyển 5 triệu vào tiết kiệm"_.' };
  const accounts = all('SELECT * FROM accounts WHERE is_active = 1');
  const n = norm(text);
  const to = accounts.find((a) => n.includes(norm(a.name)) && n.indexOf(norm(a.name)) > n.indexOf('vao')) || accounts.find((a) => /tiet kiem/.test(norm(a.name)));
  const from = accounts.find((a) => a.id !== to?.id && (a.type === 'bank' || a.type === 'cash'));
  if (ent.fund) {
    const target = ent.fund;
    const source = listFunds().find((f) => f.id !== target.id && f.balance >= ent.amount) || listFunds()[0];
    moveBetweenFunds({ from_fund_id: source.id, to_fund_id: target.id, amount: ent.amount, note: 'Chuyển quỹ theo yêu cầu' });
    return { reply: `🔁 Đã chuyển ${fmt(ent.amount)} từ quỹ *${source.name}* sang *${target.name}*.`, refresh: true };
  }
  if (!to) return { reply: 'Mình chưa rõ chuyển vào tài khoản nào. Bạn nói rõ hơn nhé, ví dụ _"chuyển 5 triệu từ VCB vào tiết kiệm"_.' };
  const res = createTransaction({ type: 'transfer', amount: ent.amount, currency: ent.currency, date: ent.date, account_id: from?.id, counter_account_id: to.id, note: cleanNote(text, ent), source: 'chat' });
  return { reply: `🔁 Đã chuyển **${fmt(ent.amount)}**${from ? ` từ ${from.name}` : ''} sang **${to.name}**. Số dư ${to.name}: ${short(get('SELECT balance FROM accounts WHERE id=?', [to.id]).balance)}.`, data: { transaction: res.transaction }, refresh: true };
}

function cleanNote(text, ent) {
  let s = String(text);
  if (ent.amounts?.length) for (const a of ent.amounts) s = s.replace(a.raw, ' ');
  return s.replace(/\s+/g, ' ').replace(/^(vua|da|minh|toi|mình|tôi|vừa|đã)\s+/i, '').trim().slice(0, 120) || 'Giao dịch';
}

// ---------- truy vấn -------------------------------------------------------

function querySpending(text, ent) {
  const r = ent.range;
  const t = totals(r.from, r.to);
  const cats = categoryBreakdown(r.from, r.to).slice(0, 6);
  const split = essentialSplit(r.from, r.to);
  const avg = averageMonthlyExpense(3);
  const days = Math.max(1, diffDays(r.from, r.to > today() ? today() : r.to) + 1);
  return {
    reply: bullet([
      `📊 **${r.label}**: chi **${fmt(t.expense)}**, thu ${fmt(t.income)} → ${t.net >= 0 ? `dôi dư ${short(t.net)}` : `âm ${short(-t.net)}`}`,
      `Trung bình ${short(t.expense / days)}/ngày${avg ? ` (nhịp 3 tháng gần đây: ${short(avg)}/tháng)` : ''}`,
      '',
      '**Tốn nhiều nhất:**',
      cats.map((c, i) => `${i + 1}. ${c.icon || ''} ${c.name}: ${fmt(c.amount)} (${Math.round((c.amount / Math.max(1, t.expense)) * 100)}%)`).join('\n'),
      '',
      split.total ? `Thiết yếu ${Math.round((split.essential / split.total) * 100)}% · Tuỳ ý ${Math.round((split.discretionary / split.total) * 100)}%` : null,
      t.income ? `Tỷ lệ tiết kiệm: **${Math.round(t.savings_rate * 100)}%**` : null,
    ]),
    data: { totals: t, categories: cats },
  };
}

function queryBalance() {
  const base = baseCurrency();
  const rows = all('SELECT * FROM accounts WHERE is_active = 1');
  // Sắp xếp theo giá trị đã quy đổi, và hiển thị đúng đồng tiền của từng ví.
  const accounts = rows
    .map((a) => {
      const code = normalizeCurrency(a.currency || base);
      return { ...a, currency: code, base_balance: convert(a.balance, code, base) };
    })
    .sort((x, y) => y.base_balance - x.base_balance);
  const sts = safeToSpend();
  const funds = listFunds().filter((f) => f.spendable && f.balance !== 0);
  return {
    reply: bullet([
      `💳 **Số dư hiện tại**`,
      accounts.map((a) => {
        const own = fmt(a.balance, a.currency);
        const conv = a.currency === base ? '' : ` (≈ ${short(a.base_balance)})`;
        return `• ${a.icon || ''} ${a.name}: ${own}${conv}`;
      }).join('\n'),
      '',
      `Tiền mặt khả dụng: **${fmt(sts.liquid)}**`,
      `Trừ ${short(sts.upcoming_fixed)} hoá đơn cố định còn lại tháng này → **an toàn tiêu ${fmt(sts.available)}** (~${short(sts.per_day)}/ngày trong ${sts.days_left} ngày).`,
      funds.length ? `\n🧺 Quỹ tiêu được: ${funds.map((f) => `${f.name} ${short(f.balance)}`).join(' · ')}` : null,
    ]),
    data: { accounts, safe_to_spend: sts },
  };
}

function queryNetworth() {
  const nw = netWorth();
  const b = nw.breakdown;
  const hist = all('SELECT * FROM networth_snapshots ORDER BY date DESC LIMIT 2');
  const change = hist.length === 2 ? nw.net - hist[1].net : null;
  return {
    reply: bullet([
      `🏛️ **Tài sản ròng: ${fmt(nw.net)}**`,
      `Tài sản ${fmt(nw.assets)} − Nợ ${fmt(nw.liabilities)}`,
      '',
      `• 💧 Tiền mặt/thanh toán: ${fmt(b.liquid)}`,
      `• 🏦 Tiết kiệm: ${fmt(b.savings)}`,
      `• 📈 Đầu tư: ${fmt(b.investments)}`,
      b.real_estate ? `• 🏡 Bất động sản: ${fmt(b.real_estate)}` : null,
      b.loans ? `• 🏦 Nợ vay: −${fmt(b.loans)}` : null,
      b.credit_debt ? `• 💳 Dư nợ thẻ: −${fmt(b.credit_debt)}` : null,
      change !== null ? `\nSo với lần chốt trước: ${change >= 0 ? '▲' : '▼'} ${short(Math.abs(change))}` : null,
    ]),
    data: nw,
  };
}

function queryFire() {
  const f = fireStats();
  const p = P();
  return {
    reply: bullet([
      `🔥 **Tự do tài chính**`,
      `Chi phí sống ${short(f.monthly_expense)}/tháng → cần **${fmt(f.fi_number)}** (quy tắc rút ${Math.round(f.swr * 100)}%/năm).`,
      `Đang có ${fmt(f.invested)} tài sản sinh lời → hoàn thành **${Math.round(f.progress * 100)}%**.`,
      f.fi_date ? `\n🗓️ Dự kiến đạt: **${vnDate(f.fi_date)}**${f.fi_age ? ` (bạn ${Math.round(f.fi_age)} tuổi)` : ''}, còn ${Math.round(f.months_to_fi / 12 * 10) / 10} năm.` : `\n⚠️ Với dôi dư hiện tại (${short(f.monthly_surplus)}/tháng) chưa thể chạm mốc — cần tăng khoảng cách thu/chi.`,
      `💵 Thu nhập thụ động hiện tại ${short(f.passive_income.total)}/tháng, phủ **${Math.round(f.passive_coverage * 100)}%** chi phí sống.`,
      `🪶 Lean FIRE (chỉ chi thiết yếu): ${short(f.lean_number)} · Fat FIRE: ${short(f.fat_number)}`,
      f.coast_reached ? `🌴 Bạn đã qua mốc Coast FIRE — kể cả ngừng tích luỹ, tài sản vẫn tự lớn đủ để nghỉ hưu đúng hạn.` : `🌱 Coast FIRE cần ${short(f.coast_number)} (đạt mốc này thì có thể ngừng tích luỹ mà vẫn nghỉ hưu đúng tuổi ${p.retire_age_target}).`,
      '',
      '**Cách rút ngắn:**',
      f.scenarios.filter((s) => s.key !== 'base' && s.date).map((s) => `• ${s.label} → ${vnDate(s.date)} (nhanh hơn ${Math.max(0, (f.months_to_fi ?? 0) - s.months)} tháng)`).join('\n'),
    ]),
    data: f,
  };
}

function queryForecast() {
  const d = dailyForecast(60);
  const m = monthlyForecast(6);
  return {
    reply: bullet([
      `🔮 **Dự báo dòng tiền**`,
      `Số dư hiện tại ${fmt(d.start_balance)}, nhịp chi biến đổi ~${short(d.variable_daily)}/ngày.`,
      d.shortfall ? `⚠️ Nguy cơ **hết tiền ngày ${vnDate(d.shortfall)}** nếu giữ nhịp này.` : `✅ 60 ngày tới không có nguy cơ âm tiền. Điểm thấp nhất: ${short(d.min.balance)} vào ${vnDate(d.min.date)}.`,
      '',
      `Trung bình mỗi tháng: thu ${short(m.monthly_income)} − chi ${short(m.monthly_expense)} = **${m.monthly_net >= 0 ? '+' : ''}${short(m.monthly_net)}**`,
      m.rows.slice(0, 6).map((r) => `• ${r.month}: tích luỹ ${short(r.cumulative)}`).join('\n'),
    ]),
    data: { daily: d, monthly: m },
  };
}

function queryDebt() {
  const income = averageMonthlyIncome(6);
  const s = debtSummary(income);
  if (!s.debts.length) return { reply: '🎉 Bạn không có khoản nợ nào đang theo dõi. Đây là lợi thế lớn — dòng tiền tự do hoàn toàn để tích luỹ.' };
  const av = payoffPlan('avalanche', 0);
  const sn = payoffPlan('snowball', 0);
  return {
    reply: bullet([
      `🏦 **Tổng nợ ${fmt(s.total_balance)}**, trả ${short(s.monthly_payment)}/tháng${s.dti === null ? ' _(chưa biết thu nhập nên chưa tính được gánh nặng — khai nguồn thu giúp mình nhé)_' : ` (${Math.round(s.dti * 100)}% thu nhập)`}.`,
      s.debts.map((d) => `• ${d.name}: ${short(d.balance)} @ ${d.interest_rate}%/năm → hết nợ ${vnDate(d.payoff)}`).join('\n'),
      '',
      `📅 Ngày sạch nợ dự kiến: **${vnDate(s.debt_free_date)}**, còn phải trả ${short(s.total_interest_remaining)} tiền lãi.`,
      `⚖️ Avalanche (ưu tiên lãi cao): ${av.months} tháng, lãi ${short(av.total_interest)}`,
      `❄️ Snowball (ưu tiên nợ nhỏ): ${sn.months} tháng, lãi ${short(sn.total_interest)}`,
      av.total_interest < sn.total_interest ? `→ Nên chọn **Avalanche**, tiết kiệm ${short(sn.total_interest - av.total_interest)} tiền lãi.` : `→ Snowball hiệu quả tương đương mà tạo động lực tốt hơn.`,
    ]),
    data: s,
  };
}

function queryGoals() {
  const goals = all("SELECT * FROM goals WHERE status='active' ORDER BY priority, deadline");
  if (!goals.length) return { reply: 'Bạn chưa đặt mục tiêu nào. Nói với mình kiểu _"muốn mua nhà 2 tỷ trong 5 năm"_ là mình dựng luôn kế hoạch.' };
  const surplus = Math.max(0, averageMonthlyIncome(6) - averageMonthlyExpense(6));
  return {
    reply: bullet([
      `🎯 **Mục tiêu đang chạy**`,
      goals.map((g) => {
        const pctDone = Math.round((g.current_amount / Math.max(1, g.target_amount)) * 100);
        const monthsLeft = g.deadline ? Math.max(0.1, diffDays(today(), g.deadline) / 30) : null;
        const need = monthsLeft ? (g.target_amount - g.current_amount) / monthsLeft : g.monthly_contribution;
        const eta = monthsToTarget(g.current_amount, g.monthly_contribution || surplus, 0.06, g.target_amount);
        return `• **${g.name}** ${short(g.current_amount)}/${short(g.target_amount)} (${pctDone}%)\n  ${bar(pctDone)}${monthsLeft ? `\n  Hạn ${vnDate(g.deadline)} → cần ${short(need)}/tháng` : eta ? `\n  Với nhịp hiện tại: xong sau ~${Math.round(eta)} tháng` : ''}`;
      }).join('\n'),
      '',
      `Dôi dư trung bình ${short(surplus)}/tháng.`,
    ]),
    data: goals,
  };
}

const bar = (p) => {
  const n = Math.round(Math.min(100, Math.max(0, p)) / 10);
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};

function queryBudget() {
  const bs = budgetStatus();
  if (!bs.items.length) {
    const sug = suggestBudgets(3).slice(0, 5);
    return {
      reply: bullet([
        'Bạn chưa đặt ngân sách. Dựa trên 3 tháng gần đây mình gợi ý:',
        sug.map((s) => `• ${s.icon || ''} ${s.name}: ${short(s.suggested)}/tháng (đang tiêu ~${short(s.average)})`).join('\n'),
        '',
        'Nói _"đặt ngân sách ăn uống 5 triệu"_ để áp dụng.',
      ]),
      data: sug,
    };
  }
  return {
    reply: bullet([
      `📊 **Ngân sách tháng ${bs.month}** — đã qua ${Math.round(bs.pace * 100)}% thời gian`,
      bs.items.map((b) => `• ${b.icon || ''} ${b.name}: ${short(b.spent)}/${short(b.limit)} ${bar(b.pct * 100)} ${b.status === 'over' ? '🔴' : b.status === 'fast' ? '🟠' : '🟢'}${b.daily_left ? ` — còn ${short(b.daily_left)}/ngày` : ''}`).join('\n'),
      '',
      `Tổng: ${short(bs.total_spent)}/${short(bs.total_limit)}`,
    ]),
    data: bs,
  };
}

function queryInvestment() {
  const pf = portfolio();
  const re = realEstate();
  if (!pf.holdings.length && !re.properties.length) return { reply: 'Chưa có khoản đầu tư nào được theo dõi. Nói _"mình có 1000 cổ phiếu HPG giá vốn 25"_ để mình ghi nhận.' };
  // Giá và giá trị của từng mã nằm ở NGUYÊN TỆ của mã đó (FPT tính bằng đồng,
  // VWCE tính bằng euro). Không truyền đồng tiền vào hàm định dạng thì 148.000₫
  // một cổ phiếu FPT sẽ hiện thành "€1.5k".
  const line = (h) => {
    const c = h.currency;
    const base = h.value_base != null && c !== pf.currency ? ` ≈ ${short(h.value_base)}` : '';
    return `• ${h.symbol}: ${h.quantity} × ${short(h.last_price || h.avg_cost, c)} = ${short(h.value, c)}${base} (${h.pnl >= 0 ? '▲' : '▼'} ${Math.round(h.pnl_pct * 100)}%)`;
  };
  const prop = (p) => `• ${p.name}: ${short(p.current_value, p.currency)}${p.monthly_rent ? ` — thuê ${short(p.monthly_rent, p.currency)}/tháng` : ''}${p.yield_pct != null ? ` (lợi suất ${(p.yield_pct * 100).toFixed(1)}%/năm)` : ''}`;
  return {
    reply: bullet([
      `📈 **Danh mục đầu tư: ${fmt(pf.total_value)}**`,
      pf.holdings.map(line).join('\n'),
      pf.total_cost ? `\nLãi/lỗ chưa thực hiện: **${pf.unrealized_pnl >= 0 ? '+' : ''}${fmt(pf.unrealized_pnl)}** (${Math.round(pf.unrealized_pct * 100)}%)` : null,
      pf.projected_dividend ? `Cổ tức dự kiến: ${short(pf.projected_dividend)}/năm` : null,
      re.properties.length ? `\n🏡 **Bất động sản: ${short(re.total_value)}**\n${re.properties.map(prop).join('\n')}\nDòng tiền thuê ròng: **${short(re.net_monthly)}/tháng**` : null,
      `\n💡 Thu nhập thụ động tổng: ${short(passiveIncomeMonthly().total)}/tháng`,
    ]),
    data: { portfolio: pf, real_estate: re },
  };
}

function queryIncome(text, ent) {
  const r = ent.range;
  const s = incomeSources(r.from, r.to);
  const streams = all('SELECT * FROM income_streams WHERE active = 1');
  const declared = declaredIncomeMonthly();

  // Chưa có khoản thu nào vào sổ nhưng đã khai nguồn thu (người sống bằng lãi,
  // cổ tức, tiền thuê nhà...) thì trả lời theo số đã khai, chứ không báo "0đ".
  if (!s.has_data && declared.total > 0) {
    const ratio = declared.passive / declared.total;
    return {
      reply: bullet([
        `💰 **Thu nhập đã khai: ${fmt(declared.total)}/tháng**`,
        streams.map((x) => `• ${x.name}: ${fmt(streamMonthly(x))}/tháng${isPassiveStream(x) ? ' _(thụ động)_' : ''}`).join('\n'),
        '',
        `Chủ động ${Math.round((1 - ratio) * 100)}% · Thụ động ${Math.round(ratio * 100)}%`,
        `\n⚠️ Chưa có khoản thu nào thực sự vào sổ ${r.label}. Con số trên là theo bạn khai — bật đọc tin nhắn ngân hàng ở tab Tự động hoá để app đối chiếu với tiền về thật.`,
      ]),
      data: { ...s, declared },
    };
  }

  return {
    reply: bullet([
      `💰 **Thu nhập ${r.label}: ${fmt(s.total)}**`,
      s.categories.map((c) => `• ${c.icon || ''} ${c.name}: ${fmt(c.amount)}`).join('\n'),
      s.streams.length ? s.streams.map((c) => `• ${c.name}: ${fmt(c.amount)}`).join('\n') : null,
      '',
      s.has_data ? `Chủ động ${Math.round((1 - s.passive_ratio) * 100)}% · Thụ động ${Math.round(s.passive_ratio * 100)}%` : null,
      `Đang theo dõi ${streams.length} nguồn thu: ${streams.map((x) => x.name).join(', ')}`,
      s.has_data && s.passive_ratio < 0.2 ? `\n💡 Thu nhập thụ động còn thấp. Mỗi ${short(10_000_000)} bỏ vào kênh sinh lời 8%/năm tạo thêm ~${short((10_000_000 * 0.08) / 12)}/tháng.` : null,
    ]),
    data: s,
  };
}

// ---------- cố vấn ---------------------------------------------------------

function surplusAdvice(text, ent) {
  const amount = ent.amount || Math.max(0, netWorth().breakdown.liquid - averageMonthlyExpense(3) * 6);
  if (!amount) return { reply: 'Bạn đang dư khoảng bao nhiêu? Cho mình con số để lên phương án cụ thể nhé.' };
  const plan = surplusPlan(amount);
  const p = P();
  const invest = plan.steps.find((s) => s.key === 'invest');
  return {
    reply: bullet([
      `💡 **Phương án cho ${fmt(amount)}** (theo thứ tự ưu tiên):`,
      '',
      plan.steps.map((s, i) => `**${i + 1}. ${s.label} — ${fmt(s.amount)}**\n   ${s.why}`).join('\n\n'),
      invest?.breakdown ? `\n**Chia nhỏ phần đầu tư (${p.risk_profile === 'aggressive' ? 'khẩu vị tăng trưởng' : p.risk_profile === 'conservative' ? 'khẩu vị an toàn' : 'khẩu vị cân bằng'}):**\n${invest.breakdown.map((b) => `• ${b.label}: ${short(b.amount)}`).join('\n')}` : null,
      invest?.impact ? `\n🔥 ${invest.impact.text}.` : null,
    ]),
    data: plan,
  };
}

function affordability(text, ent) {
  const price = ent.amount;
  if (!price) return { reply: 'Món đó giá bao nhiêu? Cho mình con số để tính xem có nên mua không.' };
  const sts = safeToSpend();
  const avgExpense = averageMonthlyExpense(3);
  const surplus = Math.max(0, averageMonthlyIncome(6) - avgExpense);
  const ef = emergencyStatus();
  const fun = fundByName('Hưởng thụ');
  const fire = fireStats();
  const delayMonths = surplus > 0 ? Math.ceil(price / surplus) : null;
  const ok = price <= sts.available && ef.ok;
  const okFund = fun && fun.balance >= price;
  const item = String(text).replace(/\d[\d.,]*\s*(trieu|triệu|k|nghin|nghìn|ty|tỷ|d|đ)?/gi, '').replace(/(co nen|mua|khong|duoc|\?)/gi, '').trim();

  const lines = [`🛒 **${item || 'Món này'} — ${fmt(price)}**`, ''];
  lines.push(ok ? `✅ **Mua được.** Sau khi trừ hoá đơn cố định bạn còn ${short(sts.available)} khả dụng.` : `⚠️ **Nên cân nhắc.** Khả dụng an toàn chỉ ${short(sts.available)}${!ef.ok && ef.has_data ? `, và quỹ khẩn cấp mới đủ ${ef.months_covered}/${ef.target_months} tháng` : ''}.`);
  if (okFund) lines.push(`🎈 Quỹ Hưởng thụ đang có ${short(fun.balance)} — đủ để mua mà không đụng vào kế hoạch dài hạn.`);
  else if (fun) lines.push(`🎈 Quỹ Hưởng thụ mới có ${short(fun.balance)}. Nếu chờ thêm ${Math.ceil((price - fun.balance) / Math.max(1, (fun.percent / 100) * averageMonthlyIncome(6)))} tháng thì mua "sạch" không áy náy.`);
  lines.push(`⏳ Bằng ${Math.round((price / Math.max(1, avgExpense)) * 10) / 10} tháng chi phí sống của bạn.`);
  if (fire.months_to_fi) {
    const after = monthsToTarget(Math.max(0, fire.invested - price), fire.monthly_surplus, fire.real_return, fire.fi_number);
    const delay = after === null ? null : Math.max(0, Math.ceil(after) - fire.months_to_fi);
    if (delay) lines.push(`🔥 Nếu lấy từ tiền đầu tư, ngày tự do tài chính lùi ~${delay} tháng.`);
  }
  if (delayMonths && !okFund) lines.push(`\n💡 Gợi ý: đặt mục tiêu tiết kiệm ${short(Math.ceil(price / Math.min(6, delayMonths || 6)))}/tháng, mua sau ${Math.min(6, delayMonths)} tháng. Nói _"tạo mục tiêu ${item} ${short(price)} trong 6 tháng"_ là mình lo.`);
  return { reply: lines.join('\n'), data: { price, safe: sts, ok } };
}

function summary() {
  const h = healthScore();
  const nw = netWorth();
  const f = fireStats();
  const mk = monthKey();
  const t = totals(monthStart(mk), monthEnd(mk));
  const ef = emergencyStatus();
  const actions = nextActions(3);
  const ins = listInsights({ limit: 3 });
  return {
    reply: bullet([
      `## 🩺 Sức khoẻ tài chính: ${h.score}/100 (${h.grade} — ${h.label})`,
      h.components.map((c) => `• ${c.label}: ${bar(c.score)} ${c.score}/100 — ${c.detail}`).join('\n'),
      '',
      `**Tháng ${mk}:** thu ${short(t.income)} · chi ${short(t.expense)} · tiết kiệm ${Math.round(t.savings_rate * 100)}%`,
      `**Tài sản ròng:** ${fmt(nw.net)} · **Quỹ khẩn cấp:** ${ef.has_data ? `${ef.months_covered}/${ef.target_months} tháng` : 'chưa đủ dữ liệu chi tiêu'}`,
      f.fi_date ? `**Tự do tài chính:** ${vnDate(f.fi_date)} (${Math.round(f.progress * 100)}% chặng đường)` : null,
      '',
      ins.length ? `**Cần chú ý:**\n${ins.map((i) => `• ${i.title}`).join('\n')}` : null,
      '',
      `**Nên làm tiếp:**\n${actions.map((a, i) => `${i + 1}. ${a.title} — ${a.detail}`).join('\n')}`,
    ]),
    data: { health: h, net_worth: nw, fire: f },
  };
}

// ---------- thiết lập ------------------------------------------------------

function createGoal(text, ent) {
  const amount = ent.amount;
  if (!amount) return { reply: 'Mục tiêu cần bao nhiêu tiền? Ví dụ _"mua nhà 2 tỷ trong 5 năm"_.' };
  const months = ent.horizonMonths;
  const n = norm(text);
  let type = 'save';
  if (/nha|can ho|dat|xe/.test(n)) type = 'purchase';
  else if (/du lich|travel/.test(n)) type = 'travel';
  else if (/khan cap/.test(n)) type = 'emergency';
  else if (/nghi huu|tu do tai chinh/.test(n)) type = 'retirement';
  let name = String(text).replace(ent.amounts?.[0]?.raw || '', '').replace(/trong \d+\s*(nam|năm|thang|tháng)/gi, '').replace(/^(minh |toi |mình |tôi )?(muon|muốn|du dinh|dự định|dat muc tieu|đặt mục tiêu|tao muc tieu|tạo mục tiêu|len ke hoach)\s*/i, '').replace(/\s+/g, ' ').trim();
  name = (name || 'Mục tiêu mới').slice(0, 60);
  const fundName = type === 'emergency' ? 'Quỹ khẩn cấp' : type === 'retirement' ? 'Tự do tài chính' : 'Mục tiêu lớn';
  const deadline = months ? addMonths(today(), months) : null;
  const monthly = months ? Math.round(amount / months) : 0;
  const id = insert('goals', {
    name: name.charAt(0).toUpperCase() + name.slice(1), type, target_amount: amount, deadline,
    monthly_contribution: monthly, fund_id: fundByName(fundName)?.id, priority: type === 'emergency' ? 1 : 2,
    auto_contribute: 1, status: 'active',
  });
  const g = get('SELECT * FROM goals WHERE id = ?', [id]);
  const surplus = Math.max(0, averageMonthlyIncome(6) - averageMonthlyExpense(6));
  const feasible = monthly ? monthly <= surplus : true;
  const eta = monthsToTarget(0, surplus || monthly, 0.06, amount);
  return {
    reply: bullet([
      `🎯 Đã tạo mục tiêu **${g.name}: ${fmt(amount)}**${deadline ? ` — hạn ${vnDate(deadline)}` : ''}`,
      monthly ? `Cần để dành **${fmt(monthly)}/tháng**. Dôi dư hiện tại của bạn ~${short(surplus)}/tháng → ${feasible ? '✅ khả thi.' : '⚠️ hơi căng, cân nhắc giãn hạn hoặc tăng thu nhập.'}` : eta ? `Với nhịp tiết kiệm hiện tại (${short(surplus)}/tháng, lãi 6%/năm) bạn sẽ đạt sau ~${Math.round(eta)} tháng.` : null,
      `Tiền vào quỹ *${fundName}* sẽ **tự động** được gắn cho mục tiêu này mỗi kỳ thu nhập.`,
      !feasible && monthly ? `\n💡 Nếu giãn thành ${Math.ceil(amount / Math.max(1, surplus))} tháng thì chỉ cần ${short(surplus)}/tháng.` : null,
    ]),
    data: g,
    refresh: true,
  };
}

function createBudgetIntent(text, ent) {
  if (!ent.amount || !ent.category) return { reply: 'Bạn muốn đặt ngân sách cho danh mục nào, bao nhiêu? Ví dụ _"đặt ngân sách ăn uống 5 triệu/tháng"_.' };
  const b = upsertBudget({ category_id: ent.category.id, amount: ent.amount, period: 'monthly', alert_threshold: 0.8, active: 1 });
  const st = budgetStatus().items.find((x) => x.id === b.id);
  return {
    reply: `📊 Đã đặt ngân sách **${ent.category.name}: ${fmt(ent.amount)}/tháng**.${st ? ` Tháng này đã dùng ${short(st.spent)} (${Math.round(st.pct * 100)}%).` : ''} Mình sẽ cảnh báo khi bạn tiêu nhanh hơn nhịp.`,
    data: b,
    refresh: true,
  };
}

function setAllocation(text) {
  const funds = listFunds();
  const parts = splitItems(text);
  const updates = [];
  for (const part of parts) {
    const p = parsePercent(part);
    if (p === null) continue;
    const f = funds.find((x) => norm(part).includes(norm(x.name)));
    if (f) {
      update('funds', f.id, { percent: Math.round(p * 1000) / 10 });
      updates.push({ name: f.name, percent: Math.round(p * 1000) / 10 });
    }
  }
  if (!updates.length) {
    return {
      reply: bullet([
        'Tỷ lệ phân bổ hiện tại:',
        funds.map((f) => `• ${f.icon || ''} ${f.name}: ${f.percent}%`).join('\n'),
        '',
        'Muốn đổi thì nói kiểu: _"thiết yếu 50%, tự do tài chính 20%, hưởng thụ 10%"_.',
      ]),
      data: funds,
    };
  }
  const total = listFunds().reduce((s, f) => s + f.percent, 0);
  return {
    reply: bullet([
      `✅ Đã cập nhật: ${updates.map((u) => `${u.name} ${u.percent}%`).join(', ')}`,
      `Tổng phân bổ hiện tại: **${Math.round(total * 10) / 10}%**${Math.abs(total - 100) > 0.5 ? ' ⚠️ chưa bằng 100%, phần chênh sẽ được chia lại theo tỷ trọng.' : ' ✅'}`,
      listFunds().map((f) => `• ${f.name}: ${f.percent}%`).join('\n'),
    ]),
    data: listFunds(),
    refresh: true,
  };
}

function addAccount(text, ent) {
  const items = parseNamedAmounts(text);
  if (!items.length) return { reply: 'Bạn cho mình tên tài khoản và số dư nhé, ví dụ _"VCB 50 triệu"_.' };
  const created = [];
  for (const raw of items) {
    const it = { ...raw, name: cleanEntityName(raw.name) || raw.name };
    const existing = all('SELECT * FROM accounts').find((a) => norm(a.name) === norm(it.name));
    if (existing) {
      const diff = it.amount - existing.balance;
      update('accounts', existing.id, { balance: it.amount, last_synced_at: today() });
      created.push({ ...existing, balance: it.amount, updated: true, diff });
    } else {
      const id = insert('accounts', {
        name: it.name, type: guessType(it.name), balance: it.amount, opening_balance: it.amount,
        interest_rate: /tiet kiem/.test(norm(it.name)) ? 5.2 : 0, opened_at: today(), auto_sync: 'sms',
      });
      created.push(get('SELECT * FROM accounts WHERE id = ?', [id]));
    }
  }
  return {
    reply: bullet([
      created.map((a) => `${a.updated ? '🔄 Cập nhật' : '➕ Đã thêm'} **${a.name}**: ${fmt(a.balance)}${a.updated && a.diff ? ` (${a.diff > 0 ? '+' : ''}${short(a.diff)})` : ''}`).join('\n'),
      `\nTổng tài sản ròng hiện tại: **${fmt(netWorth().net)}**`,
    ]),
    data: created,
    refresh: true,
  };
}

function guessType(name) {
  const n = norm(name);
  if (/tiet kiem|ky han/.test(n)) return 'savings';
  if (/tien mat|cash/.test(n)) return 'cash';
  if (/momo|zalopay|shopeepay|vi /.test(n)) return 'ewallet';
  if (/chung khoan|vps|ssi|tcbs|dnse/.test(n)) return 'brokerage';
  if (/the tin dung|credit/.test(n)) return 'credit_card';
  return 'bank';
}

function addIncomeStream(text, ent) {
  const amount = ent.amount;
  if (!amount) return { reply: 'Nguồn thu đó mỗi tháng bao nhiêu? Ví dụ _"cho thuê nhà 8 triệu mỗi tháng"_.' };
  const n = norm(text);
  let type = 'other';
  let catName = 'Thu khác';
  if (/luong|salary/.test(n)) { type = 'salary'; catName = 'Lương'; }
  else if (/thue nha|cho thue|tro|can ho/.test(n)) { type = 'rental'; catName = 'Cho thuê BĐS'; }
  else if (/lai|tiet kiem/.test(n)) { type = 'interest'; catName = 'Lãi ngân hàng'; }
  else if (/co tuc/.test(n)) { type = 'dividend'; catName = 'Cổ tức'; }
  else if (/freelance|du an|ngoai/.test(n)) { type = 'freelance'; catName = 'Freelance / Dự án'; }
  else if (/kinh doanh|ban hang|shop/.test(n)) { type = 'business'; catName = 'Kinh doanh'; }
  const dayM = n.match(/ngay (\d{1,2})|mung (\d{1,2})/);
  const payday = dayM ? Number(dayM[1] || dayM[2]) : 5;
  const name = cleanEntityName(text, ent) || 'Nguồn thu mới';
  const id = insert('income_streams', { name: name.slice(0, 60), type, net_amount: amount, frequency: 'monthly', payday, stability: type === 'rental' || type === 'interest' ? 4 : 3, active: 1 });
  createRecurring({ name: name.slice(0, 60), type: 'income', amount, category_id: categoryByName(catName, 'income')?.id, income_stream_id: id, frequency: 'monthly', day_of_month: payday, start_date: today(), auto_post: 1 });
  if (type === 'rental') insert('properties', { name: name.slice(0, 60), monthly_rent: amount, occupancy: 1, current_value: amount * 200 });
  const streams = all('SELECT * FROM income_streams WHERE active = 1');
  return {
    reply: bullet([
      `➕ Đã thêm nguồn thu **${name}: ${fmt(amount)}/tháng** (ngày ${payday} hàng tháng, tự động ghi sổ).`,
      `Bạn đang có **${streams.length} nguồn thu**, tổng ${short(streams.reduce((s, x) => s + (x.net_amount || 0), 0))}/tháng.`,
      type !== 'salary' ? `Đây là thu nhập ${['rental', 'interest', 'dividend'].includes(type) ? '**thụ động** — loại giúp bạn tới tự do tài chính nhanh nhất' : 'chủ động'}.` : null,
    ]),
    data: { id },
    refresh: true,
  };
}

function addDebt(text, ent) {
  const amounts = findAmounts(text).map((a) => a.value).filter((v) => v > 0);
  if (!amounts.length) return { reply: 'Khoản vay bao nhiêu, lãi suất mấy %? Ví dụ _"vay mua xe 300 triệu lãi 10%, trả 8 triệu/tháng"_.' };
  const balance = Math.max(...amounts);
  const monthly = amounts.filter((v) => v !== balance).sort((a, b) => a - b)[0] || 0;
  const rate = parsePercent(text) != null ? parsePercent(text) * 100 : 12;
  const n = norm(text);
  const bare = cleanEntityName(text, { amounts: findAmounts(text) });
  const name = bare ? (/^(vay|no|nợ|thẻ|the|tra gop|trả góp)/i.test(bare) ? bare : `Vay ${bare}`) : 'Khoản vay';
  const id = insert('debts', {
    name: name.slice(0, 60), type: /nha|the chap/.test(n) ? 'mortgage' : /xe/.test(n) ? 'auto' : /the tin dung/.test(n) ? 'credit_card' : 'personal',
    balance, principal: balance, interest_rate: rate, monthly_payment: monthly, min_payment: monthly || Math.round(balance * 0.03),
    start_date: today(), due_day: 10, status: 'active',
  });
  if (monthly) {
    createRecurring({ name: `Trả nợ ${name}`.slice(0, 60), type: 'expense', amount: monthly, debt_id: id, category_id: categoryByName('Trả nợ & Lãi vay', 'expense')?.id, fund_id: fundByName('Thiết yếu')?.id, frequency: 'monthly', day_of_month: 10, start_date: today(), auto_post: 1 });
  }
  const d = get('SELECT * FROM debts WHERE id = ?', [id]);
  const sched = payoffPlan('avalanche', 0);
  return {
    reply: bullet([
      `🏦 Đã ghi khoản nợ **${d.name}: ${fmt(balance)}** @ ${rate}%/năm${monthly ? `, trả ${short(monthly)}/tháng` : ''}.`,
      `Ngày sạch nợ dự kiến: **${vnDate(sched.payoff_date)}**, tổng lãi còn phải trả ${short(sched.total_interest)}.`,
      rate >= 15 ? `⚠️ Lãi ${rate}%/năm là rất cao — nên ưu tiên trả trước mọi khoản đầu tư khác.` : null,
    ]),
    data: d,
    refresh: true,
  };
}

function addHolding(text, ent) {
  const sym = ent.symbol;
  const amounts = findAmounts(text).map((a) => ({
    ...a,
    plain: /^[\d.,\s]+$/.test(a.raw) ? parseNumberFor(a.raw, a.currency) : null,
  }));
  if (!sym) return { reply: 'Bạn đang giữ mã nào? Ví dụ _"mình có 1000 cổ phiếu HPG giá vốn 25"_.' };
  // Số lượng = con số trần không kèm đơn vị tiền; giá = số tiền còn lại.
  const qtyA = amounts.find((a) => a.plain != null && Number.isInteger(a.plain) && a.plain >= 1 && a.plain <= 10_000_000 && !a.explicit_currency);
  const qty = qtyA ? qtyA.plain : 0;
  const priceRaw = amounts.find((a) => a !== qtyA);
  // Giá cổ phiếu Việt Nam luôn là VND kể cả khi người dùng đang sống ở nước
  // ngoài — "FPT giá 135k" nghĩa là 135.000đ/cp, không phải 135k euro.
  const hc = priceRaw?.explicit_currency ? priceRaw.currency : guessSymbolCurrency(sym, priceRaw?.currency);
  const price = priceRaw ? (priceRaw.currency === hc ? priceRaw.value : toMinor(priceRaw.major, hc)) : 0;
  const acc = get("SELECT * FROM accounts WHERE type = 'brokerage' LIMIT 1") || get('SELECT * FROM accounts LIMIT 1');
  const h = upsertHolding({ symbol: sym, name: sym, account_id: acc?.id, quantity: qty, avg_cost: price, last_price: price, asset_class: 'stock', currency: hc });
  const pf = portfolio();
  return {
    reply: bullet([
      `📈 Đã ghi nhận **${qty.toLocaleString('vi-VN')} ${sym}** giá vốn ${short(price, hc)}/cp → giá trị ${fmt(qty * price, hc)}.`,
      `Danh mục hiện tại: ${fmt(pf.total_value)}.`,
      `Cập nhật giá thị trường bằng cách nhắn _"giá ${sym} 28"_ để mình tính lãi/lỗ.`,
    ]),
    data: h,
    refresh: true,
  };
}

function addRecurringIntent(text, ent) {
  if (!ent.amount) return { reply: 'Khoản định kỳ bao nhiêu tiền, ngày nào? Ví dụ _"tiền nhà 6 triệu ngày 1 hàng tháng"_.' };
  const n = norm(text);
  const dayM = n.match(/ngay (\d{1,2})|mung (\d{1,2})/);
  const day = dayM ? Number(dayM[1] || dayM[2]) : 1;
  const isIncome = /nhan|luong|thu|cho thue|co tuc|lai/.test(n);
  const frequency = /moi ngay|hang ngay/.test(n) ? 'daily' : /moi tuan|hang tuan/.test(n) ? 'weekly' : /moi nam|hang nam/.test(n) ? 'yearly' : /moi quy|hang quy/.test(n) ? 'quarterly' : 'monthly';
  const name = cleanEntityName(text, ent) || 'Khoản định kỳ';
  const rec = createRecurring({
    name: name.slice(0, 60), type: isIncome ? 'income' : 'expense', amount: ent.amount,
    category_id: ent.category?.id, fund_id: isIncome ? null : (ent.fund?.id || fundByName('Thiết yếu')?.id),
    frequency, day_of_month: day, start_date: today(), auto_post: 1,
  });
  const when = { daily: 'mỗi ngày', weekly: 'mỗi tuần', quarterly: 'mỗi quý', yearly: 'mỗi năm' }[frequency] || `ngày ${day} hàng tháng`;
  const perMonth = { daily: ent.amount * 30, weekly: ent.amount * 4.33, quarterly: ent.amount / 3, yearly: ent.amount / 12 }[frequency];
  return {
    reply: bullet([
      `🔁 Đã thiết lập **${rec.name}: ${fmt(rec.amount)}** ${when} — app tự ghi sổ, bạn không cần nhớ.`,
      perMonth ? `Tương đương **${short(Math.round(perMonth))}/tháng** (${short(Math.round(perMonth * 12))}/năm).` : null,
    ]),
    data: rec,
    refresh: true,
  };
}

function undo() {
  const last = get("SELECT * FROM transactions WHERE source IN ('chat','manual') ORDER BY id DESC LIMIT 1");
  if (!last) return { reply: 'Không có giao dịch nào gần đây để xoá.' };
  deleteTransaction(last.id);
  return { reply: `🗑️ Đã xoá giao dịch **${last.type === 'income' ? 'thu' : 'chi'} ${fmt(last.amount)}** (${last.note || 'không ghi chú'}).`, refresh: true };
}

function help() {
  return {
    reply: bullet([
      '🤖 **Mình làm được gì**',
      '',
      '**Ghi sổ bằng lời nói thường:**',
      '• _"trưa nay ăn 60k"_ · _"đổ xăng 100 nghìn"_ · _"vừa nhận lương 25 triệu"_',
      '• _"chuyển 5 triệu vào tiết kiệm"_ · _"xoá giao dịch vừa rồi"_',
      '',
      '**Tự động, không cần nhập tay:**',
      '• Lương, tiền nhà, thuê bao: tự ghi đúng ngày',
      '• Lãi tiết kiệm: tự cộng mỗi kỳ',
      '• SMS/thông báo ngân hàng: bật ở tab **Tự động hoá** (webhook cho iOS Shortcuts / Tasker / MacroDroid)',
      '• Sao kê CSV: kéo thả là xong, tự lọc trùng',
      '',
      '**Hỏi bất cứ điều gì về tiền:**',
      '• _"tháng này tiêu bao nhiêu"_ · _"còn bao nhiêu tiền"_ · _"tài sản ròng"_',
      '• _"bao giờ mình tự do tài chính"_ · _"bao giờ hết nợ"_',
      '• _"dư 50 triệu nên làm gì"_ · _"có nên mua iPhone 30 triệu không"_',
      '• _"tình hình tài chính của mình thế nào"_',
      '',
      '**Thiết lập bằng chat:**',
      '• _"mua nhà 2 tỷ trong 5 năm"_ → tạo mục tiêu + kế hoạch',
      '• _"đặt ngân sách ăn uống 5 triệu"_ · _"thiết yếu 50%, hưởng thụ 10%"_',
      '• _"cho thuê nhà 8 triệu mỗi tháng"_ → thêm nguồn thu thụ động',
    ]),
  };
}

function greeting() {
  const p = P();
  const mk = monthKey();
  const t = totals(monthStart(mk), monthEnd(mk));
  const sts = safeToSpend();
  const ins = listInsights({ limit: 2 });
  return {
    reply: bullet([
      `Chào ${p.name || 'bạn'} 👋`,
      `Tháng này: thu ${short(t.income)} · chi ${short(t.expense)} · còn an toàn tiêu ${short(sts.available)} (${short(sts.per_day)}/ngày).`,
      ins.length ? `\n${ins.map((i) => `${i.severity === 'danger' ? '🔴' : i.severity === 'warn' ? '🟠' : '💡'} ${i.title}`).join('\n')}` : null,
      '\nCần gì cứ nói — ghi chi tiêu, hỏi kế hoạch, hay xin lời khuyên.',
    ]),
  };
}

function updateProfile(text) {
  const m = String(text).match(/(?:tên là|ten la|gọi mình là|goi minh la|mình là|minh la)\s+([\p{L}\s]{2,30})/iu);
  const y = String(text).match(/\b(19|20)\d{2}\b/);
  const patch = {};
  if (m) patch.name = m[1].trim();
  if (y) patch.birth_year = Number(y[0]);
  const age = norm(text).match(/(\d{2})\s*tuoi/);
  if (age) patch.birth_year = new Date().getFullYear() - Number(age[1]);
  if (!Object.keys(patch).length) return { reply: 'Bạn muốn cập nhật thông tin gì? Ví dụ _"mình tên Nam, sinh năm 1996"_.' };
  update('profile', 1, patch);
  return { reply: `✅ Đã cập nhật hồ sơ${patch.name ? `, chào ${patch.name}` : ''}${patch.birth_year ? ` (sinh ${patch.birth_year})` : ''}.`, refresh: true };
}

/**
 * Câu KỂ HOÀN CẢNH RỒI XIN LỜI KHUYÊN — khác hẳn câu ra lệnh ghi sổ. Dấu hiệu
 * là những cụm mở đầu một cuộc trò chuyện với cố vấn: "nên bắt đầu từ đâu",
 * "tính lại thế nào", "vì sao", "phải làm sao".
 */
function asksForAdvice(text) {
  const n = norm(text);
  return /bat dau tu dau|nen lam gi|lam gi bay gio|phai lam sao|lam sao bay gio|tinh lai the nao|nen tinh sao|tinh sao|vi sao|tai sao|the nao bay gio|khuyen minh|tu van cho minh|giup minh voi|nen the nao|di tiep the nao|xoay so|goi y cho minh/.test(n);
}

function unknown(text, ent) {
  // Câu hỏi kiến thức tài chính -> trả lời gắn với số liệu thật của người dùng
  const topic = findTopic(text);
  if (topic) {
    return {
      reply: answerTopic(topic),
      quick: ['Tình hình tài chính của mình', 'Việc nên làm tiếp theo', 'Bao giờ tự do tài chính'],
    };
  }
  // Người dùng KỂ HOÀN CẢNH rồi xin lời khuyên ("mình đang nợ 900 triệu và
  // không còn gì, nên bắt đầu từ đâu"). Con số trong câu là bối cảnh, không
  // phải khoản cần ghi sổ — hỏi lại "bạn muốn ghi thu hay chi" ở đây là bỏ rơi
  // người dùng đúng lúc họ cần cố vấn nhất.
  if (asksForAdvice(text)) {
    const s = summary();
    return {
      ...s,
      reply: `${s.reply}\n\n_Mình trả lời dựa trên toàn bộ số liệu đang có trong app. Muốn đi sâu hơn thì hỏi tiếp: "nên trả khoản nợ nào trước", "cắt chi tiêu ở đâu", "bao giờ mình tự do tài chính"._`,
    };
  }
  // Có tiền nhưng không rõ ý -> hỏi lại có định hướng
  if (ent.amount) {
    return {
      reply: bullet([
        `Mình thấy con số **${short(ent.amount, ent.currency)}** nhưng chưa chắc ý bạn. Bạn muốn:`,
        '• Ghi một khoản **chi** → nói _"chi ' + short(ent.amount, ent.currency) + ' cho ..."_',
        '• Ghi một khoản **thu** → nói _"nhận ' + short(ent.amount, ent.currency) + ' từ ..."_',
        '• Xin **lời khuyên** cho khoản dư này → _"dư ' + short(ent.amount, ent.currency) + ' nên làm gì"_',
        '• Xem **có nên mua** món giá đó → _"có nên mua ... ' + short(ent.amount, ent.currency) + ' không"_',
      ]),
      quick: [`Chi ${short(ent.amount, ent.currency)}`, `Nhận ${short(ent.amount, ent.currency)}`, `Dư ${short(ent.amount, ent.currency)} nên làm gì`],
    };
  }
  return {
    reply: bullet([
      'Mình chưa chắc hiểu ý bạn 🤔 Thử hỏi kiểu:',
      '• _"tháng này tiêu bao nhiêu"_',
      '• _"bao giờ mình tự do tài chính"_',
      '• _"dư 50 triệu nên làm gì"_',
      '• _"trưa nay ăn 60k"_',
      '',
      'Hoặc gõ **giúp gì được** để xem toàn bộ khả năng.',
    ]),
    quick: ['Tình hình tài chính của mình', 'Tháng này tiêu bao nhiêu', 'Bao giờ tự do tài chính'],
  };
}

function setPrice(text, ent) {
  const sym = ent.symbol;
  const a = ent.amounts?.[0];
  if (!sym || !a) return null;
  const changed = all('SELECT * FROM holdings WHERE upper(symbol) = upper(?)', [sym]);
  if (!changed.length) return null;
  const hc = curInfo(changed[0].currency || guessSymbolCurrency(sym, a.currency)).code;
  const price = a.explicit_currency && a.currency === hc ? a.value : toMinor(a.major, hc);
  run('UPDATE holdings SET last_price = ?, last_price_at = ? WHERE upper(symbol) = upper(?)', [price, today(), sym]);
  const pf = portfolio();
  const h = pf.holdings.find((x) => x.symbol.toUpperCase() === sym.toUpperCase());
  return { reply: `📈 Cập nhật giá **${sym}: ${short(price, hc)}**. Vị thế của bạn: ${short(h.value, hc)} (${h.pnl >= 0 ? '▲' : '▼'} ${short(Math.abs(h.pnl), hc)}, ${Math.round(h.pnl_pct * 100)}%).`, refresh: true };
}

// ---------- đa tiền tệ: tỷ giá, kiều hối, thuế Ireland ---------------------

/** Đoán cặp tiền tệ người dùng đang hỏi trong câu. */
function fxPair(text, ent) {
  const n = norm(text);
  const seen = [];
  for (const [re, code] of [
    [/euro|eur|€/, 'EUR'], [/vnd|viet nam dong|tien viet|dong viet|vnđ/, 'VND'],
    [/usd|do la|dola|\$/, 'USD'], [/gbp|bang anh|£/, 'GBP'],
  ]) if (re.test(n) && !seen.includes(code)) seen.push(code);
  const base = baseCurrency();
  const from = ent?.currency || seen[0] || base;
  const to = seen.find((c) => c !== from) || (from === 'VND' ? base : 'VND');
  return { from, to: to === from ? (from === 'VND' ? 'EUR' : 'VND') : to };
}

function queryFx(text, ent) {
  const { from, to } = fxPair(text, ent);
  const rate = getRate(from, to);
  const st = fxStatus();
  const amount = ent?.amount || 0;
  const lines = [
    `💱 **1 ${from} = ${rate.toLocaleString('vi-VN', { maximumFractionDigits: to === 'VND' ? 0 : 4 })} ${to}**${st.updated_at ? ` _(cập nhật ${vnDate(st.updated_at)})_` : ''}`,
  ];
  if (amount) lines.push(`→ ${fmt(amount, from)} ≈ **${fmt(convert(amount, from, to), to)}**`);
  const digits = (code) => (code === 'VND' ? 0 : 4);
  const tips = rateTable(from)
    .filter((r) => r.code !== to && r.rate > 0)
    .map((r) => `${r.flag} 1 ${from} = ${r.rate.toLocaleString('vi-VN', { maximumFractionDigits: digits(r.code) })} ${r.code}`);
  if (tips.length) lines.push(`\nCác cặp khác: ${tips.join(' · ')}`);
  if (from !== 'VND' && to === 'VND') {
    const adv = timingAdvice(from, to);
    if (adv.verdict !== 'unknown') lines.push(`\n${adv.message}`);
  }
  return { reply: bullet(lines), quick: ['Giờ có nên gửi tiền về VN không?', 'Tháng này mình gửi về bao nhiêu rồi?'] };
}

function remittanceHandler(text, ent) {
  const n = norm(text);
  const base = baseCurrency();
  const from = ent?.currency && ent.currency !== 'VND' ? ent.currency : base === 'VND' ? 'EUR' : base;
  const to = 'VND';
  const adv = timingAdvice(from, to);
  const sum = remittanceSummary({ months: 12 });
  const cost = costInsight(12) || { total_cost: 0, cost_pct: 0 };

  // Có số tiền cụ thể -> báo giá luôn
  if (ent?.amount && !/bao nhieu roi|da gui|tong cong|thong ke/.test(n)) {
    const q = fxQuote({ amount: convert(ent.amount, ent.currency || from, from), from, to });
    return {
      reply: bullet([
        `🌍 ${q.text}`,
        `\n${adv.message}`,
        cost.total_cost ? `\n💸 12 tháng qua bạn đã tốn ${fmt(cost.total_cost, from)} phí + chênh tỷ giá (${pct(cost.cost_pct)} số tiền gửi).` : null,
        `\nMuốn mình ghi sổ khoản này? Nhắn _"chuyển ${toMajor(q.amount, from)} ${from} từ <ví> sang <tài khoản VN>"_.`,
      ]),
      data: { quote: q, timing: adv },
      quick: ['Tỷ giá hôm nay', 'Mình gửi về bao nhiêu rồi?'],
    };
  }

  return {
    reply: bullet([
      `🌍 **Chuyển tiền ${from} → ${to}**`,
      `${adv.message}`,
      sum.count
        ? `\n📊 12 tháng qua: **${sum.count} lần**, gửi ${fmt(sum.total_sent, from)} → nhận ${fmt(sum.total_received, to)}${sum.total_cost ? `, chi phí ${fmt(sum.total_cost, from)}` : ''}.`
        : `\n📊 Chưa có lần chuyển nào được ghi. Cứ tạo giao dịch chuyển khoản giữa ví ${from} và tài khoản ${to}, mình sẽ tự theo dõi.`,
      `\n💡 Mẹo giảm chi phí: gom nhiều lần nhỏ thành 1 lần lớn (phí cố định chia đều), so tỷ giá giữa các dịch vụ, và tránh gửi lúc tỷ giá đang thấp hơn trung bình 90 ngày.`,
    ]),
    data: { timing: adv, summary: sum, cost },
    quick: ['Gửi 1000 euro về thì nhận bao nhiêu?', 'Tỷ giá hôm nay'],
  };
}

function queryTax(text, ent) {
  const n = norm(text);
  const country = /viet nam|thue vn|tncn|giam tru gia canh|bhxh/.test(n)
    ? 'VN'
    : /ireland|paye|usc|prsi|dirt|ben nay/.test(n)
      ? 'IE'
      : ent?.currency === 'EUR'
        ? 'IE'
        : taxCountry();
  const cfg = taxConfigAuto(country);
  const cc = cfg.currency;
  // Mặc định hiểu là lương tháng; nói rõ "một năm/mỗi năm" thì chia lại.
  let grossMonthly = null;
  if (ent?.amount) {
    const a = convert(ent.amount, ent.currency || cc, cc);
    grossMonthly = /(mot|moi|\/)\s*nam|nam nay kiem|per year|\/year/.test(n) ? Math.round(a / 12) : a;
  }
  const lines = [];

  if (country === 'IE') {
    lines.push(
      `🇮🇪 **Thuế thu nhập ở Ireland (${cfg.year})**`,
      `• Thuế TNCN: 20% đến ${fmt(cfg.srcop, 'EUR')}/năm, phần vượt 40%`,
      `• Tín dụng thuế trừ thẳng vào số phải nộp: ${fmt(cfg.credits, 'EUR')}/năm (cá nhân + PAYE)`,
      `• USC: 0,5% → 8% theo bậc, miễn nếu thu nhập ≤ €13.000/năm`,
      `• PRSI: ${pct(cfg.prsi_rate)} lương gộp`,
      `• Lãi tiết kiệm chịu DIRT 33%; lãi bán cổ phiếu chịu CGT 33% (miễn €1.270 đầu mỗi năm)`,
      `• Đóng pension được giảm trừ thuế TNCN theo tuổi (15%→40% thu nhập, trần €115.000) — nhưng **không** giảm USC/PRSI`
    );
  } else {
    lines.push(
      `🇻🇳 **Thuế TNCN Việt Nam**`,
      `• Biểu luỹ tiến 7 bậc: 5% → 35%`,
      `• Giảm trừ bản thân ${fmt(cfg.self_deduction, 'VND')}/tháng, mỗi người phụ thuộc ${fmt(cfg.dependent_deduction, 'VND')}/tháng`,
      `• Bảo hiểm bắt buộc ${pct(cfg.insurance_rate)} lương đóng bảo hiểm (BHXH 8% + BHYT 1,5% + BHTN 1%)`
    );
  }

  if (grossMonthly) {
    // VN tính theo tháng, Ireland tính theo năm — truyền đúng kỳ cho từng nước.
    const r = grossToNetAuto(country === 'IE' ? grossMonthly * 12 : grossMonthly, { country });
    const netMonthly = country === 'IE' ? r.monthly_net : r.net;
    lines.push(
      `\n📊 Với lương gộp **${fmt(grossMonthly, cc)}/tháng** (${fmt(grossMonthly * 12, cc)}/năm):`,
      country === 'IE'
        ? `• Cả năm: thuế TNCN ${fmt(r.income_tax, cc)} · USC ${fmt(r.usc, cc)} · PRSI ${fmt(r.prsi, cc)} = ${fmt(r.total_tax, cc)}`
        : `• Mỗi tháng: bảo hiểm ${fmt(r.insurance, cc)} · thuế TNCN ${fmt(r.tax, cc)}`,
      `• **Thực nhận ≈ ${fmt(netMonthly, cc)}/tháng**${r.effective_rate != null ? ` (thuế suất thực tế ${pct(r.effective_rate)})` : ''}`,
      r.marginal_rate != null ? `• Thuế suất biên ${pct(r.marginal_rate)} — kiếm thêm 100 thì giữ lại được ${Math.round(100 * (1 - r.marginal_rate))}.` : null
    );
  } else {
    lines.push(`\n💡 Nhắn lương tháng của bạn (ví dụ _"lương ${cc === 'EUR' ? '4200 euro' : '30 triệu'} thuế bao nhiêu"_) để mình tính chi tiết.`);
  }
  return {
    reply: bullet(lines),
    quick: country === 'IE' ? ['Đóng pension có lợi không?', 'Tỷ giá hôm nay'] : ['Lương 30 triệu thực nhận bao nhiêu?', 'Tình hình tài chính của mình'],
  };
}

export const HANDLERS = {
  query_fx: queryFx,
  remittance: remittanceHandler,
  query_tax: queryTax,
  add_expense: addExpense,
  add_income: addIncome,
  add_transfer: addTransfer,  query_spending: querySpending,
  query_balance: queryBalance,
  query_networth: queryNetworth,
  query_fire: queryFire,
  query_forecast: queryForecast,
  query_debt: queryDebt,
  query_goal: queryGoals,
  query_budget: queryBudget,
  query_investment: queryInvestment,
  query_income: queryIncome,
  surplus_advice: surplusAdvice,
  affordability,
  summary,
  create_goal: createGoal,
  create_budget: createBudgetIntent,
  set_allocation: setAllocation,
  add_account: addAccount,
  add_income_stream: addIncomeStream,
  add_debt: addDebt,
  add_holding: addHolding,
  add_recurring: addRecurringIntent,
  undo,
  help,
  greeting,
  update_profile: updateProfile,
  set_price: setPrice,
  unknown,
};
