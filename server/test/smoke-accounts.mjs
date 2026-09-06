/**
 * Nhiều người dùng: đăng nhập, và trên hết là CÁCH LY.
 *
 * Đây là bộ kiểm quan trọng nhất của tầng tài khoản. Một app tài chính mà để
 * người này đọc được sổ người kia thì không có lỗi nào khác đáng bàn nữa. Mỗi
 * người một file SQLite riêng nên cách ly là vật lý — bộ kiểm này giữ cho
 * điều đó đúng mãi, kể cả khi sau này ai đó thêm truy vấn mới.
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';

const dir = fileURLToPath(new URL('./.tmp-accounts/', import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

process.env.FINMATE_MULTIUSER = '1';
process.env.FINMATE_FX_OFFLINE = '1';
process.env.FINMATE_DATA_DIR = dir;
process.env.FINMATE_DB = path.join(dir, 'default.db');

const { router } = await import('../src/routes/api.js');
const { requireAccount } = await import('../src/services/account_auth.js');
const acc = await import('../src/services/accounts.js');
const { openCount } = await import('../src/services/ledgers.js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', requireAccount);
app.use('/api', router);
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api`;

const call = async (method, p, body, token) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-finmate-key': token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const POST = (p, b, t) => call('POST', p, b, t);
const GET = (p, t) => call('GET', p, null, t);

head('Đăng ký và đăng nhập');
const an = await POST('/account/register', { email: 'An@Example.COM ', password: 'matkhau-cua-an', name: 'An' });
ok('đăng ký được', an.status === 200 && an.user?.id > 0, JSON.stringify(an).slice(0, 100));
ok('email được chuẩn hoá về chữ thường, bỏ khoảng trắng', an.user?.email === 'an@example.com', an.user?.email);
ok('đăng ký xong có token dùng ngay, không bắt gõ lại mật khẩu', typeof an.token === 'string' && an.token.length > 20);
ok('không trả mật khẩu băm ra ngoài', !JSON.stringify(an).includes('pass'), JSON.stringify(an).slice(0, 80));

const binh = await POST('/account/register', { email: 'binh@example.com', password: 'matkhau-cua-binh', name: 'Bình' });
ok('người thứ hai đăng ký được', binh.user?.id > 0 && binh.user.id !== an.user.id);

const trung = await POST('/account/register', { email: 'an@example.com', password: 'mat-khau-khac' });
ok('email trùng bị từ chối', trung.status >= 400 && /đã có tài khoản/.test(trung.error || ''), trung.error);
const yeu = await POST('/account/register', { email: 'c@example.com', password: '123' });
ok('mật khẩu quá ngắn bị từ chối', yeu.status >= 400 && /8 ký tự/.test(yeu.error || ''), yeu.error);
const xau = await POST('/account/register', { email: 'khong-phai-email', password: 'matkhaudaidai' });
ok('email sai định dạng bị từ chối', xau.status >= 400, xau.error);

head('CÁCH LY: không ai đọc được sổ của ai');
await POST('/accounts', { name: 'VCB của An', type: 'bank', balance: 5_000_000, currency: 'VND' }, an.token);
await POST('/accounts', { name: 'AIB của Bình', type: 'bank', balance: 7_000_000, currency: 'EUR' }, binh.token);
const kA = await GET('/accounts', an.token);
const kB = await GET('/accounts', binh.token);
const tenA = kA.accounts.map((a) => a.name);
const tenB = kB.accounts.map((a) => a.name);
ok('An thấy sổ của An', tenA.includes('VCB của An'), tenA.join(', '));
ok('Bình thấy sổ của Bình', tenB.includes('AIB của Bình'), tenB.join(', '));
ok('An KHÔNG thấy gì của Bình', !tenA.some((n) => /Bình/.test(n)), tenA.join(', '));
ok('Bình KHÔNG thấy gì của An', !tenB.some((n) => /An/.test(n)), tenB.join(', '));

await POST('/transactions', { type: 'expense', amount: 123_000, date: '2026-09-01', merchant: 'Quán của An' }, an.token);
const gdA = await GET('/transactions?limit=50', an.token);
const gdB = await GET('/transactions?limit=50', binh.token);
ok('giao dịch cũng cách ly', gdA.transactions.length === 1 && gdB.transactions.length === 0,
  `An ${gdA.transactions.length} · Bình ${gdB.transactions.length}`);

const dashA = await GET('/dashboard', an.token);
const dashB = await GET('/dashboard', binh.token);
ok('trang chủ mỗi người ra số của riêng mình',
  dashA.net_worth.net !== dashB.net_worth.net, `${dashA.net_worth.net} vs ${dashB.net_worth.net}`);

head('Phiên đăng nhập');
ok('không token thì bị chặn', (await GET('/accounts')).status === 401);
ok('token bịa bị chặn', (await GET('/accounts', 'token-bia-dat')).status === 401);
const me = await GET('/account/me', an.token);
ok('/account/me trả đúng người', me.user?.email === 'an@example.com', JSON.stringify(me.user));

const sai = await POST('/account/login', { email: 'an@example.com', password: 'sai-mat-khau' });
ok('mật khẩu sai bị từ chối', sai.status === 401);
ok('không tiết lộ email nào đã đăng ký',
  (await POST('/account/login', { email: 'khong-ton-tai@example.com', password: 'gi-do-dai-dai' })).error === sai.error);

const lai = await POST('/account/login', { email: 'an@example.com', password: 'matkhau-cua-an' });
ok('đăng nhập lại được, cấp token mới', lai.status === 200 && lai.token !== an.token);
ok('token cũ vẫn dùng được (nhiều thiết bị cùng lúc)', (await GET('/accounts', an.token)).status === 200);

await POST('/account/logout', {}, an.token);
ok('đăng xuất thì token đó hết hiệu lực', (await GET('/accounts', an.token)).status === 401);
ok('thiết bị khác vẫn đăng nhập', (await GET('/accounts', lai.token)).status === 200);

head('Đổi mật khẩu');
const doi = await POST('/account/password', { current: 'matkhau-cua-an', next: 'matkhau-moi-cua-an' }, lai.token);
ok('đổi được mật khẩu', doi.status === 200, JSON.stringify(doi).slice(0, 80));
ok('đổi xong mọi thiết bị phải đăng nhập lại', (await GET('/accounts', lai.token)).status === 401);
ok('mật khẩu cũ hết dùng được', (await POST('/account/login', { email: 'an@example.com', password: 'matkhau-cua-an' })).status === 401);
const moi = await POST('/account/login', { email: 'an@example.com', password: 'matkhau-moi-cua-an' });
ok('mật khẩu mới đăng nhập được', moi.status === 200);
ok('dữ liệu còn nguyên sau khi đổi mật khẩu',
  (await GET('/accounts', moi.token)).accounts.some((a) => a.name === 'VCB của An'));

head('Sổ riêng từng người');
ok('mỗi người một file .db riêng', existsSync(acc.ledgerPath(an.user.id)) && existsSync(acc.ledgerPath(binh.user.id)));
ok('chỉ mở đúng số sổ đang dùng', openCount() === 2, String(openCount()));
ok('sổ mới được gieo sẵn danh mục/quỹ mặc định',
  (await GET('/categories', binh.token)).categories?.length > 0);

head('/health nhận ra mình khi mở lại app');
// Giao diện hỏi /health lúc mở trang để biết còn đăng nhập không. /health không
// đòi token (phải trả lời được cả khi chưa đăng nhập), nhưng CÓ token hợp lệ
// thì phải nói ra là ai — không thì mỗi lần tải lại trang là bị đá ra ngoài.
const hCoToken = await GET('/health', moi.token);
ok('có token thì /health nói rõ đang là ai', hCoToken.user?.id === an.user.id, JSON.stringify(hCoToken.user));
const hKhong = await GET('/health');
ok('không token thì /health vẫn trả lời, và không nhận vơ là ai cả', hKhong.status === 200 && !hKhong.user);
ok('token bậy cũng không được nhận là ai', !(await GET('/health', 'token-bay-ba')).user);

head('Khoá cửa đăng ký cho máy chủ đặt công khai');
// Máy chủ mở ra Internet mà ai cũng đăng ký được thì người lạ tạo tài khoản
// vô hạn, mỗi tài khoản một file sổ, đến lúc đầy đĩa thì cả nhà cùng mất dùng.
process.env.FINMATE_SIGNUP_CODE = 'ma-moi-cua-nha-minh';
const thieuMa = await POST('/account/register', { email: 'nguoila@example.com', password: 'mat-khau-dai-dai' });
ok('không có mã mời thì không đăng ký được', thieuMa.status !== 200 && /mã mời/i.test(thieuMa.error || ''), JSON.stringify(thieuMa).slice(0, 100));
const saiMa = await POST('/account/register', { email: 'nguoila@example.com', password: 'mat-khau-dai-dai', code: 'doan-bua' });
ok('mã sai cũng không vào được', saiMa.status !== 200);
ok('người lạ không hề được tạo tài khoản', acc.countUsers() === 2, String(acc.countUsers()));
const dungMa = await POST('/account/register', { email: 'chi@example.com', password: 'mat-khau-cua-chi', code: 'ma-moi-cua-nha-minh' });
ok('đúng mã thì đăng ký bình thường', dungMa.status === 200 && dungMa.user?.id > 0, JSON.stringify(dungMa).slice(0, 100));
ok('/health báo cho giao diện biết phải hỏi mã mời', (await GET('/health')).signup_code_required === true);
delete process.env.FINMATE_SIGNUP_CODE;
ok('bỏ mã thì cửa mở lại như cũ (chạy trong nhà)', (await GET('/health')).signup_code_required === false);

process.env.FINMATE_MAX_USERS = '3';
const qua = await POST('/account/register', { email: 'nguoithu4@example.com', password: 'mat-khau-dai-dai' });
ok('chạm trần số tài khoản thì dừng nhận thêm', qua.status !== 200 && /đủ số tài khoản/i.test(qua.error || ''), JSON.stringify(qua).slice(0, 100));
delete process.env.FINMATE_MAX_USERS;

head('Quên mật khẩu: gửi thư');
// Máy chủ thư giả: bắt lại đúng lá thư app định gửi, để soi nội dung thật chứ
// không phải soi ý định gửi.
const thuDaGui = [];
const mailSrv = await new Promise((r) => {
  const a = express();
  a.use(express.json());
  a.post('/emails', (req, rq) => { thuDaGui.push({ ...req.body, auth: req.get('authorization') }); rq.json({ id: 'thu-' + thuDaGui.length }); });
  const sv = a.listen(0, () => r(sv));
});
process.env.FINMATE_MAIL_KEY = 'khoa-gia';
process.env.FINMATE_MAIL_URL = `http://127.0.0.1:${mailSrv.address().port}/emails`;
process.env.FINMATE_PUBLIC_URL = 'https://finmate.example';

ok('/health báo giao diện biết máy chủ gửi được thư', (await GET('/health')).mail_enabled === true);
const quen = await POST('/account/forgot', { email: 'an@example.com' });
ok('gọi quên mật khẩu được khi CHƯA đăng nhập', quen.status === 200, JSON.stringify(quen).slice(0, 80));
ok('có gửi đúng một lá thư', thuDaGui.length === 1, String(thuDaGui.length));
ok('thư gửi đúng người', thuDaGui[0]?.to?.[0] === 'an@example.com', JSON.stringify(thuDaGui[0]?.to));
ok('thư có kèm khoá API ở header', /^Bearer khoa-gia$/.test(thuDaGui[0]?.auth || ''));
const veTrongThu = /#reset=([A-Za-z0-9_-]+)/.exec(thuDaGui[0]?.text || '')?.[1];
ok('thư có đường dẫn đặt lại trên đúng tên miền công khai', (thuDaGui[0]?.text || '').includes('https://finmate.example/#reset='), (thuDaGui[0]?.text || '').slice(0, 60));
ok('thư nói rõ dùng một lần và có hạn', /MỘT LẦN|một lần/.test(thuDaGui[0]?.text || '') && /phút/.test(thuDaGui[0]?.text || ''));

const laVe = await POST('/account/forgot', { email: 'khong-ai-dung@example.com' });
ok('email không có tài khoản: trả lời y hệt, không lộ ai đã đăng ký', JSON.stringify(laVe) === JSON.stringify(quen), JSON.stringify(laVe));
ok('và tất nhiên không gửi thư nào', thuDaGui.length === 1, String(thuDaGui.length));

const lienTiep = await POST('/account/forgot', { email: 'an@example.com' });
ok('bấm lại ngay thì không gửi thêm thư (quãng nghỉ chống chọc phá)', thuDaGui.length === 1, String(thuDaGui.length));
ok('nhưng vẫn trả lời y hệt, không để lộ là đã có vé', JSON.stringify(lienTiep) === JSON.stringify(quen));

head('Quên mật khẩu: dùng vé');
const kiem = await GET(`/account/reset?token=${encodeURIComponent(veTrongThu)}`);
ok('mở đường dẫn thì biết ngay vé còn dùng được', kiem.valid === true && kiem.email === 'an@example.com', JSON.stringify(kiem));
ok('vé bịa thì báo hỏng chứ không nhận bừa', (await GET('/account/reset?token=ve-bia-dat')).valid === false);

const nganQua = await POST('/account/reset', { token: veTrongThu, password: 'ngan' });
ok('mật khẩu mới quá ngắn thì bị chặn', nganQua.status !== 200 && /8 ký tự/.test(nganQua.error || ''), JSON.stringify(nganQua).slice(0, 80));

const phienCu = (await POST('/account/login', { email: 'an@example.com', password: 'matkhau-moi-cua-an' })).token;
ok('trước khi đặt lại, phiên cũ vẫn dùng được', (await GET('/accounts', phienCu)).status === 200);

const datLai = await POST('/account/reset', { token: veTrongThu, password: 'mat-khau-quen-roi' });
ok('đặt lại được bằng vé trong thư', datLai.status === 200 && datLai.user?.id === an.user.id, JSON.stringify(datLai).slice(0, 100));
ok('đặt lại xong vào thẳng app, không bắt gõ lại mật khẩu vừa đặt', typeof datLai.token === 'string' && datLai.token.length > 20);
ok('mọi thiết bị khác bị đăng xuất', (await GET('/accounts', phienCu)).status === 401);
ok('mật khẩu cũ hết dùng được', (await POST('/account/login', { email: 'an@example.com', password: 'matkhau-moi-cua-an' })).status === 401);
ok('mật khẩu mới đăng nhập được', (await POST('/account/login', { email: 'an@example.com', password: 'mat-khau-quen-roi' })).status === 200);
ok('vé đã dùng thì không dùng lại được', (await POST('/account/reset', { token: veTrongThu, password: 'lan-nua-di' })).status !== 200);
ok('sổ vẫn còn nguyên sau khi đặt lại mật khẩu',
  (await GET('/accounts', datLai.token)).accounts?.some((a) => a.name === 'VCB của An'));

head('Quên mật khẩu: vé cũ và vé hết hạn');
// Vé "hết hạn" = hạn nằm trong quá khứ. Đặt số phút âm là cách gọn nhất để
// dựng đúng tình huống đó mà không phải giả lập đồng hồ.
process.env.FINMATE_RESET_MINUTES = '-1';
const veHet = acc.startReset('binh@example.com');
ok('vé hết hạn thì coi như không có', veHet && !acc.resetOwner(veHet.token), JSON.stringify(Boolean(veHet)));
let neVe = null;
try { acc.resetWithToken(veHet.token, 'mat-khau-gi-do'); } catch (e) { neVe = e.message; }
ok('dùng vé hết hạn thì báo rõ là hết hạn', /hết hạn|đã dùng/.test(neVe || ''), String(neVe));
delete process.env.FINMATE_RESET_MINUTES;
ok('mật khẩu của Bình không hề bị đổi', Boolean(acc.verify({ email: 'binh@example.com', password: 'matkhau-cua-binh' })));

head('Quên mật khẩu: máy chủ chưa gắn dịch vụ gửi thư');
delete process.env.FINMATE_MAIL_KEY;
ok('/health nói thẳng là không gửi được thư', (await GET('/health')).mail_enabled === false);
const khongThu = await POST('/account/forgot', { email: 'an@example.com' });
ok('vẫn trả lời tử tế chứ không lỗi', khongThu.status === 200, JSON.stringify(khongThu).slice(0, 80));
ok('và nói rõ là không gửi được, để giao diện chỉ đường khác', khongThu.mail_enabled === false && khongThu.sent === false, JSON.stringify(khongThu));
mailSrv.close();
delete process.env.FINMATE_MAIL_URL;
delete process.env.FINMATE_PUBLIC_URL;

srv.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? '✗' : '✓'} smoke-accounts: ${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
