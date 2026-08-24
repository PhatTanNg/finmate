/**
 * Dữ liệu mẫu cho người Việt sống & làm việc ở Ireland.
 * Sinh hoạt bằng EUR, vẫn giữ tài sản/đầu tư ở Việt Nam bằng VND, và
 * gửi tiền về nhà hàng tháng — đúng bài toán đa tiền tệ thật sự.
 */
import { db, all, get, insert, update, run, setting } from '../db.js';
import { bootstrap, categoryByName, fundByName } from '../bootstrap.js';
import { createTransaction } from '../services/ledger.js';
import { createRecurring, runDueRecurring } from '../services/recurring.js';
import { upsertHolding, recordTrade, setPrice } from '../services/investments.js';
import { snapshot } from '../services/networth.js';
import { generateInsights } from '../services/insights.js';
import { recomputeFundBalances, allocateIncome } from '../services/funds.js';
import { ensureSeedRates, setRate, convert } from '../services/fx.js';
import { grossToNetIE } from '../services/tax_ie.js';
import { today, addDays, addMonths, monthKey, monthStart, monthEnd, lastMonths } from '../util/date.js';
import { toMinor, fmtMoney } from '../util/currency.js';

bootstrap();

for (const t of ['transactions', 'fund_ledger', 'holdings', 'trades', 'properties', 'debts', 'goals', 'budgets', 'recurring', 'income_streams', 'accounts', 'insights', 'networth_snapshots', 'chat_messages', 'ingest_log']) {
  run(`DELETE FROM ${t}`);
}
run('UPDATE funds SET balance = 0');

// EUR là đồng tiền chính, thuế tính theo Ireland
update('profile', 1, {
  name: 'Phát', birth_year: 1996, city: 'Dublin', country: 'IE', tax_country: 'IE',
  currency: 'EUR', secondary_currency: 'VND', dependents: 0, marital_status: 'single',
  risk_profile: 'balanced',
  lifestyle: 'Làm full-time ở Dublin, thuê nhà share, đi Luas/bus, nấu ăn ở nhà là chính, gửi tiền về VN hàng tháng và đầu tư cổ phiếu Việt Nam',
  retire_age_target: 50, onboarded: 1, onboarding_step: 'done',
  expected_return: 0.07, inflation: 0.025,
});
run("UPDATE funds SET currency = 'EUR'");

ensureSeedRates();
setRate('EUR', 'VND', 30500, today(), 'seed');
// vài mốc lịch sử để tính năng "thời điểm nên gửi tiền" có dữ liệu so sánh
for (let i = 1; i <= 90; i += 3) {
  const wave = 30500 + Math.round(Math.sin(i / 9) * 620 + Math.cos(i / 4) * 180);
  setRate('EUR', 'VND', wave, addDays(today(), -i), 'seed');
}

const E = (v) => toMinor(v, 'EUR');
const V = (v) => toMinor(v, 'VND');

// ---- tài khoản ------------------------------------------------------------
const acc = {};
const A = ({ key, ...data }) => (acc[key] = insert('accounts', { currency: 'EUR', ...data, opening_balance: data.balance, opened_at: data.opened_at || '2023-01-01' }));
A({ key: 'revolut', name: 'Revolut', type: 'bank', institution: 'Revolut', balance: E(3_240.55), auto_sync: 1, color: '#0075eb' });
A({ key: 'aib', name: 'AIB Current', type: 'bank', institution: 'AIB', balance: E(5_870.2), account_no: 'IE29AIBK93115212345678', auto_sync: 1, color: '#c8102e', statement_day: 1 });
A({ key: 'n26', name: 'N26 Spaces', type: 'savings', institution: 'N26', balance: E(9_400), interest_rate: 2.6, interest_payout: 'monthly', color: '#36a18b' });
A({ key: 'cashEur', name: 'Tiền mặt', type: 'cash', balance: E(120), color: '#6b7280' });
A({ key: 'degiro', name: 'DEGIRO', type: 'investment', institution: 'DEGIRO', balance: E(640), color: '#7c3aed' });
A({ key: 'ccEur', name: 'Revolut Credit', type: 'credit', institution: 'Revolut', balance: E(-410.9), credit_limit: E(3_000), statement_day: 25, due_day: 12, color: '#b91c1c', include_in_networth: 0 });
// tài sản ở Việt Nam — vẫn ghi bằng VND
A({ key: 'vcb', name: 'VCB Việt Nam', type: 'bank', institution: 'Vietcombank', balance: V(48_000_000), currency: 'VND', color: '#0b6b3a' });
A({ key: 'savVn', name: 'Tiết kiệm 12 tháng VCB', type: 'savings', institution: 'Vietcombank', balance: V(420_000_000), currency: 'VND', interest_rate: 5.6, interest_payout: 'maturity', term_months: 12, opened_at: addMonths(today(), -4), maturity_date: addMonths(today(), 8), color: '#0f766e' });
A({ key: 'vps', name: 'Chứng khoán VPS', type: 'investment', institution: 'VPS', balance: V(12_500_000), currency: 'VND', color: '#1d4ed8' });

// ---- nguồn thu ------------------------------------------------------------
const GROSS_YEAR = E(58_000);
const pay = grossToNetIE(GROSS_YEAR, { age: 30, pension: E(3_480), rentCredit: true });
insert('income_streams', {
  name: 'Lương full-time (Dublin)', type: 'salary', employer: 'Stripe Ireland', account_id: acc.aib,
  gross_amount: Math.round(GROSS_YEAR / 12), net_amount: pay.monthly_net, currency: 'EUR',
  frequency: 'monthly', payday: 25, stability: 'stable', growth_rate: 6, tax_mode: 'paye', active: 1,
});
insert('income_streams', { name: 'Lãi N26 Spaces', type: 'interest', account_id: acc.n26, gross_amount: E(20.4), net_amount: E(13.7), currency: 'EUR', frequency: 'monthly', stability: 'stable', tax_mode: 'dirt', active: 1 });
insert('income_streams', { name: 'Lãi tiết kiệm VCB', type: 'interest', account_id: acc.vcb, gross_amount: V(1_960_000), net_amount: V(1_960_000), currency: 'VND', frequency: 'monthly', stability: 'stable', tax_mode: 'none', active: 1 });
const propId = insert('properties', { name: 'Căn hộ Bình Thạnh cho thuê', address: 'Bình Thạnh, TP.HCM', currency: 'VND', purchase_price: V(1_850_000_000), current_value: V(2_250_000_000), purchase_date: '2021-06-01', monthly_rent: V(9_500_000), monthly_cost: V(1_200_000), occupancy: 0.92, appreciation_rate: 6 });
insert('income_streams', { name: 'Cho thuê căn hộ Bình Thạnh', type: 'rental', account_id: acc.vcb, gross_amount: V(9_500_000), net_amount: V(8_300_000), currency: 'VND', frequency: 'monthly', payday: 10, stability: 'stable', property_id: propId, tax_mode: 'rental', active: 1 });
insert('income_streams', { name: 'Freelance (khách VN)', type: 'freelance', account_id: acc.revolut, gross_amount: E(450), net_amount: E(450), currency: 'EUR', frequency: 'irregular', stability: 'variable', tax_mode: 'none', active: 1 });

// ---- đầu tư ---------------------------------------------------------------
upsertHolding({ account_id: acc.degiro, symbol: 'VWCE', name: 'Vanguard FTSE All-World (UCITS)', asset_class: 'etf', quantity: 62, avg_cost: E(112.4), last_price: E(126.85), currency: 'EUR', dividend_yield: 1.7 });
upsertHolding({ account_id: acc.degiro, symbol: 'CSPX', name: 'iShares Core S&P 500 (UCITS)', asset_class: 'etf', quantity: 8, avg_cost: E(488.2), last_price: E(552.1), currency: 'EUR' });
upsertHolding({ account_id: acc.vps, symbol: 'HPG', name: 'Hoà Phát', asset_class: 'stock', quantity: 3000, avg_cost: V(25_400), last_price: V(27_950), currency: 'VND', dividend_yield: 2 });
upsertHolding({ account_id: acc.vps, symbol: 'FPT', name: 'FPT Corp', asset_class: 'stock', quantity: 800, avg_cost: V(92_000), last_price: V(118_500), currency: 'VND', dividend_yield: 2.5 });
upsertHolding({ account_id: acc.vps, symbol: 'SJC', name: 'Vàng SJC (chỉ)', asset_class: 'gold', quantity: 8, avg_cost: V(7_600_000), last_price: V(8_950_000), currency: 'VND' });

// ---- nợ -------------------------------------------------------------------
insert('debts', { name: 'Dư nợ Revolut Credit', type: 'credit_card', lender: 'Revolut', currency: 'EUR', principal: E(410.9), balance: E(410.9), interest_rate: 21.9, min_payment: E(25), due_day: 12, account_id: acc.revolut, method: 'revolving', status: 'active' });

// ---- mục tiêu -------------------------------------------------------------
insert('goals', { name: 'Quỹ khẩn cấp 6 tháng', type: 'emergency', currency: 'EUR', target_amount: E(15_600), current_amount: E(9_400), deadline: addMonths(today(), 12), monthly_contribution: E(520), auto_contribute: 1, fund_id: fundByName('Quỹ khẩn cấp')?.id, priority: 1, status: 'active' });
insert('goals', { name: 'Tiền cọc mua nhà ở Dublin', type: 'house', currency: 'EUR', target_amount: E(45_000), current_amount: E(11_200), deadline: addMonths(today(), 54), monthly_contribution: E(700), auto_contribute: 1, fund_id: fundByName('Mục tiêu lớn')?.id, priority: 2, status: 'active', expected_return: 3 });
insert('goals', { name: 'Về Việt Nam thăm nhà (2 lần/năm)', type: 'travel', currency: 'EUR', target_amount: E(2_400), current_amount: E(860), deadline: addMonths(today(), 6), monthly_contribution: E(200), auto_contribute: 1, fund_id: fundByName('Hưởng thụ')?.id, priority: 4, status: 'active' });
insert('goals', { name: 'Tự do tài chính', type: 'fire', currency: 'EUR', target_amount: E(750_000), current_amount: 0, deadline: addMonths(today(), 240), monthly_contribution: E(900), auto_contribute: 1, fund_id: fundByName('Tự do tài chính')?.id, priority: 3, status: 'active', expected_return: 7 });

// ---- ngân sách ------------------------------------------------------------
const B = (cat, eur) => {
  const c = categoryByName(cat);
  if (c) insert('budgets', { category_id: c.id, amount: E(eur), currency: 'EUR', period: 'monthly', month: monthKey(), rollover: 0, alert_threshold: 0.8, active: 1 });
};
B('Ăn uống', 420);
B('Cà phê & trà sữa', 70);
B('Mua sắm', 180);
B('Giải trí', 120);
B('Di chuyển', 110);
B('Sức khỏe', 60);

// ---- định kỳ --------------------------------------------------------------
const R = (data) => createRecurring({ auto_post: 1, active: 1, currency: 'EUR', start_date: addMonths(today(), -6), ...data });
R({ name: 'Tiền thuê nhà (share, Dublin 8)', type: 'expense', amount: E(1_150), account_id: acc.aib, category_id: categoryByName('Nhà ở')?.id, frequency: 'monthly', day_of_month: 1 });
R({ name: 'Điện + gas (Electric Ireland)', type: 'expense', amount: E(96), account_id: acc.aib, category_id: categoryByName('Điện nước')?.id, frequency: 'monthly', day_of_month: 8, variable: 1 });
R({ name: 'Internet Virgin Media', type: 'expense', amount: E(45), account_id: acc.aib, category_id: categoryByName('Điện thoại & Internet')?.id, frequency: 'monthly', day_of_month: 10 });
R({ name: 'Điện thoại 48/Three', type: 'expense', amount: E(14.99), account_id: acc.revolut, category_id: categoryByName('Điện thoại & Internet')?.id, frequency: 'monthly', day_of_month: 6 });
R({ name: 'Leap Card TaxSaver (vé tháng)', type: 'expense', amount: E(85), account_id: acc.aib, category_id: categoryByName('Di chuyển')?.id, frequency: 'monthly', day_of_month: 2 });
R({ name: 'Netflix + Spotify', type: 'expense', amount: E(21.98), account_id: acc.ccEur, category_id: categoryByName('Đăng ký dịch vụ')?.id, frequency: 'monthly', day_of_month: 14 });
R({ name: 'Gym FLYEfit', type: 'expense', amount: E(29), account_id: acc.ccEur, category_id: categoryByName('Sức khỏe')?.id, frequency: 'monthly', day_of_month: 20 });
R({ name: 'Bảo hiểm y tế VHI', type: 'expense', amount: E(72), account_id: acc.aib, category_id: categoryByName('Bảo hiểm')?.id, frequency: 'monthly', day_of_month: 18 });

// ---- lịch sử 6 tháng ------------------------------------------------------
let seed = 20260115;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
/** Số tiền EUR ngẫu nhiên quanh `base` euro, làm tròn tới cent. */
const near = (base, spread) => Math.max(50, Math.round(E(base + (rnd() - 0.5) * 2 * spread)));

const FOOD = ['Tesco', 'Lidl', 'Dunnes Stores', 'SuperValu', 'Asia Market', 'Boojum', 'Camile Thai', 'Deliveroo', 'Centra', 'Bánh mì Ba Đô'];
const COFFEE = ['Costa Coffee', 'Insomnia', 'Butlers Chocolate Café', 'Starbucks', '3FE'];
const SHOP = ['Penneys', 'Zara Grafton St', 'IKEA Ballymun', 'Amazon.ie', 'Boots', 'Currys'];
const MOVE = ['Leap Card top-up', 'FreeNow', 'Irish Rail', 'Dublin Bus', 'Circle K fuel'];
const FUN = ['Odeon Point Square', 'Steam', 'The Bernard Shaw', 'Aviva Stadium', 'Eventbrite'];

const months = lastMonths(6);
for (const mk of months) {
  const first = monthStart(mk);
  const isCurrent = mk === monthKey();
  const dayLimit = isCurrent ? Number(today().slice(8, 10)) : 28;

  // lương về AIB ngày 25
  createTransaction({ type: 'income', amount: pay.monthly_net, currency: 'EUR', date: addDays(first, 24), account_id: acc.aib, merchant: 'STRIPE PAYROLL', note: `Lương tháng ${mk}`, source: 'sms', category_id: categoryByName('Lương', 'income')?.id });
  // thu nhập ở Việt Nam vẫn vào tài khoản VND
  createTransaction({ type: 'income', amount: V(8_300_000), currency: 'VND', date: addDays(first, 9), account_id: acc.vcb, merchant: 'TIEN THUE NHA', note: 'Tiền thuê căn hộ Bình Thạnh', source: 'sms', category_id: categoryByName('Cho thuê BĐS', 'income')?.id });
  if (rnd() > 0.55) createTransaction({ type: 'income', amount: near(450, 200), currency: 'EUR', date: addDays(first, 17), account_id: acc.revolut, merchant: 'FREELANCE PAYOUT', note: 'Dự án freelance', source: 'sms', category_id: categoryByName('Freelance', 'income')?.id });

  for (let d = 1; d <= dayLimit; d++) {
    const date = addDays(first, d - 1);
    if (d % 7 === 2 || d % 7 === 5) createTransaction({ type: 'expense', amount: near(48, 22), currency: 'EUR', date, account_id: pick([acc.revolut, acc.aib, acc.ccEur]), merchant: pick(FOOD.slice(0, 5)), note: 'Đi chợ tuần', source: 'sms' });
    if (rnd() > 0.55) createTransaction({ type: 'expense', amount: near(11.5, 6), currency: 'EUR', date, account_id: pick([acc.revolut, acc.ccEur]), merchant: pick(FOOD.slice(5)), source: 'sms' });
    if (rnd() > 0.6) createTransaction({ type: 'expense', amount: near(3.8, 1.4), currency: 'EUR', date, account_id: pick([acc.revolut, acc.cashEur]), merchant: pick(COFFEE), source: 'sms' });
    if (rnd() > 0.82) createTransaction({ type: 'expense', amount: near(42, 30), currency: 'EUR', date, account_id: pick([acc.ccEur, acc.aib]), merchant: pick(SHOP), source: 'sms' });
    if (rnd() > 0.88) createTransaction({ type: 'expense', amount: near(16, 10), currency: 'EUR', date, account_id: pick([acc.revolut, acc.cashEur]), merchant: pick(MOVE), source: 'sms' });
    if (rnd() > 0.92) createTransaction({ type: 'expense', amount: near(24, 14), currency: 'EUR', date, account_id: pick([acc.ccEur, acc.revolut]), merchant: pick(FUN), source: 'sms' });
  }

  // các khoản lớn
  if (rnd() > 0.65) createTransaction({ type: 'expense', amount: near(230, 120), currency: 'EUR', date: addDays(first, 12), account_id: acc.ccEur, merchant: 'Ryanair', note: 'Vé đi chơi châu Âu', source: 'sms' });
  if (rnd() > 0.8) createTransaction({ type: 'expense', amount: near(85, 40), currency: 'EUR', date: addDays(first, 21), account_id: acc.aib, merchant: 'Blackrock Clinic', note: 'Khám bệnh', source: 'sms' });

  // ---- gửi tiền về Việt Nam: chuyển khoản khác đồng tiền ------------------
  const sendDay = addDays(first, 26);
  const sent = near(1_000, 90);
  const fee = near(4.5, 1.5);
  createTransaction({
    type: 'transfer', amount: sent, fee, currency: 'EUR', date: sendDay,
    account_id: acc.revolut, counter_account_id: acc.vcb,
    note: 'Gửi tiền về cho gia đình', source: 'manual',
  });

  // luân chuyển nội bộ
  // Lương về AIB, mỗi tháng chuyển sang Revolut một khoản để tiêu và gửi về nhà.
  createTransaction({ type: 'transfer', amount: E(1_050), currency: 'EUR', date: addDays(first, 25), account_id: acc.aib, counter_account_id: acc.revolut, note: 'Tiền sinh hoạt tháng', source: 'sms' });
  createTransaction({ type: 'transfer', amount: E(520), currency: 'EUR', date: addDays(first, 25), account_id: acc.aib, counter_account_id: acc.n26, note: 'Bỏ quỹ khẩn cấp', source: 'sms' });
  createTransaction({ type: 'transfer', amount: E(400), currency: 'EUR', date: addDays(first, 25), account_id: acc.aib, counter_account_id: acc.degiro, note: 'DCA vào ETF', source: 'sms' });
  const dcaPrice = near(124, 6);
  recordTrade({ symbol: 'VWCE', side: 'buy', quantity: Math.max(1, Math.round(E(400) / dcaPrice)), price: dcaPrice, date: addDays(first, 26), account_id: acc.degiro, note: 'Mua định kỳ VWCE' });
  createTransaction({ type: 'transfer', amount: E(430), currency: 'EUR', date: addDays(first, 11), account_id: acc.aib, counter_account_id: acc.ccEur, note: 'Thanh toán thẻ tín dụng', source: 'sms' });
  createTransaction({ type: 'transfer', amount: E(60), currency: 'EUR', date: addDays(first, 3), account_id: acc.revolut, counter_account_id: acc.cashEur, note: 'Rút ATM', source: 'sms' });

  runDueRecurring(isCurrent ? today() : monthEnd(mk));

  if (!isCurrent) {
    allocateIncome({ amount: pay.monthly_net, date: addDays(first, 25), note: `Phân bổ thu nhập ${mk}` });
    snapshot(monthStart(mk));
  }
}

const ccDebt = get("SELECT id FROM debts WHERE type = 'credit_card'");
const ccBalance = Math.max(0, -get('SELECT balance FROM accounts WHERE id = ?', [acc.ccEur]).balance);
if (ccDebt) update('debts', ccDebt.id, { balance: ccBalance, principal: ccBalance });

recomputeFundBalances();
snapshot();
generateInsights();
setting('demo_seeded', new Date().toISOString());

const c = get('SELECT COUNT(*) c FROM transactions').c;
console.log(`[finmate] persona Ireland: ${c} giao dịch, ${all('SELECT id FROM accounts').length} tài khoản (EUR + VND).`);
console.log(`[finmate] lương gộp ${fmtMoney(GROSS_YEAR, 'EUR')}/năm → thực nhận ${fmtMoney(pay.monthly_net, 'EUR')}/tháng (thuế ${fmtMoney(pay.total_tax, 'EUR')}/năm).`);
console.log(`[finmate] 1.000 € hôm nay ≈ ${fmtMoney(convert(E(1000), 'EUR', 'VND'), 'VND')}`);
console.log('[finmate] chạy `npm run dev` rồi mở http://localhost:5173');
