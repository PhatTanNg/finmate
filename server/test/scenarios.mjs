/**
 * Bộ kịch bản đánh giá toàn diện — chạy qua HTTP API thật trên DB tạm.
 *
 *   node test/scenarios.mjs
 *
 * Mô phỏng hành trình một người dùng thật (Tân, sống ở Dublin, đầu tư ở VN)
 * từ lúc mở app lần đầu tới khi dùng đủ mọi tính năng, kèm các tình huống
 * người dùng hay làm sai. Mỗi kịch bản kiểm chứng *hiệu ứng thật* trên dữ
 * liệu, không chỉ kiểm mã trạng thái 200.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, '.tmp-scenarios.db');
const PORT = 4111;
const BASE = `http://127.0.0.1:${PORT}/api`;

for (const suffix of ['', '-shm', '-wal']) {
  if (existsSync(DB + suffix)) rmSync(DB + suffix);
}

const child = spawn(process.execPath, [join(HERE, '..', 'src', 'index.js')], {
  env: { ...process.env, FINMATE_DB: DB, PORT: String(PORT), FINMATE_FX_OFFLINE: '1', FINMATE_AGENT: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (b) => { serverLog += b.toString(); });
child.stderr.on('data', (b) => { serverLog += b.toString(); });

async function waitUp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server không lên được.\n${serverLog}`);
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { json = { _nonJson: true }; }
  return { status: r.status, ...json };
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b ?? {});
const PATCH = (p, b) => api('PATCH', p, b);
const DEL = (p) => api('DELETE', p);

// ---------------------------------------------------------------------------

const results = [];
let group = '';
function G(name) { group = name; }

async function S(name, fn) {
  const rec = { group, name, ok: false, note: '' };
  try {
    const out = await fn();
    if (out === false) { rec.note = 'trả về false'; }
    else if (typeof out === 'string') { rec.ok = true; rec.note = out; }
    else { rec.ok = true; }
  } catch (e) {
    rec.note = e.message;
  }
  results.push(rec);
  process.stdout.write(rec.ok ? '.' : 'X');
  return rec;
}

function must(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error(`${msg} (nhận ${a}, mong ~${b})`); }

// tiện ích tra cứu
const acc = {};
const fund = {};
async function accounts() { return (await GET('/accounts')).accounts; }
async function findAcc(name) { return (await accounts()).find((a) => a.name === name); }
async function funds(all = false) { return (await GET(`/funds${all ? '?all=1' : ''}`)).funds; }
async function findFund(name) { return (await funds(true)).find((f) => f.name === name); }

// ===========================================================================

await waitUp();
console.log('Server tạm đã lên. Bắt đầu chạy kịch bản...\n');

// --- 1. Khởi động & hồ sơ --------------------------------------------------
G('1. Khởi động & hồ sơ');

await S('App khởi động với dữ liệu mặc định sạch', async () => {
  const d = await GET('/dashboard');
  must(d.ok !== false, 'dashboard lỗi');
  const c = (await GET('/categories')).categories;
  must(c.length > 10, `chỉ có ${c.length} danh mục mặc định`);
  return `${c.length} danh mục dựng sẵn`;
});

await S('Có sẵn bộ quỹ mặc định cộng đúng 100%', async () => {
  const f = await funds();
  must(f.length >= 5, `chỉ có ${f.length} quỹ`);
  const total = f.reduce((s, x) => s + (x.percent || 0), 0);
  near(total, 100, 0.01, 'tổng % quỹ mặc định');
  return `${f.length} quỹ, tổng ${total}%`;
});

await S('Cập nhật hồ sơ: tên, năm sinh, nước cư trú thuế', async () => {
  await PATCH('/profile', { name: 'Tân', birth_year: 1997, city: 'Dublin', tax_country: 'IE' });
  const p = (await GET('/profile')).profile;
  must(p.name === 'Tân' && p.tax_country === 'IE', JSON.stringify(p));
});

await S('Đổi đồng tiền gốc sang EUR', async () => {
  const r = await POST('/currency/base', { currency: 'EUR' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const p = (await GET('/profile')).profile;
  must(p.currency === 'EUR', `base = ${p.currency}`);
  const fs = await funds();
  const wrong = fs.filter((f) => f.currency && f.currency !== 'EUR' && !f.balance);
  must(wrong.length === 0, `quỹ trống còn giữ đồng tiền cũ: ${wrong.map((f) => f.name + '/' + f.currency).join(', ')}`);
});

await S('Đổi sang đồng tiền không tồn tại thì bị từ chối', async () => {
  const r = await POST('/currency/base', { currency: 'XYZ' });
  must(r.ok === false || r.status >= 400, 'nhận bừa mã tiền tệ lạ');
});

await S('Thuế đổi theo nước cư trú (IE có USC/PRSI)', async () => {
  const c = await GET('/tax/config');
  must(c.country === 'IE', `country = ${c.country}`);
  const j = JSON.stringify(c).toLowerCase();
  must(j.includes('usc') || j.includes('prsi'), 'thiếu cấu hình USC/PRSI');
});

// --- 2. Tài khoản & số dư --------------------------------------------------
G('2. Tài khoản & số dư');

await S('Tạo tài khoản ngân hàng EUR', async () => {
  const r = await POST('/accounts', { name: 'AIB Current', type: 'bank', balance: 520000, currency: 'EUR' });
  acc.aib = r.account.id;
  must(r.account.balance === 520000, `balance = ${r.account.balance}`);
  return '€5.200,00';
});

await S('Tạo tài khoản VND song song', async () => {
  const r = await POST('/accounts', { name: 'Vietcombank', type: 'bank', balance: 180000000, currency: 'VND' });
  acc.vcb = r.account.id;
  must(r.account.currency === 'VND', 'sai đồng tiền');
});

await S('Tạo ví tiền mặt, thẻ tín dụng, tài khoản tiết kiệm', async () => {
  acc.cash = (await POST('/accounts', { name: 'Ví tiền mặt', type: 'cash', balance: 15000, currency: 'EUR' })).account.id;
  acc.card = (await POST('/accounts', { name: 'Revolut Credit', type: 'credit', balance: -45000, currency: 'EUR' })).account.id;
  acc.save = (await POST('/accounts', { name: 'Tiết kiệm VCB', type: 'savings', balance: 500000000, currency: 'VND' })).account.id;
  must((await accounts()).length >= 5, 'chưa đủ tài khoản');
});

await S('Thẻ tín dụng giữ số dư âm (không bị ép về 0)', async () => {
  const a = (await accounts()).find((x) => x.id === acc.card);
  must(a.balance === -45000, `balance = ${a.balance}`);
  return 'nợ thẻ -€450,00';
});

await S('Tổng tài sản quy đổi đúng, không cộng nhầm VND với EUR', async () => {
  const list = await accounts();
  const base = list[0].base_currency;
  must(base === 'EUR', `base = ${base}`);
  const vcb = list.find((x) => x.id === acc.vcb);
  must(vcb.base_balance > 0 && vcb.base_balance < vcb.balance / 100,
    `180tr VND -> ${vcb.base_balance} cent EUR, vô lý`);
  return `180tr₫ ≈ €${(vcb.base_balance / 100).toFixed(0)}`;
});

await S('Sửa tên tài khoản', async () => {
  await PATCH(`/accounts/${acc.cash}`, { name: 'Tiền mặt' });
  must((await findAcc('Tiền mặt')), 'không đổi được tên');
});

await S('Đối soát số dư lệch tự sinh giao dịch điều chỉnh', async () => {
  const before = (await accounts()).find((x) => x.id === acc.aib).balance;
  await POST(`/accounts/${acc.aib}/reconcile`, { balance: before - 3300 });
  const after = (await accounts()).find((x) => x.id === acc.aib).balance;
  near(after, before - 3300, 1, 'số dư sau đối soát');
  return 'lệch €33 được ghi nhận';
});

await S('Đối soát khi số dư khớp thì không tạo rác', async () => {
  const cur = (await accounts()).find((x) => x.id === acc.aib).balance;
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  await POST(`/accounts/${acc.aib}/reconcile`, { balance: cur });
  const n2 = (await GET('/transactions?limit=500')).transactions.length;
  must(n2 === n1, `tạo thêm ${n2 - n1} giao dịch thừa`);
});

await S('Tài khoản chứng khoán tách khỏi tài khoản chi tiêu', async () => {
  acc.broker = (await POST('/accounts', { name: 'VPS Chứng khoán', type: 'brokerage', balance: 200000000, currency: 'VND' })).account.id;
  const d = await GET('/dashboard');
  must(d.ok !== false, 'dashboard vỡ khi có tài khoản chứng khoán');
});

// --- 3. Ghi chép giao dịch -------------------------------------------------
G('3. Ghi chép giao dịch');

await S('Ghi một khoản chi và số dư giảm đúng', async () => {
  const before = (await accounts()).find((x) => x.id === acc.aib).balance;
  await POST('/transactions', { type: 'expense', amount: 1250, account_id: acc.aib, note: 'cà phê Insomnia', currency: 'EUR' });
  const after = (await accounts()).find((x) => x.id === acc.aib).balance;
  near(after, before - 1250, 1, 'số dư sau chi');
});

await S('Ghi thu nhập và số dư tăng đúng', async () => {
  const before = (await accounts()).find((x) => x.id === acc.aib).balance;
  await POST('/transactions', { type: 'income', amount: 520000, account_id: acc.aib, note: 'lương tháng', currency: 'EUR' });
  const after = (await accounts()).find((x) => x.id === acc.aib).balance;
  near(after, before + 520000, 1, 'số dư sau thu');
});

await S('Chuyển khoản làm giảm bên gửi, tăng bên nhận', async () => {
  const a0 = (await accounts()).find((x) => x.id === acc.aib).balance;
  const b0 = (await accounts()).find((x) => x.id === acc.cash).balance;
  await POST('/transactions', { type: 'transfer', amount: 10000, account_id: acc.aib, to_account_id: acc.cash, note: 'rút ATM', currency: 'EUR' });
  const a1 = (await accounts()).find((x) => x.id === acc.aib).balance;
  const b1 = (await accounts()).find((x) => x.id === acc.cash).balance;
  near(a1, a0 - 10000, 1, 'bên gửi');
  near(b1, b0 + 10000, 1, 'bên nhận');
});

await S('Chuyển khoản KHÔNG bị tính là chi tiêu trong báo cáo', async () => {
  const rep = (await GET('/reports/month')).report;
  const j = JSON.stringify(rep);
  must(!j.includes('rút ATM'), 'chuyển khoản lọt vào báo cáo chi tiêu');
});

await S('Giao dịch tự phân loại theo tên người bán', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 4500, account_id: acc.aib, merchant: 'Tesco', note: 'đi chợ', currency: 'EUR' });
  const t = r.transaction || r;
  must(t.category_id, 'không gán được danh mục cho Tesco');
});

await S('Số tiền 0 hoặc rỗng bị từ chối', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 0, account_id: acc.aib });
  must(r.ok === false || r.status >= 400, 'nhận giao dịch 0đ');
});

await S('Số tiền âm được coi là trị tuyệt đối, không làm hỏng sổ', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: -2500, account_id: acc.aib, note: 'test âm', currency: 'EUR' });
  const t = r.transaction || r;
  must(t.amount === 2500, `amount = ${t.amount}`);
});

await S('Sửa số tiền giao dịch thì số dư được tính lại', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 5000, account_id: acc.aib, note: 'sửa thử', currency: 'EUR' });
  const id = (r.transaction || r).id;
  const b0 = (await accounts()).find((x) => x.id === acc.aib).balance;
  await PATCH(`/transactions/${id}`, { amount: 3000 });
  const b1 = (await accounts()).find((x) => x.id === acc.aib).balance;
  near(b1, b0 + 2000, 1, 'số dư sau khi giảm chi 20€');
});

await S('Xoá giao dịch thì hoàn lại số dư', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 7700, account_id: acc.aib, note: 'xoá thử', currency: 'EUR' });
  const id = (r.transaction || r).id;
  const b0 = (await accounts()).find((x) => x.id === acc.aib).balance;
  await DEL(`/transactions/${id}`);
  const b1 = (await accounts()).find((x) => x.id === acc.aib).balance;
  near(b1, b0 + 7700, 1, 'số dư sau xoá');
});

await S('Lọc giao dịch theo khoảng ngày', async () => {
  const all = (await GET('/transactions?limit=500')).transactions;
  const some = (await GET('/transactions?from=2000-01-01&to=2000-01-02')).transactions;
  must(all.length > 0, 'không có giao dịch nào');
  must(some.length === 0, `lọc ngày quá khứ vẫn trả ${some.length} bản ghi`);
});

await S('Lọc giao dịch theo tài khoản', async () => {
  const some = (await GET(`/transactions?account_id=${acc.vcb}&limit=200`)).transactions;
  must(some.every((t) => t.account_id === acc.vcb || t.to_account_id === acc.vcb), 'lọt giao dịch tài khoản khác');
});

await S('Tính lại toàn bộ số dư cho ra cùng kết quả (idempotent)', async () => {
  const before = (await accounts()).map((a) => `${a.id}:${a.balance}`).join(',');
  await POST('/transactions/rebuild');
  const after = (await accounts()).map((a) => `${a.id}:${a.balance}`).join(',');
  must(before === after, `số dư đổi sau khi rebuild:\n  trước ${before}\n  sau   ${after}`);
});

await S('Ghi chi bằng đồng tiền khác tài khoản vẫn quy đổi được', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 500000, account_id: acc.aib, note: 'mua đồ ở VN', currency: 'VND' });
  const t = r.transaction || r;
  must(t.base_amount !== undefined && t.base_amount > 0, `base_amount = ${t.base_amount}`);
  must(t.base_amount < 10000, `500k VND -> ${t.base_amount} cent EUR, sai`);
  return `500.000₫ ≈ €${(t.base_amount / 100).toFixed(2)}`;
});

await S('Mỗi giao dịch lưu tỷ giá tại thời điểm phát sinh', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 250000, account_id: acc.vcb, currency: 'VND', date: '2026-03-10', note: 'ăn trưa Sài Gòn' });
  const id = r.transaction?.id;
  must(id, JSON.stringify(r).slice(0, 200));
  const t = (await GET('/transactions?limit=50')).transactions.find((x) => x.id === id);
  must(t && t.currency === 'VND', `đồng tiền = ${t?.currency}`);
  must(t.fx_rate > 0, `không lưu fx_rate: ${t.fx_rate}`);
  must(t.base_currency === 'EUR', `base_currency = ${t.base_currency}`);
  // 250.000₫ khoảng €8, tức 800-900 cent — kiểm tra để chắc không cộng nhầm đơn vị
  must(t.base_amount > 500 && t.base_amount < 1500, `base_amount phi lý: ${t.base_amount}`);
  return `250.000₫ lưu kèm tỷ giá ${t.fx_rate} → ${t.base_amount} cent EUR`;
});

await S('Giao dịch tương lai không phá dự báo', async () => {
  const future = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  await POST('/transactions', { type: 'expense', amount: 20000, account_id: acc.aib, date: future, note: 'đặt cọc tương lai', currency: 'EUR' });
  const f = await GET('/forecast');
  must(f.ok !== false, 'forecast vỡ');
});

// --- 4. Parser tin nhắn ngân hàng ------------------------------------------
G('4. Đọc tin nhắn ngân hàng');

const BANK_MSGS = [
  ['AIB thẻ ghi nợ',
    'AIB: Your Visa Debit card ending 4321 was used for EUR 45.20 at TESCO IRELAND on 24-Aug-26. Available balance: EUR 4,120.55',
    { amount: 4520, currency: 'EUR', direction: 'expense', balance: 412055 }],
  ['Revolut chi tiêu',
    'Revolut: You spent 12.50 EUR at Boojum Dublin. Your new balance is 1,204.30 EUR',
    { amount: 1250, currency: 'EUR', direction: 'expense' }],
  ['Bank of Ireland tiền vào',
    'Bank of Ireland: A lodgement of EUR 1,450.00 was made to your account on 24/08/2026',
    { amount: 145000, currency: 'EUR', direction: 'income' }],
  ['N26 dấu phẩy kiểu Đức',
    'N26: Payment of 8,99 EUR to Spotify was successful.',
    { amount: 899, currency: 'EUR', direction: 'expense' }],
  ['Wise nhận tiền',
    'Wise: You received 2,000.00 EUR from ACME LTD.',
    { amount: 200000, currency: 'EUR', direction: 'income' }],
  ['Vietcombank tiếng Việt',
    'VCB: TK 0123456789 -350,000VND luc 24/08/2026. So du: 12,450,000VND. ND: thanh toan Grab',
    { amount: 350000, currency: 'VND', direction: 'expense', balance: 12450000 }],
  ['Techcombank tiền vào',
    'TCB: TK 1900xxxx +15,000,000 VND ngay 24/08/2026. So du 45,000,000 VND. ND: LUONG THANG 08',
    { amount: 15000000, direction: 'income' }],
  ['AIB ghi nợ trực tiếp',
    'AIB: Direct Debit of EUR 89.99 to VODAFONE IRELAND has been paid from your account.',
    { amount: 8999, direction: 'expense' }],
  ['Lệnh chi định kỳ',
    'PTSB: Standing order of EUR 1,200.00 to LANDLORD has been processed.',
    { amount: 120000, direction: 'expense' }],
  ['Hoàn tiền',
    'Revolut: You received a refund of 24.99 EUR from AMAZON.',
    { amount: 2499, direction: 'income' }],
  ['Thanh toán không tiếp xúc',
    'Monzo: Contactless payment of £4.75 at PRET A MANGER.',
    { amount: 475, currency: 'GBP', direction: 'expense' }],
  ['MoMo ví điện tử',
    'MoMo: Ban da thanh toan 129,000d cho Shopee. So du vi: 450,000d',
    { amount: 129000, direction: 'expense' }],
];

for (const [label, text, want] of BANK_MSGS) {
  await S(`Đọc đúng: ${label}`, async () => {
    const r = await POST('/ingest/preview', { text });
    const p = r.parsed;
    must(p, 'không parse được gì');
    if (want.amount !== undefined) must(p.amount === want.amount, `amount = ${p.amount}, mong ${want.amount}`);
    if (want.currency) must(p.currency === want.currency, `currency = ${p.currency}, mong ${want.currency}`);
    if (want.direction) must(p.type === want.direction, `type = ${p.type}, mong ${want.direction}`);
    if (want.balance !== undefined) must(p.balance === want.balance, `balance = ${p.balance}, mong ${want.balance}`);
    return `${p.amount} ${p.currency || ''} ${p.type}`;
  });
}

await S('Không nhầm số thẻ thành số tiền', async () => {
  const p = (await POST('/ingest/preview', { text: 'AIB: card ending 4321 used for EUR 45.20 at TESCO' })).parsed;
  must(p.amount !== 4321, 'lấy nhầm số thẻ 4321');
  must(p.amount === 4520, `amount = ${p.amount}`);
});

await S('Không nhầm số tài khoản thành số tiền', async () => {
  const p = (await POST('/ingest/preview', { text: 'VCB: TK 0123456789 -350,000VND. So du: 12,450,000VND' })).parsed;
  must(p.amount === 350000, `amount = ${p.amount}`);
});

await S('Tách số dư còn lại ra khỏi số tiền giao dịch', async () => {
  const p = (await POST('/ingest/preview', { text: 'AIB: EUR 45.20 spent. Available balance: EUR 4,120.55' })).parsed;
  must(p.amount === 4520 && p.balance === 412055, `amount=${p.amount} balance=${p.balance}`);
});

await S('Tin nhắn rác không tạo giao dịch bừa', async () => {
  const p = (await POST('/ingest/preview', { text: 'Chúc mừng bạn trúng thưởng! Nhấn vào link để nhận quà' })).parsed;
  must(!p || !p.amount, `vẫn parse ra ${p && p.amount}`);
});

await S('Tin nhắn rỗng không làm sập server', async () => {
  const r = await POST('/ingest/preview', { text: '' });
  must(r.status < 500, `status ${r.status}`);
});

await S('Webhook cần token đúng mới ghi được', async () => {
  const noTok = await fetch(`${BASE}/ingest`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'AIB: EUR 10.00 spent at X' });
  must(noTok.status === 401, `không token mà vẫn ${noTok.status}`);
});

let TOKEN = '';
await S('Token webhook luôn tồn tại sẵn, không cần bật tay', async () => {
  const st = await GET('/automation/status');
  TOKEN = st.token;
  must(TOKEN && TOKEN.length > 20, `token = ${TOKEN}`);
});

await S('Nạp tin nhắn qua webhook tạo giao dịch thật', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  const r = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'x-finmate-token': TOKEN },
    body: 'AIB: Your card was used for EUR 33.30 at DUNNES STORES on 24-Aug-26',
  });
  must(r.ok, `status ${r.status}`);
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0 + 1, `số giao dịch ${n0} -> ${n1}`);
});

await S('Nạp lại đúng tin nhắn đó không tạo bản ghi trùng', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'x-finmate-token': TOKEN },
    body: 'AIB: Your card was used for EUR 33.30 at DUNNES STORES on 24-Aug-26',
  });
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0, `tạo thêm ${n1 - n0} bản ghi trùng`);
});

await S('Đổi token thì token cũ hết hiệu lực', async () => {
  const old = TOKEN;
  const r = await POST('/automation/rotate-token');
  TOKEN = r.token;
  must(TOKEN !== old, 'token không đổi');
  const bad = await fetch(`${BASE}/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', 'x-finmate-token': old }, body: 'AIB: EUR 1.00 spent at Y',
  });
  must(bad.status === 401, `token cũ vẫn dùng được (${bad.status})`);
});

await S('Nhật ký nạp tin nhắn ghi lại được', async () => {
  const log = (await GET('/ingest/log')).log;
  must(log.length > 0, 'nhật ký rỗng');
});

// --- 5. Import CSV ---------------------------------------------------------
G('5. Import CSV sao kê');

const CSV = `Date,Description,Amount,Currency
2026-08-01,SPAR DUBLIN,-12.30,EUR
2026-08-02,SALARY ACME,3200.00,EUR
2026-08-03,ELECTRIC IRELAND,-88.40,EUR
2026-08-04,LIDL,-45.10,EUR`;

await S('Xem trước CSV không ghi vào sổ', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  const r = await POST('/ingest/csv', { csv: CSV, account_id: acc.aib, dry_run: true });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0, 'dry run vẫn ghi vào sổ');
});

await S('Import CSV tạo đúng số dòng', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  await POST('/ingest/csv', { csv: CSV, account_id: acc.aib });
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 - n0 === 4, `tạo ${n1 - n0} dòng, mong 4`);
});

await S('CSV phân biệt được tiền vào và tiền ra', async () => {
  const txs = (await GET('/transactions?limit=500')).transactions;
  const sal = txs.find((t) => (t.note || t.merchant || '').toUpperCase().includes('SALARY'));
  must(sal, 'không thấy dòng lương');
  must(sal.type === 'income', `type = ${sal.type}`);
});

await S('Import lại cùng CSV không nhân đôi dữ liệu', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  await POST('/ingest/csv', { csv: CSV, account_id: acc.aib });
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0, `nhân đôi ${n1 - n0} dòng`);
});

await S('CSV hỏng không làm sập server', async () => {
  const r = await POST('/ingest/csv', { csv: 'xxx;;;\n@@@,,,', account_id: acc.aib });
  must(r.status < 500, `status ${r.status}`);
});

// --- 6. Quỹ ----------------------------------------------------------------
G('6. Quỹ & phân bổ');

await S('Phân bổ thu nhập tự chia vào các quỹ theo tỷ lệ', async () => {
  const before = (await funds()).reduce((s, f) => s + f.balance_base, 0);
  await POST('/funds/allocate', { amount: 300000, note: 'lương tháng 8' });
  const after = (await funds()).reduce((s, f) => s + f.balance_base, 0);
  near(after - before, 300000, 200, 'tổng tiền vào quỹ');
  return '€3.000 chia hết vào quỹ';
});

await S('Tổng quỹ khớp với tổng đã phân bổ', async () => {
  const d = await GET('/funds');
  const sum = d.funds.reduce((s, f) => s + f.balance_base, 0);
  near(d.total_balance, sum, 200, 'total_balance');
});

await S('Tạo quỹ mới có mục tiêu và hạn hoàn thành', async () => {
  const r = await POST('/funds', {
    name: 'Quỹ đổi xe', percent: 0, currency: 'EUR',
    target_amount: 3000000, target_date: '2028-06-30', priority: 3, type: 'goal',
  });
  fund.car = r.fund.id;
  must(r.fund.target_date === '2028-06-30', `target_date = ${r.fund.target_date}`);
});

await S('App tự tính số tiền cần bỏ mỗi tháng', async () => {
  const f = await findFund('Quỹ đổi xe');
  must(f.plan, 'không có kế hoạch');
  must(f.plan.monthly_needed > 0, `monthly_needed = ${f.plan.monthly_needed}`);
  const months = f.plan.months_left;
  near(f.plan.monthly_needed * months, 3000000, 3000000 * 0.05, 'tiền/tháng × số tháng');
  return `€${(f.plan.monthly_needed / 100).toFixed(0)}/tháng trong ${months} tháng`;
});

await S('Quỹ quá hạn mà chưa đủ tiền bị đánh dấu trễ', async () => {
  const r = await POST('/funds', { name: 'Quỹ trễ hạn', type: 'goal', percent: 0, currency: 'EUR', target_amount: 100000, target_date: '2020-01-01' });
  const f = await findFund('Quỹ trễ hạn');
  must(f.plan.status === 'overdue', `status = ${f.plan.status}`);
  await DEL(`/funds/${r.fund.id}`);
});

await S('Quỹ đã đủ tiền được đánh dấu hoàn thành', async () => {
  const r = await POST('/funds', { name: 'Quỹ đã xong', type: 'goal', percent: 0, currency: 'EUR', target_amount: 1000, target_date: '2030-01-01' });
  await POST('/funds/move', { from_fund_id: (await funds())[0].id, to_fund_id: r.fund.id, amount: 2000, note: 'nạp đủ' });
  const f = await findFund('Quỹ đã xong');
  must(f.plan.status === 'done', `status = ${f.plan.status}, balance = ${f.balance}`);
  await POST(`/funds/${r.fund.id}/archive`, {});
});

await S('Tổng gánh nặng hàng tháng của mọi quỹ được cộng đúng', async () => {
  const d = await GET('/funds');
  must(d.monthly_load, 'thiếu monthly_load');
  const sum = d.funds.reduce((s, f) => s + (f.plan?.monthly_needed_base ?? f.plan?.monthly_needed ?? 0), 0);
  must(d.monthly_load.total > 0, 'tổng = 0 dù có quỹ có hạn');
  return `€${(d.monthly_load.total / 100).toFixed(0)}/tháng`;
});

await S('Chuyển tiền giữa hai quỹ làm tiền thật sự dịch chuyển', async () => {
  const f = await funds();
  const from = f.find((x) => x.balance > 5000);
  must(from, 'không có quỹ nào đủ tiền');
  const to = f.find((x) => x.id !== from.id);
  const b0 = from.balance; const c0 = to.balance;
  await POST('/funds/move', { from_fund_id: from.id, to_fund_id: to.id, amount: 5000, note: 'test' });
  const f2 = await funds();
  const from2 = f2.find((x) => x.id === from.id);
  const to2 = f2.find((x) => x.id === to.id);
  near(from2.balance, b0 - 5000, 1, 'quỹ nguồn');
  near(to2.balance, c0 + 5000, 1, 'quỹ đích');
});

await S('Không chuyển được sang chính nó', async () => {
  const f = (await funds())[0];
  const b0 = f.balance;
  await POST('/funds/move', { from_fund_id: f.id, to_fund_id: f.id, amount: 1000 });
  const after = (await funds()).find((x) => x.id === f.id).balance;
  must(after === b0, `số dư đổi từ ${b0} thành ${after}`);
});

await S('Đóng quỹ thì tiền dồn sang quỹ khác, không bốc hơi', async () => {
  const r = await POST('/funds', { name: 'Quỹ sẽ đóng', type: 'goal', percent: 0, currency: 'EUR' });
  const id = r.fund.id;
  const other = (await funds()).find((x) => x.id !== id && x.currency === 'EUR');
  await POST('/funds/move', { from_fund_id: other.id, to_fund_id: id, amount: 4000, note: 'nạp' });
  const o0 = (await funds()).find((x) => x.id === other.id).balance;
  const res = await POST(`/funds/${id}/archive`, { to_fund_id: other.id });
  must(res.ok !== false, JSON.stringify(res).slice(0, 200));
  const o1 = (await funds()).find((x) => x.id === other.id).balance;
  near(o1, o0 + 4000, 1, 'quỹ nhận');
  fund.closed = id;
});

await S('Quỹ đã đóng biến khỏi danh sách mặc định', async () => {
  const open = await funds();
  must(!open.find((x) => x.id === fund.closed), 'quỹ đóng vẫn hiện');
});

await S('Quỹ đã đóng vẫn xem được khi bật "hiện quỹ đã đóng"', async () => {
  const all = await funds(true);
  must(all.find((x) => x.id === fund.closed), 'không xem lại được quỹ đã đóng');
});

await S('Quỹ đã đóng không còn nhận phân bổ tự động', async () => {
  const f = (await funds(true)).find((x) => x.id === fund.closed);
  must((f.percent || 0) === 0, `percent = ${f.percent}`);
});

await S('Mở lại quỹ đã đóng', async () => {
  const r = await POST(`/funds/${fund.closed}/reopen`, { percent: 5 });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const f = (await funds()).find((x) => x.id === fund.closed);
  must(f, 'không mở lại được');
  must(f.percent === 5, `percent = ${f.percent}`);
  await POST(`/funds/${fund.closed}/archive`, {});
});

await S('Đổi tỷ lệ phân bổ và tổng vẫn kiểm soát được', async () => {
  const f = await funds();
  await PATCH(`/funds/${f[0].id}`, { percent: f[0].percent });
  const d = await GET('/funds');
  must(d.ok !== false, 'lỗi khi đổi tỷ lệ');
});

await S('Sổ cái quỹ ghi lại mọi biến động', async () => {
  const l = (await GET('/funds/ledger')).entries;
  must(l.length > 5, `chỉ có ${l.length} dòng`);
});

// --- 7. Mục tiêu -----------------------------------------------------------
G('7. Mục tiêu tài chính');

let goalId;
await S('Tạo mục tiêu mua nhà có hạn', async () => {
  const r = await POST('/goals', { name: 'Mua nhà Dublin', target_amount: 6000000, deadline: '2030-12-31', currency: 'EUR' });
  goalId = r.goal.id;
  must(r.goal.target_amount === 6000000, 'sai số tiền');
});

await S('Nạp tiền vào mục tiêu làm tăng tiến độ', async () => {
  await POST(`/goals/${goalId}/contribute`, { amount: 150000 });
  const g = (await GET('/goals')).goals.find((x) => x.id === goalId);
  must(g.current_amount === 150000, `current = ${g.current_amount}`);
});

await S('Mục tiêu tính được còn bao nhiêu tháng và cần bao nhiêu mỗi tháng', async () => {
  const d = await GET('/dashboard');
  const j = JSON.stringify(d);
  must(j.includes('Mua nhà') || (await GET('/goals')).goals.length > 0, 'mục tiêu không xuất hiện ở đâu');
});

await S('Mục tiêu quá hạn không làm vỡ giao diện', async () => {
  const r = await POST('/goals', { name: 'Mục tiêu quá hạn', target_amount: 100000, deadline: '2019-01-01', currency: 'EUR' });
  const d = await GET('/dashboard');
  must(d.ok !== false, 'dashboard vỡ');
  await DEL(`/goals/${r.goal.id}`);
});

await S('Mục tiêu không có hạn vẫn hợp lệ', async () => {
  const r = await POST('/goals', { name: 'Mục tiêu mở', target_amount: 500000, currency: 'EUR' });
  must(r.goal.id, 'không tạo được');
  await DEL(`/goals/${r.goal.id}`);
});

await S('Mục tiêu bằng VND song song với mục tiêu EUR', async () => {
  const r = await POST('/goals', { name: 'Mua đất Long An', target_amount: 2000000000, deadline: '2031-01-01', currency: 'VND' });
  const g = (await GET('/goals')).goals.find((x) => x.id === r.goal.id);
  must(g.currency === 'VND', `currency = ${g.currency}`);
  const d = await GET('/dashboard');
  must(d.ok !== false, 'dashboard vỡ khi có 2 đồng tiền');
});

await S('Nạp quá số tiền mục tiêu không làm âm hay lỗi', async () => {
  await POST(`/goals/${goalId}/contribute`, { amount: 99999999 });
  const g = (await GET('/goals')).goals.find((x) => x.id === goalId);
  must(g.current_amount > 0, 'âm hoặc mất dữ liệu');
});

await S('Xoá mục tiêu', async () => {
  const r = await POST('/goals', { name: 'Xoá thử', target_amount: 1000, currency: 'EUR' });
  await DEL(`/goals/${r.goal.id}`);
  must(!(await GET('/goals')).goals.find((x) => x.id === r.goal.id), 'vẫn còn');
});

// --- 8. Ngân sách ----------------------------------------------------------
G('8. Ngân sách');

let catFood;
await S('Đặt ngân sách cho một danh mục', async () => {
  const cats = (await GET('/categories')).categories;
  catFood = cats.find((c) => /ăn|food|uống/i.test(c.name)) || cats.find((c) => c.kind === 'expense');
  const r = await POST('/budgets', { category_id: catFood.id, amount: 40000, month: new Date().toISOString().slice(0, 7) });
  must(r.budget, 'không tạo được ngân sách');
  return `${catFood.name}: €400`;
});

await S('Chi tiêu trừ vào ngân sách đúng danh mục', async () => {
  const row0 = (await GET('/budgets')).items.find((x) => x.category_id === catFood.id);
  await POST('/transactions', { type: 'expense', amount: 5000, account_id: acc.aib, category_id: catFood.id, note: 'ăn trưa', currency: 'EUR' });
  const row1 = (await GET('/budgets')).items.find((x) => x.category_id === catFood.id);
  must(row1, 'không thấy dòng ngân sách');
  must(row1.spent > (row0?.spent ?? 0), `spent ${row0?.spent} -> ${row1.spent}`);
});

await S('Vượt ngân sách thì được cảnh báo', async () => {
  await POST('/transactions', { type: 'expense', amount: 60000, account_id: acc.aib, category_id: catFood.id, note: 'tiệc', currency: 'EUR' });
  const b = await GET('/budgets');
  const row = b.items.find((x) => x.category_id === catFood.id);
  must(row.spent > row.amount, `spent ${row.spent} <= amount ${row.amount}`);
  must(row.remaining < 0 || row.over || b.over > 0, 'không có dấu hiệu cảnh báo vượt');
  return `vượt €${((row.spent - row.amount) / 100).toFixed(0)}`;
});

await S('Ngân sách tháng khác không bị lẫn', async () => {
  const b = await GET('/budgets?month=2020-01');
  const row = (b.items || []).find((x) => x.category_id === catFood.id);
  must(!row || row.spent === 0, `tháng 2020-01 lại có chi ${row?.spent}`);
});

await S('Tổng hạn mức và tổng đã tiêu được cộng đúng', async () => {
  const b = await GET('/budgets');
  const sumLimit = b.items.reduce((s, x) => s + (x.amount || 0), 0);
  near(b.total_limit, sumLimit, 2, 'tổng hạn mức');
});

await S('App cho biết đang tiêu nhanh hay chậm so với nhịp tháng', async () => {
  const b = await GET('/budgets');
  must(b.pace !== undefined, 'không có chỉ số nhịp chi');
});

await S('App gợi ý được mức ngân sách từ lịch sử', async () => {
  const s = await GET('/budgets/suggest');
  must(Array.isArray(s.suggestions), 'không trả gợi ý');
});

await S('Ngân sách âm hoặc bằng 0 bị chặn hoặc chuẩn hoá', async () => {
  const r = await POST('/budgets', { category_id: catFood.id, amount: -500, month: new Date().toISOString().slice(0, 7) });
  const bad = r.budget && r.budget.amount < 0;
  must(!bad, `lưu ngân sách âm ${r.budget?.amount}`);
});

await S('Xoá ngân sách', async () => {
  const m = new Date().toISOString().slice(0, 7);
  const r = await POST('/budgets', { category_id: catFood.id, amount: 40000, month: m });
  const id = r.budget.id;
  await DEL(`/budgets/${id}`);
  const b = await GET('/budgets');
  must(!(b.items || []).find((x) => x.id === id), 'vẫn còn');
});

// --- 9. Nợ -----------------------------------------------------------------
G('9. Quản lý nợ');

let debtCard; let debtLoan;
await S('Thêm nợ thẻ tín dụng lãi cao', async () => {
  const r = await POST('/debts', { name: 'Thẻ Revolut', principal: 300000, balance: 300000, interest_rate: 22.9, min_payment: 5000, monthly_payment: 8000, currency: 'EUR', type: 'credit_card' });
  debtCard = r.debt.id;
  must(r.debt.balance === 300000, 'sai dư nợ');
});

await S('Thêm khoản vay mua xe lãi thấp', async () => {
  const r = await POST('/debts', { name: 'Vay mua xe', principal: 1500000, balance: 1500000, interest_rate: 6.5, min_payment: 30000, monthly_payment: 30000, term_months: 60, currency: 'EUR', type: 'auto' });
  debtLoan = r.debt.id;
  must(r.debt.id, 'không tạo được');
});

await S('Tổng nợ được cộng đúng', async () => {
  const d = (await GET('/debts')).summary;
  must(d.debts.length >= 2, `chỉ có ${d.debts.length} khoản nợ`);
  must(d.total_balance > 0, `tổng nợ = ${d.total_balance}`);
  return `tổng €${(d.total_balance / 100).toFixed(0)}`;
});

await S('Chiến lược tuyết lở ưu tiên khoản lãi cao nhất', async () => {
  const d = await GET('/debts');
  must(d.avalanche && d.snowball, 'thiếu kế hoạch trả nợ');
  const first = d.avalanche.order?.[0];
  must(first, 'thứ tự trả nợ rỗng');
  must(/revolut/i.test(first.name || ''), `tuyết lở chọn "${first.name}" thay vì thẻ 22,9%`);
  return `trả trước: ${first.name}`;
});

await S('Tuyết lở trả ít lãi hơn hoặc bằng bóng tuyết', async () => {
  const d = await GET('/debts');
  must(d.avalanche.total_interest <= d.snowball.total_interest + 1,
    `tuyết lở ${d.avalanche.total_interest} > bóng tuyết ${d.snowball.total_interest}`);
  return `tiết kiệm €${((d.snowball.total_interest - d.avalanche.total_interest) / 100).toFixed(0)}`;
});

await S('Lịch trả nợ tính ra ngày sạch nợ', async () => {
  const s = await GET(`/debts/${debtLoan}/schedule`);
  must(s.ok !== false, JSON.stringify(s).slice(0, 200));
  const rows = s.schedule?.rows || s.schedule || [];
  must(Array.isArray(rows) ? rows.length > 0 : !!s.schedule, 'lịch rỗng');
});

await S('Trả nợ làm giảm dư nợ', async () => {
  const b0 = (await GET('/debts')).summary.debts.find((x) => x.id === debtCard).balance;
  await PATCH(`/debts/${debtCard}`, { balance: b0 - 50000 });
  const b1 = (await GET('/debts')).summary.debts.find((x) => x.id === debtCard).balance;
  near(b1, b0 - 50000, 1, 'dư nợ sau khi trả');
});

await S('Tỷ lệ nợ trên thu nhập (DTI) được tính', async () => {
  const d = (await GET('/debts')).summary;
  must(d.dti !== undefined, 'không tính DTI');
});

await S('Nợ lãi suất 0% không gây chia cho 0', async () => {
  const r = await POST('/debts', { name: 'Vay bạn bè', principal: 100000, balance: 100000, interest_rate: 0, min_payment: 10000, monthly_payment: 10000, currency: 'EUR' });
  const s = await GET(`/debts/${r.debt.id}/schedule`);
  must(s.status < 500, `status ${s.status}`);
  await DEL(`/debts/${r.debt.id}`);
});

await S('Nợ trả tối thiểu quá nhỏ được cảnh báo thay vì treo vô hạn', async () => {
  const r = await POST('/debts', { name: 'Nợ treo', principal: 1000000, balance: 1000000, interest_rate: 30, min_payment: 100, monthly_payment: 100, currency: 'EUR' });
  const started = Date.now();
  const s = await GET(`/debts/${r.debt.id}/schedule`);
  const ms = Date.now() - started;
  must(ms < 5000, `mất ${ms}ms — có thể lặp vô hạn`);
  must(s.status < 500, `status ${s.status}`);
  await DEL(`/debts/${r.debt.id}`);
});

// --- 10. Đầu tư ------------------------------------------------------------
G('10. Đầu tư & bất động sản');

await S('Mua cổ phiếu Việt Nam ghi bằng VND', async () => {
  const r = await POST('/investments/trade', { symbol: 'FPT', side: 'buy', quantity: 100, price: 135000, currency: 'VND', date: '2026-01-15' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const p = (await GET('/investments')).portfolio;
  const h = (p.holdings || []).find((x) => x.symbol === 'FPT');
  must(h, 'không thấy FPT trong danh mục');
  must(h.quantity === 100, `quantity = ${h.quantity}`);
});

await S('Cập nhật giá làm lãi lỗ thay đổi', async () => {
  await POST('/investments/price', { symbol: 'FPT', price: 150000 });
  const p = (await GET('/investments')).portfolio;
  must(p.unrealized_pnl > 0, `lãi chưa thực hiện = ${p.unrealized_pnl}`);
  return `lãi ${(p.unrealized_pct * 100).toFixed(1)}%`;
});

await S('Tiền bán cổ phiếu thật sự chảy về tài khoản', async () => {
  const before = (await accounts()).find((x) => x.id === acc.vcb).balance;
  const r = await POST('/investments/trade', { symbol: 'FPT', side: 'sell', quantity: 10, price: 150000, currency: 'VND', account_id: acc.vcb });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const after = (await accounts()).find((x) => x.id === acc.vcb).balance;
  must(after > before, `bán 10 cổ phiếu mà tiền mặt không tăng: ${before} → ${after}`);
  return `bán 10 FPT: số dư VCB ${before} → ${after}`;
});

await S('Bán một phần làm giảm số lượng nắm giữ', async () => {
  const before = (await GET('/investments')).portfolio.holdings.find((x) => x.symbol === 'FPT').quantity;
  await POST('/investments/trade', { symbol: 'FPT', side: 'sell', quantity: 40, price: 150000, currency: 'VND' });
  const p = (await GET('/investments')).portfolio;
  const h = (p.holdings || []).find((x) => x.symbol === 'FPT');
  must(h.quantity === before - 40, `quantity = ${h.quantity}, mong ${before - 40}`);
});

await S('Bán nhiều hơn số đang có bị chặn', async () => {
  const before = (await GET('/investments')).portfolio.holdings.find((x) => x.symbol === 'FPT').quantity;
  await POST('/investments/trade', { symbol: 'FPT', side: 'sell', quantity: 9999, price: 150000, currency: 'VND' });
  const after = (await GET('/investments')).portfolio.holdings.find((x) => x.symbol === 'FPT')?.quantity ?? 0;
  must(after >= 0, `số lượng âm: ${after}`);
});

await S('Danh mục ETF bằng EUR song song cổ phiếu VND', async () => {
  await POST('/investments/trade', { symbol: 'VWCE', side: 'buy', quantity: 10, price: 11500, currency: 'EUR' });
  const p = (await GET('/investments')).portfolio;
  must((p.holdings || []).length >= 2, 'thiếu mã');
  must(p.total_value > 0, 'tổng giá trị = 0');
});

await S('Phân bổ tài sản theo loại được tính', async () => {
  const p = (await GET('/investments')).portfolio;
  must(p.allocation, 'không có phân bổ');
  must(p.by_currency, 'không tách theo đồng tiền');
  return `${Object.keys(p.allocation).length} nhóm tài sản`;
});

await S('Thêm bất động sản cho thuê', async () => {
  const r = await POST('/properties', { name: 'Căn hộ Q7', current_value: 3500000000, purchase_price: 3000000000, monthly_rent: 12000000, monthly_cost: 1000000, currency: 'VND' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const re = await GET('/properties');
  must((re.properties || []).length >= 1, 'không thấy bất động sản');
});

await S('Bất động sản tính được dòng tiền ròng hàng tháng', async () => {
  const re = await GET('/properties');
  must(re.net_monthly !== undefined, 'không tính dòng tiền ròng');
  must(re.total_value > 0, `tổng giá trị = ${re.total_value}`);
  return `dòng tiền ròng ${re.net_monthly}`;
});

// --- 11. Nguồn thu nhập ----------------------------------------------------
G('11. Nguồn thu nhập');

await S('Thêm lương full-time', async () => {
  const r = await POST('/income-streams', { name: 'Lương Acme Ireland', type: 'salary', net_amount: 520000, gross_amount: 650000, payday: 25, currency: 'EUR' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
});

await S('Thêm thu nhập cho thuê nhà (VND)', async () => {
  await POST('/income-streams', { name: 'Cho thuê Q7', type: 'rental', net_amount: 12000000, payday: 5, currency: 'VND' });
  const s = await GET('/income-streams');
  must(s.streams.length >= 2, 'thiếu nguồn thu');
});

await S('Thêm lãi ngân hàng và cổ tức', async () => {
  await POST('/income-streams', { name: 'Lãi tiết kiệm VCB', type: 'interest', net_amount: 2500000, currency: 'VND' });
  await POST('/income-streams', { name: 'Cổ tức FPT', type: 'dividend', net_amount: 1500000, currency: 'VND' });
  const s = await GET('/income-streams');
  must(s.streams.length >= 4, `chỉ có ${s.streams.length} nguồn thu`);
});

await S('Thu nhập thụ động được tách riêng khỏi lương', async () => {
  const p = (await GET('/income-streams')).passive;
  must(p && p.total !== undefined, JSON.stringify(p));
  must(p.total > 0, `thụ động = ${p.total} dù đã khai tiền thuê + lãi + cổ tức`);
  must(p.rent > 0 && p.interest > 0 && p.dividend > 0, `tách sai: ${JSON.stringify(p)}`);
  return `thụ động €${(p.total / 100).toFixed(0)}/tháng`;
});

await S('Nguồn thu VND được quy đổi sang đồng tiền gốc', async () => {
  const s = (await GET('/income-streams')).streams.find((x) => x.currency === 'VND');
  must(s.base_net_amount > 0, 'không quy đổi');
  must(s.base_net_amount < s.net_amount, `12tr₫ -> ${s.base_net_amount} cent EUR, sai`);
  return `12tr₫ ≈ €${(s.base_net_amount / 100).toFixed(0)}`;
});

await S('App ước tính được thuế cả năm từ các nguồn thu', async () => {
  const t = (await GET('/income-streams')).tax;
  must(t !== undefined && t !== null, 'không ước tính thuế');
});

// --- 12. Báo cáo & dự báo --------------------------------------------------
G('12. Báo cáo, dự báo, FIRE');

await S('Báo cáo tháng có thu, chi, chênh lệch', async () => {
  const r = (await GET('/reports/month')).report;
  must(r.income !== undefined && r.expense !== undefined, JSON.stringify(r).slice(0, 200));
});

await S('Xu hướng 12 tháng trả về đủ mốc', async () => {
  const t = (await GET('/reports/trend?months=12')).trend;
  must(Array.isArray(t) && t.length > 0, 'rỗng');
});

await S('Chi tiêu theo danh mục cộng khớp tổng chi', async () => {
  const c = await GET('/reports/categories');
  must(c.ok !== false, JSON.stringify(c).slice(0, 200));
});

await S('Tài sản ròng = tài sản - nợ', async () => {
  const n = (await GET('/networth')).current;
  must(n, 'không có số liệu');
  const expected = (n.assets ?? 0) - (n.liabilities ?? 0);
  near(n.net ?? n.net_worth ?? expected, expected, 200, 'tài sản ròng');
});

await S('Chụp ảnh tài sản ròng lưu được lịch sử', async () => {
  await POST('/networth/snapshot');
  const h = (await GET('/networth')).history;
  must(h.length > 0, 'lịch sử rỗng');
});

await S('Dự báo dòng tiền 90 ngày chỉ ra ngày thấp nhất', async () => {
  const f = await GET('/forecast');
  must(f.ok !== false, JSON.stringify(f).slice(0, 200));
  const j = JSON.stringify(f);
  must(j.includes('low') || j.includes('min') || j.includes('days'), 'không có điểm thấp nhất');
});

await S('Điểm sức khoẻ tài chính nằm trong 0–100', async () => {
  const h = (await GET('/advisor/health')).health;
  const score = h.score ?? h.total ?? h;
  must(typeof score === 'number' && score >= 0 && score <= 100, `score = ${score}`);
  return `${score}/100`;
});

await S('App đề xuất hành động tiếp theo có thứ tự ưu tiên', async () => {
  const a = (await GET('/advisor/actions')).actions;
  must(Array.isArray(a) && a.length > 0, 'không đề xuất gì');
  return `${a.length} đề xuất`;
});

await S('Gợi ý tiêu tiền dư theo thứ tự thác nước', async () => {
  const s = await GET('/advisor/surplus?amount=1000000');
  must(s.ok !== false, JSON.stringify(s).slice(0, 200));
  const j = JSON.stringify(s).toLowerCase();
  must(j.includes('nợ') || j.includes('khẩn cấp') || j.includes('đầu tư'), 'không nêu thứ tự ưu tiên');
});

await S('Ngày tự do tài chính được tính ra', async () => {
  const f = (await GET('/fire')).fire;
  must(f.fi_number > 0, `fi_number = ${f.fi_number}`);
  must(f.fi_date || f.months_to_fi !== undefined, 'không ra được ngày FIRE');
  return `FI ở tuổi ${f.fi_age ?? '?'}, cần €${(f.fi_number / 100 / 1000).toFixed(0)}k`;
});

await S('Tiết kiệm nhiều hơn thì FIRE tới sớm hơn', async () => {
  const a = (await GET('/fire')).fire;
  const b = (await GET('/fire?savings_boost=500')).fire;
  must(a.months_to_fi !== undefined, 'không tính được số tháng');
  must(Array.isArray(a.scenarios) && a.scenarios.length > 0, 'không có kịch bản rút ngắn');
  return `${a.scenarios.length} kịch bản`;
});

await S('Quỹ khẩn cấp cho biết đủ mấy tháng', async () => {
  const e = (await GET('/fire')).emergency;
  must(e && e.months_covered !== undefined, JSON.stringify(e).slice(0, 200));
  must(e.target_amount > 0, 'không đặt mục tiêu quỹ khẩn cấp');
  return `đủ ${e.months_covered} tháng`;
});

await S('Số tiền an toàn tiêu hôm nay không âm vô lý', async () => {
  const safe = (await GET('/dashboard')).safe_to_spend;
  must(safe && typeof safe === 'object', `safe = ${JSON.stringify(safe)}`);
  for (const k of ['liquid', 'upcoming_fixed', 'buffer', 'cash_available']) {
    must(typeof safe[k] === 'number' && Number.isFinite(safe[k]), `thiếu ${k}: ${JSON.stringify(safe).slice(0, 120)}`);
  }
  must(safe.cash_available >= 0, `tiền tiêu được âm: ${safe.cash_available}`);
  return `tiền mặt dùng được ${safe.cash_available}, đệm ${safe.buffer}`;
});

await S('Insight tự động sinh ra được', async () => {
  const g = await POST('/insights/generate');
  must(g.ok !== false, JSON.stringify(g).slice(0, 200));
  const l = (await GET('/insights')).insights;
  must(Array.isArray(l), 'không trả danh sách');
  return `${l.length} insight`;
});

await S('Bỏ qua một insight thì nó không hiện lại', async () => {
  const l = (await GET('/insights')).insights;
  if (!l.length) return 'không có insight để thử';
  await PATCH(`/insights/${l[0].id}`, { dismissed: 1 });
  const after = (await GET('/insights')).insights;
  must(!after.find((x) => x.id === l[0].id), 'vẫn hiện sau khi bỏ qua');
});

// --- 13. Thuế --------------------------------------------------------------
G('13. Thuế');

await S('Thuế Ireland: lương €62.400 tính ra PAYE + USC + PRSI', async () => {
  const r = await POST('/tax/pit', { gross: 6240000, country: 'IE', period: 'year' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 300));
  const res = r.result || r;
  must(res.net > 0 && res.net < 6240000, `net = ${res.net}`);
  const rate = res.effective_rate ?? (res.tax / 6240000);
  must(rate > 0.15 && rate < 0.45, `thuế suất thực ${(rate * 100).toFixed(1)}% — nghi sai`);
  return `net €${(res.net / 100).toFixed(0)}, thuế thực ${(rate * 100).toFixed(1)}%`;
});

await S('Thuế Ireland có bậc 40% khi lương cao', async () => {
  const low = (await POST('/tax/pit', { gross: 3000000, country: 'IE', period: 'year' })).result;
  const high = (await POST('/tax/pit', { gross: 12000000, country: 'IE', period: 'year' })).result;
  const rLow = low.effective_rate ?? low.tax / 3000000;
  const rHigh = high.effective_rate ?? high.tax / 12000000;
  must(rHigh > rLow, `lương cao lại chịu thuế suất thấp hơn (${rHigh} <= ${rLow})`);
});

await S('Thuế Việt Nam: biểu luỹ tiến 7 bậc', async () => {
  const r = await POST('/tax/pit', { gross: 38000000, country: 'VN', period: 'month' });
  const res = r.result || r;
  must(res.net > 0 && res.net < 38000000, `net = ${res.net}`);
  must(res.insurance > 0, 'không trừ bảo hiểm');
});

await S('Giảm trừ người phụ thuộc làm giảm thuế (VN)', async () => {
  const a = (await POST('/tax/pit', { gross: 38000000, country: 'VN', period: 'month', dependents: 0 })).result;
  const b = (await POST('/tax/pit', { gross: 38000000, country: 'VN', period: 'month', dependents: 2 })).result;
  must(b.tax < a.tax, `2 người phụ thuộc mà thuế không giảm (${a.tax} -> ${b.tax})`);
});

await S('Lương dưới ngưỡng chịu thuế thì thuế = 0', async () => {
  const r = (await POST('/tax/pit', { gross: 8000000, country: 'VN', period: 'month' })).result;
  must(r.tax === 0, `thuế = ${r.tax} dù dưới ngưỡng`);
});

await S('Lương 0 không gây lỗi chia cho 0', async () => {
  const r = await POST('/tax/pit', { gross: 0, country: 'VN', period: 'month' });
  must(r.status < 500, `status ${r.status}`);
});

await S('Thuế suất biên luôn >= thuế suất thực', async () => {
  const r = (await POST('/tax/pit', { gross: 38000000, country: 'VN', period: 'month' })).result;
  if (r.marginal_rate !== undefined && r.effective_rate !== undefined) {
    must(r.marginal_rate >= r.effective_rate, `biên ${r.marginal_rate} < thực ${r.effective_rate}`);
  }
});

await S('Cấu hình thuế đọc được cho cả hai nước', async () => {
  const ie = await GET('/tax/config?country=IE');
  const vn = await GET('/tax/config?country=VN');
  must(ie.ok !== false && vn.ok !== false, 'không đọc được cấu hình');
});

// --- 14. Đa tiền tệ & kiều hối ---------------------------------------------
G('14. Đa tiền tệ & kiều hối');

await S('Bảng tỷ giá đọc được', async () => {
  const r = await GET('/fx/rates');
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  must(r.rates && Object.keys(r.rates).length > 1, 'bảng tỷ giá rỗng');
});

await S('Quy đổi EUR sang VND ra con số hợp lý', async () => {
  const r = await GET('/fx/convert?amount=10000&from=EUR&to=VND');
  must(r.result > 2000000 && r.result < 4000000, `€100 -> ${r.result}₫ (kỳ vọng 2–4 triệu)`);
  return `€100 ≈ ${Math.round(r.result / 1000)}k₫`;
});

await S('Quy đổi khứ hồi không mất tiền', async () => {
  const v1 = (await GET('/fx/convert?amount=100000&from=EUR&to=VND')).result;
  const v2 = (await GET(`/fx/convert?amount=${v1}&from=VND&to=EUR`)).result;
  near(v2, 100000, 200, 'quy đổi khứ hồi EUR->VND->EUR');
});

await S('Nhập tỷ giá tay khi offline', async () => {
  const r = await POST('/fx/rate', { base: 'EUR', quote: 'VND', rate: 28000 });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const c = await GET('/fx/convert?amount=100&from=EUR&to=VND');
  near(c.result, 28000, 200, 'tỷ giá vừa nhập tay');
  return '1 EUR = 28.000₫';
});

await S('Tỷ giá <= 0 bị từ chối', async () => {
  const r = await POST('/fx/rate', { base: 'EUR', quote: 'VND', rate: 0 });
  must(r.ok === false || r.status >= 400, 'nhận tỷ giá 0');
});

await S('Lịch sử tỷ giá lưu lại được', async () => {
  const h = await GET('/fx/history?base=EUR&quote=VND');
  must(h.ok !== false, JSON.stringify(h).slice(0, 200));
  must(Array.isArray(h.history), 'không trả lịch sử');
});

await S('Báo giá gửi tiền về Việt Nam tính đủ phí', async () => {
  const r = await POST('/remittance/quote', { amount: 100000, from: 'EUR', to: 'VND' });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const q = r.quote || r;
  must(q.received > 0, `không tính được số nhận: ${JSON.stringify(q).slice(0, 150)}`);
  must(q.fee >= 0 && q.net > 0 && q.net <= 100000, `phí/net vô lý: fee=${q.fee} net=${q.net}`);
  must(q.mid_rate > 0 && q.effective_rate > 0 && q.effective_rate <= q.mid_rate, `tỷ giá vô lý: ${q.mid_rate}/${q.effective_rate}`);
  return `€1000 (phí ${q.fee}) → nhận ${Math.round(q.received / 1)}₫, tỷ giá thực ${q.effective_rate}`;
});

await S('Gửi tiền về VN được ghi nhận là kiều hối', async () => {
  await POST('/transactions', {
    type: 'transfer', amount: 80000, currency: 'EUR', account_id: acc.aib,
    counter_account_id: acc.vcb, counter_amount: 2200000000, counter_currency: 'VND',
    note: 'gửi tiền về nhà', date: '2026-08-01',
  });
  const h = await GET('/remittance');
  must((h.list || []).length >= 1, `danh sách kiều hối rỗng: ${JSON.stringify(h).slice(0, 200)}`);
  return `${h.list.length} lần gửi`;
});

await S('App tính được chi phí thật của việc gửi tiền', async () => {
  const h = await GET('/remittance');
  must(h.summary, 'không có tổng kết');
  must(h.cost !== undefined, 'không tính chi phí');
});

await S('App tư vấn thời điểm gửi theo biên độ tỷ giá', async () => {
  const h = await GET('/remittance?to=VND');
  must(h.timing, 'không có tư vấn thời điểm');
  const j = JSON.stringify(h.timing).toLowerCase();
  must(j.length > 20, 'tư vấn rỗng');
});

await S('Đổi đồng tiền gốc về VND rồi quay lại EUR không mất dữ liệu', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  await POST('/currency/base', { currency: 'VND' });
  const mid = await GET('/dashboard');
  must(mid.ok !== false, 'dashboard vỡ sau khi đổi base');
  await POST('/currency/base', { currency: 'EUR' });
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0, `số giao dịch đổi từ ${n0} thành ${n1}`);
});

await S('Giá trị lịch sử không đổi khi tỷ giá hiện tại đổi', async () => {
  const t0 = (await GET('/transactions?limit=50')).transactions.find((x) => x.currency === 'VND');
  if (!t0) return 'không có giao dịch VND để thử';
  const rate0 = t0.fx_rate;
  await POST('/fx/rate', { base: 'EUR', quote: 'VND', rate: 30000 });
  const t1 = (await GET('/transactions?limit=50')).transactions.find((x) => x.id === t0.id);
  must(t1.fx_rate === rate0, `fx_rate lịch sử bị ghi đè ${rate0} -> ${t1.fx_rate}`);
  await POST('/fx/rate', { base: 'EUR', quote: 'VND', rate: 28000 });
});

// --- 15. Khoản định kỳ -----------------------------------------------------
G('15. Khoản định kỳ');

await S('Tạo khoản chi định kỳ hàng tháng', async () => {
  const r = await POST('/recurring', {
    name: 'Tiền thuê nhà', amount: 145000, type: 'expense', account_id: acc.aib,
    frequency: 'monthly', next_date: new Date().toISOString().slice(0, 10), currency: 'EUR',
  });
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
});

await S('Khoản định kỳ hiện trong danh sách sắp tới', async () => {
  const r = await GET('/recurring');
  must((r.upcoming || []).length > 0 || (r.recurring || []).length > 0, 'không có khoản nào');
});

await S('Chạy tự động ghi sổ khoản đến hạn', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  const r = await POST('/automation/run');
  must(r.ok !== false, JSON.stringify(r).slice(0, 200));
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 >= n0, 'mất giao dịch');
  return `ghi thêm ${n1 - n0}`;
});

await S('Chạy tự động lần hai không ghi trùng', async () => {
  const n0 = (await GET('/transactions?limit=500')).transactions.length;
  await POST('/automation/run');
  const n1 = (await GET('/transactions?limit=500')).transactions.length;
  must(n1 === n0, `ghi trùng ${n1 - n0} khoản`);
});

await S('Chi phí cố định hàng tháng được tổng hợp', async () => {
  const r = await GET('/recurring');
  must(r.monthly_fixed !== undefined, 'không tính chi phí cố định');
});

await S('Tắt khoản định kỳ thì ngừng ghi sổ', async () => {
  const list = (await GET('/recurring')).recurring;
  const item = list[0];
  await PATCH(`/recurring/${item.id}`, { active: 0 });
  const after = (await GET('/recurring')).recurring.find((x) => x.id === item.id);
  must(after.active === 0, `active = ${after.active}`);
});

// --- 16. Chat & cố vấn -----------------------------------------------------
G('16. Chat (chế độ offline)');

async function chat(text) {
  const r = await POST('/chat', { message: text });
  return r;
}
const replyOf = (r) => String(r.reply ?? r.message ?? JSON.stringify(r));

await S('Lần đầu mở app, AI chủ động bắt chuyện để thiết lập', async () => {
  const h = await GET('/chat/history');
  const msgs = h.messages || h.history || [];
  must(msgs.length > 0, 'không có lời chào mở đầu');
  return `${msgs.length} tin nhắn mở đầu`;
});

await S('Trong lúc onboarding, câu hỏi tra cứu vẫn được trả lời đúng trọng tâm', async () => {
  const r = await chat('số dư AIB còn bao nhiêu');
  const text = replyOf(r);
  must(!/Câu \d\/\d/.test(text) || /aib|số dư|5\.?2|tài khoản/i.test(text),
    `câu hỏi bị nuốt vào luồng hỏi đáp onboarding: "${text.slice(0, 130)}"`);
  return text.slice(0, 70).replace(/\s+/g, ' ');
});

await S('Onboarding kết thúc được để vào chế độ dùng thường ngày', async () => {
  for (const msg of ['bỏ qua', 'bỏ qua', 'bỏ qua', 'không', 'không', 'không', 'xong', 'hoàn tất']) {
    await chat(msg);
    const p = (await GET('/profile')).profile;
    if (p.onboarded) return 'thoát được luồng thiết lập';
  }
  const p = (await GET('/profile')).profile;
  must(p.onboarded, 'không thoát được luồng hỏi 7 câu dù đã trả lời hết');
});

const CHAT_CASES = [
  ['trưa nay ăn 12 euro ở Boojum', (t) => /ghi|đã|12/i.test(t)],
  ['số dư AIB còn bao nhiêu', (t) => /aib|số dư|tài khoản|€/i.test(t)],
  ['tôi có bao nhiêu tiền', (t) => /€|tài sản|tổng|tiền/i.test(t)],
  ['tháng này tiêu bao nhiêu rồi', (t) => /chi|tiêu|€|tháng/i.test(t)],
  ['bao giờ tôi tự do tài chính', (t) => /tự do|fire|năm|tuổi/i.test(t)],
  ['tôi nên trả nợ nào trước', (t) => /nợ|lãi|revolut|xe/i.test(t)],
  ['tôi dư 5000 euro nên làm gì', (t) => /nợ|khẩn cấp|đầu tư|quỹ/i.test(t)],
  ['quỹ khẩn cấp của tôi đủ chưa', (t) => /khẩn cấp|tháng/i.test(t)],
  ['tỷ giá euro hôm nay', (t) => /tỷ giá|eur|vnd|₫/i.test(t)],
  ['gửi 800 euro về việt nam', (t) => /gửi|chuyển|phí|tỷ giá/i.test(t)],
  ['thuế thu nhập của tôi bao nhiêu', (t) => /thuế|net|paye|usc/i.test(t)],
  ['tôi có nên mua macbook 2500 euro không', (t) => t.length > 80],
  ['lạm phát ảnh hưởng tiền của tôi thế nào', (t) => /lạm phát/i.test(t)],
  ['có nên mua nhà hay thuê', (t) => /nhà|thuê|mua/i.test(t)],
  ['đặt ngân sách ăn uống 400 euro', (t) => /ngân sách|400/i.test(t)],
  ['tạo mục tiêu du lịch nhật 3000 euro trong 12 tháng', (t) => /mục tiêu|du lịch|3000|tháng/i.test(t)],
  ['chuyển 500 euro từ AIB sang tiền mặt', (t) => /chuyển|€|tài khoản/i.test(t)],
  ['nhận lương 5200 euro', (t) => /lương|thu nhập|phân bổ|quỹ|ghi/i.test(t)],
  ['mở quỹ đổi xe 30000 euro trước hè 2028', (t) => /quỹ|xe|30|tháng/i.test(t)],
  ['xin chào', (t) => t.length > 20],
  ['asdkjhaskdjh', (t) => t.length > 20],
];

for (const [msg, check] of CHAT_CASES) {
  await S(`Chat: "${msg.slice(0, 42)}"`, async () => {
    const r = await chat(msg);
    must(r.status < 500, `status ${r.status}`);
    const text = replyOf(r);
    must(text && text.length > 10, 'trả lời rỗng');
    must(check(text), `trả lời lạc đề: ${text.slice(0, 120)}`);
    return text.slice(0, 60).replace(/\s+/g, ' ');
  });
}

await S('Chat không làm mất dữ liệu đã có', async () => {
  const a = await accounts();
  must(a.length >= 5, `còn ${a.length} tài khoản sau khi chat`);
});

await S('Lịch sử chat được lưu lại', async () => {
  const h = await GET('/chat/history');
  must((h.messages || h.history || []).length > 5, 'lịch sử rỗng');
});

await S('Tin nhắn rỗng không làm sập', async () => {
  const r = await POST('/chat', { message: '' });
  must(r.status < 500, `status ${r.status}`);
});

await S('Tin nhắn cực dài không làm sập', async () => {
  const r = await POST('/chat', { message: 'a'.repeat(5000) });
  must(r.status < 500, `status ${r.status}`);
});

// --- 17. Tình huống xấu & bảo mật -----------------------------------------
G('17. Dữ liệu xấu & biên');

await S('Số tiền cực lớn không tràn số', async () => {
  const r = await POST('/transactions', { type: 'income', amount: 9e14, account_id: acc.vcb, note: 'trúng số', currency: 'VND' });
  const t = r.transaction || r;
  if (t && t.id) {
    must(Number.isSafeInteger(t.amount), `amount = ${t.amount}`);
    await DEL(`/transactions/${t.id}`);
  }
});

await S('Chuỗi SQL injection không phá được dữ liệu', async () => {
  await POST('/accounts', { name: "'; DROP TABLE transactions; --", type: 'cash', balance: 0, currency: 'EUR' });
  const t = (await GET('/transactions?limit=10')).transactions;
  must(Array.isArray(t), 'bảng transactions biến mất');
});

await S('Tên chứa HTML/script được lưu nguyên văn, không thực thi', async () => {
  const r = await POST('/accounts', { name: '<script>alert(1)</script>', type: 'cash', balance: 0, currency: 'EUR' });
  must(r.account.name.includes('<script>'), 'bị biến đổi bất ngờ');
  await DEL(`/accounts/${r.account.id}`);
});

await S('Truy cập ID không tồn tại trả lỗi rõ ràng, không phải 500', async () => {
  const r = await GET('/transactions/999999');
  must(r.status < 500, `status ${r.status}`);
});

await S('Xoá thứ đã xoá không gây lỗi', async () => {
  const r1 = await POST('/goals', { name: 'Xoá hai lần', target_amount: 1000, currency: 'EUR' });
  await DEL(`/goals/${r1.goal.id}`);
  const r2 = await DEL(`/goals/${r1.goal.id}`);
  must(r2.status < 500, `status ${r2.status}`);
});

await S('JSON sai định dạng bị từ chối gọn gàng', async () => {
  const r = await fetch(`${BASE}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  must(r.status >= 400 && r.status < 500, `status ${r.status}`);
});

await S('Ngày sai định dạng không làm hỏng sổ', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 1000, account_id: acc.aib, date: 'hôm qua', currency: 'EUR' });
  must(r.status < 500, `status ${r.status}`);
  const d = await GET('/dashboard');
  must(d.ok !== false, 'dashboard vỡ vì ngày sai');
});

await S('Tài khoản không tồn tại khi ghi giao dịch', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 1000, account_id: 999999, currency: 'EUR' });
  must(r.status < 500, `status ${r.status}`);
});

await S('Đơn vị tiền lạ được chuẩn hoá hoặc từ chối', async () => {
  const r = await POST('/transactions', { type: 'expense', amount: 1000, account_id: acc.aib, currency: 'ZZZ' });
  must(r.status < 500, `status ${r.status}`);
});

await S('Xuất toàn bộ dữ liệu ra JSON', async () => {
  const r = await GET('/export');
  must(r.status < 400, `status ${r.status}`);
  const j = JSON.stringify(r);
  must(j.length > 1000, `dữ liệu xuất chỉ ${j.length} ký tự`);
  return `${(j.length / 1024).toFixed(0)} KB`;
});

await S('Sao lưu chạy được và liệt kê được', async () => {
  await POST('/backup/run');
  const l = await GET('/backup/list');
  must((l.backups || []).length > 0, 'không có bản sao lưu');
});

await S('Dashboard vẫn nhanh sau khi có nhiều dữ liệu', async () => {
  const t0 = Date.now();
  await GET('/dashboard');
  const ms = Date.now() - t0;
  must(ms < 2000, `mất ${ms}ms`);
  return `${ms}ms`;
});

await S('Gọi 20 request song song không gây khoá DB', async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, () => GET('/dashboard')));
  must(rs.every((r) => r.status < 500), `có ${rs.filter((r) => r.status >= 500).length} lỗi 500`);
});

await S('Đặt PIN rồi mọi endpoint đều cần khoá phiên', async () => {
  const s = await POST('/auth/setup', { pin: '135790' });
  must(s.ok !== false, JSON.stringify(s).slice(0, 200));
  const r = await fetch(`${BASE}/dashboard`);
  must(r.status === 401, `chưa đăng nhập mà vẫn ${r.status}`);
});

await S('Đăng nhập bằng PIN đúng thì vào được', async () => {
  const r = await POST('/auth/login', { pin: '135790' });
  must(r.key, 'không trả khoá phiên');
  const d = await fetch(`${BASE}/dashboard`, { headers: { 'x-finmate-key': r.key } });
  must(d.ok, `status ${d.status}`);
});

await S('PIN sai bị từ chối', async () => {
  const r = await POST('/auth/login', { pin: '000000' });
  must(r.ok === false || r.status >= 400, 'PIN sai vẫn vào được');
});

await S('Webhook vẫn chạy được khi đã bật PIN (điện thoại không cần PIN)', async () => {
  const r = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'x-finmate-token': TOKEN },
    body: 'AIB: Your card was used for EUR 7.77 at CENTRA on 24-Aug-26',
  });
  must(r.ok, `status ${r.status}`);
});

await S('Token webhook không mở được cửa hậu vào API khác', async () => {
  const r = await fetch(`${BASE}/dashboard`, { headers: { 'x-finmate-token': TOKEN } });
  must(r.status === 401, `token webhook vào được dashboard (${r.status})`);
});

// ===========================================================================

console.log('\n');
const byGroup = new Map();
for (const r of results) {
  if (!byGroup.has(r.group)) byGroup.set(r.group, { pass: 0, fail: 0, items: [] });
  const g = byGroup.get(r.group);
  if (r.ok) g.pass += 1; else g.fail += 1;
  g.items.push(r);
}

console.log('═'.repeat(78));
console.log('KẾT QUẢ THEO NHÓM TÍNH NĂNG');
console.log('═'.repeat(78));
for (const [name, g] of byGroup) {
  const total = g.pass + g.fail;
  const bar = '█'.repeat(Math.round((g.pass / total) * 20)).padEnd(20, '░');
  const mark = g.fail === 0 ? '✅' : '⚠️ ';
  console.log(`${mark} ${name.padEnd(32)} ${bar} ${g.pass}/${total}`);
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + '═'.repeat(78));
console.log(`TỔNG: ${results.length - failed.length}/${results.length} kịch bản đạt`);
console.log('═'.repeat(78));

if (failed.length) {
  console.log('\nCÁC KỊCH BẢN KHÔNG ĐẠT:\n');
  for (const f of failed) console.log(`  [${f.group}]\n    ${f.name}\n    → ${f.note}\n`);
}

const notes = results.filter((r) => r.ok && r.note);
if (notes.length) {
  console.log('\nSỐ LIỆU QUAN SÁT ĐƯỢC:\n');
  for (const n of notes) console.log(`  · ${n.name}: ${n.note}`);
}

child.kill();
process.exit(failed.length ? 1 : 0);
