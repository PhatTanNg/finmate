/**
 * Bộ công cụ AI agent được phép gọi.
 *
 * Quy ước quan trọng:
 *  - Agent luôn nói số tiền bằng ĐƠN VỊ LỚN (65000 đồng, 12.5 euro) cho dễ hiểu;
 *    mọi tool ở đây tự quy về đơn vị nhỏ nhất bằng toMinor() trước khi ghi DB.
 *  - Mỗi tool trả về object gọn để nhét lại vào hội thoại — không trả cả cục DB.
 *  - Tool nào ghi dữ liệu thì đặt cờ `mutates: true` để tầng trên biết cần làm mới UI.
 */
import { all, get, insert, update, run } from '../../db.js';
import { today, monthKey, monthStart, monthEnd, addMonths } from '../../util/date.js';
import { toMinor, normalizeCurrency } from '../../util/currency.js';
import { baseCurrency, convert, getRate, rateTable } from '../fx.js';
import { createTransaction, deleteTransaction, listTransactions } from '../ledger.js';
import { listFunds, fundsOverview, moveBetweenFunds, fundPlan, monthlyFundLoad, archiveFund, reopenFund } from '../funds.js';
import { budgetStatus, upsertBudget, suggestBudgets } from '../budgets.js';
import { portfolio, realEstate, upsertHolding, setPrice as setHoldingPrice, guessSymbolCurrency } from '../investments.js';
import { debtSummary, payoffPlan } from '../debts.js';
import { createRecurring, upcoming } from '../recurring.js';
import { fireStats, emergencyStatus, passiveIncomeMonthly } from '../fire.js';
import { dailyForecast, monthlyForecast, safeToSpend } from '../forecast.js';
import { totals, categoryBreakdown, monthlyTrend, incomeSources, topMerchants, averageMonthlyExpense } from '../reports.js';
import { netWorth, accountsBase } from '../networth.js';
import { healthScore, surplusPlan, nextActions, investmentSplit } from '../advisor.js';
import { projectedAnnualInterest } from '../interest.js';
import { quote as fxQuote, timingAdvice, remittanceSummary, costInsight } from '../remittance.js';
import { taxCountry, grossToNetAuto, estimateAnnualTaxAuto, COUNTRIES } from '../tax_router.js';
import { categoryByName, fundByName } from '../../bootstrap.js';
import { generateInsights, listInsights } from '../insights.js';

const ACCOUNT_TYPES = ['cash', 'bank', 'ewallet', 'savings', 'investment', 'credit', 'credit_card', 'brokerage', 'crypto', 'real_estate', 'loan', 'other_asset'];
const INCOME_TYPES = ['salary', 'business', 'freelance', 'dividend', 'interest', 'rental', 'capital_gain', 'royalty', 'other'];

/** Số tiền agent gửi luôn là đơn vị lớn -> quy về đơn vị nhỏ nhất để ghi DB. */
function minor(amount, currency) {
  const code = normalizeCurrency(currency || baseCurrency());
  const n = num(amount);
  if (n == null) throw new Error('Số tiền không hợp lệ. Hãy truyền một con số, ví dụ 65000 hoặc 12.5.');
  return { value: toMinor(n, code), code };
}

/** Chấp nhận cả "1.250,50" / "1,250.50" / " 65000 " vì model đôi khi trả chuỗi đã định dạng. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Dấu xuất hiện sau cùng là dấu thập phân, dấu kia là phân cách nghìn.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.split(',').length === 2 && s.length - lastComma <= 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Số tiền phải dương. Model đôi khi gửi số âm với ý "hoàn lại/giảm đi", nhưng
 *  DB lấy trị tuyệt đối nên khoản đó bị ghi NGƯỢC HƯỚNG mà không ai biết. */
function minorPositive(amount, currency, hint = '') {
  const n = num(amount);
  if (n == null) throw new Error('Số tiền không hợp lệ. Hãy truyền một con số, ví dụ 65000 hoặc 12.5.');
  if (n <= 0) throw new Error(`Số tiền phải lớn hơn 0 (nhận được ${n}).${hint ? ' ' + hint : ''}`);
  return minor(n, currency);
}

/** Ngưỡng "to bất thường" theo đơn vị lớn — chỉ để cảnh báo, không chặn. */
const HUGE = { VND: 2_000_000_000, KRW: 500_000_000, JPY: 50_000_000, IDR: 5_000_000_000, THB: 10_000_000 };

/**
 * Cảnh báo khi số tiền lệch hẳn khỏi mức thường thấy.
 * Không chặn — mua nhà, trả học phí là chuyện có thật. Nhưng model gõ thừa số 0
 * (rất dễ với VND) sẽ làm vỡ mọi báo cáo, nên phải nói ra để agent xác nhận lại.
 */
function amountWarning(major, valueMinor, code) {
  let avg = 0;
  try { avg = averageMonthlyExpense(6) || 0; } catch { /* chưa đủ lịch sử */ }
  if (avg > 0) {
    let inBase = valueMinor;
    try { inBase = convert(valueMinor, code, baseCurrency()); } catch { /* thiếu tỉ giá */ }
    if (inBase > avg * 30) {
      return `Số tiền này gấp ~${Math.round(inBase / avg)} lần mức chi trung bình một tháng. Hãy xác nhận lại với người dùng; nếu gõ nhầm hãy gọi hoan_tac_gan_nhat.`;
    }
    return null;
  }
  const limit = HUGE[code] ?? 200_000;
  if (major > limit) return `Số tiền ${major} ${code} lớn bất thường. Hãy hỏi lại người dùng cho chắc; nếu gõ nhầm hãy gọi hoan_tac_gan_nhat.`;
  return null;
}

/** Ngày quá xa làm hỏng báo cáo tháng và dự báo dòng tiền. */
function dateWarning(ngay) {
  if (!ngay) return null;
  const d = String(ngay).slice(0, 10);
  const diff = Math.round((Date.parse(d) - Date.parse(today())) / 86400000);
  if (!Number.isFinite(diff)) return null;
  if (diff > 60) return `Ngày ${d} là ${diff} ngày nữa. Nếu đây là khoản định kỳ sắp tới, hãy dùng tao_giao_dich_dinh_ky thay vì ghi sổ ngay.`;
  if (diff < -3650) return `Ngày ${d} cách đây hơn 10 năm — có thể gõ nhầm năm.`;
  return null;
}

/** Ưu tiên quy ước 1-9 (nhỏ = quan trọng hơn). Số âm khiến quỹ đó vượt cả quỹ thiết yếu. */
function priorityOf(v) {
  const n = Math.round(num(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(99, Math.max(1, n));
}

/** Hạn đã qua thì mọi phép tính "mỗi tháng cần bỏ bao nhiêu" đều vô nghĩa. */
function deadlineWarning(han) {
  if (!han) return null;
  const d = String(han).slice(0, 10);
  return Date.parse(d) < Date.parse(today())
    ? `Hạn ${d} đã nằm ở quá khứ nên không tính được số tiền cần góp mỗi tháng. Hãy hỏi người dùng hạn mới.`
    : null;
}

/** Gộp nhiều cảnh báo thành một trường, bỏ các giá trị rỗng. */
const warn = (...xs) => { const l = xs.filter(Boolean); return l.length ? l.join(' ') : null; };

/** So khớp tên bỏ dấu, không phân biệt hoa thường — model hay gõ thiếu dấu. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

/** Tìm theo id, tên khớp chính xác, rồi mới tới khớp một phần (ưu tiên chuỗi dài nhất). */
function match(list, key) {
  if (key == null || key === '') return null;
  if (/^\d+$/.test(String(key))) {
    const byId = list.find((x) => x.id === Number(key));
    if (byId) return byId;
  }
  const n = fold(key);
  if (!n) return null;
  return list.find((x) => fold(x.name) === n)
    || list.filter((x) => fold(x.name).includes(n) || n.includes(fold(x.name))).sort((a, b) => b.name.length - a.name.length)[0]
    || null;
}

function findAccount(nameOrId) {
  const active = all('SELECT * FROM accounts WHERE is_active = 1');
  return match(active, nameOrId) || match(all('SELECT * FROM accounts'), nameOrId);
}

const findGoal = (k) => match(all('SELECT * FROM goals'), k);
const findDebt = (k) => match(all('SELECT * FROM debts'), k);
const findFund = (k) => match(listFunds(), k) || (fundByName ? fundByName(k) : null);

const tenTaiKhoan = () => all('SELECT name FROM accounts WHERE is_active = 1').map((a) => a.name);

/* ------------------------------------------------------------------ *
 *  GHI DỮ LIỆU                                                        *
 * ------------------------------------------------------------------ */

function ghi_giao_dich({ loai = 'expense', so_tien, dong_tien, mo_ta, danh_muc, tai_khoan, tai_khoan_nhan, ngay, noi_chi }) {
  const acc = findAccount(tai_khoan);
  const code = normalizeCurrency(dong_tien || acc?.currency || baseCurrency());
  const { value } = minorPositive(so_tien, code, 'Nếu đây là khoản tiền vào, hãy đặt loai="income" thay vì dùng số âm.');

  const type = loai === 'income' ? 'income' : loai === 'transfer' ? 'transfer' : 'expense';
  let to = null;
  if (type === 'transfer') {
    to = findAccount(tai_khoan_nhan);
    if (!to) {
      const ds = all('SELECT name FROM accounts WHERE is_active = 1').map((a) => a.name).join(', ');
      return { ok: false, error: `Chuyển khoản cần biết tiền vào tài khoản nào (tham số tai_khoan_nhan). Các tài khoản đang có: ${ds}.` };
    }
    if (acc && to.id === acc.id) return { ok: false, error: 'Tài khoản gửi và nhận đang trùng nhau.' };
  }

  const cat = danh_muc && type !== 'transfer' ? categoryByName(danh_muc, type === 'income' ? 'income' : 'expense') : null;
  // Phải đo TRƯỚC khi ghi: nếu đo sau, chính khoản bất thường này sẽ kéo mức
  // trung bình lên và tự che giấu mình.
  const canhBaoTien = amountWarning(num(so_tien), value, code);
  const res = createTransaction({
    type,
    amount: value,
    currency: code,
    note: mo_ta || danh_muc || '',
    merchant: noi_chi || null,
    date: ngay || today(),
    account_id: acc?.id,
    counter_account_id: to?.id,
    category_id: cat?.id,
    source: 'chat',
  });
  const t = res.transaction;
  const c = t.category_id ? get('SELECT name, icon FROM categories WHERE id = ?', [t.category_id]) : null;
  return {
    ok: true,
    mutates: true,
    id: t.id,
    da_ghi: { loai: t.type, so_tien: t.amount, dong_tien: t.currency, danh_muc: c ? `${c.icon || ''} ${c.name}`.trim() : null, tai_khoan: acc?.name || null, tai_khoan_nhan: to?.name || null, ngay: t.date },
    canh_bao: warn(res.warnings, canhBaoTien, dateWarning(ngay)),
  };
}

function xoa_giao_dich({ id }) {
  const t = get('SELECT * FROM transactions WHERE id = ?', [Number(id)]);
  if (!t) return { ok: false, error: 'Không tìm thấy giao dịch.' };
  deleteTransaction(Number(id));
  return { ok: true, mutates: true, da_xoa: { id: t.id, so_tien: t.amount, mo_ta: t.note } };
}

function hoan_tac_gan_nhat() {
  const t = get("SELECT * FROM transactions WHERE source IN ('chat','manual') ORDER BY id DESC LIMIT 1");
  if (!t) return { ok: false, error: 'Không có giao dịch nào để hoàn tác.' };
  deleteTransaction(t.id);
  return { ok: true, mutates: true, da_hoan_tac: { so_tien: t.amount, dong_tien: t.currency, mo_ta: t.note, ngay: t.date } };
}

function tao_tai_khoan({ ten, loai = 'bank', so_du = 0, dong_tien, lai_suat, ngan_hang }) {
  if (!ten) return { ok: false, error: 'Cần tên tài khoản.' };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  if (!ACCOUNT_TYPES.includes(loai)) return { ok: false, error: `Loại tài khoản phải thuộc: ${ACCOUNT_TYPES.join(', ')}` };
  const exist = all('SELECT * FROM accounts').find((a) => a.name.toLowerCase() === String(ten).toLowerCase());
  if (exist) return capnhat_so_du({ tai_khoan: exist.id, so_du, dong_tien: code });
  const { value } = minor(so_du, code);
  const id = insert('accounts', {
    name: ten, type: loai, currency: code, balance: value, opening_balance: value,
    interest_rate: Number(lai_suat) || 0, institution: ngan_hang || null, is_active: 1,
  });
  return { ok: true, mutates: true, da_tao: { id, ten, loai, so_du: value, dong_tien: code } };
}

function capnhat_so_du({ tai_khoan, so_du, dong_tien }) {
  const acc = findAccount(tai_khoan);
  if (!acc) return { ok: false, error: `Không tìm thấy tài khoản "${tai_khoan}".`, tai_khoan_hop_le: tenTaiKhoan() };
  const code = normalizeCurrency(dong_tien || acc.currency || baseCurrency());
  const { value } = minor(so_du, code);
  const chenh = value - acc.balance;
  update('accounts', acc.id, { balance: value, currency: code });
  // Ghi một bút toán điều chỉnh để lịch sử vẫn khớp số dư.
  if (chenh !== 0) {
    createTransaction({
      type: chenh > 0 ? 'income' : 'expense',
      amount: Math.abs(chenh),
      currency: code,
      account_id: acc.id,
      note: `Điều chỉnh số dư ${acc.name} theo thực tế`,
      date: today(),
      source: 'system',
      excluded: 1,
    });
    update('accounts', acc.id, { balance: value });
  }
  return { ok: true, mutates: true, tai_khoan: acc.name, so_du_moi: value, dong_tien: code, chenh_lech: chenh };
}

function tao_muc_tieu({ ten, so_tien, han, dong_tien, gop_moi_thang, loai = 'save' }) {
  if (!ten || !so_tien) return { ok: false, error: 'Cần tên và số tiền mục tiêu.' };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  const { value } = minorPositive(so_tien, code, 'Số tiền mục tiêu phải dương.');
  const exist = all('SELECT * FROM goals').find((g) => g.name.toLowerCase() === String(ten).toLowerCase());
  const data = {
    name: ten, type: loai, target_amount: value, currency: code,
    deadline: han || null,
    monthly_contribution: gop_moi_thang ? minorPositive(gop_moi_thang, code).value : 0,
    status: 'active',
  };
  const canh_bao = deadlineWarning(han);
  if (exist) { update('goals', exist.id, data); return { ok: true, mutates: true, da_cap_nhat: { id: exist.id, ...data }, canh_bao }; }
  const id = insert('goals', data);
  return { ok: true, mutates: true, da_tao: { id, ten, so_tien: value, dong_tien: code, han: han || null }, canh_bao };
}

function gop_tien_muc_tieu({ muc_tieu, so_tien, dong_tien }) {
  const g = findGoal(muc_tieu);
  if (!g) return { ok: false, error: `Không tìm thấy mục tiêu "${muc_tieu}".` };
  const code = normalizeCurrency(dong_tien || g.currency || baseCurrency());
  const { value } = minorPositive(so_tien, code, 'Muốn rút bớt khỏi mục tiêu thì dùng so_tien_rut.');
  const now = (g.current_amount || 0) + convert(value, code, normalizeCurrency(g.currency || baseCurrency()));
  update('goals', g.id, { current_amount: now, status: now >= g.target_amount ? 'done' : 'active' });
  return {
    ok: true, mutates: true, muc_tieu: g.name, da_gop: value, tong_hien_co: now,
    con_thieu: Math.max(0, g.target_amount - now),
    tien_do: g.target_amount ? Math.round((now / g.target_amount) * 100) + '%' : null,
  };
}

function findCategory(ten, kind = 'expense') {
  if (!ten) return null;
  return categoryByName(ten, kind) || match(all('SELECT * FROM categories WHERE kind = ?', [kind]), ten);
}

function dat_ngan_sach({ danh_muc, so_tien, dong_tien, thang }) {
  const cat = findCategory(danh_muc, 'expense');
  if (!cat) return { ok: false, error: `Không có danh mục "${danh_muc}".`, danh_muc_hop_le: all("SELECT name FROM categories WHERE kind='expense' ORDER BY name").map((c) => c.name) };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  const { value } = minor(so_tien, code);
  upsertBudget({ category_id: cat.id, amount: value, currency: code, month: thang || null, period: 'monthly' });
  return { ok: true, mutates: true, danh_muc: cat.name, han_muc: value, dong_tien: code, ap_dung: thang || 'mọi tháng' };
}

function dat_phan_bo_quy({ phan_bo }) {
  // Model có lúc trả object {"Quỹ": 50}, có lúc trả mảng [{quy, phan_tram}] — nhận cả hai.
  let pairs = [];
  if (Array.isArray(phan_bo)) {
    pairs = phan_bo.map((x) => [x.quy ?? x.ten ?? x.name, x.phan_tram ?? x.percent ?? x.pct]);
  } else if (phan_bo && typeof phan_bo === 'object') {
    pairs = Object.entries(phan_bo);
  } else {
    return { ok: false, error: 'Cần object dạng {"Thiết yếu": 50, "Tự do tài chính": 20}', quy_hop_le: listFunds().map((f) => f.name) };
  }
  const done = []; const bo_qua = [];
  for (const [ten, pct] of pairs) {
    const f = findFund(ten);
    if (!f) { bo_qua.push(ten); continue; }
    // % âm làm tổng bị kéo xuống, khiến các quỹ khác thực nhận nhiều hơn mức đặt.
    const p = Math.max(0, num(pct) || 0);
    update('funds', f.id, { percent: p });
    done.push({ quy: f.name, phan_tram: p });
  }
  if (!done.length) return { ok: false, error: 'Không khớp quỹ nào.', quy_hop_le: listFunds().map((f) => f.name) };
  const active = listFunds();
  const tong = active.reduce((s, f) => s + (f.percent || 0), 0);
  const out = { ok: true, mutates: true, da_dat: done, bo_qua: bo_qua.length ? bo_qua : undefined, tong_phan_tram: tong };
  // Tiền vẫn được chia hết, nhưng app chia theo TỈ LỆ chứ không theo con số tuyệt đối.
  // Nếu tổng khác 100 thì % hiển thị không còn là % thực nhận — phải nói ra, nếu không
  // agent sẽ báo với người dùng "đã đặt 80%" trong khi quỹ đó chỉ nhận 48%.
  if (Math.abs(tong - 100) > 0.01 && tong > 0) {
    out.canh_bao = `Tổng phân bổ đang là ${tong}% chứ không phải 100%, nên mỗi quỹ thực nhận theo tỉ lệ chứ không đúng con số vừa đặt. Hãy chỉnh lại cho tổng bằng 100%.`;
    out.phan_tram_thuc_nhan = active
      .filter((f) => f.percent > 0)
      .map((f) => ({ quy: f.name, khai_bao: f.percent, thuc_nhan: Math.round((f.percent / tong) * 1000) / 10 }));
  }
  return out;
}

function chuyen_quy({ tu_quy, den_quy, so_tien, dong_tien, ly_do }) {
  const a = findFund(tu_quy); const b = findFund(den_quy);
  if (!a || !b) return { ok: false, error: 'Không tìm thấy quỹ nguồn hoặc quỹ đích.', quy_hop_le: listFunds().map((f) => f.name) };
  if (a.id === b.id) return { ok: false, error: 'Quỹ nguồn và quỹ đích trùng nhau.' };
  const { value } = minor(so_tien, dong_tien || a.currency || baseCurrency());
  if (value <= 0) return { ok: false, error: 'Số tiền phải lớn hơn 0.' };
  moveBetweenFunds({ from_fund_id: a.id, to_fund_id: b.id, amount: value, note: ly_do || 'Chuyển theo yêu cầu trong chat' });
  return { ok: true, mutates: true, tu: a.name, den: b.name, so_tien: value, so_du_moi: { [a.name]: a.balance - value, [b.name]: b.balance + value } };
}

const FUND_TYPES = ['necessity', 'freedom', 'education', 'fun', 'giving', 'ltss', 'emergency', 'goal'];

/** Tạo quỹ mới hoặc cập nhật quỹ đã có (khớp theo tên). */
function tao_quy({ ten, loai = 'goal', phan_tram, muc_tieu, han_hoan_thanh, uu_tien, tran, tieu_duoc, dong_tien, ghi_chu, icon, mau }) {
  if (!ten) return { ok: false, error: 'Cần tên quỹ.' };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  const exist = findFund(ten);
  const patch = {};
  if (phan_tram != null) patch.percent = num(phan_tram) || 0;
  if (muc_tieu != null) patch.target_amount = minor(muc_tieu, code).value;
  if (han_hoan_thanh != null) patch.target_date = String(han_hoan_thanh).slice(0, 10);
  if (uu_tien != null) patch.priority = priorityOf(uu_tien) ?? 100;
  if (tran != null) patch.cap = minorPositive(tran, code, 'Trần quỹ phải dương.').value;
  if (tieu_duoc != null) patch.spendable = tieu_duoc ? 1 : 0;
  if (ghi_chu != null) patch.note = ghi_chu;
  if (icon != null) patch.icon = icon;
  if (mau != null) patch.color = mau;

  if (exist) {
    if (exist.archived) patch.archived = 0;
    update('funds', exist.id, patch);
    const f = get('SELECT * FROM funds WHERE id = ?', [exist.id]);
    return { ok: true, mutates: true, da_cap_nhat: f.name, ke_hoach: fundPlan(f), canh_bao: deadlineWarning(patch.target_date) };
  }
  if (!FUND_TYPES.includes(loai)) loai = 'goal';
  const id = insert('funds', {
    name: ten, type: loai, currency: code, balance: 0,
    percent: patch.percent ?? 0,
    target_amount: patch.target_amount ?? 0,
    target_date: patch.target_date ?? null,
    priority: patch.priority ?? 100,
    cap: patch.cap ?? 0,
    spendable: patch.spendable ?? (loai === 'necessity' || loai === 'fun' ? 1 : 0),
    note: patch.note ?? null, icon: patch.icon ?? null, color: patch.color ?? null,
  });
  const f = get('SELECT * FROM funds WHERE id = ?', [id]);
  return { ok: true, mutates: true, da_tao: f.name, id, ke_hoach: fundPlan(f), canh_bao: deadlineWarning(patch.target_date) };
}

/** Đặt mục tiêu + hạn hoàn thành, trả lại số tiền cần bỏ mỗi tháng. */
function dat_muc_tieu_quy({ quy, so_tien_muc_tieu, han_hoan_thanh, uu_tien, dong_tien }) {
  const f = findFund(quy);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ.', quy_hop_le: listFunds({ includeArchived: true }).map((x) => x.name) };
  const code = normalizeCurrency(dong_tien || f.currency || baseCurrency());
  const patch = {};
  if (so_tien_muc_tieu != null) patch.target_amount = minorPositive(so_tien_muc_tieu, code, 'Số tiền mục tiêu phải dương.').value;
  if (han_hoan_thanh != null) patch.target_date = String(han_hoan_thanh).slice(0, 10);
  if (uu_tien != null) patch.priority = priorityOf(uu_tien) ?? f.priority;
  if (!Object.keys(patch).length) return { ok: false, error: 'Cần ít nhất mục tiêu, hạn hoặc độ ưu tiên.' };
  update('funds', f.id, patch);
  const nf = get('SELECT * FROM funds WHERE id = ?', [f.id]);
  return { ok: true, mutates: true, quy: nf.name, ke_hoach: fundPlan(nf), canh_bao: deadlineWarning(patch.target_date), ghi_chu: 'monthly_needed là số tiền cần bỏ vào mỗi tháng để kịp hạn.' };
}

/** Đóng quỹ: ngừng phân bổ, dồn số dư sang quỹ khác. */
function dong_quy({ quy, chuyen_so_du_sang }) {
  const f = findFund(quy);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ.', quy_hop_le: listFunds().map((x) => x.name) };
  const target = chuyen_so_du_sang ? findFund(chuyen_so_du_sang) : null;
  if (chuyen_so_du_sang && !target) return { ok: false, error: 'Không tìm thấy quỹ nhận số dư.', quy_hop_le: listFunds().map((x) => x.name) };
  const res = archiveFund(f.id, { to_fund_id: target?.id });
  if (!res.ok) return { ...res, quy_hop_le: listFunds().map((x) => x.name) };
  const tong = listFunds().reduce((s, x) => s + (x.percent || 0), 0);
  return { ...res, mutates: true, tong_phan_tram_con_lai: tong, canh_bao: tong < 100 ? `Tổng phân bổ chỉ còn ${tong}%, nên chia lại ${(100 - tong).toFixed(0)}% cho các quỹ khác.` : null };
}

/** Mở lại quỹ đã đóng. */
function mo_lai_quy({ quy, phan_tram }) {
  const f = findFund(quy) || match(listFunds({ includeArchived: true }), quy);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ.', quy_da_dong: listFunds({ includeArchived: true }).filter((x) => x.archived).map((x) => x.name) };
  const res = reopenFund(f.id, phan_tram != null ? num(phan_tram) : null);
  return res.ok ? { ...res, mutates: true } : res;
}

/** Xoá hẳn quỹ — chỉ cho phép khi quỹ rỗng và không phải quỹ hệ thống. */
function xoa_quy({ quy }) {
  const f = findFund(quy) || match(listFunds({ includeArchived: true }), quy);
  if (!f) return { ok: false, error: 'Không tìm thấy quỹ.' };
  if (f.balance !== 0) return { ok: false, error: `Quỹ "${f.name}" còn số dư ${f.balance}. Hãy dùng dong_quy để đóng và dồn số dư sang quỹ khác.` };
  run('DELETE FROM funds WHERE id = ?', [f.id]);
  return { ok: true, mutates: true, da_xoa: f.name };
}

function them_nguon_thu({ ten, loai = 'salary', so_tien_net, so_tien_gross, dong_tien, tan_suat = 'monthly', ngay_nhan, noi_lam }) {
  if (!ten) return { ok: false, error: 'Cần tên nguồn thu.' };
  if (!INCOME_TYPES.includes(loai)) return { ok: false, error: `Loại phải thuộc: ${INCOME_TYPES.join(', ')}` };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  const net = so_tien_net ? minorPositive(so_tien_net, code, 'Nguồn thu là tiền vào nên không thể âm.').value : 0;
  const gross = so_tien_gross ? minorPositive(so_tien_gross, code, 'Nguồn thu là tiền vào nên không thể âm.').value : 0;
  const exist = all('SELECT * FROM income_streams').find((s) => s.name.toLowerCase() === String(ten).toLowerCase());
  const data = {
    name: ten, type: loai, currency: code, frequency: tan_suat,
    net_amount: net || gross, gross_amount: gross || net,
    tax_mode: gross && !net ? 'gross_pit' : 'net',
    payday: ngay_nhan ? Number(ngay_nhan) : null, employer: noi_lam || null, active: 1,
  };
  if (exist) { update('income_streams', exist.id, data); return { ok: true, mutates: true, da_cap_nhat: { id: exist.id, ...data } }; }
  const id = insert('income_streams', data);
  return { ok: true, mutates: true, da_tao: { id, ...data } };
}

function them_no({ ten, so_du, lai_suat = 0, tra_moi_thang, dong_tien, loai = 'personal', chu_no }) {
  if (!ten || !so_du) return { ok: false, error: 'Cần tên khoản nợ và số dư.' };
  const code = normalizeCurrency(dong_tien || baseCurrency());
  const bal = minorPositive(so_du, code, 'Số dư nợ là số tiền còn phải trả nên luôn dương.').value;
  const rate = Number(lai_suat) || 0;
  if (rate < 0 || rate > 200) {
    return { ok: false, error: `Lãi suất ${rate}%/năm không hợp lý. Hãy truyền lãi suất năm dạng số nguyên (ví dụ 22 nghĩa là 22%/năm), trong khoảng 0-200.` };
  }
  const exist = all('SELECT * FROM debts').find((d) => d.name.toLowerCase() === String(ten).toLowerCase());
  const data = {
    name: ten, type: loai, currency: code, balance: bal, principal: bal,
    interest_rate: rate,
    monthly_payment: tra_moi_thang ? minorPositive(tra_moi_thang, code).value : 0,
    lender: chu_no || null, status: 'active',
  };
  if (exist) { update('debts', exist.id, data); return { ok: true, mutates: true, da_cap_nhat: { id: exist.id, ...data } }; }
  const id = insert('debts', data);
  return { ok: true, mutates: true, da_tao: { id, ...data } };
}

function tra_no({ khoan_no, so_tien, dong_tien }) {
  const d = findDebt(khoan_no);
  if (!d) return { ok: false, error: `Không tìm thấy khoản nợ "${khoan_no}".`, khoan_no_hop_le: all("SELECT name FROM debts WHERE status='active'").map((x) => x.name) };
  const code = normalizeCurrency(dong_tien || d.currency || baseCurrency());
  const { value } = minor(so_tien, code);
  const con = Math.max(0, (d.balance || 0) - convert(value, code, normalizeCurrency(d.currency || baseCurrency())));
  update('debts', d.id, { balance: con, status: con === 0 ? 'paid' : 'active' });
  createTransaction({ type: 'expense', amount: value, currency: code, note: `Trả nợ ${d.name}`, date: today(), source: 'chat' });
  return { ok: true, mutates: true, khoan_no: d.name, da_tra: value, con_lai: con, het_no: con === 0 };
}

function them_dau_tu({ ma, so_luong, gia_von, dong_tien, loai = 'stock', ten }) {
  if (!ma) return { ok: false, error: 'Cần mã chứng khoán/quỹ.' };
  const qty = num(so_luong) || 0;
  if (qty < 0) return { ok: false, error: `Số lượng nắm giữ không thể âm (nhận được ${qty}). Muốn ghi nhận bán bớt thì truyền số lượng còn lại sau khi bán.` };
  const code = normalizeCurrency(dong_tien || guessSymbolCurrency(ma, baseCurrency()));
  const h = upsertHolding({
    symbol: String(ma).toUpperCase(), name: ten || String(ma).toUpperCase(), asset_class: loai,
    quantity: qty,
    avg_cost: gia_von != null ? minorPositive(gia_von, code, 'Giá vốn phải dương.').value : 0,
    currency: code,
  });
  const saved = h?.holding || h || {};
  return { ok: true, mutates: true, da_luu: { ma: saved.symbol || String(ma).toUpperCase(), so_luong: saved.quantity, gia_von: saved.avg_cost, dong_tien: code } };
}

function cap_nhat_gia({ ma, gia, dong_tien }) {
  if (!ma || !gia) return { ok: false, error: 'Cần mã và giá.' };
  const code = normalizeCurrency(dong_tien || guessSymbolCurrency(ma, baseCurrency()));
  const { value } = minorPositive(gia, code, 'Giá thị trường phải dương.');
  setHoldingPrice(String(ma).toUpperCase(), value);
  return { ok: true, mutates: true, ma: String(ma).toUpperCase(), gia_moi: value, dong_tien: code };
}

function tao_giao_dich_dinh_ky({ ten, loai = 'expense', so_tien, dong_tien, tan_suat = 'monthly', ngay_trong_thang, danh_muc, tai_khoan }) {
  if (!ten || !so_tien) return { ok: false, error: 'Cần tên và số tiền.' };
  const acc = findAccount(tai_khoan);
  const code = normalizeCurrency(dong_tien || acc?.currency || baseCurrency());
  const cat = danh_muc ? categoryByName(danh_muc, loai === 'income' ? 'income' : 'expense') : null;
  const r = createRecurring({
    name: ten, type: loai, amount: minor(so_tien, code).value, currency: code,
    frequency: tan_suat, day_of_month: ngay_trong_thang ? Number(ngay_trong_thang) : null,
    category_id: cat?.id, account_id: acc?.id, active: 1,
  });
  return { ok: true, mutates: true, da_tao: { id: r?.id, ten, so_tien: minor(so_tien, code).value, tan_suat, ngay: ngay_trong_thang || null } };
}

function cap_nhat_ho_so(patch = {}) {
  const map = {
    ten: 'name', nam_sinh: 'birth_year', thanh_pho: 'city', nguoi_phu_thuoc: 'dependents',
    tinh_trang_hon_nhan: 'marital_status', khau_vi_rui_ro: 'risk_profile', phong_cach_song: 'lifestyle',
    tuoi_nghi_huu_mong_muon: 'retire_age_target', ty_le_tiet_kiem_muc_tieu: 'savings_rate_target',
    so_thang_quy_khan_cap: 'emergency_months_target', dong_tien_goc: 'currency', quoc_gia_thue: 'tax_country',
  };
  const data = {};
  for (const [vi, col] of Object.entries(map)) if (patch[vi] !== undefined && patch[vi] !== null) data[col] = patch[vi];
  if (!Object.keys(data).length) return { ok: false, error: 'Không có trường nào hợp lệ để cập nhật.' };
  if (data.currency) data.currency = normalizeCurrency(data.currency);
  update('profile', 1, data);
  return { ok: true, mutates: true, da_cap_nhat: data };
}

function hoan_tat_thiet_lap() {
  update('profile', 1, { onboarded: 1, onboarding_step: 'done' });
  generateInsights();
  return { ok: true, mutates: true, da_hoan_tat: true, goi_y: 'Người dùng đã thiết lập xong, từ giờ trò chuyện bình thường.' };
}

/* ------------------------------------------------------------------ *
 *  TRA CỨU                                                            *
 * ------------------------------------------------------------------ */

function liet_ke_tai_khoan() {
  const base = baseCurrency();
  return {
    ok: true,
    dong_tien_goc: base,
    tai_khoan: all('SELECT id, name, type, currency, balance, interest_rate FROM accounts WHERE is_active = 1').map((a) => ({
      ...a, quy_doi_goc: convert(a.balance, normalizeCurrency(a.currency || base), base),
    })),
    tong_quy_doi: accountsBase(['cash', 'bank', 'ewallet', 'savings', 'investment', 'brokerage', 'crypto']),
  };
}

const liet_ke_quy = ({ gom_quy_dong } = {}) => ({
  ok: true,
  quy: listFunds({ includeArchived: Boolean(gom_quy_dong) }).map((f) => {
    const p = fundPlan(f);
    return {
      id: f.id, ten: f.name, loai: f.type, dong_tien: f.currency,
      phan_tram: f.percent, so_du: f.balance, tieu_duoc: Boolean(f.spendable),
      uu_tien: f.priority, dang_dong: Boolean(f.archived),
      muc_tieu: p.has_target ? p.target_amount : null,
      han_hoan_thanh: f.target_date || null,
      con_thieu: p.has_target ? p.remaining : null,
      con_lai_thang: p.months_left,
      can_bo_moi_thang: p.monthly_needed || null,
      tinh_trang: p.status || null,
    };
  }),
  tong_can_bo_moi_thang: monthlyFundLoad().total,
});
const liet_ke_danh_muc = () => ({
  ok: true,
  chi: all("SELECT name, icon FROM categories WHERE kind='expense' ORDER BY name").map((c) => c.name),
  thu: all("SELECT name, icon FROM categories WHERE kind='income' ORDER BY name").map((c) => c.name),
});
const liet_ke_muc_tieu = () => ({ ok: true, muc_tieu: all('SELECT id, name, target_amount, current_amount, deadline, currency, status FROM goals') });
const liet_ke_nguon_thu = () => ({ ok: true, nguon_thu: all('SELECT id, name, type, net_amount, gross_amount, currency, frequency, active FROM income_streams') });

function xem_chi_tieu({ tu_ngay, den_ngay, thang }) {
  const mk = thang || monthKey();
  const from = tu_ngay || monthStart(mk);
  const to = den_ngay || monthEnd(mk);
  return {
    ok: true, tu: from, den: to,
    tong: totals(from, to),
    theo_danh_muc: categoryBreakdown(from, to, 'expense').slice(0, 12),
    noi_chi_nhieu: topMerchants(from, to, 6),
  };
}

function xem_giao_dich({ so_luong = 15, tu_khoa, loai }) {
  const list = listTransactions({ limit: Math.min(Number(so_luong) || 15, 50), q: tu_khoa || undefined, type: loai || undefined });
  return { ok: true, giao_dich: (list.transactions || list || []).map((t) => ({ id: t.id, ngay: t.date, so_tien: t.amount, dong_tien: t.currency, loai: t.type, mo_ta: t.note, danh_muc: t.category_name })) };
}

const xem_tai_san = () => ({ ok: true, ...netWorth(), lai_du_kien_nam: projectedAnnualInterest() });
const xem_tu_do_tai_chinh = () => ({ ok: true, fire: fireStats(), quy_khan_cap: emergencyStatus(), thu_nhap_thu_dong: passiveIncomeMonthly() });
const xem_du_bao = () => ({ ok: true, theo_ngay: dailyForecast(60), theo_thang: monthlyForecast(12), an_toan_tieu: safeToSpend(), sap_toi: upcoming(30) });
const xem_ngan_sach = () => ({ ok: true, ...budgetStatus(), goi_y: suggestBudgets(3) });
const xem_no = () => ({ ok: true, tong_quan: debtSummary(0), ke_hoach_lai_cao_truoc: payoffPlan('avalanche', 0), ke_hoach_no_nho_truoc: payoffPlan('snowball', 0) });
const xem_dau_tu = () => ({ ok: true, danh_muc_dau_tu: portfolio(), bat_dong_san: realEstate() });
const xem_suc_khoe = () => ({ ok: true, diem: healthScore(), viec_nen_lam: nextActions(6), canh_bao: listInsights({ unreadOnly: false }).slice(0, 8) });
const xem_xu_huong = () => ({ ok: true, theo_thang: monthlyTrend(12), chi_trung_binh: averageMonthlyExpense(6), nguon_thu: incomeSources(monthStart(monthKey()), monthEnd(monthKey())) });

function tu_van_tien_du({ so_tien, dong_tien }) {
  // Không nói rõ số tiền thì lấy luôn phần còn được tiêu an toàn của tháng này.
  let value;
  if (so_tien == null || so_tien === '') {
    value = Math.max(0, safeToSpend()?.available || 0);
    if (!value) return { ok: false, error: 'Tháng này chưa có tiền dư để phân bổ. Hãy hỏi người dùng số tiền cụ thể.' };
  } else {
    value = minor(so_tien, dong_tien || baseCurrency()).value;
  }
  return { ok: true, so_tien_xet: value, phuong_an: surplusPlan(value), phan_bo_dau_tu: investmentSplit(value) };
}

function xem_ty_gia({ tu = 'EUR', den = 'VND' }) {
  const a = normalizeCurrency(tu), b = normalizeCurrency(den);
  return { ok: true, cap: `${a}/${b}`, ty_gia: getRate(a, b), bang: rateTable(), goi_y_thoi_diem: a === 'EUR' ? timingAdvice(a, b) : null };
}

function tinh_chuyen_tien({ so_tien, tu = 'EUR', den = 'VND', phi }) {
  const a = normalizeCurrency(tu), b = normalizeCurrency(den);
  return {
    ok: true,
    bao_gia: fxQuote(minor(so_tien, a).value, a, b, phi ? minor(phi, a).value : undefined),
    thoi_diem: timingAdvice(a, b),
    lich_su: remittanceSummary(12),
    chi_phi_thuc: costInsight(12),
  };
}

function tinh_thue({ luong_gross, dong_tien, quoc_gia }) {
  const country = quoc_gia || taxCountry();
  const code = normalizeCurrency(dong_tien || COUNTRIES?.[country]?.currency || baseCurrency());
  return {
    ok: true, quoc_gia: country,
    luong: grossToNetAuto(minor(luong_gross, code).value, { country }),
    thue_ca_nam_moi_nguon: estimateAnnualTaxAuto(),
  };
}

/* ------------------------------------------------------------------ *
 *  ĐĂNG KÝ                                                            *
 * ------------------------------------------------------------------ */

const T = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const N = (description) => ({ type: 'number', description });

export const TOOL_IMPL = {
  ghi_giao_dich, xoa_giao_dich, hoan_tac_gan_nhat, tao_tai_khoan, capnhat_so_du,
  tao_muc_tieu, gop_tien_muc_tieu, dat_ngan_sach, dat_phan_bo_quy, chuyen_quy,
  tao_quy, dat_muc_tieu_quy, dong_quy, mo_lai_quy, xoa_quy,
  them_nguon_thu, them_no, tra_no, them_dau_tu, cap_nhat_gia, tao_giao_dich_dinh_ky,
  cap_nhat_ho_so, hoan_tat_thiet_lap,
  liet_ke_tai_khoan, liet_ke_quy, liet_ke_danh_muc, liet_ke_muc_tieu, liet_ke_nguon_thu,
  xem_chi_tieu, xem_giao_dich, xem_tai_san, xem_tu_do_tai_chinh, xem_du_bao, xem_ngan_sach,
  xem_no, xem_dau_tu, xem_suc_khoe, xem_xu_huong, tu_van_tien_du, xem_ty_gia,
  tinh_chuyen_tien, tinh_thue,
};

export const TOOLS = [
  T('ghi_giao_dich', 'Ghi một khoản chi/thu/chuyển tiền vào sổ. Dùng khi người dùng kể về việc đã tiêu hoặc nhận tiền.', {
    loai: S('expense (chi) | income (thu) | transfer (chuyển)', { enum: ['expense', 'income', 'transfer'] }),
    so_tien: N('Số tiền theo đơn vị thường ngày, ví dụ 65000 (đồng) hoặc 12.5 (euro)'),
    dong_tien: S('Mã tiền tệ VND/EUR/USD/GBP. Bỏ trống = đồng tiền gốc của người dùng'),
    mo_ta: S('Mô tả ngắn, ví dụ "ăn trưa cơm tấm"'),
    danh_muc: S('Tên danh mục nếu người dùng nói rõ. Bỏ trống để app tự phân loại'),
    tai_khoan: S('Tên hoặc id tài khoản/ví'),
    tai_khoan_nhan: S('Chỉ dùng khi loai=transfer: tên hoặc id tài khoản nhận tiền. Bắt buộc, nếu thiếu thì tiền sẽ không vào đâu cả'),
    noi_chi: S('Tên cửa hàng/nơi chi'),
    ngay: S('YYYY-MM-DD, bỏ trống = hôm nay'),
  }, ['so_tien']),

  T('xoa_giao_dich', 'Xoá một giao dịch theo id.', { id: N('id giao dịch') }, ['id']),
  T('hoan_tac_gan_nhat', 'Xoá giao dịch vừa ghi gần nhất khi người dùng nói nhầm/huỷ.'),

  T('tao_tai_khoan', 'Tạo tài khoản/ví mới, hoặc cập nhật số dư nếu tên đã tồn tại. Dùng khi thiết lập ban đầu.', {
    ten: S('Tên tài khoản, ví dụ "Vietcombank", "AIB Current", "Tiền mặt"'),
    loai: S('Loại tài khoản', { enum: ACCOUNT_TYPES }),
    so_du: N('Số dư hiện tại theo đơn vị thường ngày'),
    dong_tien: S('VND/EUR/USD/GBP'),
    lai_suat: N('Lãi suất %/năm nếu là tiết kiệm'),
    ngan_hang: S('Tên ngân hàng/tổ chức'),
  }, ['ten']),

  T('capnhat_so_du', 'Cập nhật số dư thực tế của một tài khoản (app tự ghi bút toán điều chỉnh).', {
    tai_khoan: S('Tên hoặc id tài khoản'),
    so_du: N('Số dư mới theo đơn vị thường ngày'),
    dong_tien: S('VND/EUR/USD/GBP'),
  }, ['tai_khoan', 'so_du']),

  T('tao_muc_tieu', 'Tạo hoặc cập nhật mục tiêu tài chính (mua nhà, du lịch, quỹ khẩn cấp…).', {
    ten: S('Tên mục tiêu'), so_tien: N('Số tiền cần đạt'), han: S('Hạn YYYY-MM-DD'),
    dong_tien: S('VND/EUR/USD/GBP'), gop_moi_thang: N('Dự kiến góp mỗi tháng'),
    loai: S('Loại mục tiêu', { enum: ['save', 'purchase', 'travel', 'emergency', 'debt_payoff', 'investment', 'education', 'retirement'] }),
  }, ['ten', 'so_tien']),

  T('gop_tien_muc_tieu', 'Cộng thêm tiền vào một mục tiêu.', {
    muc_tieu: S('Tên hoặc id mục tiêu'), so_tien: N('Số tiền góp'), dong_tien: S('VND/EUR/USD/GBP'),
  }, ['muc_tieu', 'so_tien']),

  T('dat_ngan_sach', 'Đặt hạn mức chi hàng tháng cho một danh mục.', {
    danh_muc: S('Tên danh mục, ví dụ "Ăn uống"'), so_tien: N('Hạn mức mỗi tháng'),
    dong_tien: S('VND/EUR/USD/GBP'), thang: S('YYYY-MM, bỏ trống = áp dụng mọi tháng'),
  }, ['danh_muc', 'so_tien']),

  T('dat_phan_bo_quy', 'Đặt % thu nhập tự động chảy vào từng quỹ.', {
    phan_bo: { type: 'object', description: 'Ví dụ {"Thiết yếu": 50, "Tự do tài chính": 20, "Hưởng thụ": 10}', additionalProperties: { type: 'number' } },
  }, ['phan_bo']),

  T('chuyen_quy', 'Chuyển tiền giữa hai quỹ.', {
    tu_quy: S('Quỹ nguồn'), den_quy: S('Quỹ đích'), so_tien: N('Số tiền'), dong_tien: S('VND/EUR/USD/GBP'), ly_do: S('Lý do'),
  }, ['tu_quy', 'den_quy', 'so_tien']),

  T('tao_quy', 'Tạo quỹ mới hoặc sửa quỹ đã có: %, mục tiêu, hạn hoàn thành, độ ưu tiên, trần.', {
    ten: S('Tên quỹ, ví dụ "Quỹ mua nhà"'),
    loai: S('Loại quỹ', { enum: FUND_TYPES }),
    phan_tram: N('% thu nhập tự động chảy vào quỹ này'),
    muc_tieu: N('Số tiền mục tiêu cần đạt'),
    han_hoan_thanh: S('Hạn hoàn thành YYYY-MM-DD, dùng để tính số tiền cần bỏ mỗi tháng'),
    uu_tien: N('Độ ưu tiên, số càng nhỏ càng ưu tiên (1 = cao nhất)'),
    tran: N('Trần quỹ, vượt thì tiền chảy sang quỹ kế tiếp'),
    tieu_duoc: { type: 'boolean', description: 'true = quỹ để chi tiêu, false = quỹ tích luỹ' },
    dong_tien: S('VND/EUR/USD/GBP'), ghi_chu: S('Ghi chú'), icon: S('Emoji'), mau: S('Mã màu hex'),
  }, ['ten']),

  T('dat_muc_tieu_quy', 'Đặt số tiền mục tiêu + hạn hoàn thành cho quỹ; trả về số tiền cần bỏ mỗi tháng.', {
    quy: S('Tên hoặc id quỹ'), so_tien_muc_tieu: N('Số tiền cần đạt'),
    han_hoan_thanh: S('Hạn YYYY-MM-DD'), uu_tien: N('Độ ưu tiên, nhỏ = ưu tiên cao'),
    dong_tien: S('VND/EUR/USD/GBP'),
  }, ['quy']),

  T('dong_quy', 'Đóng một quỹ: ngừng nhận phân bổ, dồn số dư sang quỹ khác, giữ nguyên lịch sử.', {
    quy: S('Tên hoặc id quỹ cần đóng'),
    chuyen_so_du_sang: S('Quỹ nhận số dư còn lại; bỏ trống thì tự chọn quỹ cùng đồng tiền'),
  }, ['quy']),

  T('mo_lai_quy', 'Mở lại một quỹ đã đóng.', {
    quy: S('Tên hoặc id quỹ'), phan_tram: N('% phân bổ mới, bỏ trống thì giữ nguyên'),
  }, ['quy']),

  T('xoa_quy', 'Xoá hẳn một quỹ rỗng khỏi app.', { quy: S('Tên hoặc id quỹ') }, ['quy']),

  T('them_nguon_thu', 'Thêm/cập nhật nguồn thu nhập: lương, cho thuê, cổ tức, lãi ngân hàng, freelance…', {
    ten: S('Tên nguồn thu'), loai: S('Loại', { enum: INCOME_TYPES }),
    so_tien_net: N('Thực nhận mỗi kỳ'), so_tien_gross: N('Trước thuế mỗi kỳ'),
    dong_tien: S('VND/EUR/USD/GBP'),
    tan_suat: S('Tần suất', { enum: ['monthly', 'quarterly', 'yearly', 'weekly', 'irregular'] }),
    ngay_nhan: N('Ngày trong tháng nhận tiền'), noi_lam: S('Công ty/nguồn'),
  }, ['ten']),

  T('them_no', 'Thêm/cập nhật khoản nợ.', {
    ten: S('Tên khoản nợ'), so_du: N('Dư nợ hiện tại'), lai_suat: N('%/năm'),
    tra_moi_thang: N('Số tiền trả mỗi tháng'), dong_tien: S('VND/EUR/USD/GBP'),
    loai: S('Loại nợ', { enum: ['mortgage', 'auto', 'personal', 'credit_card', 'student', 'bnpl', 'family'] }),
    chu_no: S('Bên cho vay'),
  }, ['ten', 'so_du']),

  T('tra_no', 'Ghi nhận một lần trả nợ.', { khoan_no: S('Tên hoặc id'), so_tien: N('Số tiền trả'), dong_tien: S('VND/EUR/USD/GBP') }, ['khoan_no', 'so_tien']),

  T('them_dau_tu', 'Thêm/cập nhật khoản đầu tư (cổ phiếu, ETF, quỹ, crypto, vàng).', {
    ma: S('Mã, ví dụ FPT, VOO, BTC, SJC'), so_luong: N('Số lượng'), gia_von: N('Giá vốn trung bình mỗi đơn vị'),
    dong_tien: S('VND/EUR/USD/GBP'), loai: S('Loại tài sản', { enum: ['stock', 'etf', 'fund', 'crypto', 'gold', 'bond', 'other'] }), ten: S('Tên đầy đủ'),
  }, ['ma']),

  T('cap_nhat_gia', 'Cập nhật giá thị trường của một mã đang nắm giữ.', { ma: S('Mã'), gia: N('Giá mỗi đơn vị'), dong_tien: S('VND/EUR/USD/GBP') }, ['ma', 'gia']),

  T('tao_giao_dich_dinh_ky', 'Tạo khoản thu/chi lặp lại: tiền nhà, gói cước, lương…', {
    ten: S('Tên'), loai: S('Loại', { enum: ['income', 'expense', 'transfer'] }), so_tien: N('Số tiền mỗi kỳ'),
    dong_tien: S('VND/EUR/USD/GBP'), tan_suat: S('Tần suất', { enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] }),
    ngay_trong_thang: N('Ngày trong tháng'), danh_muc: S('Danh mục'), tai_khoan: S('Tài khoản'),
  }, ['ten', 'so_tien']),

  T('cap_nhat_ho_so', 'Cập nhật thông tin cá nhân dùng cho mọi tính toán (tuổi, thành phố, khẩu vị rủi ro, đồng tiền gốc, nước tính thuế…).', {
    ten: S('Tên gọi'), nam_sinh: N('Năm sinh, ví dụ 1996'), thanh_pho: S('Thành phố đang sống'),
    nguoi_phu_thuoc: N('Số người phụ thuộc'), tinh_trang_hon_nhan: S('single | married'),
    khau_vi_rui_ro: S('conservative | balanced | aggressive'), phong_cach_song: S('Mô tả tự do về lối sống, ưu tiên'),
    tuoi_nghi_huu_mong_muon: N('Tuổi muốn tự do tài chính'), ty_le_tiet_kiem_muc_tieu: N('0..1, ví dụ 0.3'),
    so_thang_quy_khan_cap: N('Số tháng chi phí muốn để dành'), dong_tien_goc: S('VND/EUR/USD/GBP'),
    quoc_gia_thue: S('VN hoặc IE'),
  }),

  T('hoan_tat_thiet_lap', 'Đánh dấu đã thiết lập xong hồ sơ. CHỈ gọi khi đã có: thông tin cá nhân cơ bản, ít nhất 1 tài khoản kèm số dư, và ít nhất 1 nguồn thu.'),

  T('liet_ke_tai_khoan', 'Xem toàn bộ tài khoản kèm số dư và đồng tiền.'),
  T('liet_ke_quy', 'Xem các quỹ (phong bì): % phân bổ, số dư, mục tiêu, hạn hoàn thành và số tiền cần bỏ mỗi tháng.', {
    gom_quy_dong: { type: 'boolean', description: 'true = hiện cả quỹ đã đóng' },
  }),
  T('liet_ke_danh_muc', 'Xem tên các danh mục thu/chi hợp lệ.'),
  T('liet_ke_muc_tieu', 'Xem các mục tiêu tài chính.'),
  T('liet_ke_nguon_thu', 'Xem các nguồn thu nhập.'),

  T('xem_chi_tieu', 'Xem tổng thu chi và phân tích theo danh mục trong một khoảng thời gian.', {
    thang: S('YYYY-MM'), tu_ngay: S('YYYY-MM-DD'), den_ngay: S('YYYY-MM-DD'),
  }),
  T('xem_giao_dich', 'Xem danh sách giao dịch gần đây, có thể lọc theo từ khoá.', {
    so_luong: N('Tối đa 50'), tu_khoa: S('Từ khoá tìm trong mô tả'), loai: S('expense | income | transfer'),
  }),
  T('xem_tai_san', 'Xem tài sản ròng, cơ cấu tài sản/nợ và lãi dự kiến.'),
  T('xem_tu_do_tai_chinh', 'Xem tiến độ FIRE: số tiền cần, ngày dự kiến, thu nhập thụ động, quỹ khẩn cấp.'),
  T('xem_du_bao', 'Dự báo dòng tiền 60 ngày và 12 tháng, số tiền an toàn để tiêu, hoá đơn sắp tới.'),
  T('xem_ngan_sach', 'Xem tình hình ngân sách tháng này và gợi ý hạn mức hợp lý.'),
  T('xem_no', 'Xem tổng quan nợ và so sánh hai chiến lược trả nợ.'),
  T('xem_dau_tu', 'Xem danh mục đầu tư và bất động sản.'),
  T('xem_suc_khoe', 'Xem điểm sức khoẻ tài chính, việc nên làm tiếp và các cảnh báo.'),
  T('xem_xu_huong', 'Xem xu hướng thu chi 12 tháng và cơ cấu nguồn thu.'),

  T('tu_van_tien_du', 'Gợi ý phân bổ một khoản tiền dư theo thứ tự ưu tiên. Bỏ trống so_tien để dùng số tiền còn tiêu được an toàn của tháng này.', { so_tien: N('Số tiền dư'), dong_tien: S('VND/EUR/USD/GBP') }),
  T('xem_ty_gia', 'Xem tỷ giá hiện tại và gợi ý thời điểm chuyển tiền.', { tu: S('Mã tiền nguồn'), den: S('Mã tiền đích') }),
  T('tinh_chuyen_tien', 'Tính chi phí thật của một lần chuyển tiền quốc tế.', {
    so_tien: N('Số tiền gửi'), tu: S('Mã tiền nguồn'), den: S('Mã tiền đích'), phi: N('Phí dịch vụ'),
  }, ['so_tien']),
  T('tinh_thue', 'Tính thuế thu nhập từ lương gộp theo nước cư trú (Việt Nam hoặc Ireland).', {
    luong_gross: N('Lương gộp (VN: mỗi tháng, IE: mỗi năm)'), dong_tien: S('VND/EUR'), quoc_gia: S('VN | IE'),
  }, ['luong_gross']),
];

/**
 * Model hay gọi đúng tool nhưng đặt sai tên tham số (so_du_moi thay vì so_du...).
 * Thay vì để tool im lặng ghi số 0, ta ánh xạ lại các tên hay nhầm nhất.
 */
const ALIASES = {
  ghi_giao_dich: { amount: 'so_tien', so_luong: 'so_tien', gia_tri: 'so_tien', ghi_chu: 'mo_ta', noi_dung: 'mo_ta', ten: 'mo_ta', vi: 'tai_khoan', tai_khoan_nguon: 'tai_khoan', tai_khoan_dich: 'tai_khoan_nhan', den_tai_khoan: 'tai_khoan_nhan', to_account: 'tai_khoan_nhan', currency: 'dong_tien', date: 'ngay', type: 'loai' },
  capnhat_so_du: { so_du_moi: 'so_du', so_du_hien_tai: 'so_du', balance: 'so_du', so_tien: 'so_du', ten: 'tai_khoan', tai_khoan_id: 'tai_khoan' },
  tao_tai_khoan: { so_du_hien_tai: 'so_du', balance: 'so_du', so_tien: 'so_du', ten_tai_khoan: 'ten', name: 'ten' },
  them_nguon_thu: { so_tien: 'so_tien_net', thu_nhap: 'so_tien_net', luong: 'so_tien_net', net: 'so_tien_net', gross: 'so_tien_gross', luong_gross: 'so_tien_gross', ngay: 'ngay_nhan', payday: 'ngay_nhan', cong_ty: 'noi_lam' },
  tra_no: { no: 'khoan_no', ten: 'khoan_no', ten_no: 'khoan_no', debt: 'khoan_no' },
  them_no: { so_tien: 'so_du', du_no: 'so_du', tra_toi_thieu: 'tra_moi_thang', min_payment: 'tra_moi_thang' },
  them_dau_tu: { gia_mua: 'gia_von', gia: 'gia_von', gia_trung_binh: 'gia_von', symbol: 'ma', ma_ck: 'ma', so_co_phieu: 'so_luong' },
  cap_nhat_gia: { symbol: 'ma', gia_hien_tai: 'gia', gia_moi: 'gia' },
  gop_tien_muc_tieu: { goal: 'muc_tieu', ten: 'muc_tieu', ten_muc_tieu: 'muc_tieu', so_tien_gop: 'so_tien' },
  tao_muc_tieu: { so_tien_muc_tieu: 'so_tien', muc_tieu: 'so_tien', target: 'so_tien', ten_muc_tieu: 'ten', deadline: 'han', han_chot: 'han' },
  dat_ngan_sach: { category: 'danh_muc', ten: 'danh_muc', han_muc: 'so_tien', gioi_han: 'so_tien' },
  chuyen_quy: { tu: 'tu_quy', den: 'den_quy', quy_nguon: 'tu_quy', quy_dich: 'den_quy' },
  tao_quy: { name: 'ten', ten_quy: 'ten', percent: 'phan_tram', ty_le: 'phan_tram', muc_tieu_so_tien: 'muc_tieu', so_tien_muc_tieu: 'muc_tieu', target: 'muc_tieu', han: 'han_hoan_thanh', deadline: 'han_hoan_thanh', han_chot: 'han_hoan_thanh', ngay_hoan_thanh: 'han_hoan_thanh', priority: 'uu_tien', do_uu_tien: 'uu_tien', cap: 'tran' },
  dat_muc_tieu_quy: { quy_ten: 'quy', ten: 'quy', fund: 'quy', muc_tieu: 'so_tien_muc_tieu', target: 'so_tien_muc_tieu', so_tien: 'so_tien_muc_tieu', han: 'han_hoan_thanh', deadline: 'han_hoan_thanh', han_chot: 'han_hoan_thanh', priority: 'uu_tien' },
  dong_quy: { ten: 'quy', fund: 'quy', quy_ten: 'quy', chuyen_sang: 'chuyen_so_du_sang', den_quy: 'chuyen_so_du_sang', to: 'chuyen_so_du_sang' },
  mo_lai_quy: { ten: 'quy', fund: 'quy', percent: 'phan_tram' },
  xoa_quy: { ten: 'quy', fund: 'quy' },
  tao_giao_dich_dinh_ky: { chu_ky: 'tan_suat', ngay: 'ngay_trong_thang', frequency: 'tan_suat' },
  tinh_thue: { thu_nhap_nam: 'luong_gross', thu_nhap: 'luong_gross', luong: 'luong_gross', nuoc: 'quoc_gia' },
  tu_van_tien_du: { tien_du: 'so_tien', amount: 'so_tien' },
  tinh_chuyen_tien: { tu_tien: 'tu', den_tien: 'den', amount: 'so_tien' },
  cap_nhat_ho_so: { name: 'ten', tuoi: 'nam_sinh', city: 'thanh_pho' },
  xem_giao_dich: { limit: 'so_luong', keyword: 'tu_khoa', q: 'tu_khoa' },
};

function normalizeArgs(name, args) {
  const map = ALIASES[name];
  if (!map || !args || typeof args !== 'object') return args || {};
  const out = { ...args };
  for (const [from, to] of Object.entries(map)) {
    if (out[from] !== undefined && out[to] === undefined) { out[to] = out[from]; delete out[from]; }
  }
  return out;
}

/** Chạy một tool theo tên, luôn trả object an toàn để nhét vào hội thoại. */
export function runTool(name, args) {
  const fn = TOOL_IMPL[name];
  if (!fn) return { ok: false, error: `Không có công cụ "${name}".`, cong_cu_hop_le: Object.keys(TOOL_IMPL) };
  try {
    return fn(normalizeArgs(name, args)) || { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
