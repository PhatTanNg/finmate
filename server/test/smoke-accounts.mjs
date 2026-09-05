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

srv.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? '✗' : '✓'} smoke-accounts: ${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
