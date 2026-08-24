/**
 * Kiểm bộ công cụ quản trị: AI phải sửa và xoá được mọi tài nguyên của app.
 *
 * Vì sao có bài test này: ảnh chụp màn hình từ người dùng thật cho thấy AI hứa
 * "tôi sẽ xoá 19 mục tiêu trùng lặp" rồi không làm gì cả — vì trong tay nó
 * không hề có công cụ xoá mục tiêu. Cả bộ công cụ ban đầu chỉ biết *thêm vào*.
 * Một cố vấn chỉ được phép thêm mà không được phép dọn thì sổ sách sẽ ngày càng
 * rác, và app càng dùng lâu càng vô dụng.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, '.tmp-manage.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }
process.env.FINMATE_DB = DB;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);

const { runTool, TOOLS, TOOL_IMPL } = await import('../src/services/chat/tools.js');
const { all, get, insert } = await import('../src/db.js');
const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();

const T = (name, args = {}) => runTool(name, args);

/* ---------- 0. Công cụ phải thật sự có mặt trong danh sách gửi cho model ---------- */
head('Model nhìn thấy đủ công cụ quản trị');
{
  const names = TOOLS.map((t) => t.function.name);
  const must = [
    'xoa_muc_tieu', 'sua_muc_tieu', 'xoa_nguon_thu', 'sua_nguon_thu', 'xoa_no', 'sua_no',
    'xoa_dau_tu', 'xoa_ngan_sach', 'xoa_dinh_ky', 'sua_dinh_ky', 'xoa_tai_khoan', 'sua_tai_khoan',
    'sua_giao_dich', 'don_trung_lap', 'xoa_het_du_lieu',
    'liet_ke_no', 'liet_ke_dau_tu', 'liet_ke_ngan_sach', 'liet_ke_dinh_ky',
  ];
  for (const m of must) ok(`${m} có trong TOOLS`, names.includes(m));
  ok('mọi tool đều có hàm chạy được', names.every((n) => typeof TOOL_IMPL[n] === 'function'),
    names.filter((n) => typeof TOOL_IMPL[n] !== 'function').join(', '));
  ok('không có tên trùng nhau', new Set(names).size === names.length);
}

/* ---------- 1. Dựng dữ liệu nền ---------- */
head('Dựng dữ liệu để thao tác');
{
  T('tao_tai_khoan', { ten: 'Vietcombank', loai: 'bank', so_du: 50000000 });
  T('tao_tai_khoan', { ten: 'Ví Momo', loai: 'ewallet', so_du: 2000000 });
  T('tao_muc_tieu', { ten: 'Mua xe', so_tien: 500000000, han: '2028-01-01' });
  T('them_nguon_thu', { ten: 'Lương chính', loai: 'salary', so_tien_net: 30000000 });
  T('them_no', { ten: 'Vay bạn', so_du: 30000000, lai_suat: 0, tra_moi_thang: 2000000 });
  T('them_dau_tu', { ma: 'VNM', so_luong: 100, gia_von: 70000 });
  T('dat_ngan_sach', { danh_muc: 'Ăn uống', so_tien: 5000000 });
  T('tao_giao_dich_dinh_ky', { ten: 'Tiền nhà', loai: 'expense', so_tien: 8000000, tan_suat: 'monthly', ngay_trong_thang: 5 });
  ok('có thêm 2 tài khoản ngoài ví mặc định', all('SELECT * FROM accounts').length === 3, JSON.stringify(all('SELECT name FROM accounts')));
  ok('có 1 mục tiêu', all('SELECT * FROM goals').length === 1);
  ok('có 1 nguồn thu', all('SELECT * FROM income_streams').length === 1);
  ok('có 1 khoản nợ', all('SELECT * FROM debts').length === 1);
}

/* ---------- 2. Liệt kê phải trả về id để còn thao tác ---------- */
head('Liệt kê trả về id thật');
{
  const no = T('liet_ke_no');
  ok('liet_ke_no chạy được', no.ok === true, JSON.stringify(no).slice(0, 140));
  ok('liet_ke_no có id', Number.isInteger(no.danh_sach?.[0]?.id));
  const dt = T('liet_ke_dau_tu');
  ok('liet_ke_dau_tu thấy VNM', dt.danh_sach?.some((r) => r.symbol === 'VNM'), JSON.stringify(dt).slice(0, 140));
  const ns = T('liet_ke_ngan_sach');
  ok('liet_ke_ngan_sach có danh mục', Boolean(ns.danh_sach?.[0]?.danh_muc), JSON.stringify(ns).slice(0, 140));
  const dk = T('liet_ke_dinh_ky');
  ok('liet_ke_dinh_ky thấy Tiền nhà', dk.danh_sach?.some((r) => /Tiền nhà/.test(r.name)), JSON.stringify(dk).slice(0, 140));
}

/* ---------- 3. Sửa mục tiêu ---------- */
head('Sửa và xoá mục tiêu');
{
  const r = T('sua_muc_tieu', { muc_tieu: 'Mua xe', so_tien: 600000000, han: '2029-06-30', uu_tien: 2 });
  ok('sửa được số tiền mục tiêu', r.ok === true, JSON.stringify(r).slice(0, 160));
  ok('đánh dấu có thay đổi dữ liệu', r.mutates === true);
  const g = get('SELECT * FROM goals WHERE name = ?', ['Mua xe']);
  ok('số tiền mới vào DB đúng đơn vị nhỏ', g.target_amount === 600000000 * 100 || g.target_amount === 600000000,
    `target_amount=${g.target_amount}`);
  ok('hạn mới vào DB', g.deadline === '2029-06-30', g.deadline);

  const r2 = T('sua_muc_tieu', { ten: 'Mua xe', ten_moi: 'Mua ô tô' });
  ok('gọi bằng tên tham số sai vẫn hiểu (ten -> muc_tieu)', r2.ok === true, JSON.stringify(r2).slice(0, 140));
  ok('đổi được tên', Boolean(get('SELECT * FROM goals WHERE name = ?', ['Mua ô tô'])));

  const r3 = T('sua_muc_tieu', { muc_tieu: 'Không tồn tại' });
  ok('không tìm thấy thì báo rõ', r3.ok === false && /Không tìm thấy/.test(r3.error));
  ok('kèm danh sách đang có để chọn lại', Array.isArray(r3.dang_co));
}

/* ---------- 4. Xoá mục tiêu thật ---------- */
{
  const before = all('SELECT * FROM goals').length;
  const r = T('xoa_muc_tieu', { muc_tieu: 'Mua ô tô' });
  ok('xoá được mục tiêu', r.ok === true, JSON.stringify(r).slice(0, 140));
  ok('trả lại thứ vừa xoá để hoàn tác', Boolean(r.da_xoa?.ten));
  ok('mục tiêu biến mất khỏi DB', all('SELECT * FROM goals').length === before - 1);
}

/* ---------- 5. Nguồn thu, nợ, đầu tư, ngân sách, định kỳ ---------- */
head('Sửa và xoá các tài nguyên còn lại');
{
  ok('sửa nguồn thu', T('sua_nguon_thu', { nguon_thu: 'Lương chính', so_tien_net: 35000000 }).ok === true);
  ok('tạm dừng nguồn thu', T('sua_nguon_thu', { nguon_thu: 'Lương chính', dang_hoat_dong: false }).ok === true);
  ok('nguồn thu đã ngừng trong DB', get('SELECT * FROM income_streams WHERE name = ?', ['Lương chính'])?.active === 0);
  ok('xoá nguồn thu', T('xoa_nguon_thu', { nguon_thu: 'Lương chính' }).ok === true);
  ok('nguồn thu biến mất', all('SELECT * FROM income_streams').length === 0);

  ok('sửa nợ', T('sua_no', { khoan_no: 'Vay bạn', so_du: 25000000, lai_suat: 5 }).ok === true);
  ok('lãi suất mới vào DB', get('SELECT * FROM debts WHERE name = ?', ['Vay bạn'])?.interest_rate === 5);
  ok('xoá nợ', T('xoa_no', { khoan_no: 'Vay bạn' }).ok === true);
  ok('nợ biến mất', all('SELECT * FROM debts').length === 0);

  ok('xoá đầu tư theo mã', T('xoa_dau_tu', { ma: 'VNM' }).ok === true);
  ok('đầu tư biến mất', all('SELECT * FROM holdings').length === 0);

  ok('xoá ngân sách', T('xoa_ngan_sach', { danh_muc: 'Ăn uống' }).ok === true);
  ok('ngân sách biến mất', all('SELECT * FROM budgets').length === 0);

  ok('sửa định kỳ', T('sua_dinh_ky', { giao_dich: 'Tiền nhà', so_tien: 9000000 }).ok === true);
  ok('tạm dừng định kỳ', T('sua_dinh_ky', { giao_dich: 'Tiền nhà', dang_hoat_dong: false }).ok === true);
  ok('xoá định kỳ', T('xoa_dinh_ky', { giao_dich: 'Tiền nhà' }).ok === true);
  ok('định kỳ biến mất', all('SELECT * FROM recurring').length === 0);
}

/* ---------- 6. Tài khoản: không được âm thầm làm mất lịch sử ---------- */
head('Xoá tài khoản phải cẩn trọng với lịch sử');
{
  T('ghi_giao_dich', { loai: 'expense', so_tien: 100000, mo_ta: 'cà phê', tai_khoan: 'Ví Momo' });
  const r = T('xoa_tai_khoan', { tai_khoan: 'Ví Momo' });
  ok('từ chối xoá khi còn giao dịch', r.ok === false, JSON.stringify(r).slice(0, 160));
  ok('nói rõ vướng bao nhiêu giao dịch', /giao dịch/.test(r.error || ''));
  ok('gợi ý cách ẩn thay vì xoá', /dang_hoat_dong/.test(r.goi_y || ''));

  ok('ẩn tài khoản được', T('sua_tai_khoan', { tai_khoan: 'Ví Momo', dang_hoat_dong: false }).ok === true);
  ok('tài khoản đã ẩn trong DB', get('SELECT * FROM accounts WHERE name = ?', ['Ví Momo'])?.is_active === 0);
  ok('đổi tên tài khoản được', T('sua_tai_khoan', { tai_khoan: 'Vietcombank', ten_moi: 'VCB chính' }).ok === true);
  ok('tên mới vào DB', Boolean(get('SELECT * FROM accounts WHERE name = ?', ['VCB chính'])));

  const { setUserUtterance: sayIt } = await import('../src/services/chat/tools_manage.js');
  sayIt('xoá Ví Momo, xoá cả giao dịch luôn');
  const r2 = T('xoa_tai_khoan', { tai_khoan: 'Ví Momo', xoa_ca_giao_dich: true });
  ok('xoá được khi đã đồng ý xoá cả giao dịch', r2.ok === true, JSON.stringify(r2).slice(0, 160));
  ok('báo rõ đã xoá bao nhiêu giao dịch', r2.da_xoa?.giao_dich_da_xoa >= 1);
  sayIt('');
}

/* ---------- 7. Sửa giao dịch ---------- */
head('Sửa giao dịch đã ghi');
{
  T('ghi_giao_dich', { loai: 'expense', so_tien: 50000, mo_ta: 'ăn sáng', tai_khoan: 'VCB chính' });
  const t = all('SELECT * FROM transactions ORDER BY id DESC')[0];
  const r = T('sua_giao_dich', { id: t.id, so_tien: 75000, mo_ta: 'ăn sáng + cà phê' });
  ok('sửa được giao dịch', r.ok === true, JSON.stringify(r).slice(0, 160));
  ok('mô tả mới vào DB', /cà phê/.test(get('SELECT * FROM transactions WHERE id = ?', [t.id])?.note || ''));
  const r2 = T('sua_giao_dich', { id: 999999, so_tien: 1000 });
  ok('id không có thì báo lỗi rõ', r2.ok === false && /999999/.test(r2.error));
}

/* ---------- 8. Dọn trùng lặp — đúng cảnh người dùng gặp ---------- */
head('Dọn 19 mục tiêu trùng tên');
{
  // tao_muc_tieu đã tự chống trùng (gọi lại chỉ cập nhật bản cũ), nên dữ liệu
  // rác thật của người dùng phải được dựng lại bằng cách chèn thẳng — đúng như
  // cách nó lọt vào sổ qua các đường khác: nhập sao kê, onboarding lặp, script cũ.
  for (let i = 0; i < 19; i += 1) {
    insert('goals', { name: 'Mua xe', type: 'save', target_amount: 50000000000, currency: 'VND', deadline: '2028-01-01', status: 'active' });
  }
  T('tao_muc_tieu', { ten: 'Du lịch Nhật', so_tien: 60000000, han: '2027-05-01' });
  ok('đã dựng lại đúng cảnh 19 bản trùng + 1 bản khác', all('SELECT * FROM goals').length === 20,
    `goals=${all('SELECT * FROM goals').length}`);

  const xem = T('don_trung_lap', { loai: 'muc_tieu' });
  ok('mặc định chỉ xem trước, chưa xoá', xem.thu_truoc === true, JSON.stringify(xem).slice(0, 160));
  ok('đếm đúng số sẽ xoá', xem.tong_xoa === 18, `tong_xoa=${xem.tong_xoa}`);
  ok('chưa đụng vào DB', all('SELECT * FROM goals').length === 20);
  ok('nói rõ giữ lại bản nào', Number.isInteger(xem.ke_hoach?.[0]?.giu_lai_id));

  const lam = T('don_trung_lap', { loai: 'muc_tieu', thu_truoc: false });
  ok('dọn thật khi được yêu cầu', lam.ok === true && lam.mutates === true, JSON.stringify(lam).slice(0, 160));
  ok('chỉ còn 2 mục tiêu', all('SELECT * FROM goals').length === 2, JSON.stringify(all('SELECT name FROM goals')));
  ok('giữ đúng mục tiêu không trùng', Boolean(get('SELECT * FROM goals WHERE name = ?', ['Du lịch Nhật'])));
  ok('vẫn còn đúng một "Mua xe"', all('SELECT * FROM goals WHERE name = ?', ['Mua xe']).length === 1);

  const lai = T('don_trung_lap', { loai: 'muc_tieu', thu_truoc: false });
  ok('dọn lần hai thì báo không còn gì trùng', lai.tong_xoa === 0);
  ok('loại không hợp lệ thì báo rõ', T('don_trung_lap', { loai: 'linh tinh' }).ok === false);
}

/* ---------- 9. Xoá sạch — việc nguy hiểm nhất ---------- */
head('Xoá sạch dữ liệu đòi mật khẩu miệng của chính người dùng');
{
  const { setUserUtterance } = await import('../src/services/chat/tools_manage.js');

  setUserUtterance('xoá hết dữ liệu đi');
  const thieu = T('xoa_het_du_lieu', {});
  ok('không có xác nhận thì từ chối', thieu.ok === false, JSON.stringify(thieu).slice(0, 160));
  ok('nói rõ cần gõ XOA HET', /XOA HET/.test(thieu.error || ''));
  ok('cho biết trước sẽ mất những gì', Number.isInteger(thieu.se_xoa?.accounts));

  const sai = T('xoa_het_du_lieu', { xac_nhan: 'ok' });
  ok('"ok" KHÔNG được coi là đồng ý', sai.ok === false, JSON.stringify(sai).slice(0, 140));
  const sai2 = T('xoa_het_du_lieu', { xac_nhan: 'có' });
  ok('"có" KHÔNG được coi là đồng ý', sai2.ok === false);

  // Đây là tai nạn đã xảy ra thật: người dùng nói "đồng ý, dọn thật đi" (ý là
  // dọn trùng lặp) và model tự điền xac_nhan="XOA HET" rồi xoá sạch cả sổ.
  setUserUtterance('đồng ý, dọn thật đi');
  const gia_mao = T('xoa_het_du_lieu', { xac_nhan: 'XOA HET' });
  ok('model TỰ gõ mật khẩu thay người dùng thì bị chặn', gia_mao.ok === false, JSON.stringify(gia_mao).slice(0, 200));
  ok('nói thẳng là không được tự xác nhận thay', /tự|chưa hề gõ/i.test(gia_mao.error || ''), gia_mao.error);
  ok('dữ liệu vẫn còn nguyên sau khi bị chặn', all('SELECT * FROM goals').length === 2,
    `goals=${all('SELECT * FROM goals').length}`);

  setUserUtterance('XOA HET');
  const that = T('xoa_het_du_lieu', { xac_nhan: 'XOA HET' });
  ok('người dùng tự gõ thì xoá thật', that.ok === true, JSON.stringify(that).slice(0, 200));
  ok('có chụp lại bản sao trước khi xoá', Boolean(that.ban_sao) && /\.db$/.test(String(that.ban_sao)), String(that.ban_sao));
  ok('mục tiêu sạch', all('SELECT * FROM goals').length === 0);
  ok('tài khoản người dùng sạch, chỉ còn ví mặc định của app', all('SELECT * FROM accounts').length === 1, JSON.stringify(all('SELECT name FROM accounts')));
  ok('giao dịch sạch', all('SELECT * FROM transactions').length === 0);
  ok('quỹ mặc định được dựng lại', all('SELECT * FROM funds').length > 0, `funds=${all('SELECT * FROM funds').length}`);
  ok('danh mục mặc định còn nguyên', all('SELECT * FROM categories').length > 0);
  ok('app quay lại bước onboarding', get('SELECT * FROM profile WHERE id = 1')?.onboarded === 0);
  ok('báo lại đã xoá bao nhiêu', Number.isInteger(that.da_xoa?.accounts));

  setUserUtterance('');
}

/* ---------- 10. Cờ nguy hiểm khác cũng không được model tự bật ---------- */
head('Xoá tài khoản kèm giao dịch phải nghe thấy chính người dùng nói');
{
  const { setUserUtterance } = await import('../src/services/chat/tools_manage.js');

  const accId = insert('accounts', { name: 'ACB Test', type: 'bank', balance: 500000, currency: 'VND', is_active: 1 });
  insert('transactions', { account_id: accId, type: 'expense', amount: 100000, currency: 'VND', date: '2026-01-05', note: 'test' });
  insert('transactions', { account_id: accId, type: 'expense', amount: 200000, currency: 'VND', date: '2026-01-06', note: 'test 2' });

  setUserUtterance('xoá tài khoản ACB Test đi');
  const chan1 = T('xoa_tai_khoan', { tai_khoan: 'ACB Test' });
  ok('còn giao dịch thì không xoá ngay', chan1.ok === false, JSON.stringify(chan1).slice(0, 140));
  ok('nói rõ vướng bao nhiêu giao dịch', /2 giao dịch/.test(chan1.error || ''), chan1.error);

  // Đây là đúng cái mẫu đã gây tai nạn: model tự bật cờ phá dữ liệu.
  const chan2 = T('xoa_tai_khoan', { tai_khoan: 'ACB Test', xoa_ca_giao_dich: true });
  ok('model TỰ bật cờ xoá giao dịch thì bị chặn', chan2.ok === false, JSON.stringify(chan2).slice(0, 180));
  ok('gợi ý cách an toàn là ẩn đi', /dang_hoat_dong/.test(JSON.stringify(chan2)));
  ok('tài khoản vẫn còn', all('SELECT * FROM accounts WHERE id = ?', [accId]).length === 1);
  ok('giao dịch vẫn còn nguyên', all('SELECT * FROM transactions WHERE account_id = ?', [accId]).length === 2);

  setUserUtterance('xoá tài khoản ACB Test, xoá cả giao dịch luôn');
  const that2 = T('xoa_tai_khoan', { tai_khoan: 'ACB Test', xoa_ca_giao_dich: true });
  ok('người dùng nói rõ thì xoá thật', that2.ok === true, JSON.stringify(that2).slice(0, 180));
  ok('báo đúng số giao dịch đã xoá', that2.da_xoa?.giao_dich_da_xoa === 2, JSON.stringify(that2.da_xoa));
  ok('tài khoản đã biến mất', all('SELECT * FROM accounts WHERE id = ?', [accId]).length === 0);
  ok('giao dịch đã biến mất', all('SELECT * FROM transactions WHERE account_id = ?', [accId]).length === 0);

  // Tài khoản rỗng thì không cần hỏi han gì — không có gì để mất.
  const trong = insert('accounts', { name: 'Ví rỗng', type: 'cash', balance: 0, currency: 'VND', is_active: 1 });
  setUserUtterance('bỏ ví rỗng đi');
  const r = T('xoa_tai_khoan', { tai_khoan: 'Ví rỗng' });
  ok('tài khoản không có giao dịch thì xoá thẳng', r.ok === true, JSON.stringify(r).slice(0, 140));
  ok('đúng tài khoản bị xoá', all('SELECT * FROM accounts WHERE id = ?', [trong]).length === 0);

  setUserUtterance('');
}

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }
// Các bản chụp cứu hộ do chính bài test sinh ra — dọn đi, đừng để rác lại repo.
try { fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true }); } catch {}
console.log(`\n${fail === 0 ? '🎉' : '❌'} smoke-manage: ${pass} đạt, ${fail} hỏng`);
if (fail) process.exitCode = 1;

