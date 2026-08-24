/** Kiểm tra mọi field mà frontend đọc thực sự tồn tại trong phản hồi API. */
const BASE = 'http://localhost:4000/api';
let fail = 0;

const get = async (p) => {
  const r = await fetch(BASE + p);
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(`${p} -> ${r.status} ${d.error || ''}`);
  return d;
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(`${p} -> ${r.status} ${d.error || ''}`);
  return d;
};

const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : (Array.isArray(a) && /^\d+$/.test(k) ? a[+k] : a[k])), o);

function check(label, obj, paths) {
  const miss = paths.filter((p) => dig(obj, p) === undefined);
  if (miss.length) { fail++; console.log(`❌ ${label}: thiếu ${miss.join(', ')}`); }
  else console.log(`✅ ${label}`);
}

const d = await get('/dashboard');
check('Dashboard /dashboard', d, ['month', 'totals', 'net_worth.net', 'net_worth.breakdown', 'net_worth_history', 'accounts', 'funds', 'safe_to_spend', 'trend', 'categories', 'budgets', 'goals', 'insights', 'health.score', 'fire', 'emergency', 'upcoming', 'actions', 'passive', 'recent']);

const fire = await get('/fire');
check('Fire /fire', fire, ['fire.fi_number', 'fire.lean_number', 'fire.fat_number', 'fire.coast_number', 'fire.progress', 'fire.monthly_surplus', 'fire.savings_rate', 'fire.swr', 'fire.invested', 'fire.scenarios', 'fire.projection', 'fire.passive_coverage', 'emergency.current', 'emergency.months_covered', 'emergency.target_months', 'emergency.target_amount', 'emergency.gap', 'emergency.ok']);

const fc = await get('/forecast?days=90&months=12');
check('Fire /forecast', fc, ['daily.series.0.balance', 'daily.series.0.date', 'daily.min', 'monthly.rows.0.month', 'monthly.rows.0.income', 'monthly.rows.0.expense', 'monthly.rows.0.net', 'safe_to_spend.liquid', 'safe_to_spend.upcoming_fixed', 'safe_to_spend.available', 'safe_to_spend.per_day', 'safe_to_spend.days_left']);

const h = await get('/advisor/health');
check('Advisor /advisor/health', h, ['health.score', 'health.grade', 'health.label', 'health.components.0.key', 'health.components.0.label', 'health.components.0.score', 'health.components.0.weight', 'health.components.0.detail']);
const acts = await get('/advisor/actions?limit=8');
check('Advisor /advisor/actions', acts, ['actions.0.title', 'actions.0.detail']);
const sp = await get('/advisor/surplus?amount=50000000');
check('Advisor /advisor/surplus', sp, ['plan.amount', 'plan.steps.0.label', 'plan.steps.0.why', 'plan.steps.0.amount', 'plan.left', 'split.0.label', 'split.0.amount']);

const ins = await get('/insights');
check('Insights /insights', ins, ['insights.0.id', 'insights.0.severity', 'insights.0.title', 'insights.0.body', 'insights.0.created_at']);

// --- Đa tiền tệ ---------------------------------------------------------
const accs = await get('/accounts');
check('Accounts /accounts', accs, ['accounts.0.name', 'accounts.0.balance', 'accounts.0.currency', 'accounts.0.base_currency', 'accounts.0.base_balance', 'accounts.0.is_active', 'accounts.0.type']);
const inc = await get('/income-streams');
check('Income /income-streams', inc, ['streams.0.name', 'streams.0.net_amount', 'streams.0.currency', 'streams.0.base_net_amount', 'streams.0.base_gross_amount', 'passive.interest', 'passive.dividend', 'passive.rent', 'projected_interest', 'tax.total', 'tax.currency', 'tax.detail.0.name', 'tax.detail.0.kind', 'tax.detail.0.amount']);
const fxr = await get('/fx/rates');
check('Currency /fx/rates', fxr, ['base', 'rates.0.code', 'rates.0.rate', 'rates.0.inverse', 'status.last_ok', 'status.source']);
const remit = await get('/remittance?months=12');
check('Currency /remittance', remit, ['summary.count', 'summary.total_sent', 'summary.total_received', 'timing.verdict', 'timing.message', 'cost.cost', 'cost.cost_pct', 'list']);
const invs = await get('/investments');
check('Investments /investments', invs, ['portfolio.total_value', 'portfolio.holdings', 'portfolio.projected_dividend', 'real_estate.total_value', 'real_estate.net_monthly']);

const st = await get('/automation/status');
check('Automation /automation/status', st, ['last_run', 'recurring', 'accounts_synced', 'webhook_url', 'log']);

// --- trang "AI đã làm gì": nhật ký, trí nhớ, rà soát chủ động ---
const del = async (p) => {
  const r = await fetch(BASE + p, { method: 'DELETE' });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(`${p} -> ${r.status} ${d.error || ''}`);
  return d;
};
const put = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(`${p} -> ${r.status} ${d.error || ''}`);
  return d;
};

const aiActs = await get('/ai/actions?limit=5');
check('AiLog /ai/actions', aiActs, ['actions', 'stats.tong', 'stats.thay_doi_du_lieu', 'stats.da_hoan_tac']);
if (aiActs.actions?.length) {
  check('AiLog /ai/actions[0]', aiActs, ['actions.0.id', 'actions.0.cong_cu', 'actions.0.luc', 'actions.0.nguon', 'actions.0.da_hoan_tac', 'actions.0.thay_doi_du_lieu', 'actions.0.so_hang_doi', 'actions.0.thanh_cong']);
  const one = await get(`/ai/actions/${aiActs.actions[0].id}`);
  check('AiLog /ai/actions/:id', one, ['id', 'cong_cu', 'luc', 'nguon', 'da_hoan_tac', 'thay_doi_du_lieu', 'thay_doi']);
} else {
  console.log('   (chưa có thao tác AI nào để soi chi tiết)');
}

// Tạo rồi xoá một mục nhớ để chắc chắn cả ba route memory đều khớp với UI.
await post('/ai/memory', { kind: 'fact', key: '__smoke__', value: 'kiểm thử giao diện', importance: 1 });
const aiMem = await get('/ai/memory');
check('AiLog /ai/memory', aiMem, ['memory.0.id', 'memory.0.loai', 'memory.0.loai_vi', 'memory.0.muc', 'memory.0.noi_dung', 'memory.0.do_quan_trong']);
const smokeMem = aiMem.memory.find((m) => m.muc === '__smoke__');
if (smokeMem) await del(`/ai/memory/${smokeMem.id}`);
else { fail++; console.log('❌ AiLog /ai/memory: mục vừa thêm không thấy trong danh sách'); }

const aiRev = await get('/ai/review');
check('AiLog /ai/review', aiRev, ['config.che_do', 'config.moi_bao_nhieu_gio', 'config.dang_bat']);
const aiRevPut = await put('/ai/review', { che_do: aiRev.config.che_do, moi_bao_nhieu_gio: aiRev.config.moi_bao_nhieu_gio });
check('AiLog PUT /ai/review', aiRevPut, ['che_do', 'moi_bao_nhieu_gio', 'dang_bat']);

const rec = await get('/recurring');
check('Automation /recurring', rec, ['recurring.0.name', 'recurring.0.frequency', 'recurring.0.next_date', 'recurring.0.amount', 'recurring.0.auto_post', 'upcoming', 'monthly_fixed']);
console.log('   monthly_fixed =', JSON.stringify(rec.monthly_fixed));

const prof = await get('/profile');
check('Settings /profile', prof, ['profile.name', 'profile.risk_profile', 'profile.swr', 'profile.expected_return', 'profile.inflation', 'profile.savings_rate_target', 'profile.emergency_months_target', 'profile.retire_age_target']);
const tax = await post('/tax/pit', { gross: 30000000, dependents: 0 });
// Mỗi nước có bộ field riêng: Việt Nam có bảo hiểm + giảm trừ gia cảnh,
// Ireland có PAYE/USC/PRSI + tín dụng thuế.
check('Settings /tax/pit', tax, tax?.result?.country === 'IE'
  ? ['result.gross', 'result.net', 'result.income_tax', 'result.usc', 'result.prsi', 'result.total_tax', 'result.taxable', 'result.marginal_rate', 'result.effective_rate', 'result.monthly_net', 'config.srcop', 'config.credits']
  : ['result.gross', 'result.net', 'result.insurance', 'result.tax', 'result.taxable', 'result.deduction', 'result.marginal_rate', 'result.effective_rate', 'result.annual_tax', 'config.self_deduction', 'config.dependent_deduction']);
const rules = await get('/rules');
check('Settings /rules', rules, ['rules']);
const cats = await get('/categories');
check('/categories', cats, ['categories.0.id', 'categories.0.name']);

const prev = await post('/ingest/preview', { text: 'VCB: 23/08/2026 12:34 TK 0071000123456 -350,000VND. So du: 42,150,000VND. ND: THANH TOAN GRABFOOD' });
check('Automation /ingest/preview', prev, ['parsed.amount', 'parsed.type']);
const csv = await post('/ingest/csv', { csv: 'Ngay,Noi dung,So tien\n01/03/2026,Mua sam Shopee,-450000', dry_run: true });
check('Automation /ingest/csv (dry)', csv, ['imported', 'duplicates', 'items']);

console.log(fail ? `\n${fail} nhóm field bị thiếu.` : '\n🎉 Tất cả field frontend dùng đều tồn tại.');
process.exit(fail ? 1 : 0);
