/**
 * Nhóm công cụ QUẢN TRỊ: sửa, xoá, dọn dẹp, làm lại từ đầu.
 *
 * Vì sao có file này: bộ công cụ ban đầu chỉ cho AI *thêm vào* — tạo tài khoản,
 * tạo mục tiêu, ghi giao dịch — mà gần như không cho *sửa* hay *bỏ đi*. Hậu quả
 * lộ ra khi dùng thật: người dùng bảo "xoá hết dữ liệu, làm lại từ đầu", AI hứa
 * "tôi sẽ xoá 19 mục tiêu trùng" rồi... không làm được gì, vì trong tay nó không
 * có một cái công cụ xoá nào cho mục tiêu. Một cố vấn không thể chỉ biết thêm
 * việc mà không được phép dọn dẹp.
 *
 * Nguyên tắc ở đây:
 *  - Mọi hàm xoá đều trả lại *đúng thứ vừa xoá* để nhật ký hoàn tác dùng được.
 *  - Xoá thứ có ràng buộc (tài khoản còn giao dịch) thì phải nói rõ vướng gì,
 *    không im lặng làm hỏng sổ.
 *  - Việc nguy hiểm (xoá sạch) đòi mật khẩu miệng, không nhận "ok" cho qua.
 */
import { all, get, update, run, db, DB_PATH } from '../../db.js';
import { normalizeCurrency } from '../../util/currency.js';
import { baseCurrency } from '../fx.js';
import { toMinor } from '../../util/currency.js';
import { bootstrap } from '../../bootstrap.js';
import { startOnboarding } from './onboarding.js';
import fs from 'node:fs';
import nodePath from 'node:path';

/**
 * Chụp nguyên trạng cơ sở dữ liệu ra một file riêng trước khi làm việc nguy hiểm.
 * Không dùng createBackup() của app vì hàm đó dọn bớt bản cũ theo lịch và ghi đè
 * mốc "đã sao lưu hôm nay" — bản chụp cứu hộ thì không được phép bị dọn.
 */
function snapshotDb(nhan) {
  const dir = process.env.FINMATE_BACKUP_DIR || nodePath.join(nodePath.dirname(DB_PATH), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  // VACUUM INTO từ chối ghi đè file có sẵn. Hai lần chụp sát nhau mà trùng tên
  // thì cả việc chụp lẫn việc gọi nó đều hỏng — nên tên phải chắc chắn không đụng.
  let file = nodePath.join(dir, `finmate-${nhan}-${stamp}.db`);
  for (let i = 2; fs.existsSync(file); i += 1) {
    file = nodePath.join(dir, `finmate-${nhan}-${stamp}-${i}.db`);
  }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return nodePath.basename(file);
}

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const N = (description) => ({ type: 'number', description });
const B = (description) => ({ type: 'boolean', description });
const T = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();

/** Tìm bản ghi theo id số hoặc theo tên gần đúng. */
function pick(rows, needle, field = 'name') {
  if (needle == null || needle === '') return null;
  const n = Number(needle);
  if (Number.isInteger(n) && n > 0) {
    const byId = rows.find((r) => r.id === n);
    if (byId) return byId;
  }
  const q = norm(needle);
  if (!q) return null;
  return rows.find((r) => norm(r[field]) === q)
    || rows.find((r) => norm(r[field]).includes(q))
    || rows.find((r) => q.includes(norm(r[field])) && norm(r[field]).length >= 3)
    || null;
}

const minorOf = (amount, currency) => toMinor(Number(amount), normalizeCurrency(currency || baseCurrency()));

/** Gợi ý danh sách khi không tìm thấy — để agent tự chọn lại thay vì bó tay. */
const options = (rows, field = 'name') => rows.slice(0, 25).map((r) => `${r.id}: ${r[field]}`);

/* ------------------------------------------------------------------ */
/* Liệt kê — agent cần id thật trước khi sửa hay xoá                    */
/* ------------------------------------------------------------------ */

function liet_ke_no() {
  const rows = all('SELECT id, name, type, lender, balance, interest_rate, monthly_payment, status, currency FROM debts ORDER BY balance DESC');
  return { ok: true, tong: rows.length, danh_sach: rows };
}

function liet_ke_dau_tu() {
  const rows = all('SELECT id, symbol, name, asset_class, quantity, avg_cost, last_price, currency FROM holdings ORDER BY symbol');
  return { ok: true, tong: rows.length, danh_sach: rows };
}

function liet_ke_ngan_sach() {
  const rows = all(`SELECT b.id, c.name AS danh_muc, b.amount, b.period, b.month, b.active, b.currency
                    FROM budgets b LEFT JOIN categories c ON c.id = b.category_id ORDER BY b.amount DESC`);
  return { ok: true, tong: rows.length, danh_sach: rows };
}

function liet_ke_dinh_ky() {
  const rows = all('SELECT id, name, type, amount, frequency, next_date, active, currency FROM recurring ORDER BY next_date');
  return { ok: true, tong: rows.length, danh_sach: rows };
}

function liet_ke_bat_dong_san() {
  const rows = all('SELECT * FROM properties ORDER BY id');
  return { ok: true, tong: rows.length, danh_sach: rows };
}

/* ------------------------------------------------------------------ */
/* Mục tiêu                                                            */
/* ------------------------------------------------------------------ */

function sua_muc_tieu({ muc_tieu, ten_moi, so_tien, han, uu_tien, trang_thai, ghi_chu }) {
  const rows = all('SELECT * FROM goals');
  const g = pick(rows, muc_tieu);
  if (!g) return { ok: false, error: `Không tìm thấy mục tiêu "${muc_tieu}".`, dang_co: options(rows) };
  const patch = {};
  if (ten_moi) patch.name = String(ten_moi).trim();
  if (so_tien != null) patch.target_amount = minorOf(so_tien, g.currency);
  if (han) patch.deadline = String(han).slice(0, 10);
  if (uu_tien != null) patch.priority = Number(uu_tien);
  if (trang_thai) patch.status = String(trang_thai);
  if (ghi_chu) patch.note = String(ghi_chu);
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa. Cho biết tên mới, số tiền, hạn, ưu tiên hoặc trạng thái.' };
  update('goals', g.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, name, target_amount, deadline, priority, status FROM goals WHERE id = ?', [g.id]) };
}

function xoa_muc_tieu({ muc_tieu }) {
  const rows = all('SELECT * FROM goals');
  const g = pick(rows, muc_tieu);
  if (!g) return { ok: false, error: `Không tìm thấy mục tiêu "${muc_tieu}".`, dang_co: options(rows) };
  run('UPDATE transactions SET goal_id = NULL WHERE goal_id = ?', [g.id]);
  run('DELETE FROM goals WHERE id = ?', [g.id]);
  return { ok: true, mutates: true, da_xoa: { id: g.id, ten: g.name, so_tien_muc_tieu: g.target_amount, da_gop: g.current_amount } };
}

/* ------------------------------------------------------------------ */
/* Nguồn thu                                                           */
/* ------------------------------------------------------------------ */

function sua_nguon_thu({ nguon_thu, ten_moi, so_tien_net, so_tien_gross, tan_suat, ngay_nhan, noi_lam, dang_hoat_dong }) {
  const rows = all('SELECT * FROM income_streams');
  const s = pick(rows, nguon_thu);
  if (!s) return { ok: false, error: `Không tìm thấy nguồn thu "${nguon_thu}".`, dang_co: options(rows) };
  const patch = {};
  if (ten_moi) patch.name = String(ten_moi).trim();
  if (so_tien_net != null) patch.net_amount = minorOf(so_tien_net, s.currency);
  if (so_tien_gross != null) patch.gross_amount = minorOf(so_tien_gross, s.currency);
  if (tan_suat) patch.frequency = String(tan_suat);
  if (ngay_nhan != null) patch.payday = Number(ngay_nhan);
  if (noi_lam) patch.employer = String(noi_lam);
  if (dang_hoat_dong != null) patch.active = dang_hoat_dong ? 1 : 0;
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa.' };
  update('income_streams', s.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, name, net_amount, frequency, payday, active FROM income_streams WHERE id = ?', [s.id]) };
}

function xoa_nguon_thu({ nguon_thu }) {
  const rows = all('SELECT * FROM income_streams');
  const s = pick(rows, nguon_thu);
  if (!s) return { ok: false, error: `Không tìm thấy nguồn thu "${nguon_thu}".`, dang_co: options(rows) };
  run('UPDATE transactions SET income_stream_id = NULL WHERE income_stream_id = ?', [s.id]);
  run('UPDATE recurring SET income_stream_id = NULL WHERE income_stream_id = ?', [s.id]);
  run('DELETE FROM income_streams WHERE id = ?', [s.id]);
  return { ok: true, mutates: true, da_xoa: { id: s.id, ten: s.name, net: s.net_amount } };
}

/* ------------------------------------------------------------------ */
/* Nợ                                                                  */
/* ------------------------------------------------------------------ */

function sua_no({ khoan_no, ten_moi, so_du, lai_suat, tra_moi_thang, chu_no, trang_thai }) {
  const rows = all('SELECT * FROM debts');
  const d = pick(rows, khoan_no);
  if (!d) return { ok: false, error: `Không tìm thấy khoản nợ "${khoan_no}".`, dang_co: options(rows) };
  const patch = {};
  if (ten_moi) patch.name = String(ten_moi).trim();
  if (so_du != null) patch.balance = minorOf(so_du, d.currency);
  if (lai_suat != null) patch.interest_rate = Number(lai_suat);
  if (tra_moi_thang != null) patch.monthly_payment = minorOf(tra_moi_thang, d.currency);
  if (chu_no) patch.lender = String(chu_no);
  if (trang_thai) patch.status = String(trang_thai);
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa.' };
  update('debts', d.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, name, balance, interest_rate, monthly_payment, status FROM debts WHERE id = ?', [d.id]) };
}

function xoa_no({ khoan_no }) {
  const rows = all('SELECT * FROM debts');
  const d = pick(rows, khoan_no);
  if (!d) return { ok: false, error: `Không tìm thấy khoản nợ "${khoan_no}".`, dang_co: options(rows) };
  run('UPDATE transactions SET debt_id = NULL WHERE debt_id = ?', [d.id]);
  run('DELETE FROM debts WHERE id = ?', [d.id]);
  return { ok: true, mutates: true, da_xoa: { id: d.id, ten: d.name, du_no: d.balance } };
}

/* ------------------------------------------------------------------ */
/* Đầu tư, ngân sách, định kỳ                                          */
/* ------------------------------------------------------------------ */

function xoa_dau_tu({ ma }) {
  const rows = all('SELECT * FROM holdings');
  const h = pick(rows, ma, 'symbol') || pick(rows, ma, 'name');
  if (!h) return { ok: false, error: `Không tìm thấy khoản đầu tư "${ma}".`, dang_co: options(rows, 'symbol') };
  run('UPDATE transactions SET holding_id = NULL WHERE holding_id = ?', [h.id]);
  run('DELETE FROM trades WHERE holding_id = ?', [h.id]);
  run('DELETE FROM holdings WHERE id = ?', [h.id]);
  return { ok: true, mutates: true, da_xoa: { id: h.id, ma: h.symbol, so_luong: h.quantity } };
}

function xoa_ngan_sach({ danh_muc }) {
  const rows = all(`SELECT b.*, c.name AS cat FROM budgets b LEFT JOIN categories c ON c.id = b.category_id`);
  const b = pick(rows, danh_muc, 'cat') || pick(rows, danh_muc);
  if (!b) return { ok: false, error: `Không tìm thấy ngân sách cho "${danh_muc}".`, dang_co: options(rows, 'cat') };
  run('DELETE FROM budgets WHERE id = ?', [b.id]);
  return { ok: true, mutates: true, da_xoa: { id: b.id, danh_muc: b.cat, han_muc: b.amount } };
}

function sua_dinh_ky({ giao_dich, ten_moi, so_tien, tan_suat, ngay_trong_thang, dang_hoat_dong }) {
  const rows = all('SELECT * FROM recurring');
  const r = pick(rows, giao_dich);
  if (!r) return { ok: false, error: `Không tìm thấy giao dịch định kỳ "${giao_dich}".`, dang_co: options(rows) };
  const patch = {};
  if (ten_moi) patch.name = String(ten_moi).trim();
  if (so_tien != null) patch.amount = minorOf(so_tien, r.currency);
  if (tan_suat) patch.frequency = String(tan_suat);
  if (ngay_trong_thang != null) patch.day_of_month = Number(ngay_trong_thang);
  if (dang_hoat_dong != null) patch.active = dang_hoat_dong ? 1 : 0;
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa.' };
  update('recurring', r.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, name, amount, frequency, day_of_month, active FROM recurring WHERE id = ?', [r.id]) };
}

function xoa_dinh_ky({ giao_dich }) {
  const rows = all('SELECT * FROM recurring');
  const r = pick(rows, giao_dich);
  if (!r) return { ok: false, error: `Không tìm thấy giao dịch định kỳ "${giao_dich}".`, dang_co: options(rows) };
  run('DELETE FROM recurring WHERE id = ?', [r.id]);
  return { ok: true, mutates: true, da_xoa: { id: r.id, ten: r.name, so_tien: r.amount } };
}

/* ------------------------------------------------------------------ */
/* Tài khoản & giao dịch                                               */
/* ------------------------------------------------------------------ */

function sua_tai_khoan({ tai_khoan, ten_moi, loai, ngan_hang, lai_suat, tinh_vao_tai_san, dang_hoat_dong, ghi_chu }) {
  const rows = all('SELECT * FROM accounts');
  const a = pick(rows, tai_khoan);
  if (!a) return { ok: false, error: `Không tìm thấy tài khoản "${tai_khoan}".`, dang_co: options(rows) };
  const patch = {};
  if (ten_moi) patch.name = String(ten_moi).trim();
  if (loai) patch.type = String(loai);
  if (ngan_hang) patch.institution = String(ngan_hang);
  if (lai_suat != null) patch.interest_rate = Number(lai_suat);
  if (tinh_vao_tai_san != null) patch.include_in_networth = tinh_vao_tai_san ? 1 : 0;
  if (dang_hoat_dong != null) patch.is_active = dang_hoat_dong ? 1 : 0;
  if (ghi_chu) patch.note = String(ghi_chu);
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa.' };
  update('accounts', a.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, name, type, institution, balance, is_active, include_in_networth FROM accounts WHERE id = ?', [a.id]) };
}

/**
 * Xoá tài khoản. Cờ xoa_ca_giao_dich là loại tham số nguy hiểm mà model tự điền
 * được — đúng cái mẫu đã từng xoá sạch sổ của người dùng thật. Nên ở đây không
 * tin cờ đó một mình: phải có dấu vết trong chính câu người dùng vừa gõ.
 */
function xoa_tai_khoan({ tai_khoan, xoa_ca_giao_dich = false }) {
  const rows = all('SELECT * FROM accounts');
  const a = pick(rows, tai_khoan);
  if (!a) return { ok: false, error: `Không tìm thấy tài khoản "${tai_khoan}".`, dang_co: options(rows) };
  const n = get('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ? OR counter_account_id = ?', [a.id, a.id])?.c || 0;
  if (n > 0 && !xoa_ca_giao_dich) {
    return {
      ok: false,
      error: `Tài khoản "${a.name}" còn ${n} giao dịch. Xoá tài khoản sẽ làm mất lịch sử đó.`,
      goi_y: 'Nếu chỉ muốn ẩn đi, dùng sua_tai_khoan với dang_hoat_dong=false. Nếu thật sự muốn xoá cả giao dịch, gọi lại với xoa_ca_giao_dich=true.',
    };
  }
  if (n > 0 && xoa_ca_giao_dich && !nguoiDungMuonXoaCaGiaoDich()) {
    return {
      ok: false,
      error: `Chưa xoá. Bạn chưa nói rõ là muốn mất luôn ${n} giao dịch của "${a.name}".`,
      can_nguoi_dung_noi: 'Hãy nhắn lại có chữ "xoá cả giao dịch" (hoặc "xoá cả lịch sử") thì mình mới làm.',
      goi_y_an_toan: 'Muốn giữ lịch sử thì dùng sua_tai_khoan với dang_hoat_dong=false — tài khoản biến khỏi màn hình nhưng số liệu còn nguyên.',
    };
  }
  if (n > 0 && xoa_ca_giao_dich) snapshotDb('truoc-khi-xoa-tai-khoan');
  if (xoa_ca_giao_dich) run('DELETE FROM transactions WHERE account_id = ? OR counter_account_id = ?', [a.id, a.id]);
  run('UPDATE funds SET account_id = NULL WHERE account_id = ?', [a.id]);
  run('DELETE FROM accounts WHERE id = ?', [a.id]);
  return { ok: true, mutates: true, da_xoa: { id: a.id, ten: a.name, so_du: a.balance, giao_dich_da_xoa: xoa_ca_giao_dich ? n : 0 } };
}

function sua_giao_dich({ id, so_tien, mo_ta, ngay, danh_muc }) {
  const t = get('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!t) return { ok: false, error: `Không có giao dịch id ${id}.` };
  const patch = {};
  if (so_tien != null) patch.amount = minorOf(so_tien, t.currency);
  if (mo_ta) patch.note = String(mo_ta);
  if (ngay) patch.date = String(ngay).slice(0, 10);
  if (danh_muc) {
    const c = pick(all('SELECT * FROM categories'), danh_muc);
    if (!c) return { ok: false, error: `Không có danh mục "${danh_muc}".` };
    patch.category_id = c.id;
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Không có gì để sửa.' };
  update('transactions', t.id, patch);
  return { ok: true, mutates: true, da_sua: get('SELECT id, type, amount, date, note, category_id FROM transactions WHERE id = ?', [t.id]) };
}

/* ------------------------------------------------------------------ */
/* Dọn trùng lặp                                                       */
/* ------------------------------------------------------------------ */

const DUP_TABLES = {
  muc_tieu: { table: 'goals', label: 'mục tiêu' },
  nguon_thu: { table: 'income_streams', label: 'nguồn thu' },
  no: { table: 'debts', label: 'khoản nợ' },
  tai_khoan: { table: 'accounts', label: 'tài khoản' },
  dinh_ky: { table: 'recurring', label: 'giao dịch định kỳ' },
};

/**
 * Gộp các bản ghi trùng tên, giữ lại bản cũ nhất. Sinh ra khi người dùng (hoặc
 * chính AI) lỡ tạo cùng một thứ nhiều lần — thực tế đã thấy 19 mục tiêu "Mua xe"
 * và 19 khoản nợ giống hệt nhau nằm chồng lên nhau trong một sổ thật.
 */
function don_trung_lap({ loai, thu_truoc = true }) {
  const spec = DUP_TABLES[loai];
  if (!spec) return { ok: false, error: `Loại phải thuộc: ${Object.keys(DUP_TABLES).join(', ')}` };
  const rows = all(`SELECT * FROM ${spec.table} ORDER BY id`);
  const groups = new Map();
  for (const r of rows) {
    const k = norm(r.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dup = [...groups.values()].filter((g) => g.length > 1);
  const ke_hoach = dup.map((g) => ({ ten: g[0].name, giu_lai_id: g[0].id, se_xoa: g.slice(1).map((r) => r.id) }));
  const tong_xoa = ke_hoach.reduce((s, x) => s + x.se_xoa.length, 0);
  if (!tong_xoa) return { ok: true, tong_xoa: 0, thong_bao: `Không có ${spec.label} nào bị trùng tên.` };
  if (thu_truoc) {
    return { ok: true, thu_truoc: true, tong_xoa, ke_hoach, goi_y: 'Nói lại với thu_truoc=false để xoá thật.' };
  }
  for (const g of dup) {
    for (const r of g.slice(1)) {
      if (spec.table === 'goals') run('UPDATE transactions SET goal_id = NULL WHERE goal_id = ?', [r.id]);
      if (spec.table === 'income_streams') run('UPDATE transactions SET income_stream_id = NULL WHERE income_stream_id = ?', [r.id]);
      if (spec.table === 'debts') run('UPDATE transactions SET debt_id = NULL WHERE debt_id = ?', [r.id]);
      if (spec.table === 'accounts') run('DELETE FROM transactions WHERE account_id = ? OR counter_account_id = ?', [r.id, r.id]);
      run(`DELETE FROM ${spec.table} WHERE id = ?`, [r.id]);
    }
  }
  return { ok: true, mutates: true, tong_xoa, da_gop: ke_hoach };
}

/* ------------------------------------------------------------------ */
/* Làm lại từ đầu                                                      */
/* ------------------------------------------------------------------ */

const WIPE_TABLES = [
  'transactions', 'fund_ledger', 'goals', 'budgets', 'recurring', 'trades', 'holdings',
  'properties', 'debts', 'income_streams', 'insights', 'networth_snapshots', 'ingest_log',
  'ai_changes', 'ai_actions', 'ai_memory', 'chat_messages', 'funds', 'accounts', 'rules',
];
const MAT_KHAU_MIENG = 'XOA HET';

/**
 * Câu vừa rồi của chính người dùng, do tầng agent đặt vào trước mỗi lượt.
 *
 * Vì sao cần: thử nghiệm thật đã cho thấy model tự điền xac_nhan="XOA HET" khi
 * người dùng chỉ nói "đồng ý, dọn thật đi" — nó tưởng mình đang xác nhận việc
 * dọn trùng lặp, và sổ sách của một người bị xoá sạch trong một lượt chat. Bài
 * học lặp lại y hệt lần trước: **không được tin lời model tự khai**. Chốt chặn
 * phải đọc thẳng câu người dùng gõ, thứ mà model không giả mạo được.
 */
let cauNguoiDungVuaGo = '';
export function setUserUtterance(text) { cauNguoiDungVuaGo = String(text || ''); }

const normLoose = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const nguoiDungDaGo = (s) => normLoose(cauNguoiDungVuaGo).includes(normLoose(s));

/**
 * Người dùng có thật sự nói tới việc mất luôn lịch sử giao dịch không?
 * Không đòi mật khẩu miệng như xoá sạch (việc này nhỏ hơn), nhưng vẫn phải nghe
 * thấy chữ "giao dịch"/"lịch sử" đi cùng ý xoá — chứ một tiếng "ừ" thì không đủ.
 */
function nguoiDungMuonXoaCaGiaoDich() {
  const c = norm(cauNguoiDungVuaGo);
  return /(xoa|xoá|huy|bo|delete)/.test(c) && /(giao dich|lich su|transaction|het|tat ca|luon)/.test(c);
}

/**
 * Xoá sạch dữ liệu và bắt đầu lại onboarding — không đụng vào cấu hình app.
 *
 * Hai lớp khoá, cả hai đều phải mở: model truyền đúng chuỗi XOA HET, VÀ chính
 * người dùng phải gõ chuỗi đó trong tin nhắn của họ. Trong app tài chính, phá
 * cả sổ vì hiểu nhầm một tiếng "ừ" là điều tuyệt đối không được phép.
 */
function xoa_het_du_lieu({ xac_nhan, giu_lai_ho_so = false }) {
  const dem = {};
  for (const t of ['transactions', 'accounts', 'goals', 'debts', 'income_streams', 'holdings', 'funds']) {
    dem[t] = get(`SELECT COUNT(*) AS c FROM ${t}`)?.c || 0;
  }
  const modelDaGui = norm(xac_nhan) === norm(MAT_KHAU_MIENG);
  const nguoiDungXacNhan = nguoiDungDaGo(MAT_KHAU_MIENG);

  if (!nguoiDungXacNhan) {
    return {
      ok: false,
      can_xac_nhan: true,
      error: modelDaGui
        ? `Bạn tự điền "${MAT_KHAU_MIENG}" nhưng người dùng chưa hề gõ chuỗi đó. Không được tự xác nhận thay họ. Hãy hỏi lại và chờ chính họ gõ "${MAT_KHAU_MIENG}".`
        : `Đây là việc không hoàn tác được. Hãy nói người dùng gõ đúng "${MAT_KHAU_MIENG}" rồi mới gọi lại công cụ này.`,
      se_xoa: dem,
      cau_nguoi_dung_vua_go: cauNguoiDungVuaGo.slice(0, 120),
    };
  }
  if (!modelDaGui) {
    return { ok: false, can_xac_nhan: true, error: `Thiếu tham số xac_nhan="${MAT_KHAU_MIENG}".`, se_xoa: dem };
  }

  // Sao lưu trước khi phá: chính công cụ này xoá luôn ai_actions/ai_changes nên
  // sau khi chạy sẽ không còn gì để hoàn tác. Một bản chụp trên đĩa là đường lui
  // duy nhất còn lại.
  let ban_sao = null;
  try { ban_sao = snapshotDb('truoc-khi-xoa-het'); } catch (e) { ban_sao = `không sao lưu được: ${e.message}`; }

  run('PRAGMA foreign_keys = OFF');
  const loi = [];
  try {
    for (const t of WIPE_TABLES) {
      try {
        run(`DELETE FROM ${t}`);
      } catch (e) {
        if (!/no such table/i.test(String(e?.message))) loi.push(`${t}: ${e.message}`);
      }
    }
  } finally {
    run('PRAGMA foreign_keys = ON');
  }
  if (loi.length) return { ok: false, error: `Không xoá được hết: ${loi.join(' · ')}`, con_lai: loi, ban_sao };

  const sot = WIPE_TABLES.map((t) => {
    try { return { t, c: get(`SELECT COUNT(*) AS c FROM ${t}`)?.c || 0 }; } catch { return { t, c: 0 }; }
  }).filter((x) => x.c > 0);
  if (sot.length) return { ok: false, error: `Còn sót dữ liệu: ${sot.map((x) => `${x.t}=${x.c}`).join(', ')}`, ban_sao };

  if (!giu_lai_ho_so) {
    update('profile', 1, {
      name: null, birth_year: null, city: null, country: null, dependents: 0,
      monthly_income: 0, risk_level: null, retire_age: null,
    });
  }
  bootstrap();
  startOnboarding();
  return {
    ok: true,
    mutates: true,
    da_xoa: dem,
    ban_sao,
    thong_bao: `Đã xoá sạch dữ liệu và dựng lại danh mục + quỹ mặc định. App quay về bước onboarding đầu tiên. Bản sao trước khi xoá: ${ban_sao}`,
  };
}

/* ------------------------------------------------------------------ */

export const MANAGE_IMPL = {
  liet_ke_no, liet_ke_dau_tu, liet_ke_ngan_sach, liet_ke_dinh_ky, liet_ke_bat_dong_san,
  sua_muc_tieu, xoa_muc_tieu,
  sua_nguon_thu, xoa_nguon_thu,
  sua_no, xoa_no,
  xoa_dau_tu, xoa_ngan_sach,
  sua_dinh_ky, xoa_dinh_ky,
  sua_tai_khoan, xoa_tai_khoan, sua_giao_dich,
  don_trung_lap, xoa_het_du_lieu,
};

export const MANAGE_TOOLS = [
  T('liet_ke_no', 'Liệt kê mọi khoản nợ kèm id — gọi trước khi sửa hoặc xoá nợ.'),
  T('liet_ke_dau_tu', 'Liệt kê mọi khoản đầu tư đang giữ kèm id.'),
  T('liet_ke_ngan_sach', 'Liệt kê mọi ngân sách đang đặt kèm id.'),
  T('liet_ke_dinh_ky', 'Liệt kê mọi giao dịch định kỳ kèm id.'),
  T('liet_ke_bat_dong_san', 'Liệt kê bất động sản đang có.'),

  T('sua_muc_tieu', 'Sửa một mục tiêu: đổi tên, số tiền, hạn, độ ưu tiên hoặc trạng thái.', {
    muc_tieu: S('Tên hoặc id mục tiêu'),
    ten_moi: S('Tên mới'), so_tien: N('Số tiền cần đạt (đơn vị lớn)'), han: S('Hạn YYYY-MM-DD'),
    uu_tien: N('1 là gấp nhất'), trang_thai: S('Trạng thái', { enum: ['active', 'paused', 'done', 'cancelled'] }),
    ghi_chu: S('Ghi chú'),
  }, ['muc_tieu']),
  T('xoa_muc_tieu', 'Xoá hẳn một mục tiêu khỏi app.', { muc_tieu: S('Tên hoặc id mục tiêu') }, ['muc_tieu']),

  T('sua_nguon_thu', 'Sửa một nguồn thu nhập.', {
    nguon_thu: S('Tên hoặc id nguồn thu'), ten_moi: S('Tên mới'),
    so_tien_net: N('Thực nhận mỗi kỳ'), so_tien_gross: N('Trước thuế mỗi kỳ'),
    tan_suat: S('Tần suất', { enum: ['monthly', 'weekly', 'biweekly', 'quarterly', 'yearly', 'once'] }),
    ngay_nhan: N('Ngày nhận trong tháng'), noi_lam: S('Nơi làm / bên trả'),
    dang_hoat_dong: B('false để đánh dấu đã ngừng'),
  }, ['nguon_thu']),
  T('xoa_nguon_thu', 'Xoá hẳn một nguồn thu nhập.', { nguon_thu: S('Tên hoặc id nguồn thu') }, ['nguon_thu']),

  T('sua_no', 'Sửa một khoản nợ.', {
    khoan_no: S('Tên hoặc id khoản nợ'), ten_moi: S('Tên mới'), so_du: N('Dư nợ hiện tại'),
    lai_suat: N('%/năm'), tra_moi_thang: N('Trả mỗi tháng'), chu_no: S('Chủ nợ'),
    trang_thai: S('Trạng thái', { enum: ['active', 'paid', 'closed'] }),
  }, ['khoan_no']),
  T('xoa_no', 'Xoá hẳn một khoản nợ.', { khoan_no: S('Tên hoặc id khoản nợ') }, ['khoan_no']),

  T('xoa_dau_tu', 'Xoá một khoản đầu tư đang giữ (kèm lịch sử mua bán của nó).', { ma: S('Mã hoặc id') }, ['ma']),
  T('xoa_ngan_sach', 'Bỏ ngân sách của một danh mục.', { danh_muc: S('Tên danh mục hoặc id ngân sách') }, ['danh_muc']),

  T('sua_dinh_ky', 'Sửa một giao dịch định kỳ (đổi số tiền, tần suất, tạm dừng).', {
    giao_dich: S('Tên hoặc id'), ten_moi: S('Tên mới'), so_tien: N('Số tiền mỗi kỳ'),
    tan_suat: S('Tần suất', { enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] }),
    ngay_trong_thang: N('Ngày trong tháng'), dang_hoat_dong: B('false để tạm dừng'),
  }, ['giao_dich']),
  T('xoa_dinh_ky', 'Xoá hẳn một giao dịch định kỳ.', { giao_dich: S('Tên hoặc id') }, ['giao_dich']),

  T('sua_tai_khoan', 'Sửa tài khoản: đổi tên, loại, ngân hàng, lãi suất, ẩn khỏi tài sản, hoặc ngừng dùng.', {
    tai_khoan: S('Tên hoặc id tài khoản'), ten_moi: S('Tên mới'),
    loai: S('Loại tài khoản'), ngan_hang: S('Ngân hàng / tổ chức'), lai_suat: N('%/năm'),
    tinh_vao_tai_san: B('Có tính vào tài sản ròng không'), dang_hoat_dong: B('false để ẩn đi'),
    ghi_chu: S('Ghi chú'),
  }, ['tai_khoan']),
  T('xoa_tai_khoan', 'Xoá hẳn một tài khoản. Nếu còn giao dịch, công cụ sẽ từ chối và nói rõ vướng gì.', {
    tai_khoan: S('Tên hoặc id tài khoản'),
    xoa_ca_giao_dich: B('true để xoá luôn giao dịch của tài khoản này — chỉ dùng khi người dùng đã đồng ý rõ'),
  }, ['tai_khoan']),
  T('sua_giao_dich', 'Sửa một giao dịch đã ghi (số tiền, mô tả, ngày, danh mục).', {
    id: N('id giao dịch'), so_tien: N('Số tiền mới'), mo_ta: S('Mô tả mới'),
    ngay: S('Ngày YYYY-MM-DD'), danh_muc: S('Danh mục mới'),
  }, ['id']),

  T('don_trung_lap', 'Tìm và gộp các bản ghi trùng tên (giữ bản cũ nhất). Mặc định chỉ xem trước, không xoá.', {
    loai: S('Nhóm cần dọn', { enum: Object.keys(DUP_TABLES) }),
    thu_truoc: B('true (mặc định) chỉ liệt kê sẽ xoá gì; false mới xoá thật'),
  }, ['loai']),

  T('xoa_het_du_lieu', 'Xoá sạch toàn bộ dữ liệu tài chính và bắt đầu lại onboarding. Không hoàn tác được. Bắt buộc người dùng gõ đúng "XOA HET".', {
    xac_nhan: S('Phải đúng chuỗi XOA HET do chính người dùng gõ ra'),
    giu_lai_ho_so: B('true để giữ tên/tuổi/thành phố, chỉ xoá số liệu'),
  }, ['xac_nhan']),
];

export { MAT_KHAU_MIENG };
