/** Tạo dữ liệu mẫu sát thực tế Việt Nam để trải nghiệm ngay. */
import { db, all, get, insert, update, run, setting } from '../db.js';
import { bootstrap, categoryByName, fundByName } from '../bootstrap.js';
import { createTransaction } from '../services/ledger.js';
import { createRecurring, runDueRecurring } from '../services/recurring.js';
import { upsertHolding, recordTrade, setPrice } from '../services/investments.js';
import { snapshot } from '../services/networth.js';
import { generateInsights } from '../services/insights.js';
import { recomputeFundBalances, allocateIncome } from '../services/funds.js';
import { today, addDays, addMonths, monthKey, monthStart, monthEnd, lastMonths } from '../util/date.js';

bootstrap();

const clean = () => {
  for (const t of ['transactions', 'fund_ledger', 'holdings', 'trades', 'properties', 'debts', 'goals', 'budgets', 'recurring', 'income_streams', 'accounts', 'insights', 'networth_snapshots', 'chat_messages', 'ingest_log']) {
    run(`DELETE FROM ${t}`);
  }
  run('UPDATE funds SET balance = 0');
};
clean();

update('profile', 1, {
  name: 'Nam', birth_year: 1996, city: 'TP.HCM', dependents: 1, marital_status: 'single',
  risk_profile: 'balanced', lifestyle: 'Sống ở TP.HCM, thuê trọ, hay ăn ngoài và cà phê, thích du lịch 2 lần/năm',
  retire_age_target: 45, onboarded: 1, onboarding_step: 'done',
});

// ---- tài khoản ------------------------------------------------------------
const acc = {};
const A = ({ key, ...data }) => (acc[key] = insert('accounts', { ...data, opening_balance: data.balance, opened_at: data.opened_at || '2021-01-01' }));
A({ key: 'vcb', name: 'VCB Thanh toán', type: 'bank', institution: 'Vietcombank', balance: 42_500_000, account_no: '0071000123456', auto_sync: 1, color: '#0b6b3a', statement_day: 1 });
A({ key: 'tcb', name: 'Techcombank Lương', type: 'bank', institution: 'Techcombank', balance: 18_300_000, account_no: '19036789456', auto_sync: 1, color: '#e60012' });
A({ key: 'momo', name: 'Ví MoMo', type: 'ewallet', institution: 'MoMo', balance: 2_150_000, auto_sync: 1, color: '#a50064' });
A({ key: 'cash', name: 'Tiền mặt', type: 'cash', balance: 3_000_000, color: '#6b7280' });
A({ key: 'sav', name: 'Tiết kiệm 12 tháng VCB', type: 'savings', institution: 'Vietcombank', balance: 150_000_000, interest_rate: 5.6, interest_payout: 'maturity', term_months: 12, opened_at: addMonths(today(), -5), maturity_date: addMonths(today(), 7), color: '#0f766e' });
A({ key: 'sav2', name: 'Tiết kiệm linh hoạt TCB', type: 'savings', institution: 'Techcombank', balance: 60_000_000, interest_rate: 4.2, interest_payout: 'monthly', color: '#0369a1' });
A({ key: 'stock', name: 'Chứng khoán VPS', type: 'investment', institution: 'VPS', balance: 5_600_000, color: '#7c3aed' });
A({ key: 'cc', name: 'Thẻ tín dụng TCB Visa', type: 'credit', institution: 'Techcombank', balance: -8_400_000, credit_limit: 60_000_000, statement_day: 25, due_day: 12, color: '#b91c1c', include_in_networth: 0 });

// ---- nguồn thu ------------------------------------------------------------
insert('income_streams', { name: 'Lương công ty ABC Tech', type: 'salary', employer: 'ABC Tech', account_id: acc.tcb, gross_amount: 38_000_000, net_amount: 31_200_000, frequency: 'monthly', payday: 5, stability: 'stable', growth_rate: 8, tax_mode: 'pit', active: 1 });
insert('income_streams', { name: 'Freelance thiết kế', type: 'freelance', account_id: acc.vcb, gross_amount: 6_000_000, net_amount: 5_400_000, frequency: 'monthly', stability: 'variable', tax_mode: 'flat_10', active: 1 });
const propId = insert('properties', { name: 'Căn hộ Bình Thạnh cho thuê', address: 'Bình Thạnh, TP.HCM', purchase_price: 1_850_000_000, current_value: 2_250_000_000, purchase_date: '2021-06-01', monthly_rent: 9_500_000, monthly_cost: 1_200_000, occupancy: 0.92, appreciation_rate: 6 });
insert('income_streams', { name: 'Cho thuê căn hộ Bình Thạnh', type: 'rental', account_id: acc.vcb, gross_amount: 9_500_000, net_amount: 8_300_000, frequency: 'monthly', payday: 10, stability: 'stable', property_id: propId, tax_mode: 'rental', active: 1 });
insert('income_streams', { name: 'Lãi tiết kiệm', type: 'interest', account_id: acc.vcb, gross_amount: 910_000, net_amount: 910_000, frequency: 'monthly', stability: 'stable', tax_mode: 'none', active: 1 });
insert('income_streams', { name: 'Cổ tức cổ phiếu', type: 'dividend', account_id: acc.stock, gross_amount: 1_100_000, net_amount: 1_045_000, frequency: 'yearly', stability: 'variable', tax_mode: 'dividend', active: 1 });

// ---- đầu tư ---------------------------------------------------------------
upsertHolding({ account_id: acc.stock, symbol: 'HPG', name: 'Hoà Phát', asset_class: 'stock', quantity: 3000, avg_cost: 25_400, last_price: 27_950, dividend_yield: 2 });
upsertHolding({ account_id: acc.stock, symbol: 'FPT', name: 'FPT Corp', asset_class: 'stock', quantity: 800, avg_cost: 92_000, last_price: 118_500, dividend_yield: 2.5 });
upsertHolding({ account_id: acc.stock, symbol: 'MWG', name: 'Thế Giới Di Động', asset_class: 'stock', quantity: 500, avg_cost: 58_000, last_price: 52_300, dividend_yield: 1 });
upsertHolding({ account_id: acc.stock, symbol: 'DCDS', name: 'Quỹ mở Dragon Capital', asset_class: 'fund', quantity: 1200, avg_cost: 62_000, last_price: 69_800 });
upsertHolding({ account_id: acc.stock, symbol: 'SJC', name: 'Vàng SJC (chỉ)', asset_class: 'gold', quantity: 5, avg_cost: 7_600_000, last_price: 8_950_000 });

// ---- nợ -------------------------------------------------------------------
const carLoan = insert('debts', { name: 'Vay mua xe Mazda', type: 'auto', lender: 'VIB', principal: 420_000_000, balance: 268_000_000, interest_rate: 9.5, monthly_payment: 8_900_000, min_payment: 8_900_000, start_date: '2023-03-15', term_months: 60, due_day: 15, account_id: acc.vcb, method: 'annuity', status: 'active' });
insert('debts', { name: 'Dư nợ thẻ tín dụng', type: 'credit_card', lender: 'Techcombank', principal: 8_400_000, balance: 8_400_000, interest_rate: 32, min_payment: 420_000, due_day: 12, account_id: acc.tcb, method: 'revolving', status: 'active' });

// ---- mục tiêu -------------------------------------------------------------
insert('goals', { name: 'Quỹ khẩn cấp 6 tháng', type: 'emergency', target_amount: 132_000_000, current_amount: 60_000_000, deadline: addMonths(today(), 10), monthly_contribution: 4_000_000, auto_contribute: 1, fund_id: fundByName('Quỹ khẩn cấp')?.id, priority: 1, status: 'active' });
insert('goals', { name: 'Mua nhà quận 7', type: 'house', target_amount: 900_000_000, current_amount: 210_000_000, deadline: addMonths(today(), 48), monthly_contribution: 9_000_000, auto_contribute: 1, fund_id: fundByName('Mục tiêu lớn')?.id, priority: 2, status: 'active', expected_return: 7 });
insert('goals', { name: 'Du lịch Nhật Bản', type: 'travel', target_amount: 60_000_000, current_amount: 18_500_000, deadline: addMonths(today(), 8), monthly_contribution: 3_000_000, auto_contribute: 1, fund_id: fundByName('Hưởng thụ')?.id, priority: 4, status: 'active' });
insert('goals', { name: 'Tự do tài chính', type: 'fire', target_amount: 6_000_000_000, current_amount: 0, deadline: addMonths(today(), 204), monthly_contribution: 12_000_000, auto_contribute: 1, fund_id: fundByName('Tự do tài chính')?.id, priority: 3, status: 'active', expected_return: 10 });

// ---- ngân sách ------------------------------------------------------------
const B = (cat, amount) => {
  const c = categoryByName(cat);
  if (c) insert('budgets', { category_id: c.id, amount, period: 'monthly', month: monthKey(), rollover: 0, alert_threshold: 0.8, active: 1 });
};
B('Ăn uống', 6_000_000);
B('Cà phê & trà sữa', 1_200_000);
B('Mua sắm', 3_000_000);
B('Giải trí', 1_500_000);
B('Di chuyển', 2_000_000);
B('Sức khỏe', 1_000_000);

// ---- định kỳ --------------------------------------------------------------
const R = (data) => createRecurring({ auto_post: 1, active: 1, start_date: addMonths(today(), -6), ...data });
R({ name: 'Tiền thuê trọ', type: 'expense', amount: 7_500_000, account_id: acc.vcb, category_id: categoryByName('Nhà ở')?.id, frequency: 'monthly', day_of_month: 3 });
R({ name: 'Điện nước internet', type: 'expense', amount: 1_450_000, account_id: acc.vcb, category_id: categoryByName('Điện nước')?.id, frequency: 'monthly', day_of_month: 8, variable: 1 });
R({ name: 'Gói cước Viettel', type: 'expense', amount: 200_000, account_id: acc.momo, category_id: categoryByName('Điện thoại & Internet')?.id, frequency: 'monthly', day_of_month: 6 });
R({ name: 'Netflix + Spotify', type: 'expense', amount: 319_000, account_id: acc.cc, category_id: categoryByName('Đăng ký dịch vụ')?.id, frequency: 'monthly', day_of_month: 14 });
R({ name: 'Gym California', type: 'expense', amount: 850_000, account_id: acc.cc, category_id: categoryByName('Sức khỏe')?.id, frequency: 'monthly', day_of_month: 20 });
R({ name: 'Bảo hiểm nhân thọ', type: 'expense', amount: 2_100_000, account_id: acc.vcb, category_id: categoryByName('Bảo hiểm')?.id, frequency: 'quarterly', day_of_month: 18 });
R({ name: 'Trả góp xe Mazda', type: 'expense', amount: 8_900_000, account_id: acc.vcb, category_id: categoryByName('Trả nợ')?.id, debt_id: carLoan, frequency: 'monthly', day_of_month: 15 });

// ---- lịch sử 6 tháng giao dịch -------------------------------------------
let seed = 20240915;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const around = (base, spread) => Math.round((base + (rnd() - 0.5) * 2 * spread) / 1000) * 1000;

const FOOD = ['Cơm tấm Ba Ghiền', 'Bún bò Gánh', 'Highlands Coffee', 'The Coffee House', 'Phúc Long', 'GrabFood', 'ShopeeFood', 'Bếp nhà', 'Lẩu Kichi Kichi', 'Cơm văn phòng'];
const SHOP = ['Bách Hoá Xanh', 'Co.opmart', 'Shopee', 'Lazada', 'Uniqlo', 'Nhà thuốc Long Châu', 'Circle K'];
const MOVE = ['Grab Bike', 'Grab Car', 'Đổ xăng Petrolimex', 'Gửi xe', 'Be', 'Vé xe buýt'];
const FUN = ['CGV Cinema', 'Karaoke ICOOL', 'Steam', 'Sách Fahasa', 'Bida', 'Concert'];

const months = lastMonths(6);
// Dữ liệu mẫu không được ghi vào tương lai: "Gửi bố mẹ 27/09" khi hôm nay là
// 03/09 làm dự báo dòng tiền và số tiền an toàn để tiêu sai ngay từ lúc mở app.
const notFuture = (data) => (String(data.date || today()) <= today());
const tx = (data) => (notFuture(data) ? createTransaction(data) : null);
const trade = (data) => (notFuture(data) ? recordTrade(data) : null);
const alloc = (data) => (notFuture(data) ? allocateIncome(data) : null);

for (const mk of months) {
  const first = monthStart(mk);
  const isCurrent = mk === monthKey();
  const dayLimit = isCurrent ? Number(today().slice(8, 10)) : 30;

  // thu nhập
  tx({ type: 'income', amount: around(31_200_000, 400_000), date: addDays(first, 4), account_id: acc.tcb, merchant: 'ABC TECH LUONG', note: `Lương tháng ${mk}`, source: 'sms', category_id: categoryByName('Lương', 'income')?.id });
  tx({ type: 'income', amount: 8_300_000, date: addDays(first, 9), account_id: acc.vcb, merchant: 'TIEN THUE NHA', note: 'Tiền thuê căn hộ Bình Thạnh', source: 'sms', category_id: categoryByName('Cho thuê BĐS', 'income')?.id });
  if (rnd() > 0.35) tx({ type: 'income', amount: around(5_400_000, 2_500_000), date: addDays(first, 17 + Math.floor(rnd() * 6)), account_id: acc.vcb, merchant: 'CK FREELANCE', note: 'Dự án freelance', source: 'sms', category_id: categoryByName('Freelance', 'income')?.id });

  // chi tiêu hàng ngày
  for (let d = 1; d <= dayLimit; d++) {
    const date = addDays(first, d - 1);
    const meals = rnd() > 0.25 ? 2 : 1;
    for (let i = 0; i < meals; i++) {
      const m = pick(FOOD);
      tx({ type: 'expense', amount: around(m.includes('Coffee') || m.includes('Phúc Long') ? 55_000 : 78_000, 35_000), date, account_id: pick([acc.momo, acc.cc, acc.vcb, acc.cash]), merchant: m, source: 'sms' });
    }
    if (rnd() > 0.55) tx({ type: 'expense', amount: around(45_000, 30_000), date, account_id: pick([acc.momo, acc.cash]), merchant: pick(MOVE), source: 'sms' });
    if (rnd() > 0.78) tx({ type: 'expense', amount: around(320_000, 250_000), date, account_id: pick([acc.cc, acc.vcb]), merchant: pick(SHOP), source: 'sms' });
    if (rnd() > 0.9) tx({ type: 'expense', amount: around(280_000, 180_000), date, account_id: pick([acc.cc, acc.momo]), merchant: pick(FUN), source: 'sms' });
    // rút tiền mặt để ví tiền mặt không bị âm
    if (d === 3 || d === 17) tx({ type: 'transfer', amount: 700_000, date, account_id: acc.vcb, counter_account_id: acc.cash, note: 'Rút ATM', source: 'sms' });
  }

  // các khoản lớn/bất thường
  if (rnd() > 0.6) tx({ type: 'expense', amount: around(4_500_000, 2_000_000), date: addDays(first, 12), account_id: acc.cc, merchant: 'Vietjet Air', note: 'Vé máy bay du lịch', source: 'sms' });
  if (rnd() > 0.75) tx({ type: 'expense', amount: around(2_800_000, 1_200_000), date: addDays(first, 21), account_id: acc.vcb, merchant: 'Bệnh viện Hoàn Mỹ', note: 'Khám sức khỏe', source: 'sms' });
  tx({ type: 'expense', amount: around(1_500_000, 500_000), date: addDays(first, 26), account_id: acc.vcb, merchant: 'Gửi bố mẹ', note: 'Biếu gia đình', source: 'manual' });

  // hoá đơn điện nước (khoản định kỳ dạng biến động -> ghi tay theo tháng)
  tx({ type: 'expense', amount: around(1_450_000, 400_000), date: addDays(first, 7), account_id: acc.vcb, merchant: 'EVN HCMC', note: 'Điện nước internet', category_id: categoryByName('Điện nước')?.id, source: 'sms' });

  // dòng tiền giữa các tài khoản: lương về TCB rồi toả đi
  tx({ type: 'transfer', amount: 14_000_000, date: addDays(first, 5), account_id: acc.tcb, counter_account_id: acc.vcb, note: 'Chuyển sang tài khoản chi tiêu', source: 'sms' });
  tx({ type: 'transfer', amount: 5_000_000, date: addDays(first, 5), account_id: acc.tcb, counter_account_id: acc.stock, note: 'Nạp tiền đầu tư định kỳ (DCA)', source: 'sms' });
  // mua chứng chỉ quỹ đều đặn hàng tháng bằng đúng số tiền vừa nạp
  const dcaPrice = around(66_000, 4_000);
  trade({ symbol: 'DCDS', side: 'buy', quantity: Math.round(5_000_000 / dcaPrice), price: dcaPrice, date: addDays(first, 6), account_id: acc.stock, note: 'Mua định kỳ DCDS' });
  tx({ type: 'transfer', amount: 7_000_000, date: addDays(first, 11), account_id: acc.tcb, counter_account_id: acc.cc, note: 'Thanh toán thẻ tín dụng', source: 'sms' });
  tx({ type: 'transfer', amount: 2_000_000, date: addDays(first, 1), account_id: acc.vcb, counter_account_id: acc.momo, note: 'Nạp ví MoMo', source: 'sms' });

  // ghi sổ tự động các khoản định kỳ cố định tới hết tháng này
  runDueRecurring(isCurrent ? today() : monthEnd(mk));

  if (!isCurrent) {
    tx({ type: 'transfer', amount: 5_000_000, date: addDays(first, 6), account_id: acc.tcb, counter_account_id: acc.sav2, note: 'Chuyển tiết kiệm định kỳ', source: 'manual' });
    alloc({ amount: 39_500_000, date: addDays(first, 5), note: `Phân bổ thu nhập ${mk}` });
    snapshot(monthStart(mk));
  }
}

// dư nợ thẻ tín dụng = số dư âm thật của tài khoản thẻ (tránh đếm nợ hai lần)
const ccDebt = get("SELECT id FROM debts WHERE type = 'credit_card'");
const ccBalance = Math.max(0, -get('SELECT balance FROM accounts WHERE id = ?', [acc.cc]).balance);
if (ccDebt) update('debts', ccDebt.id, { balance: ccBalance, principal: ccBalance });

recomputeFundBalances();
setPrice('DCDS', 69_800);
snapshot();
generateInsights();
setting('demo_seeded', new Date().toISOString());

const c = get('SELECT COUNT(*) c FROM transactions').c;
console.log(`[finmate] đã tạo dữ liệu mẫu: ${c} giao dịch, ${all('SELECT id FROM accounts').length} tài khoản, ${all('SELECT id FROM goals').length} mục tiêu.`);
console.log('[finmate] chạy `npm run dev` rồi mở http://localhost:5173');
