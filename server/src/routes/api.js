import express from 'express';
import fs from 'node:fs';
import { all, get, insert, update, remove, run, setting } from '../db.js';
import { pinIsSet, setPin, clearPin, verifyPin, createSession, destroySession, lockedFor, noteFail, noteSuccess, ingestToken, rotateIngestToken } from '../services/auth.js';
import { BACKUP_DIR, listBackups, createBackup, snapshotToTemp, exportAll, autoBackup } from '../services/backup.js';
import { today, monthKey, monthStart, monthEnd, lastMonths } from '../util/date.js';
import { bootstrap } from '../bootstrap.js';
import { createTransaction, updateTransaction, deleteTransaction, listTransactions, getTransaction, rebuildBalances } from '../services/ledger.js';
import { listFunds, fundsOverview, moveBetweenFunds, allocateIncome, recomputeFundBalances, postFund, archiveFund, reopenFund } from '../services/funds.js';
import { learnRule } from '../services/categorize.js';
import { createRecurring, runDueRecurring, upcoming, projectRecurring, monthlyFixed } from '../services/recurring.js';
import { accrueInterest, projectedAnnualInterest } from '../services/interest.js';
import { portfolio, upsertHolding, setPrice, recordTrade, realEstate, listHoldings } from '../services/investments.js';
import { listDebts, amortize, payoffPlan, debtSummary } from '../services/debts.js';
import { monthReport, monthlyTrend, categoryBreakdown, incomeSources, totals, averageMonthlyExpense, averageMonthlyIncome } from '../services/reports.js';
import { netWorth, snapshot, history as nwHistory } from '../services/networth.js';
import { dailyForecast, monthlyForecast, safeToSpend } from '../services/forecast.js';
import { fireStats, emergencyStatus, passiveIncomeMonthly, marketAssumptions } from '../services/fire.js';
import { passiveRoadmap } from '../services/passive.js';
import { budgetStatus, upsertBudget, suggestBudgets } from '../services/budgets.js';
import { generateInsights, listInsights } from '../services/insights.js';
import { healthScore, surplusPlan, nextActions, investmentSplit } from '../services/advisor.js';
import { ingestMessage, importCSV, ingestHistory, parseBankMessage, reconcile } from '../services/ingest.js';
import { grossToNetAuto, netToGrossAuto, estimateAnnualTaxAuto, taxConfigAuto, taxCountry, COUNTRIES } from '../services/tax_router.js';
import { setRate, getRate, convert, baseCurrency, refreshRates, ensureSeedRates, rateTable, rateHistory, fxStatus } from '../services/fx.js';
import { listRemittances, remittanceSummary, timingAdvice, quote as fxQuote, costInsight } from '../services/remittance.js';
import { CURRENCIES, CURRENCY_CODES, normalizeCurrency } from '../util/currency.js';
import { recomputeBaseAmounts } from '../services/ledger.js';
import { chat, history as chatHistory, ensureWelcome, resetChat } from '../services/chat/index.js';
import { llmEnabled, llmModel } from '../services/chat/llm.js';
import { listActions, actionDetail, actionStats, undoAction, undoLast, undoBatch, pruneActions } from '../services/ai_audit.js';
import { listMemory, remember, forget, pruneMemory } from '../services/ai_memory.js';
import { runReview, reviewConfig, setReviewConfig, lastReview, reviewHistory } from '../services/ai_review.js';

export const router = express.Router();

const ok = (res, data) => res.json({ ok: true, ...data });
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error('[api]', e);
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
};

// ---- hệ thống -------------------------------------------------------------

router.get('/health', wrap(async (req, res) => ok(res, {
  time: new Date().toISOString(),
  db: 'sqlite',
  // Người dùng phải biết mình đang nói chuyện với bộ luật hay với AI thật —
  // hai thứ này trả lời khác hẳn nhau khi câu hỏi đi lệch khỏi khuôn mẫu.
  llm: { enabled: llmEnabled(), model: llmEnabled() ? llmModel() : null },
})));

// ---- khoá ứng dụng bằng PIN ----------------------------------------------

const ipOf = (req) => req.ip || req.socket?.remoteAddress || 'local';

router.get('/auth/status', wrap(async (req, res) => ok(res, { pin_set: pinIsSet(), locked_ms: lockedFor(ipOf(req)) })));

router.post('/auth/setup', wrap(async (req, res) => {
  if (pinIsSet()) throw new Error('Đã có mã PIN. Dùng /auth/change để đổi.');
  setPin(req.body?.pin);
  ok(res, { key: createSession() });
}));

router.post('/auth/login', wrap(async (req, res) => {
  const ip = ipOf(req);
  const left = lockedFor(ip);
  if (left > 0) throw new Error(`Sai PIN nhiều lần, thử lại sau ${Math.ceil(left / 1000)} giây`);
  if (!pinIsSet()) return ok(res, { key: null, pin_set: false });
  if (!verifyPin(req.body?.pin)) {
    noteFail(ip);
    return res.status(401).json({ ok: false, error: 'Mã PIN không đúng' });
  }
  noteSuccess(ip);
  ok(res, { key: createSession() });
}));

router.post('/auth/change', wrap(async (req, res) => {
  if (pinIsSet() && !verifyPin(req.body?.old_pin)) throw new Error('Mã PIN hiện tại không đúng');
  setPin(req.body?.pin);
  ok(res, { key: createSession() });
}));

router.post('/auth/disable', wrap(async (req, res) => {
  if (pinIsSet() && !verifyPin(req.body?.pin)) throw new Error('Mã PIN không đúng');
  clearPin();
  ok(res, { pin_set: false });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  destroySession(req.get('x-finmate-key') || req.body?.key);
  ok(res, {});
}));

// ---- sao lưu & xuất dữ liệu ----------------------------------------------

router.get('/backup/list', wrap(async (req, res) => ok(res, { backups: listBackups(), dir: BACKUP_DIR })));

router.post('/backup/run', wrap(async (req, res) => ok(res, { backup: createBackup() })));

router.get('/backup/download', wrap(async (req, res) => {
  const file = snapshotToTemp();
  res.download(file, `finmate-${today()}.db`, () => fs.rmSync(file, { force: true }));
}));

router.get('/export', wrap(async (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="finmate-${today()}.json"`);
  res.json({ ok: true, exported_at: new Date().toISOString(), data: exportAll() });
}));

router.get('/profile', wrap(async (req, res) => ok(res, { profile: get('SELECT * FROM profile WHERE id = 1') })));
router.patch('/profile', wrap(async (req, res) => {
  update('profile', 1, { ...req.body, updated_at: new Date().toISOString() });
  ok(res, { profile: get('SELECT * FROM profile WHERE id = 1') });
}));

const PRIVATE_SETTINGS = new Set(['app_pin']);
const publicSettings = () => all('SELECT * FROM settings').filter((s) => !PRIVATE_SETTINGS.has(s.key));
// POST /settings nhận object nên GET cũng phải trả về được dạng object, nếu
// không thì client (và AI agent) phải tự dựng lại map từ mảng key/value.
const settingsMap = () => Object.fromEntries(publicSettings().map((s) => [s.key, s.value]));
const settingsPayload = () => ({ settings: publicSettings(), values: { ...settingsMap(), base_currency: baseCurrency() } });

router.get('/settings', wrap(async (req, res) => ok(res, settingsPayload())));
router.post('/settings', wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (PRIVATE_SETTINGS.has(k)) throw new Error('Mã PIN phải đổi qua /auth/change');
    setting(k, v);
  }
  ok(res, settingsPayload());
}));

// ---- chat -----------------------------------------------------------------

router.get('/chat/history', wrap(async (req, res) => {
  ensureWelcome();
  ok(res, { messages: chatHistory(), profile: get('SELECT * FROM profile WHERE id = 1') });
}));
router.post('/chat', wrap(async (req, res) => {
  const result = await chat(req.body?.message);
  ok(res, result);
}));
router.post('/chat/reset', wrap(async (req, res) => {
  const r = resetChat({ keepData: req.body?.keep_data !== false });
  ok(res, { started: r });
}));

// ---- bảng điều khiển ------------------------------------------------------

router.get('/dashboard', wrap(async (req, res) => {
  const mk = req.query.month || monthKey();
  const t = totals(monthStart(mk), monthEnd(mk));
  const nw = netWorth();
  ok(res, {
    month: mk,
    base_currency: baseCurrency(),
    fx: rateTable(baseCurrency()),
    totals: t,
    net_worth: nw,
    net_worth_history: nwHistory(24),
    accounts: all('SELECT * FROM accounts WHERE is_active = 1 ORDER BY type, balance DESC'),
    funds: fundsOverview(),
    safe_to_spend: safeToSpend(),
    trend: monthlyTrend(6),
    categories: categoryBreakdown(monthStart(mk), monthEnd(mk)).slice(0, 8),
    budgets: budgetStatus(mk),
    goals: all("SELECT * FROM goals WHERE status='active' ORDER BY priority, deadline LIMIT 6"),
    insights: listInsights({ limit: 8 }),
    health: healthScore(),
    fire: fireStats(),
    emergency: emergencyStatus(),
    upcoming: upcoming(14),
    actions: nextActions(4),
    passive: passiveIncomeMonthly(),
    recent: listTransactions({ limit: 8 }),
  });
}));

// ---- tài khoản ------------------------------------------------------------

router.get('/accounts', wrap(async (req, res) => {
  const base = baseCurrency();
  const accounts = all('SELECT * FROM accounts ORDER BY is_active DESC, type, id').map((a) => {
    const code = normalizeCurrency(a.currency, null) || base;
    return { ...a, currency: code, base_currency: base, base_balance: convert(a.balance, code, base) };
  });
  ok(res, { accounts, base_currency: base });
}));
router.post('/accounts', wrap(async (req, res) => {
  const body = { ...req.body };
  const balance = Number(body.balance) || 0;
  const id = insert('accounts', { ...body, balance, opening_balance: balance, opened_at: body.opened_at || today() });
  ok(res, { account: get('SELECT * FROM accounts WHERE id = ?', [id]) });
}));
router.patch('/accounts/:id', wrap(async (req, res) => {
  update('accounts', Number(req.params.id), req.body);
  ok(res, { account: get('SELECT * FROM accounts WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/accounts/:id', wrap(async (req, res) => ok(res, { removed: remove('accounts', Number(req.params.id)) })));
router.post('/accounts/:id/reconcile', wrap(async (req, res) => {
  ok(res, { result: reconcile(Number(req.params.id), Number(req.body.balance), req.body.date || today()) });
}));

// ---- giao dịch ------------------------------------------------------------

router.get('/transactions', wrap(async (req, res) => ok(res, { transactions: listTransactions(req.query) })));
router.get('/transactions/:id', wrap(async (req, res) => ok(res, { transaction: getTransaction(Number(req.params.id)) })));
router.post('/transactions', wrap(async (req, res) => {
  const result = createTransaction(req.body);
  ok(res, result);
}));
router.patch('/transactions/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const before = get('SELECT * FROM transactions WHERE id = ?', [id]);
  const t = updateTransaction(id, { ...req.body, needs_review: 0 });
  if (req.body.category_id && before && before.category_id !== req.body.category_id && req.body.learn !== false) {
    learnRule({ pattern: (t.merchant || t.note || '').slice(0, 40), category_id: t.category_id, fund_id: t.fund_id });
  }
  ok(res, { transaction: getTransaction(id) });
}));
router.delete('/transactions/:id', wrap(async (req, res) => ok(res, { removed: deleteTransaction(Number(req.params.id)) })));
router.post('/transactions/rebuild', wrap(async (req, res) => {
  rebuildBalances();
  recomputeFundBalances();
  ok(res, { rebuilt: true });
}));

// ---- danh mục -------------------------------------------------------------

router.get('/categories', wrap(async (req, res) => ok(res, { categories: all('SELECT * FROM categories ORDER BY kind, group_name, name') })));
router.post('/categories', wrap(async (req, res) => {
  const id = insert('categories', { ...req.body, is_system: 0 });
  ok(res, { category: get('SELECT * FROM categories WHERE id = ?', [id]) });
}));
router.patch('/categories/:id', wrap(async (req, res) => {
  update('categories', Number(req.params.id), req.body);
  ok(res, { category: get('SELECT * FROM categories WHERE id = ?', [Number(req.params.id)]) });
}));

// ---- quỹ ------------------------------------------------------------------

router.get('/funds', wrap(async (req, res) => ok(res, fundsOverview({ includeArchived: req.query.all === '1' }))));
router.patch('/funds/:id', wrap(async (req, res) => {
  update('funds', Number(req.params.id), req.body);
  ok(res, { fund: get('SELECT * FROM funds WHERE id = ?', [Number(req.params.id)]) });
}));
router.post('/funds', wrap(async (req, res) => {
  const id = insert('funds', req.body);
  ok(res, { fund: get('SELECT * FROM funds WHERE id = ?', [id]) });
}));
router.post('/funds/:id/archive', wrap(async (req, res) => {
  const r = archiveFund(Number(req.params.id), { to_fund_id: req.body?.to_fund_id ? Number(req.body.to_fund_id) : null });
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  ok(res, { ...r, funds: fundsOverview() });
}));
router.post('/funds/:id/reopen', wrap(async (req, res) => {
  const r = reopenFund(Number(req.params.id), req.body?.percent ?? null);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  ok(res, { ...r, funds: fundsOverview() });
}));
router.delete('/funds/:id', wrap(async (req, res) => ok(res, { removed: remove('funds', Number(req.params.id)) })));
router.post('/funds/move', wrap(async (req, res) => {
  moveBetweenFunds(req.body);
  ok(res, fundsOverview());
}));
router.post('/funds/allocate', wrap(async (req, res) => {
  const result = allocateIncome({ amount: Number(req.body.amount), date: req.body.date || today(), note: req.body.note || 'Phân bổ thủ công' });
  ok(res, { allocation: result, funds: fundsOverview() });
}));
router.get('/funds/ledger', wrap(async (req, res) => {
  ok(res, { entries: all('SELECT fl.*, f.name AS fund_name FROM fund_ledger fl JOIN funds f ON f.id = fl.fund_id ORDER BY fl.id DESC LIMIT ?', [Number(req.query.limit) || 100]) });
}));

// ---- mục tiêu -------------------------------------------------------------

router.get('/goals', wrap(async (req, res) => ok(res, { goals: all('SELECT * FROM goals ORDER BY status, priority, deadline') })));
router.post('/goals', wrap(async (req, res) => {
  const id = insert('goals', req.body);
  ok(res, { goal: get('SELECT * FROM goals WHERE id = ?', [id]) });
}));
router.patch('/goals/:id', wrap(async (req, res) => {
  update('goals', Number(req.params.id), req.body);
  ok(res, { goal: get('SELECT * FROM goals WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/goals/:id', wrap(async (req, res) => ok(res, { removed: remove('goals', Number(req.params.id)) })));
router.post('/goals/:id/contribute', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const g = get('SELECT * FROM goals WHERE id = ?', [id]);
  const amount = Math.round(Number(req.body.amount) || 0);
  run('UPDATE goals SET current_amount = current_amount + ? WHERE id = ?', [amount, id]);
  if (g.fund_id) postFund({ fund_id: g.fund_id, amount, date: today(), kind: 'goal', goal_id: id, note: `Nạp mục tiêu ${g.name}` });
  ok(res, { goal: get('SELECT * FROM goals WHERE id = ?', [id]) });
}));

// ---- ngân sách ------------------------------------------------------------

router.get('/budgets', wrap(async (req, res) => ok(res, budgetStatus(req.query.month || monthKey()))));
router.post('/budgets', wrap(async (req, res) => ok(res, { budget: upsertBudget(req.body) })));
router.delete('/budgets/:id', wrap(async (req, res) => ok(res, { removed: remove('budgets', Number(req.params.id)) })));
router.get('/budgets/suggest', wrap(async (req, res) => ok(res, { suggestions: suggestBudgets(Number(req.query.months) || 3) })));

// ---- định kỳ --------------------------------------------------------------

router.get('/recurring', wrap(async (req, res) => ok(res, {
  recurring: all('SELECT r.*, c.name AS category_name, a.name AS account_name FROM recurring r LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN accounts a ON a.id=r.account_id ORDER BY r.active DESC, r.next_date'),
  upcoming: upcoming(45),
  monthly_fixed: monthlyFixed(),
})));
router.post('/recurring', wrap(async (req, res) => ok(res, { recurring: createRecurring(req.body) })));
router.patch('/recurring/:id', wrap(async (req, res) => {
  update('recurring', Number(req.params.id), req.body);
  ok(res, { recurring: get('SELECT * FROM recurring WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/recurring/:id', wrap(async (req, res) => ok(res, { removed: remove('recurring', Number(req.params.id)) })));

// ---- nguồn thu ------------------------------------------------------------

router.get('/income-streams', wrap(async (req, res) => {
  const rows = all('SELECT s.*, a.name AS account_name FROM income_streams s LEFT JOIN accounts a ON a.id = s.account_id ORDER BY s.active DESC, s.net_amount DESC');
  const base = baseCurrency();
  // Mỗi nguồn thu có thể ở đồng tiền khác (lương EUR, tiền thuê nhà VND).
  // Kèm sẵn số đã quy đổi để giao diện cộng gộp không bị sai.
  const streams = rows.map((s) => {
    const code = normalizeCurrency(s.currency || base);
    return {
      ...s,
      currency: code,
      base_currency: base,
      base_net_amount: convert(s.net_amount || 0, code, base),
      base_gross_amount: convert(s.gross_amount || 0, code, base),
    };
  });
  const mk = monthKey();
  ok(res, {
    streams,
    sources: incomeSources(monthStart(lastMonths(6)[0]), monthEnd(mk)),
    passive: passiveIncomeMonthly(),
    projected_interest: projectedAnnualInterest(),
    tax: estimateAnnualTaxAuto(streams),
  });
}));
router.post('/income-streams', wrap(async (req, res) => {
  const id = insert('income_streams', req.body);
  ok(res, { stream: get('SELECT * FROM income_streams WHERE id = ?', [id]) });
}));
router.patch('/income-streams/:id', wrap(async (req, res) => {
  update('income_streams', Number(req.params.id), req.body);
  ok(res, { stream: get('SELECT * FROM income_streams WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/income-streams/:id', wrap(async (req, res) => ok(res, { removed: remove('income_streams', Number(req.params.id)) })));

// ---- đầu tư ---------------------------------------------------------------

router.get('/investments', wrap(async (req, res) => ok(res, { portfolio: portfolio(), real_estate: realEstate(), trades: all('SELECT t.*, h.symbol FROM trades t JOIN holdings h ON h.id=t.holding_id ORDER BY t.date DESC LIMIT 50') })));
router.post('/investments/holdings', wrap(async (req, res) => ok(res, { holding: upsertHolding(req.body) })));
router.delete('/investments/holdings/:id', wrap(async (req, res) => ok(res, { removed: remove('holdings', Number(req.params.id)) })));
router.post('/investments/price', wrap(async (req, res) => ok(res, { updated: setPrice(req.body.symbol, req.body.price, req.body.date) })));
router.post('/investments/trade', wrap(async (req, res) => ok(res, { holding: recordTrade(req.body) })));
router.get('/properties', wrap(async (req, res) => ok(res, realEstate())));
router.post('/properties', wrap(async (req, res) => {
  const id = insert('properties', req.body);
  ok(res, { property: get('SELECT * FROM properties WHERE id = ?', [id]) });
}));
router.patch('/properties/:id', wrap(async (req, res) => {
  update('properties', Number(req.params.id), req.body);
  ok(res, { property: get('SELECT * FROM properties WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/properties/:id', wrap(async (req, res) => ok(res, { removed: remove('properties', Number(req.params.id)) })));

// ---- nợ -------------------------------------------------------------------

router.get('/debts', wrap(async (req, res) => {
  const income = averageMonthlyIncome(6);
  ok(res, {
    summary: debtSummary(income),
    avalanche: payoffPlan('avalanche', Number(req.query.extra) || 0),
    snowball: payoffPlan('snowball', Number(req.query.extra) || 0),
  });
}));
router.post('/debts', wrap(async (req, res) => {
  const body = { ...req.body };
  if (!body.balance && body.principal) body.balance = body.principal;
  const id = insert('debts', body);
  ok(res, { debt: get('SELECT * FROM debts WHERE id = ?', [id]) });
}));
router.patch('/debts/:id', wrap(async (req, res) => {
  update('debts', Number(req.params.id), req.body);
  ok(res, { debt: get('SELECT * FROM debts WHERE id = ?', [Number(req.params.id)]) });
}));
router.delete('/debts/:id', wrap(async (req, res) => ok(res, { removed: remove('debts', Number(req.params.id)) })));
router.get('/debts/:id/schedule', wrap(async (req, res) => {
  const d = get('SELECT * FROM debts WHERE id = ?', [Number(req.params.id)]);
  ok(res, { schedule: amortize(d, Number(req.query.extra) || 0) });
}));

// ---- báo cáo --------------------------------------------------------------

router.get('/reports/month', wrap(async (req, res) => ok(res, { report: monthReport(req.query.month || monthKey()) })));
router.get('/reports/trend', wrap(async (req, res) => ok(res, { trend: monthlyTrend(Number(req.query.months) || 12) })));
router.get('/reports/categories', wrap(async (req, res) => {
  const mk = req.query.month || monthKey();
  ok(res, { categories: categoryBreakdown(req.query.from || monthStart(mk), req.query.to || monthEnd(mk), req.query.kind || 'expense') });
}));
router.get('/networth', wrap(async (req, res) => ok(res, { current: netWorth(), history: nwHistory(Number(req.query.limit) || 36) })));
router.post('/networth/snapshot', wrap(async (req, res) => ok(res, { snapshot: snapshot(req.body?.date || today()) })));

// ---- dự báo & tự do tài chính --------------------------------------------

router.get('/forecast', wrap(async (req, res) => ok(res, {
  daily: dailyForecast(Number(req.query.days) || 60),
  monthly: monthlyForecast(Number(req.query.months) || 12),
  safe_to_spend: safeToSpend(),
})));
router.get('/fire', wrap(async (req, res) => ok(res, { fire: fireStats(req.query), emergency: emergencyStatus(), passive: passiveIncomeMonthly() })));
router.get('/passive/roadmap', wrap(async (req, res) => ok(res, {
  roadmap: passiveRoadmap({
    monthly_contribution: req.query.monthly_contribution !== undefined ? Number(req.query.monthly_contribution) : undefined,
    risk: req.query.risk,
  }),
})));

// ---- cố vấn ---------------------------------------------------------------

router.get('/advisor/health', wrap(async (req, res) => ok(res, { health: healthScore() })));
router.get('/advisor/actions', wrap(async (req, res) => ok(res, { actions: nextActions(Number(req.query.limit) || 6) })));
router.get('/advisor/surplus', wrap(async (req, res) => {
  const amount = Number(req.query.amount) || Math.max(0, netWorth().breakdown.liquid - averageMonthlyExpense(3) * 6);
  ok(res, { plan: surplusPlan(amount), split: investmentSplit(amount, get('SELECT risk_profile FROM profile WHERE id=1')?.risk_profile) });
}));

// ---- cảnh báo -------------------------------------------------------------

router.get('/insights', wrap(async (req, res) => ok(res, { insights: listInsights({ includeDismissed: req.query.all === '1' }) })));
router.post('/insights/generate', wrap(async (req, res) => ok(res, { generated: generateInsights().length, insights: listInsights({}) })));
router.patch('/insights/:id', wrap(async (req, res) => {
  update('insights', Number(req.params.id), req.body);
  ok(res, { insight: get('SELECT * FROM insights WHERE id = ?', [Number(req.params.id)]) });
}));

// ---- tự động hoá / nhập liệu ---------------------------------------------

router.post('/ingest', wrap(async (req, res) => {
  const body = req.body || {};
  if (body.text) return ok(res, ingestMessage(body));
  // payload có cấu trúc sẵn (webhook từ app khác)
  const result = createTransaction({
    type: body.type || 'expense', amount: body.amount, date: body.date || today(),
    account_id: body.account_id, note: body.note || body.description, merchant: body.merchant,
    source: body.channel || 'webhook', external_id: body.external_id, raw: JSON.stringify(body),
  });
  ok(res, { status: result.duplicate ? 'duplicate' : 'created', ...result });
}));
router.post('/ingest/preview', wrap(async (req, res) => ok(res, { parsed: parseBankMessage(req.body?.text) })));
router.post('/ingest/csv', wrap(async (req, res) => ok(res, importCSV(req.body?.csv || '', { account_id: req.body?.account_id, dry_run: req.body?.dry_run }))));
router.get('/ingest/log', wrap(async (req, res) => ok(res, { log: ingestHistory(Number(req.query.limit) || 50) })));

router.get('/rules', wrap(async (req, res) => ok(res, { rules: all('SELECT r.*, c.name AS category_name FROM rules r LEFT JOIN categories c ON c.id = r.category_id ORDER BY r.priority, r.id') })));
router.post('/rules', wrap(async (req, res) => {
  const id = insert('rules', req.body);
  ok(res, { rule: get('SELECT * FROM rules WHERE id = ?', [id]) });
}));
router.delete('/rules/:id', wrap(async (req, res) => ok(res, { removed: remove('rules', Number(req.params.id)) })));

router.post('/automation/run', wrap(async (req, res) => ok(res, runAutomation())));
router.get('/automation/status', wrap(async (req, res) => ok(res, {
  last_run: setting('last_automation_run'),
  recurring: all('SELECT id, name, type, amount, next_date, auto_post, active FROM recurring ORDER BY next_date'),
  accounts_synced: all('SELECT id, name, auto_sync, last_synced_at FROM accounts WHERE is_active = 1'),
  webhook_url: `${req.protocol}://${req.get('host')}/api/ingest`,
  token: ingestToken(),
  pin_set: pinIsSet(),
  log: ingestHistory(10),
})));

/** Đổi token webhook khi nghi bị lộ — Shortcut trên máy cũ sẽ ngừng gửi được. */
router.post('/automation/rotate-token', wrap(async (req, res) => ok(res, { token: rotateIngestToken() })));

// ---- nhật ký, trí nhớ và rà soát chủ động của AI ---------------------------

router.get('/ai/actions', wrap(async (req, res) => ok(res, {
  actions: listActions({ limit: Number(req.query.limit) || 50, mutating_only: req.query.mutating === '1' }),
  stats: actionStats(),
})));
router.get('/ai/actions/:id', wrap(async (req, res) => {
  const d = actionDetail(Number(req.params.id));
  return d ? ok(res, d) : res.status(404).json({ ok: false, error: 'Không tìm thấy thao tác.' });
}));
router.post('/ai/actions/:id/undo', wrap(async (req, res) => ok(res, undoAction(Number(req.params.id)))));
router.post('/ai/undo', wrap(async (req, res) => ok(res, req.body?.batch ? undoBatch(req.body.batch) : undoLast(req.body?.n || 1))));

router.get('/ai/memory', wrap(async (req, res) => ok(res, { memory: listMemory({ kind: req.query.kind || null }) })));
router.post('/ai/memory', wrap(async (req, res) => ok(res, remember({ ...req.body, source: 'user' }))));
router.delete('/ai/memory/:id', wrap(async (req, res) => ok(res, forget({ id: Number(req.params.id) }))));

router.get('/ai/review', wrap(async (req, res) => ok(res, { config: reviewConfig(), last: lastReview(), history: reviewHistory(10) })));
router.put('/ai/review', wrap(async (req, res) => ok(res, setReviewConfig(req.body || {}))));
router.post('/ai/review/run', wrap(async (req, res) => {
  const r = await runReview({ force: true });
  return ok(res, r || { ok: false, error: 'Rà soát cần API key của AI. Bật trong Cài đặt rồi thử lại.' });
}));

// ---- thuế -----------------------------------------------------------------

router.post('/tax/pit', wrap(async (req, res) => {
  const { gross, net, dependents = 0, insurance_base, country, status, age, pension, rent_credit } = req.body || {};
  const c = country ? String(country).toUpperCase() : taxCountry();
  const opts = {
    country: c,
    dependents: Number(dependents) || 0,
    insuranceBase: insurance_base ? Number(insurance_base) : null,
    status: status || 'single',
    age: age ? Number(age) : 30,
    pension: pension ? Number(pension) : 0,
    rentCredit: !!rent_credit,
  };
  ok(res, {
    result: gross ? grossToNetAuto(Number(gross), opts) : netToGrossAuto(Number(net), opts),
    config: taxConfigAuto(c),
    countries: Object.values(COUNTRIES),
  });
}));

router.get('/tax/config', wrap(async (req, res) => {
  const c = req.query.country ? String(req.query.country).toUpperCase() : taxCountry();
  ok(res, { country: c, config: taxConfigAuto(c), countries: Object.values(COUNTRIES) });
}));

// ---- tiền tệ & tỷ giá -----------------------------------------------------

router.get('/fx/rates', wrap(async (req, res) => {
  const base = normalizeCurrency(req.query.base, baseCurrency());
  ok(res, {
    base,
    rates: rateTable(base),
    status: fxStatus(),
    currencies: CURRENCY_CODES.map((c) => CURRENCIES[c]),
  });
}));

router.post('/fx/refresh', wrap(async (req, res) => ok(res, await refreshRates({ force: true }))));

router.post('/fx/rate', wrap(async (req, res) => {
  const { base, quote, rate, date } = req.body || {};
  if (!rate || Number(rate) <= 0) throw new Error('Tỷ giá phải lớn hơn 0');
  setRate(base, quote, Number(rate), date || today(), 'manual');
  ok(res, { rate: getRate(base, quote, date || today()), rates: rateTable(baseCurrency()) });
}));

router.get('/fx/history', wrap(async (req, res) => {
  const base = normalizeCurrency(req.query.base, baseCurrency());
  const quote = normalizeCurrency(req.query.quote, 'VND');
  ok(res, { base, quote, history: rateHistory(base, quote, Number(req.query.limit) || 90) });
}));

router.get('/fx/convert', wrap(async (req, res) => {
  const from = normalizeCurrency(req.query.from, baseCurrency());
  const to = normalizeCurrency(req.query.to, 'VND');
  const amount = Number(req.query.amount) || 0;
  ok(res, { from, to, amount, result: convert(amount, from, to, req.query.date || today()), rate: getRate(from, to) });
}));

/** Đổi đồng tiền gốc: phải tính lại base_amount của toàn bộ giao dịch cũ. */
router.post('/currency/base', wrap(async (req, res) => {
  const code = normalizeCurrency(req.body?.currency);
  if (!code) throw new Error('Đồng tiền không hợp lệ');
  const before = get('SELECT * FROM profile WHERE id = 1') || {};
  const patch = { currency: code, updated_at: new Date().toISOString() };
  // Nếu người dùng chưa từng tự chỉnh giả định thị trường thì đổi theo đồng tiền
  // mới — 9%/4% hợp với VN, còn khu vực euro thì 7%/2,5% mới sát thực tế.
  const oldAssume = marketAssumptions(before.currency || 'VND');
  const newAssume = marketAssumptions(code);
  if (Number(before.expected_return) === oldAssume.expected_return) patch.expected_return = newAssume.expected_return;
  if (Number(before.inflation) === oldAssume.inflation) patch.inflation = newAssume.inflation;
  update('profile', 1, patch);
  ensureSeedRates();
  // Quỹ chưa có đồng nào thì đổi luôn sang đồng tiền mới — nếu để nguyên VND
  // trong khi lương về bằng euro thì mọi lần phân bổ đều phải quy đổi vòng vo
  // và số dư quỹ hiện ra sai đơn vị.
  const emptyFunds = all('SELECT id FROM funds WHERE COALESCE(balance,0) = 0 AND currency <> ?', [code]);
  for (const f of emptyFunds) update('funds', f.id, { currency: code });
  const changed = recomputeBaseAmounts();
  recomputeFundBalances();
  snapshot();
  ok(res, { currency: code, recomputed: changed, funds_switched: emptyFunds.length, profile: get('SELECT * FROM profile WHERE id = 1') });
}));

// ---- chuyển tiền quốc tế (kiều hối) --------------------------------------

router.get('/remittance', wrap(async (req, res) => {
  const months = Number(req.query.months) || 12;
  ok(res, {
    base: baseCurrency(),
    list: listRemittances({ limit: Number(req.query.limit) || 100 }),
    summary: remittanceSummary({ months }),
    timing: timingAdvice(baseCurrency(), normalizeCurrency(req.query.to, 'VND')),
    cost: costInsight(months),
  });
}));

router.post('/remittance/quote', wrap(async (req, res) => {
  const { amount, from, to, fee_pct, fixed_fee } = req.body || {};
  ok(res, {
    quote: fxQuote({
      amount: Number(amount) || 0,
      from: normalizeCurrency(from, baseCurrency()),
      to: normalizeCurrency(to, 'VND'),
      feePct: fee_pct != null ? Number(fee_pct) : 0.005,
      fixedFee: fixed_fee != null ? Number(fixed_fee) : 0,
    }),
  });
}));

// ---- chạy toàn bộ engine tự động -----------------------------------------

export function runAutomation() {
  bootstrap();
  ensureSeedRates();
  // Tỷ giá lấy về nền, không chặn khởi động — offline vẫn dùng tỷ giá đã lưu.
  refreshRates().catch((e) => console.warn('[finmate] không lấy được tỷ giá:', e.message));
  const posted = runDueRecurring();
  const interest = accrueInterest();
  snapshot();
  recomputeFundBalances();
  const insights = generateInsights();
  const backup = autoBackup();
  pruneMemory();
  setting('last_automation_run', new Date().toISOString());
  // Phiên rà soát của AI chạy nền, không chặn: nó gọi mạng nên có thể chậm, và
  // hỏng thì bộ luật sinh cảnh báo ở trên vẫn đủ dùng.
  runReview().then((r) => { if (r) console.log('[finmate] AI rà soát định kỳ xong:', r.cong_cu_da_dung.length, 'công cụ'); })
    .catch((e) => console.warn('[finmate] rà soát lỗi:', e.message));
  return { posted, interest, insights: insights.length, backup, at: new Date().toISOString() };
}
