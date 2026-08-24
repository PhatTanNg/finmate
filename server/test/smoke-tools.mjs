/** Kiểm chứng toàn bộ công cụ của AI agent trên DB tạm. */
process.env.FINMATE_DB = new URL('./.tmp-tools.db', import.meta.url).pathname.replace(/^\//, '');
import { existsSync, rmSync } from 'node:fs';
if (existsSync(process.env.FINMATE_DB)) rmSync(process.env.FINMATE_DB);

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { TOOLS, runTool } = await import('../src/services/chat/tools.js');
const { get } = await import('../src/db.js');

let pass = 0; let fail = 0;
const bad = [];
function t(name, args, check) {
  const out = runTool(name, args);
  const err = out && out.error;
  let ok = !err;
  if (ok && check) { try { ok = check(out); } catch (e) { ok = false; out._checkErr = e.message; } }
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; bad.push(name); console.log(`  FAIL ${name} -> ${JSON.stringify(out).slice(0, 300)}`); }
  return out;
}

console.log(`\nSố công cụ khai báo: ${TOOLS.length}`);
const names = TOOLS.map((x) => x.function.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) { console.log('TRÙNG TÊN:', dup); fail += 1; }

console.log('\n— Thiết lập hồ sơ —');
t('cap_nhat_ho_so', { ten: 'Tân', nam_sinh: 1997, thanh_pho: 'Dublin', nuoc_tinh_thue: 'IE', khau_vi_rui_ro: 'balanced' });
const acc = t('tao_tai_khoan', { ten: 'AIB Current', loai: 'bank', so_du: 4200, dong_tien: 'EUR' });
t('tao_tai_khoan', { ten: 'Vietcombank', loai: 'bank', so_du: 120000000, dong_tien: 'VND' });
t('tao_tai_khoan', { ten: 'Ví tiền mặt', loai: 'cash', so_du: 300 });
t('them_nguon_thu', { ten: 'Lương Google Ireland', loai: 'salary', so_tien: 5200, ngay_nhan: 25, dong_tien: 'EUR' });
t('them_nguon_thu', { ten: 'Cho thuê căn hộ Q7', loai: 'rental', so_tien: 12000000, ngay_nhan: 5, dong_tien: 'VND' });

console.log('\n— Ghi chép hằng ngày —');
t('ghi_giao_dich', { so_tien: 12.5, loai: 'expense', mo_ta: 'cà phê với đồng nghiệp' });
t('ghi_giao_dich', { so_tien: 85, loai: 'expense', mo_ta: 'đi chợ Tesco', tai_khoan: 'AIB' });
t('ghi_giao_dich', { so_tien: 5200, loai: 'income', mo_ta: 'lương tháng 8', tai_khoan: 'AIB Current' });
t('ghi_giao_dich', { so_tien: 200, loai: 'transfer', mo_ta: 'rút tiền mặt', tai_khoan: 'AIB Current', tai_khoan_dich: 'Ví tiền mặt' });
t('capnhat_so_du', { tai_khoan: 'AIB Current', so_du_moi: 9000 });

console.log('\n— Mục tiêu, quỹ, ngân sách —');
const g = t('tao_muc_tieu', { ten: 'Mua nhà Dublin', so_tien: 60000, han: '2029-12-31', dong_tien: 'EUR' });
t('gop_tien_muc_tieu', { muc_tieu: 'Mua nhà', so_tien: 1500 });
t('dat_ngan_sach', { danh_muc: 'An uong', so_tien: 400 });
t('dat_phan_bo_quy', { phan_bo: [{ quy: 'Thiet yeu', phan_tram: 45 }, { quy: 'Tu do tai chinh', phan_tram: 25 }] }, (o) => o.da_dat.length === 2);
t('chuyen_quy', { tu_quy: 'Thiet yeu', den_quy: 'Huong thu', so_tien: 100 });

console.log('\n— Nợ, đầu tư, định kỳ —');
t('them_no', { ten: 'Thẻ tín dụng Revolut', so_du: 1800, lai_suat: 19.9, tra_toi_thieu: 90, dong_tien: 'EUR' });
t('tra_no', { no: 'Revolut', so_tien: 300 });
t('them_dau_tu', { ma: 'VOO', ten: 'Vanguard S&P500', loai: 'etf', so_luong: 12, gia_mua: 480, dong_tien: 'EUR' });
t('cap_nhat_gia', { ma: 'VOO', gia: 515 });
t('tao_giao_dich_dinh_ky', { ten: 'Tiền thuê nhà', so_tien: 1450, loai: 'expense', chu_ky: 'monthly', ngay: 1 });

console.log('\n— Tra cứu —');
t('liet_ke_tai_khoan', {}, (o) => o.tai_khoan.length >= 3 && o.tai_khoan.find((a) => a.name.includes('AIB')).balance > 800000);
t('liet_ke_quy', {}, (o) => o.quy.length >= 5);
t('liet_ke_danh_muc', {}, (o) => o.chi.length > 10 && o.thu.length > 2);
t('liet_ke_muc_tieu', {}, (o) => o.muc_tieu.length >= 1 && o.muc_tieu[0].current_amount === 150000);
t('liet_ke_nguon_thu', {}, (o) => o.nguon_thu.length >= 2 && o.nguon_thu[0].net_amount === 520000);
t('xem_chi_tieu', {});
t('xem_chi_tieu', { thang: '2026-08' });
t('xem_giao_dich', { so_luong: 5 }, (o) => Array.isArray(o.giao_dich) && o.giao_dich.length === 5);
t('xem_tai_san', {}, (o) => typeof o.net === 'number');
t('xem_tu_do_tai_chinh', {});
t('xem_du_bao', {});
t('xem_ngan_sach', {});
t('xem_no', {});
t('xem_dau_tu', {});
t('xem_suc_khoe', {}, (o) => typeof o.diem.score === 'number');
t('xem_xu_huong', {});
t('tu_van_tien_du', {});
t('xem_ty_gia', {});
t('tinh_chuyen_tien', { so_tien: 2000, tu: 'EUR', den: 'VND' });
t('tinh_thue', { thu_nhap_nam: 62400 });

console.log('\n— Hoàn tác & kết thúc —');
t('ghi_giao_dich', { so_tien: 9.9, loai: 'expense', mo_ta: 'ghi nhầm' });
t('hoan_tac_gan_nhat', {});
const last = runTool('xem_giao_dich', { so_luong: 1 });
if (String(JSON.stringify(last)).includes('ghi nhầm')) { console.log('  FAIL hoàn tác không xoá được giao dịch'); fail += 1; bad.push('hoan_tac_gan_nhat/effect'); }
else { console.log('  ok   hoàn tác đã xoá đúng'); pass += 1; }

t('hoan_tat_thiet_lap', {});
if (get('SELECT onboarded FROM profile WHERE id=1')?.onboarded === 1) { console.log('  ok   profile.onboarded = 1'); pass += 1; }
else { console.log('  FAIL profile.onboarded chưa bật'); fail += 1; bad.push('onboarded'); }

console.log('\n— Lỗi được xử lý êm —');
const e1 = runTool('khong_ton_tai', {});
if (e1?.error) { console.log('  ok   tool lạ trả error'); pass += 1; } else { console.log('  FAIL tool lạ'); fail += 1; }
const e2 = runTool('ghi_giao_dich', {});
if (e2?.error) { console.log('  ok   thiếu tham số trả error'); pass += 1; } else { console.log('  FAIL thiếu tham số:', JSON.stringify(e2)); fail += 1; }
const e3 = runTool('gop_tien_muc_tieu', { muc_tieu: 'không có thật', so_tien: 10 });
if (e3?.error) { console.log('  ok   mục tiêu lạ trả error'); pass += 1; } else { console.log('  FAIL mục tiêu lạ'); fail += 1; }

console.log(`\nKết quả: ${pass} đạt / ${fail} lỗi`);
if (bad.length) console.log('Cần sửa:', [...new Set(bad)].join(', '));
process.exit(fail ? 1 : 0);
