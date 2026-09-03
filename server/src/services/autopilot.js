/**
 * Chế độ tự lái: AI điều phối app thay người dùng.
 *
 * Người dùng không phải mở tab nào để "vận hành" sổ sách. Tầng này chạy nền
 * mỗi giờ (và ngay khi có giao dịch mới từ ngân hàng), nhìn toàn bộ dữ liệu,
 * rồi biến những gì cần làm thành ĐỀ XUẤT CỤ THỂ có sẵn tham số: cân bằng quỹ
 * về 100%, đặt khoản định kỳ cho tiền nhà đã lặp ba tháng, giãn hạn mục tiêu
 * không kịp, xác nhận danh mục cho giao dịch mơ hồ… Mỗi đề xuất được nhắn
 * vào chat như lời một cố vấn; người dùng gật ("ừ", hoặc bấm Đồng ý) là xong.
 *
 * Ba mức, người dùng chọn:
 *   off      — im lặng, chỉ có cảnh báo như trước.
 *   propose  — (mặc định) đề xuất và chờ gật.
 *   act      — việc an toàn và hoàn tác được thì tự làm rồi báo; việc còn lại
 *              vẫn hỏi.
 *
 * Không cần model AI: đây là bộ luật. Có model thì agent dùng thêm công cụ
 * `de_xuat` để đưa đề xuất của chính nó vào cùng một hàng đợi.
 */
import { all, get, insert, update, setting } from '../db.js';
import { today, monthKey, monthStart, monthEnd, addMonths, diffDays, lastMonths, vnDate } from '../util/date.js';
import { short } from '../util/money.js';
import { normalizeCurrency } from '../util/currency.js';
import { baseCurrency, convert } from './fx.js';
import { propose, listProposals, acceptProposal, expireProposals, pendingCount } from './ai_proposals.js';
import { listFunds, fundsOverview, suggestedPercent } from './funds.js';
import { budgetStatus, suggestBudgets } from './budgets.js';
import { totals, averageMonthlyIncome, averageMonthlyExpense } from './reports.js';
import { safeToSpend } from './forecast.js';
import { upcoming } from './recurring.js';
import { listInsights } from './insights.js';

const MODE_KEY = 'autopilot_mode';
const BRIEF_KEY = 'last_daily_brief';
const MODES = ['off', 'propose', 'act'];

export function autopilotConfig() {
  const mode = setting(MODE_KEY) || 'propose';
  return { che_do: MODES.includes(mode) ? mode : 'propose', ban_tin_cuoi: setting(BRIEF_KEY) || null, dang_cho: pendingCount() };
}

export function setAutopilotConfig({ che_do } = {}) {
  if (che_do && MODES.includes(che_do)) setting(MODE_KEY, che_do);
  return autopilotConfig();
}

/** Nhắn một tin vào chat dưới danh nghĩa cố vấn. Trả về id tin nhắn. */
function say(content, intent, data = {}) {
  return insert('chat_messages', { role: 'assistant', content, intent, data: JSON.stringify(data) });
}

const onboarded = () => Boolean(get('SELECT onboarded FROM profile WHERE id = 1')?.onboarded);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ *
 *  Các luật sinh đề xuất                                              *
 * ------------------------------------------------------------------ */

/** 1. Tổng % quỹ lệch 100 → kéo về 100 giữ nguyên tỉ lệ. An toàn, hoàn tác được. */
function ruleRebalance() {
  const ov = fundsOverview();
  if (ov.balanced || !ov.funds?.some((f) => !f.archived && f.percent > 0)) return null;
  return propose({
    key: 'rebalance_funds', severity: 'warn', auto_ok: true,
    title: `Cân bằng phân bổ quỹ về 100% (đang ${ov.total_percent}%)`,
    body: `Tổng % các quỹ đang là ${ov.total_percent}% nên tiền thực chia không đúng con số bạn thấy. Mình sẽ kéo về đúng 100% mà giữ nguyên tỉ lệ giữa các quỹ.`,
    actions: [{ tool: 'can_bang_phan_bo', args: {} }],
  });
}

/**
 * 2. Khoản chi lặp đều hàng tháng (tiền nhà, gói cước, gym…) mà chưa có trong
 * "định kỳ" → đặt khoản định kỳ để app tự ghi, tự dự báo dòng tiền.
 */
function ruleRecurringCandidates() {
  const months = lastMonths(4);
  const rows = all(
    `SELECT COALESCE(NULLIF(t.merchant,''), NULLIF(t.note,'')) name, t.category_id, t.account_id, t.currency,
            COUNT(DISTINCT substr(t.date,1,7)) nm, COUNT(*) n, AVG(t.amount) avg_amount,
            MIN(t.amount) min_amount, MAX(t.amount) max_amount, MAX(CAST(substr(t.date,9,2) AS INTEGER)) day
     FROM transactions t
     WHERE t.type = 'expense' AND t.excluded = 0 AND substr(t.date,1,7) IN (${months.map(() => '?').join(',')})
       AND COALESCE(NULLIF(t.merchant,''), NULLIF(t.note,'')) IS NOT NULL
     GROUP BY lower(name)
     HAVING nm >= 3 AND n <= nm + 1 AND max_amount <= min_amount * 1.15 AND avg_amount > 0`,
    months,
  );
  if (!rows.length) return [];
  const existing = new Set(all('SELECT name FROM recurring').map((r) => fold(r.name)));
  const out = [];
  for (const r of rows.slice(0, 3)) {
    const name = String(r.name).trim();
    const key = fold(name);
    if (!key || existing.has(key) || [...existing].some((e) => e.includes(key) || key.includes(e))) continue;
    const cat = r.category_id ? get('SELECT name FROM categories WHERE id = ?', [r.category_id]) : null;
    const acc = r.account_id ? get('SELECT name FROM accounts WHERE id = ?', [r.account_id]) : null;
    const code = normalizeCurrency(r.currency) || baseCurrency();
    const amount = Math.round(r.avg_amount);
    const major = amount / Math.pow(10, code === 'VND' || code === 'JPY' || code === 'KRW' ? 0 : 2);
    const p = propose({
      key: `recurring_${key}`, severity: 'info',
      title: `Đặt "${name}" thành khoản định kỳ ${short(amount, code)}/tháng`,
      body: `Khoản này lặp lại ${r.nm} tháng liền với số tiền gần như nhau (quanh ngày ${r.day}). Đặt định kỳ thì app tự ghi đúng ngày, tự dự báo dòng tiền và nhắc trước khi tới hạn.`,
      actions: [{ tool: 'tao_giao_dich_dinh_ky', args: { ten: name, loai: 'expense', so_tien: major, dong_tien: code, tan_suat: 'monthly', ngay_trong_thang: r.day, danh_muc: cat?.name, tai_khoan: acc?.name } }],
    });
    if (p) out.push(p);
  }
  return out;
}

/** 3. Danh mục chi lớn mà chưa đặt ngân sách → đặt theo mức trung bình. */
function ruleBudgets() {
  const monthsWithData = lastMonths(3).filter((m) => (totals(monthStart(m), monthEnd(m)).expense || 0) > 0).length;
  if (monthsWithData < 2) return [];
  const have = new Set((budgetStatus().items || []).map((b) => b.name));
  const out = [];
  for (const s of suggestBudgets(3).filter((x) => !have.has(x.name)).slice(0, 2)) {
    if (!s.suggested) continue;
    const code = baseCurrency();
    const major = s.suggested / Math.pow(10, code === 'VND' || code === 'JPY' || code === 'KRW' ? 0 : 2);
    const p = propose({
      key: `budget_${s.category_id}`, severity: 'info',
      title: `Đặt ngân sách ${s.icon || ''} ${s.name} ${short(s.suggested)}/tháng`.replace(/\s+/g, ' '),
      body: `Bạn chi trung bình ${short(s.average)}/tháng cho ${s.name}. Có hạn mức thì mình báo được khi bạn tiêu nhanh hơn nhịp tháng, trước khi vượt.`,
      actions: [{ tool: 'dat_ngan_sach', args: { danh_muc: s.name, so_tien: major, dong_tien: code } }],
    });
    if (p) out.push(p);
  }
  return out;
}

/** 4. Mục tiêu không kịp hạn với dôi dư hiện tại → giãn hạn tới mốc khả thi. */
function ruleGoalsAtRisk() {
  const surplus = Math.max(0, averageMonthlyIncome(6) - averageMonthlyExpense(6));
  if (surplus <= 0) return [];
  const out = [];
  for (const g of all("SELECT * FROM goals WHERE status='active' AND deadline IS NOT NULL")) {
    const remaining = Math.max(0, (g.target_amount || 0) - (g.current_amount || 0));
    if (!remaining) continue;
    const monthsLeft = Math.max(0.1, diffDays(today(), g.deadline) / 30);
    const need = remaining / monthsLeft;
    if (need <= surplus * 1.2) continue;
    // Dành 80% dôi dư cho mục tiêu này là mức thực tế; hạn mới = số tháng cần với mức đó.
    const months = Math.ceil(remaining / (surplus * 0.8));
    if (months > 240) continue;
    const newDeadline = addMonths(today(), months);
    const p = propose({
      key: `goal_deadline_${g.id}`, severity: 'warn',
      title: `Giãn hạn mục tiêu "${g.name}" tới ${vnDate(newDeadline)}`,
      body: `Để kịp ${vnDate(g.deadline)} cần ${short(Math.round(need), g.currency)}/tháng, trong khi dôi dư của bạn chỉ ~${short(surplus)}/tháng. Với ${short(Math.round(surplus * 0.8))}/tháng thì ${vnDate(newDeadline)} là mốc thực tế. Muốn giữ hạn cũ thì cần tăng thu hoặc hạ mục tiêu.`,
      actions: [{ tool: 'sua_muc_tieu', args: { muc_tieu: g.id, han: newDeadline } }],
    });
    if (p) out.push(p);
  }
  return out;
}

/** 5. Quỹ âm vì tỉ lệ đặt sai → nâng % quỹ đó rồi cân bằng phần còn lại. */
function ruleNegativeFunds() {
  const out = [];
  for (const f of listFunds()) {
    if (f.balance >= 0) continue;
    const bump = suggestedPercent(f, 6);
    if (!bump) continue;
    const p = propose({
      key: `fund_pct_${f.id}`, severity: 'warn',
      title: `Nâng tỉ lệ quỹ ${f.name} từ ${bump.from}% lên ${bump.percent}%`,
      body: `Mỗi tháng quỹ nhận ${short(bump.flow.monthly_in, f.currency)} nhưng chi ${short(bump.flow.monthly_out, f.currency)}, nên số dư âm ${short(-f.balance, f.currency)} là hệ quả tích tụ. Mình sẽ nâng % quỹ này và hạ đều các quỹ còn lại cho đủ 100%.`,
      actions: [
        { tool: 'tao_quy', args: { ten: f.name, phan_tram: bump.percent } },
        { tool: 'can_bang_phan_bo', args: { giu_nguyen: [f.name] } },
      ],
    });
    if (p) out.push(p);
  }
  return out;
}

/** 6. Giao dịch app phân loại chưa chắc → xác nhận một lượt, app học luôn. */
function ruleReviewTransactions() {
  const rows = all(`SELECT t.id, t.amount, t.currency, t.date, t.merchant, t.note, c.name cname, c.icon cicon
                    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                    WHERE t.needs_review = 1 AND t.category_id IS NOT NULL
                      AND c.name NOT IN ('Chi khác', 'Thu khác')
                      AND COALESCE(t.note, '') NOT LIKE 'Điều chỉnh số dư%' AND COALESCE(t.source, '') NOT IN ('adjust', 'reconcile')
                    ORDER BY t.id DESC LIMIT 8`);
  if (!rows.length) return null;
  const lines = rows.map((r) => `• ${vnDate(r.date)} ${short(r.amount, r.currency)} ${r.merchant || r.note || ''} → ${r.cicon || ''} ${r.cname}`.replace(/\s+/g, ' '));
  return propose({
    key: 'confirm_categories', severity: 'info',
    title: `Xác nhận danh mục cho ${rows.length} giao dịch chưa chắc`,
    body: `Mình đoán như sau:\n${lines.join('\n')}\nĐồng ý thì mình chốt và học để lần sau tự xếp đúng. Sai chỗ nào bạn nói mình sửa.`,
    actions: rows.map((r) => ({ tool: 'sua_giao_dich', args: { id: r.id, danh_muc: r.cname } })),
  });
}

export function generateProposals() {
  if (!onboarded()) return [];
  const created = [];
  const rules = [ruleRebalance, ruleRecurringCandidates, ruleBudgets, ruleGoalsAtRisk, ruleNegativeFunds, ruleReviewTransactions];
  for (const rule of rules) {
    try {
      const r = rule();
      for (const p of Array.isArray(r) ? r : r ? [r] : []) if (p?.moi) created.push(p);
    } catch (e) {
      console.warn(`[finmate] luật tự lái ${rule.name} lỗi: ${e.message}`);
    }
  }
  return created;
}

/* ------------------------------------------------------------------ *
 *  Nhắn vào chat                                                      *
 * ------------------------------------------------------------------ */

const SEV_ICON = { danger: '🔴', warn: '🟠', info: '💡' };

function announce(p) {
  const id = say(
    `${SEV_ICON[p.muc_do] || '💡'} **Đề xuất:** ${p.tieu_de}\n${p.noi_dung || ''}\n\n_Bấm **Đồng ý** hoặc nhắn "ừ" là mình làm ngay; "thôi" để bỏ qua._`,
    'proposal', { proposal: p.id },
  );
  update('ai_proposals', p.id, { message_id: id });
  return id;
}

function announceDone(p, r) {
  return say(
    `✅ **Mình vừa tự làm:** ${p.tieu_de}\n${p.noi_dung || ''}\n\n_Không ưng thì bấm Hoàn tác hoặc nhắn "hoàn tác" — mọi thứ trả về như cũ._`,
    'autopilot', { proposal: p.id, batch: r.batch, mutated: true, tools: (r.ket_qua || []).map((x) => x.tool) },
  );
}

/**
 * Bản tin mỗi sáng — không có model AI cũng viết được từ số liệu. Chỉ gửi một
 * lần mỗi ngày và chỉ khi có gì đáng nói (chi hôm qua, hoá đơn sắp tới, đề
 * xuất đang chờ); mở app ra thấy im lặng còn hơn thấy tin rỗng.
 */
export function dailyBrief({ force = false } = {}) {
  if (!onboarded()) return null;
  const d = today();
  if (!force && setting(BRIEF_KEY) === d) return null;
  const yesterday = new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);
  const y = totals(yesterday, yesterday);
  const mk = monthKey();
  const m = totals(monthStart(mk), monthEnd(mk));
  const sts = safeToSpend();
  const bills = upcoming(7).filter((e) => e.type === 'expense');
  const pending = listProposals({ status: 'pending', limit: 5 });
  const alerts = listInsights({ limit: 3 }).filter((i) => !i.read && (i.severity === 'danger' || i.severity === 'warn'));
  const p = get('SELECT name FROM profile WHERE id = 1') || {};

  const lines = [`☀️ Chào ${p.name || 'bạn'}, tóm tắt hôm nay:`];
  if (y.expense > 0) lines.push(`• Hôm qua chi **${short(y.expense)}**${y.income > 0 ? `, thu ${short(y.income)}` : ''}.`);
  lines.push(`• Tháng này đã chi **${short(m.expense)}**; còn an toàn tiêu **${short(sts.available)}** (~${short(sts.per_day)}/ngày cho ${sts.days_left} ngày).`);
  if (bills.length) lines.push(`• ${bills.length} khoản sắp tới hạn: ${bills.slice(0, 3).map((b) => `${b.name} ${short(b.amount)} (${vnDate(b.date)})`).join(', ')}${bills.length > 3 ? '…' : ''}.`);
  for (const a of alerts) lines.push(`• ${a.severity === 'danger' ? '🔴' : '🟠'} ${a.title}`);
  if (pending.length) lines.push(`• Đang chờ bạn gật: ${pending.map((x) => `"${x.tieu_de}"`).join(', ')}.`);
  if (lines.length <= 2 && y.expense === 0 && !bills.length && !force) { setting(BRIEF_KEY, d); return null; }

  setting(BRIEF_KEY, d);
  const id = say(lines.join('\n'), 'brief', { brief: d });
  return { id, noi_dung: lines.join('\n') };
}

/**
 * Một vòng tự lái. Gọi từ tác vụ định kỳ mỗi giờ và sau mỗi giao dịch mới.
 * Trả về những gì đã nhắn/đã làm để log và test.
 */
export function runAutopilot({ force = false, brief = true } = {}) {
  const cfg = autopilotConfig();
  expireProposals();
  if (cfg.che_do === 'off' && !force) return { che_do: 'off', de_xuat: [], tu_lam: [], ban_tin: null };

  const created = generateProposals();
  const done = [];
  const asked = [];
  for (const p of created) {
    if (cfg.che_do === 'act' && p.tu_lam_duoc) {
      const r = acceptProposal(p.id, { source: 'autopilot' });
      if (r.ok) { announceDone(p, r); done.push({ id: p.id, tieu_de: p.tieu_de, batch: r.batch }); continue; }
    }
    announce(p);
    asked.push({ id: p.id, tieu_de: p.tieu_de });
  }
  const bt = brief ? dailyBrief() : null;
  return { che_do: cfg.che_do, de_xuat: asked, tu_lam: done, ban_tin: bt };
}

/* ------------------------------------------------------------------ *
 *  Phản hồi khi có giao dịch mới từ ngân hàng                         *
 * ------------------------------------------------------------------ */

/**
 * Tin nhắn ngân hàng vừa vào sổ: cố vấn nhắn một dòng cho biết nó đã xếp vào
 * đâu và ngân sách còn bao nhiêu — thay vì âm thầm ghi rồi để người dùng tự
 * phát hiện trong tab Giao dịch. Giao dịch mơ hồ thì kèm đề xuất xác nhận.
 */
export function noteIngest(result) {
  if (!result || result.status !== 'created' || !result.transaction) return null;
  const t = get(`SELECT t.*, c.name cname, c.icon cicon, a.name aname FROM transactions t
                 LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, [result.transaction.id]);
  if (!t) return null;
  const code = normalizeCurrency(t.currency) || baseCurrency();
  const who = t.merchant || t.note || 'giao dịch';
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
  let line = `💳 Vừa thấy **${sign}${short(t.amount, code)}** ${t.type === 'income' ? 'từ' : 'tại'} ${who}`;
  if (t.aname) line += ` (${t.aname})`;
  if (t.cname) line += ` → ${t.cicon || ''} ${t.cname}`.replace(/\s+/g, ' ');
  line += '.';

  const extras = [];
  if (t.type === 'expense' && t.category_id) {
    const b = (budgetStatus().items || []).find((x) => x.category_id === t.category_id || x.name === t.cname);
    if (b) extras.push(b.remaining >= 0 ? `Ngân sách ${b.name} còn ${short(b.remaining)}.` : `Ngân sách ${b.name} đã vượt ${short(-b.remaining)}.`);
  }
  if (t.type === 'income' && result.allocation?.length) extras.push(`Đã tự chia vào ${result.allocation.length} quỹ theo tỉ lệ.`);
  if (result.reconciled?.adjusted) extras.push(`Số dư ${t.aname} đã khớp lại theo ngân hàng.`);

  const id = say([line, ...extras].join(' '), 'ingest', { transaction: t.id, mutated: false });

  let proposal = null;
  if (t.needs_review && t.cname && !/^(Chi|Thu) khác$/.test(t.cname)) {
    const p = propose({
      key: `confirm_tx_${t.id}`, source: 'ingest', severity: 'info', expires_days: 7,
      title: `Xác nhận "${who}" là ${t.cname}`,
      body: `Mình chưa chắc lắm. Đúng thì gật, mình chốt và học để lần sau tự xếp; sai thì nói mình danh mục đúng.`,
      actions: [{ tool: 'sua_giao_dich', args: { id: t.id, danh_muc: t.cname } }],
    });
    if (p?.moi) { announce(p); proposal = p.id; }
  }
  return { message_id: id, proposal };
}

export const _internals = { ruleRebalance, ruleRecurringCandidates, ruleBudgets, ruleGoalsAtRisk, ruleNegativeFunds, ruleReviewTransactions, fold };
