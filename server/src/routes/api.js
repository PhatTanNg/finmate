import express from 'express';
import fs from 'node:fs';
import { all, get, insert, update, remove, run, setting } from '../db.js';
import { pinIsSet, setPin, clearPin, verifyPin, createSession, destroySession, lockedFor, noteFail, noteSuccess, ingestToken, rotateIngestToken } from '../services/auth.js';
import * as tk from '../services/accounts.js';
import { mailEnabled, sendMail, resetMail } from '../services/mailer.js';
import { rev as syncRev, syncInfo, checkLedgerBytes, backupBeforeReplace, replaceLedger } from '../services/sync.js';
import { backupDir, listBackups, createBackup, snapshotToTemp, exportAll, autoBackup } from '../services/backup.js';
import { today, monthKey, monthStart, monthEnd, lastMonths } from '../util/date.js';
import { bootstrap } from '../bootstrap.js';
import { createTransaction, updateTransaction, deleteTransaction, listTransactions, getTransaction, rebuildBalances } from '../services/ledger.js';
import { listFunds, fundsOverview, moveBetweenFunds, allocateIncome, recomputeFundBalances, postFund, archiveFund, reopenFund } from '../services/funds.js';
import { learnRule } from '../services/categorize.js';
import { createRecurring, runDueRecurring, upcoming, projectRecurring, monthlyFixed } from '../services/recurring.js';
import { accrueInterest, projectedAnnualInterest } from '../services/interest.js';
import { portfolio, upsertHolding, setPrice, recordTrade, realEstate, listHoldings } from '../services/investments.js';
import { refreshPrices, priceStatus, priceHistory, goldQuote } from '../services/prices.js';
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
import { llmEnabled, llmModel, llmStatus, testLlm } from '../services/chat/llm.js';
import { listActions, actionDetail, actionStats, undoAction, undoLast, undoBatch, pruneActions } from '../services/ai_audit.js';
import { listMemory, remember, forget, pruneMemory } from '../services/ai_memory.js';
import { runReview, reviewConfig, setReviewConfig, lastReview, reviewHistory } from '../services/ai_review.js';
import { listProposals, getProposal, acceptProposal, rejectProposal, proposalStats } from '../services/ai_proposals.js';
import { runAutopilot, autopilotConfig, setAutopilotConfig, noteIngest, dailyBrief } from '../services/autopilot.js';
import { runTool } from '../services/chat/tools.js';
import { setUserUtterance } from '../services/chat/tools_manage.js';

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

/**
 * Làm lại một việc đã làm rồi thì KHÔNG được làm thành hai.
 *
 * Giao diện lúc mất mạng xếp việc vào hàng chờ (web/src/lib/queue.js) rồi gửi
 * lại khi có sóng. Gửi lại luôn kèm theo rủi ro không tránh được: máy chủ đã
 * nhận và đã ghi, nhưng câu trả lời rơi giữa đường nên máy gửi tưởng hỏng.
 * Không có lớp này thì một ly cà phê thành hai khoản chi — và người dùng chỉ
 * phát hiện ra khi số dư lệch.
 *
 * Cách làm đơn giản nhất mà đúng: máy gửi tự sinh một mã cho mỗi việc và gửi
 * kèm; máy chủ nhớ mã đó cùng câu trả lời đã trả. Gặp lại mã cũ thì trả lại
 * đúng câu trả lời cũ, không đụng vào sổ.
 */
router.use((req, res, next) => {
  const op = req.get?.('x-finmate-op');
  if (!op || req.method === 'GET' || req.method === 'HEAD') return next();
  let cu = null;
  try { cu = get('SELECT * FROM op_log WHERE op_id = ?', [String(op).slice(0, 80)]); } catch { /* sổ chưa có bảng */ }
  if (cu) {
    res.setHeader('x-finmate-op-replay', '1');
    let than = {};
    try { than = JSON.parse(cu.body); } catch { than = { ok: true }; }
    return res.status(cu.status || 200).json(than);
  }
  // Ghi lại câu trả lời ngay lúc trả. Không nhớ lỗi 5xx: đó là trục trặc nhất
  // thời, lần gửi lại sau đáng được thử làm thật chứ không phải nhận lại lỗi cũ.
  const goc = res.json.bind(res);
  res.json = (than) => {
    try {
      if (res.statusCode < 500) {
        run('INSERT OR IGNORE INTO op_log (op_id, method, path, status, body) VALUES (?,?,?,?,?)',
          [String(op).slice(0, 80), req.method, req.path, res.statusCode, JSON.stringify(than)]);
      }
    } catch { /* không ghi được nhật ký thì cũng đừng làm hỏng câu trả lời */ }
    return goc(than);
  };
  return next();
});

// ---- hệ thống -------------------------------------------------------------

// ---- tài khoản người dùng (chỉ bật khi FINMATE_MULTIUSER=1) ----
// Tiền tố /account, KHÔNG phải /auth: /auth/* đã là khoá PIN của thiết bị —
// hai khái niệm khác hẳn nhau. Đặt trùng thì route mới che mất route cũ và
// khoá PIN im lặng hỏng (đúng lỗi bộ smoke-auth vừa bắt được).
// ---- tài khoản --------------------------

const needMulti = (res) => {
  res.status(404).json({ ok: false, error: 'Máy chủ này chạy chế độ một sổ, không có tài khoản' });
  return null;
};

// Chặn đăng ký hàng loạt: mỗi tài khoản đẻ một file sổ, một máy chủ nhỏ bị gọi
// liên tục sẽ đầy đĩa trước khi ai kịp nhận ra. Chỉ đếm những lần TẠO ĐƯỢC
// tài khoản — gõ nhầm mã mời hay trùng email không tạo ra gì, tính vào hạn mức
// thì người dùng thật bị khoá cửa vì lỗi đánh máy. Việc dò mã mời đã có bộ đếm
// sai chung với đăng nhập lo (khoá tạm sau nhiều lần sai).
const SIGNUP_MAX = Number(process.env.FINMATE_SIGNUP_PER_HOUR) || 5;
const signupHits = new Map();
const recentSignups = (ip) => {
  const now = Date.now();
  const h = (signupHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (h.length) signupHits.set(ip, h); else signupHits.delete(ip);
  return h;
};
function noteSignup(ip) {
  const h = recentSignups(ip);
  h.push(Date.now());
  signupHits.set(ip, h);
  if (signupHits.size > 5000) for (const k of [...signupHits.keys()]) recentSignups(k);
}

router.post('/account/register', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  const ip = ipOf(req);
  const cho = lockedFor(ip);
  if (cho) return res.status(429).json({ ok: false, error: `Sai nhiều lần, thử lại sau ${cho}s` });
  if (recentSignups(ip).length >= SIGNUP_MAX) {
    return res.status(429).json({ ok: false, error: 'Tạo quá nhiều tài khoản từ máy này, thử lại sau một giờ' });
  }
  let u;
  try {
    u = tk.register(req.body || {});
  } catch (e) {
    // Dò mã mời thì bị khoá tạm như dò mật khẩu. Các lỗi khác (email sai định
    // dạng, mật khẩu ngắn, email đã có) là người dùng thật gõ nhầm — không phạt.
    if (/mã mời/i.test(e.message)) noteFail(ip);
    throw e;
  }
  noteSignup(ip);
  // Đăng ký xong đăng nhập luôn: bắt gõ lại mật khẩu vừa đặt là vô ích.
  const s = tk.startSession(u.id, req.get('user-agent'));
  ok(res, { user: u, ...s });
}));

router.post('/account/login', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  const ip = ipOf(req);
  const cho = lockedFor(ip);
  if (cho) return res.status(429).json({ ok: false, error: `Sai nhiều lần, thử lại sau ${cho}s` });
  const u = tk.verify(req.body || {});
  if (!u) { noteFail(ip); return res.status(401).json({ ok: false, error: 'Email hoặc mật khẩu không đúng' }); }
  noteSuccess(ip);
  ok(res, { user: u, ...tk.startSession(u.id, req.get('user-agent')) });
}));

// ── Quên mật khẩu ─────────────────────────────────────────────────────────
//
// Câu trả lời của /account/forgot LUÔN GIỐNG NHAU dù email có tài khoản hay
// không. Nói "email này chưa đăng ký" là biếu không cho người lạ cách kiểm tra
// ai đang dùng app — với một app tài chính thì bản thân việc đó đã là rò rỉ.
const FORGOT_MAX = Number(process.env.FINMATE_FORGOT_PER_HOUR) || 8;
const forgotHits = new Map();
function forgotTooMany(ip) {
  const now = Date.now();
  const h = (forgotHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (h.length >= FORGOT_MAX) { forgotHits.set(ip, h); return true; }
  h.push(now);
  forgotHits.set(ip, h);
  if (forgotHits.size > 5000) {
    for (const [k, v] of forgotHits) if (!v.some((t) => now - t < 3600_000)) forgotHits.delete(k);
  }
  return false;
}

/** Địa chỉ app nhìn từ ngoài, để dán vào thư. Sau reverse proxy thì tin header. */
const publicBase = (req) => {
  if (process.env.FINMATE_PUBLIC_URL) return String(process.env.FINMATE_PUBLIC_URL).replace(/\/+$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
};
export const resetLink = (req, token) => `${publicBase(req)}/#reset=${token}`;

router.post('/account/forgot', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  const chung = { mail_enabled: mailEnabled(), sent: mailEnabled() };
  if (forgotTooMany(ipOf(req))) {
    return res.status(429).json({ ok: false, error: 'Yêu cầu quá nhiều lần từ máy này, thử lại sau một giờ' });
  }
  // Máy chủ chưa gắn dịch vụ gửi thư: nói thẳng ra thay vì phát vé rồi im lặng
  // để người dùng ngồi chờ một lá thư không bao giờ tới. Câu trả lời này không
  // phụ thuộc vào email nên vẫn không lộ ai có tài khoản.
  if (!mailEnabled()) return ok(res, chung);

  const ve = tk.startReset(req.body?.email);
  if (ve) {
    try {
      const thu = resetMail({ link: resetLink(req, ve.token), minutes: ve.minutes, name: ve.user.name });
      await sendMail({ to: ve.user.email, ...thu });
    } catch (e) {
      // Gửi hỏng thì ghi log cho chủ máy chủ đọc, nhưng vẫn trả lời như thường:
      // phân biệt được "gửi hỏng" với "email không tồn tại" cũng là một cách dò.
      console.error('[finmate] gửi thư đặt lại mật khẩu hỏng:', e.message);
    }
  }
  ok(res, chung);
}));

// Mở đường dẫn trong thư: hỏi xem vé còn dùng được không, để hiện đúng màn hình
// (đặt mật khẩu mới, hay "đường dẫn đã hết hạn") thay vì để người dùng gõ xong
// mới báo hỏng.
router.get('/account/reset', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  const u = tk.resetOwner(req.query.token);
  ok(res, { valid: Boolean(u), email: u?.email || null });
}));

router.post('/account/reset', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  const u = tk.resetWithToken(req.body?.token, req.body?.password);
  // Chứng minh được là chủ hộp thư rồi thì cho vào luôn, không bắt gõ lại mật
  // khẩu vừa đặt. Mọi phiên cũ đã bị xoá ở bước trên nên đây là phiên duy nhất.
  ok(res, { user: u, ...tk.startSession(u.id, req.get('user-agent')), note: 'Mọi thiết bị khác đã bị đăng xuất' });
}));

// ── Đồng bộ cả sổ giữa máy và tài khoản ───────────────────────────────────
//
// Bản chạy thẳng trên máy giữ sổ trong chính máy đó. Hai đường dưới đây là cách
// mang nguyên cuốn sổ ấy lên tài khoản (để mở ở máy khác) và mang về.
//
// Số hiệu bản (rev) là thứ giữ cho việc này không nuốt mất dữ liệu: máy gửi lên
// phải khai mình dựa trên bản nào. Máy chủ đã nhích sang bản khác — vì thiết bị
// khác vừa gửi, hoặc vì có người ghi qua giao diện web — thì trả 409 kèm thông
// tin để người dùng tự chọn, chứ không tự ghi đè.

const GIOI_HAN_SO = process.env.FINMATE_LEDGER_LIMIT || '100mb';

router.get('/account/ledger', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  if (!req.user) return res.status(401).json({ ok: false, error: 'Cần đăng nhập' });
  const file = snapshotToTemp();   // VACUUM INTO: bản nhất quán kể cả khi đang có người ghi
  res.setHeader('x-finmate-rev', String(syncRev()));
  res.setHeader('x-finmate-sync-at', syncInfo().at || '');
  res.download(file, `finmate-${today()}.db`, () => fs.rmSync(file, { force: true }));
}));

router.get('/account/ledger/info', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  if (!req.user) return res.status(401).json({ ok: false, error: 'Cần đăng nhập' });
  // "Sổ còn trắng" là thông tin quyết định lần đồng bộ ĐẦU TIÊN êm hay phiền:
  // tài khoản mới tinh thì cứ nhận sổ từ máy lên, không có gì để mà lệch. Sổ
  // đã có giao dịch thật thì đó là hai cuốn sổ khác nhau — phải hỏi người dùng.
  const soGd = get('SELECT COUNT(*) c FROM transactions').c;
  ok(res, { sync: syncInfo(), trong: Number(soGd) === 0, transactions: Number(soGd) });
}));

router.put('/account/ledger', express.raw({ type: () => true, limit: GIOI_HAN_SO }), wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  if (!req.user) return res.status(401).json({ ok: false, error: 'Cần đăng nhập' });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf) return res.status(400).json({ ok: false, error: 'Cần gửi nguyên file .db (application/octet-stream)' });

  const hienTai = syncInfo();
  const goc = req.query.base_rev === undefined ? null : Number(req.query.base_rev);
  const ep = /^(1|true|yes)$/i.test(String(req.query.force || ''));
  // Chưa từng đồng bộ (rev 0, sổ mới tinh) thì không có gì để lệch.
  if (!ep && goc !== null && goc !== hienTai.rev) {
    return res.status(409).json({
      ok: false,
      error: 'Sổ trên máy chủ đã thay đổi kể từ lần bạn tải về',
      conflict: true,
      sync: hienTai,
      base_rev: goc,
    });
  }

  // Soi file TRƯỚC khi động vào sổ đang có: gửi nhầm file thì phải hỏng ở đây,
  // lúc sổ thật vẫn còn nguyên.
  const soi = checkLedgerBytes(buf);
  const saoLuu = backupBeforeReplace(req.user.id, 'nhan-tu-may');
  const kq = replaceLedger(req.user.id, buf, { device: req.get('user-agent') });
  console.info(`[finmate] người dùng #${req.user.id} gửi sổ lên: ${soi.transactions} giao dịch, bản ${kq.rev}`);
  ok(res, { rev: kq.rev, transactions: soi.transactions, backup: saoLuu, forced: ep });
}));

router.post('/account/logout', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  tk.endSession(req.get('x-finmate-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  ok(res, { logged_out: true });
}));

router.get('/account/me', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  ok(res, { user: req.user || null });
}));

router.post('/account/password', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  if (!req.user) return res.status(401).json({ ok: false, error: 'Cần đăng nhập' });
  tk.changePassword(req.user.id, req.body || {});
  ok(res, { changed: true, note: 'Mọi thiết bị khác đã bị đăng xuất' });
}));

router.post('/account/logout-all', wrap(async (req, res) => {
  if (!tk.multiUser()) return needMulti(res);
  if (!req.user) return res.status(401).json({ ok: false, error: 'Cần đăng nhập' });
  ok(res, { closed: tk.endAllSessions(req.user.id) });
}));

router.get('/health', wrap(async (req, res) => ok(res, {
  time: new Date().toISOString(),
  db: 'sqlite',
  // Người dùng phải biết mình đang nói chuyện với bộ luật hay với AI thật —
  // hai thứ này trả lời khác hẳn nhau khi câu hỏi đi lệch khỏi khuôn mẫu.
  llm: {
    enabled: llmEnabled(),
    model: llmEnabled() ? llmModel() : null,
    // Không chỉ "có key hay không": có key mà key sai thì app vẫn chạy được
    // bằng bộ luật và chẳng ai biết. Số lần lỗi và thông điệp lỗi gần nhất
    // (đã che key) cho người dùng thấy ngay đường dây AI có thật sự thông.
    ...(llmEnabled() ? { trang_thai: llmStatus() } : {}),
  },
  // Không có mạng vẫn dùng đủ: mọi việc AI làm được đều có nút làm tay, bộ
  // luật tiếng Việt trả lời chat, tỷ giá dùng bản đã lưu.
  offline_ok: true,
  // Giao diện cần biết để hiện màn đăng nhập hay không, và có phải hỏi mã mời.
  multi_user: tk.multiUser(),
  signup_code_required: tk.multiUser() && tk.signupCodeRequired(),
  // Máy chủ có gửi được thư không: quyết định màn "quên mật khẩu" chỉ dẫn người
  // dùng chờ thư, hay bảo họ liên hệ chủ máy chủ.
  mail_enabled: tk.multiUser() && mailEnabled(),
  user: req.user || null,
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

router.get('/backup/list', wrap(async (req, res) => ok(res, { backups: listBackups(), dir: backupDir() })));

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
  ok(res, {
    messages: chatHistory(),
    profile: get('SELECT * FROM profile WHERE id = 1'),
    // Đề xuất đang chờ, để giao diện vẽ nút Đồng ý/Bỏ qua đúng dưới tin nhắn mang nó.
    proposals: listProposals({ status: 'pending', limit: 20 }),
    autopilot: autopilotConfig(),
  });
}));
router.post('/chat', wrap(async (req, res) => {
  const result = await chat(req.body?.message, { image: req.body?.image || null, offline: req.body?.offline === true });
  ok(res, result);
}));

/**
 * Cùng một lượt chat nhưng trả về dạng Server-Sent Events: giao diện thấy
 * ngay AI đang suy nghĩ hay đang gọi công cụ nào ("Đang ghi 65.000đ ăn trưa…")
 * thay vì nhìn ba chấm chờ 10-20 giây. Sự kiện cuối `done` mang đúng payload
 * của POST /chat, nên giao diện xử lý y hệt.
 */
router.post('/chat/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Giữ kết nối sống qua proxy khi model suy nghĩ lâu.
  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  try {
    send('start', { at: new Date().toISOString() });
    const result = await chat(req.body?.message, {
      image: req.body?.image || null,
      offline: req.body?.offline === true,
      onEvent: (ev) => send(ev.type, ev),
    });
    send('done', { ok: true, ...result });
  } catch (e) {
    console.warn('[api] chat/stream:', e.message || e);
    send('error', { ok: false, error: e.message || String(e) });
  } finally {
    clearInterval(ping);
    res.end();
  }
});
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
    profile: get('SELECT id, name, birth_year, city, currency, onboarded FROM profile WHERE id = 1'),
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
/** Kéo tổng % về 100 giữ nguyên tỉ lệ — cùng logic công cụ AI dùng, nhưng làm tay thì không vào nhật ký AI. */
router.post('/funds/rebalance', wrap(async (req, res) => {
  const r = runTool('can_bang_phan_bo', { giu_nguyen: req.body?.keep || [] });
  if (r.ok === false) return res.status(400).json(r);
  ok(res, r);
}));
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
// Giá thị trường tự động: cập nhật ngay (bỏ qua giới hạn 1 giờ), xem trạng thái, lịch sử giá, giá vàng.
router.post('/investments/refresh-prices', wrap(async (req, res) => ok(res, await refreshPrices({ force: true, symbols: req.body?.symbols || null }))));
router.get('/investments/prices', wrap(async (req, res) => ok(res, priceStatus())));
router.get('/investments/history/:symbol', wrap(async (req, res) => ok(res, { symbol: req.params.symbol.toUpperCase(), history: priceHistory(req.params.symbol, Number(req.query.days) || 90) })));
router.get('/investments/gold', wrap(async (req, res) => ok(res, { gold: await goldQuote() })));
router.put('/investments/gold-premium', wrap(async (req, res) => { setting('gold_premium_pct', Number(req.body?.pct) || 0); ok(res, priceStatus()); }));
// Proxy CORS cho bản chạy trên điện thoại — đặt được ngay trong app.
router.put('/investments/price-proxy', wrap(async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Địa chỉ proxy phải bắt đầu bằng https://' });
  setting('price_proxy', url);
  ok(res, priceStatus());
}));
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
/** Ghi một lần trả nợ bằng tay: trừ dư nợ, ghi khoản chi, đánh dấu hết nợ khi về 0. */
router.post('/debts/:id/pay', wrap(async (req, res) => {
  const d = get('SELECT * FROM debts WHERE id = ?', [Number(req.params.id)]);
  if (!d) return res.status(404).json({ ok: false, error: 'Không có khoản nợ này.' });
  const amount = Math.round(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Số tiền trả phải lớn hơn 0.' });
  const code = normalizeCurrency(req.body?.currency || d.currency || baseCurrency());
  // Gắn debt_id: sổ cái tự tách phần lãi/gốc, trừ dư nợ và đánh dấu trả xong khi về 0.
  const t = createTransaction({ type: 'expense', amount, currency: code, note: `Trả nợ ${d.name}`, date: req.body?.date || today(), account_id: req.body?.account_id || null, debt_id: d.id, source: 'manual' });
  const after = get('SELECT * FROM debts WHERE id = ?', [d.id]);
  ok(res, { debt: after, transaction: t.transaction, paid_off: after.balance <= 0 });
}));
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
  if (body.text) {
    const r = ingestMessage(body);
    // Cố vấn nhắn một dòng vào chat cho biết vừa ghi gì, và hỏi lại nếu chưa chắc danh mục.
    let note = null;
    try { note = noteIngest(r); } catch (e) { console.warn('[finmate] noteIngest lỗi:', e.message); }
    return ok(res, { ...r, note });
  }
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

// Thử một lượt gọi thật để biết key dùng được không. Không có nút này thì lần
// đầu dán key rất ức chế: gửi tin, nhận câu trả lời của bộ luật, không biết là
// key sai, tên model sai, hay trình duyệt bị chặn.
router.post('/ai/test', wrap(async (req, res) => ok(res, { ket_qua: await testLlm(req.body || {}) })));

router.get('/ai/memory', wrap(async (req, res) => ok(res, { memory: listMemory({ kind: req.query.kind || null }) })));
router.post('/ai/memory', wrap(async (req, res) => ok(res, remember({ ...req.body, source: 'user' }))));
router.delete('/ai/memory/:id', wrap(async (req, res) => ok(res, forget({ id: Number(req.params.id) }))));

router.get('/ai/proposals', wrap(async (req, res) => ok(res, {
  proposals: listProposals({ status: req.query.status === 'all' ? null : (req.query.status || 'pending'), limit: Number(req.query.limit) || 20 }),
  stats: proposalStats(),
  autopilot: autopilotConfig(),
})));
router.get('/ai/proposals/:id', wrap(async (req, res) => {
  const p = getProposal(req.params.id);
  return p ? ok(res, p) : res.status(404).json({ ok: false, error: 'Không có đề xuất này.' });
}));
router.post('/ai/proposals/:id/accept', wrap(async (req, res) => {
  const r = acceptProposal(Number(req.params.id), { source: 'proposal' });
  if (r.ok) {
    if (r.mutates) generateInsights();
    const p = getProposal(req.params.id);
    insert('chat_messages', { role: 'assistant', content: `✅ Xong: **${p.tieu_de}**.${r.so_buoc > 1 ? ` (${r.so_buoc} bước)` : ''}\n_Không ưng thì bấm Hoàn tác — mọi thứ trả về như cũ._`, intent: 'proposal_done', data: JSON.stringify({ proposal: p.id, batch: r.batch, mutated: !!r.mutates, tools: (r.ket_qua || []).map((x) => x.tool) }) });
  }
  ok(res, r);
}));
router.post('/ai/proposals/:id/reject', wrap(async (req, res) => ok(res, rejectProposal(Number(req.params.id)))));
router.get('/ai/autopilot', wrap(async (req, res) => ok(res, autopilotConfig())));
router.put('/ai/autopilot', wrap(async (req, res) => ok(res, setAutopilotConfig(req.body || {}))));
router.post('/ai/autopilot/run', wrap(async (req, res) => ok(res, runAutopilot({ force: true, brief: req.body?.brief !== false }))));
router.post('/ai/brief', wrap(async (req, res) => ok(res, { brief: dailyBrief({ force: true }) })));

router.get('/ai/review', wrap(async (req, res) => ok(res, { config: reviewConfig(), last: lastReview(), history: reviewHistory(10) })));
router.put('/ai/review', wrap(async (req, res) => ok(res, setReviewConfig(req.body || {}))));
router.post('/ai/review/run', wrap(async (req, res) => {
  const r = await runReview({ force: true });
  return ok(res, r || { ok: false, error: 'Rà soát cần API key của AI. Bật trong Cài đặt rồi thử lại.' });
}));

// ---- dọn dẹp bằng tay (không cần AI) ---------------------------------------

/** Gộp bản trùng tên. dry_run (mặc định) chỉ xem trước. */
router.post('/admin/dedupe', wrap(async (req, res) => {
  const r = runTool('don_trung_lap', { loai: req.body?.loai || req.body?.kind, thu_truoc: req.body?.dry_run !== false });
  if (r.ok === false) return res.status(400).json(r);
  ok(res, r);
}));
/** Xoá sạch dữ liệu: bắt buộc gõ đúng "XOA HET" — cùng chốt chặn với đường AI. */
router.post('/admin/wipe', wrap(async (req, res) => {
  const confirm = String(req.body?.confirm || '');
  setUserUtterance(confirm);
  const r = runTool('xoa_het_du_lieu', { xac_nhan: confirm, giu_lai_ho_so: req.body?.keep_profile === true });
  setUserUtterance('');
  if (r.ok === false) return res.status(400).json(r);
  ok(res, r);
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
  // Giá cổ phiếu/vàng/crypto: chạy nền, tối đa mỗi giờ một lần; lỗi từng mã không chặn gì.
  refreshPrices().then((r) => { if (r.updated) { snapshot(); console.log(`[finmate] cập nhật giá ${r.updated} mã`); } }).catch((e) => console.warn('[finmate] cập nhật giá lỗi:', e.message));
  const posted = runDueRecurring();
  const interest = accrueInterest();
  snapshot();
  recomputeFundBalances();
  const insights = generateInsights();
  const backup = autoBackup();
  pruneMemory();
  // Mã chống trùng chỉ cần sống lâu hơn quãng một máy có thể nằm ngoài vùng phủ.
  try { run("DELETE FROM op_log WHERE at < datetime('now', '-30 days')"); } catch { /* bảng có thể chưa có */ }
  // Tự lái: biến cảnh báo thành việc cụ thể chờ gật, và nhắn bản tin mỗi sáng.
  let autopilot = null;
  try { autopilot = runAutopilot(); } catch (e) { console.warn('[finmate] tự lái lỗi:', e.message); }
  setting('last_automation_run', new Date().toISOString());
  // Phiên rà soát của AI chạy nền, không chặn: nó gọi mạng nên có thể chậm, và
  // hỏng thì bộ luật sinh cảnh báo ở trên vẫn đủ dùng.
  runReview().then((r) => { if (r) console.log('[finmate] AI rà soát định kỳ xong:', r.cong_cu_da_dung.length, 'công cụ'); })
    .catch((e) => console.warn('[finmate] rà soát lỗi:', e.message));
  return { posted, interest, insights: insights.length, backup, autopilot, at: new Date().toISOString() };
}
