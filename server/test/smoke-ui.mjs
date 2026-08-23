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

const st = await get('/automation/status');
check('Automation /automation/status', st, ['last_run', 'recurring', 'accounts_synced', 'webhook_url', 'log']);
const rec = await get('/recurring');
check('Automation /recurring', rec, ['recurring.0.name', 'recurring.0.frequency', 'recurring.0.next_date', 'recurring.0.amount', 'recurring.0.auto_post', 'upcoming', 'monthly_fixed']);
console.log('   monthly_fixed =', JSON.stringify(rec.monthly_fixed));

const prof = await get('/profile');
check('Settings /profile', prof, ['profile.name', 'profile.risk_profile', 'profile.swr', 'profile.expected_return', 'profile.inflation', 'profile.savings_rate_target', 'profile.emergency_months_target', 'profile.retire_age_target']);
const tax = await post('/tax/pit', { gross: 30000000, dependents: 0 });
check('Settings /tax/pit', tax, ['result.gross', 'result.net', 'result.insurance', 'result.tax', 'result.taxable', 'result.deduction', 'result.marginal_rate', 'result.effective_rate', 'result.annual_tax', 'config.self_deduction', 'config.dependent_deduction']);
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
