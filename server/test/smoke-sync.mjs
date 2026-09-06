/**
 * Đồng bộ cả sổ giữa bản chạy trên máy và tài khoản.
 *
 * Điều phải giữ bằng mọi giá: KHÔNG BAO GIỜ lặng lẽ nuốt mất dữ liệu. Máy chủ
 * đã đổi kể từ lần tải về thì lần gửi lên phải bị chặn, và người dùng phải là
 * người quyết định giữ bản nào — bên bị ghi đè luôn có bản sao lưu.
 */
import { existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';

const dir = fileURLToPath(new URL('./.tmp-sync/', import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

process.env.FINMATE_MULTIUSER = '1';
process.env.FINMATE_FX_OFFLINE = '1';
process.env.FINMATE_DATA_DIR = dir;
process.env.FINMATE_DB = path.join(dir, 'default.db');
process.env.FINMATE_BACKUP_DIR = path.join(dir, 'backups');

const { router } = await import('../src/routes/api.js');
const { requireAccount } = await import('../src/services/account_auth.js');
const acc = await import('../src/services/accounts.js');

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

/** Tải nguyên sổ về, kèm số hiệu bản đọc từ header. */
const taiSo = async (token) => {
  const r = await fetch(`${base}/account/ledger`, { headers: { 'x-finmate-key': token } });
  return { status: r.status, rev: Number(r.headers.get('x-finmate-rev')), bytes: Buffer.from(await r.arrayBuffer()) };
};
/** Gửi nguyên sổ lên, khai mình dựa trên bản nào. */
const guiSo = async (token, bytes, baseRev, { force = false } = {}) => {
  const q = new URLSearchParams();
  if (baseRev !== null && baseRev !== undefined) q.set('base_rev', String(baseRev));
  if (force) q.set('force', '1');
  const r = await fetch(`${base}/account/ledger?${q}`, {
    method: 'PUT',
    headers: { 'x-finmate-key': token, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

head('Chuẩn bị hai người dùng');
const an = await POST('/account/register', { email: 'an@example.com', password: 'mat-khau-cua-an', name: 'An' });
const binh = await POST('/account/register', { email: 'binh@example.com', password: 'mat-khau-cua-binh', name: 'Bình' });
ok('hai người đăng ký được', an.user?.id > 0 && binh.user?.id > 0);
await POST('/accounts', { name: 'VCB của An', type: 'bank', opening_balance: 10_000_000 }, an.token);
await POST('/accounts', { name: 'Techcom của Bình', type: 'bank', opening_balance: 20_000_000 }, binh.token);

head('Số hiệu bản nhích lên mỗi lần sổ đổi');
const r0 = (await GET('/account/ledger/info', an.token)).sync;
ok('có số hiệu bản và mốc thời gian', typeof r0?.rev === 'number' && r0.rev > 0, JSON.stringify(r0));
await POST('/transactions', { type: 'expense', amount: 50_000, note: 'cà phê' }, an.token);
const r1 = (await GET('/account/ledger/info', an.token)).sync;
ok('ghi thêm giao dịch thì số hiệu tăng', r1.rev > r0.rev, `${r0.rev} -> ${r1.rev}`);
const r2 = (await GET('/account/ledger/info', an.token)).sync;
ok('chỉ đọc thì số hiệu đứng yên', r2.rev === r1.rev, `${r1.rev} -> ${r2.rev}`);
const revBinh = (await GET('/account/ledger/info', binh.token)).sync.rev;
await POST('/transactions', { type: 'expense', amount: 70_000, note: 'phở' }, binh.token);
ok('sổ người này đổi không làm nhích số hiệu sổ người kia',
  (await GET('/account/ledger/info', an.token)).sync.rev === r1.rev
  && (await GET('/account/ledger/info', binh.token)).sync.rev > revBinh);

head('Tải sổ về máy');
const tai = await taiSo(an.token);
ok('tải về được nguyên file SQLite', tai.status === 200 && tai.bytes.subarray(0, 6).toString() === 'SQLite', String(tai.status));
ok('header kèm đúng số hiệu bản', tai.rev === r1.rev, `${tai.rev} vs ${r1.rev}`);
ok('tải sổ về không tính là một thay đổi', (await GET('/account/ledger/info', an.token)).sync.rev === r1.rev);

const taiBinh = await taiSo(binh.token);
ok('mỗi người tải về đúng sổ của mình',
  taiBinh.bytes.includes(Buffer.from('Techcom của Bình')) && !taiBinh.bytes.includes(Buffer.from('VCB của An')));

head('Gửi sổ lên: đúng bản gốc thì nhận');
const gui = await guiSo(an.token, tai.bytes, tai.rev);
ok('nhận sổ gửi lên', gui.status === 200, JSON.stringify(gui).slice(0, 120));
ok('trả về số hiệu bản mới, lớn hơn bản cũ', gui.rev > tai.rev, `${tai.rev} -> ${gui.rev}`);
ok('có sao lưu bản cũ trước khi ghi đè', Boolean(gui.backup), JSON.stringify(gui.backup));
ok('đếm đúng số giao dịch trong sổ nhận được', gui.transactions >= 1, String(gui.transactions));
ok('sổ vẫn đọc được bình thường sau khi thay',
  (await GET('/accounts', an.token)).accounts?.some((a) => a.name === 'VCB của An'));
ok('máy chủ ghi nhận sổ đang do thiết bị giữ', (await GET('/account/ledger/info', an.token)).sync.owner === 'device');

head('Gửi sổ lên: bản gốc đã cũ thì CHẶN');
const cu = await taiSo(an.token);
await POST('/transactions', { type: 'expense', amount: 12_000, note: 'gửi xe (ghi qua web)' }, an.token);
const lech = await guiSo(an.token, cu.bytes, cu.rev);
ok('máy chủ đã đổi thì từ chối, trả 409', lech.status === 409, JSON.stringify(lech).slice(0, 120));
ok('nói rõ là lệch chứ không phải lỗi vu vơ', lech.conflict === true && /thay đổi/.test(lech.error || ''));
ok('kèm số hiệu bản hiện tại để giao diện giải thích được', lech.sync?.rev > cu.rev, JSON.stringify(lech.sync));
ok('giao dịch ghi qua web KHÔNG bị xoá mất',
  (await GET('/transactions', an.token)).transactions?.some((t) => /gửi xe/.test(t.note || '')));

head('Gửi sổ lên: người dùng chọn ghi đè');
const ep = await guiSo(an.token, cu.bytes, cu.rev, { force: true });
ok('ép ghi đè thì nhận', ep.status === 200 && ep.forced === true, JSON.stringify(ep).slice(0, 120));
ok('bản bị ghi đè vẫn được sao lưu để lấy lại', Boolean(ep.backup));
ok('sổ trên máy chủ giờ là bản người dùng gửi lên',
  !(await GET('/transactions', an.token)).transactions?.some((t) => /gửi xe/.test(t.note || '')));
const thuMuc = path.join(dir, 'backups', 'users', String(an.user.id));
ok('bản sao lưu nằm trong thư mục riêng của người đó', existsSync(thuMuc) && readdirSync(thuMuc).length >= 2, existsSync(thuMuc) ? readdirSync(thuMuc).join(', ') : 'không có');

head('Không ai gửi sổ vào tài khoản người khác được');
const trom = await taiSo(binh.token);
ok('Bình tải về sổ của Bình', trom.bytes.includes(Buffer.from('Techcom của Bình')));
await guiSo(binh.token, trom.bytes, trom.rev);
ok('Bình gửi sổ lên chỉ đụng vào sổ của Bình',
  (await GET('/accounts', an.token)).accounts?.some((a) => a.name === 'VCB của An'));
ok('và sổ của Bình vẫn là của Bình',
  (await GET('/accounts', binh.token)).accounts?.some((a) => a.name === 'Techcom của Bình'));
const khongTheKhoa = await fetch(`${base}/account/ledger`);
ok('không có khoá phiên thì không tải được sổ của ai', khongTheKhoa.status === 401, String(khongTheKhoa.status));

head('Gửi lên thứ không phải sổ FinMate');
const bay = await guiSo(an.token, Buffer.from('đây không phải sqlite đâu nhé, chỉ là chữ thôi'), null);
ok('file lạ bị từ chối', bay.status >= 400, JSON.stringify(bay).slice(0, 100));
ok('báo đúng lý do', /SQLite|sổ FinMate|quá nhỏ/i.test(bay.error || ''), bay.error);
ok('sổ thật vẫn còn nguyên sau khi từ chối',
  (await GET('/accounts', an.token)).accounts?.some((a) => a.name === 'VCB của An'));

// Một file SQLite hợp lệ nhưng của việc khác: phải chặn, vì thay vào là mất sổ.
const { DatabaseSync } = await import('node:sqlite');
const laFile = path.join(dir, 'la.db');
const la = new DatabaseSync(laFile);
la.exec('CREATE TABLE ghi_chu (id INTEGER PRIMARY KEY, noi_dung TEXT)');
la.close();
const { readFileSync } = await import('node:fs');
const laKq = await guiSo(an.token, readFileSync(laFile), null);
ok('cơ sở dữ liệu SQLite của việc khác cũng bị chặn', laKq.status >= 400, JSON.stringify(laKq).slice(0, 100));
ok('nói rõ thiếu bảng gì', /Thiếu bảng/.test(laKq.error || ''), laKq.error);

head('Ghi lúc mất mạng: gửi lại không thành hai');
// Giao diện xếp việc vào hàng chờ rồi gửi lại khi có sóng. Cảnh tệ nhất là máy
// chủ ĐÃ ghi nhưng câu trả lời rơi giữa đường: máy gửi tưởng hỏng nên gửi lại.
// Không có mã chống trùng thì một ly cà phê thành hai khoản chi.
const guiKemMa = async (p, body, token, ma) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-finmate-key': token, 'x-finmate-op': ma },
    body: JSON.stringify(body),
  });
  return { status: r.status, replay: r.headers.get('x-finmate-op-replay') === '1', ...(await r.json().catch(() => ({}))) };
};
const truocKhiGui = (await GET('/transactions', an.token)).transactions.length;
const lan1 = await guiKemMa('/transactions', { type: 'expense', amount: 45_000, note: 'cà phê ghi lúc mất sóng' }, an.token, 'op-ca-phe-1');
const lan2 = await guiKemMa('/transactions', { type: 'expense', amount: 45_000, note: 'cà phê ghi lúc mất sóng' }, an.token, 'op-ca-phe-1');
ok('lần gửi đầu ghi được', lan1.status === 200 && lan1.transaction?.id > 0, JSON.stringify(lan1).slice(0, 100));
ok('gửi lại cùng một mã: máy chủ nói rõ đây là bản chép lại', lan2.replay === true);
ok('gửi lại trả về ĐÚNG câu trả lời cũ', lan2.transaction?.id === lan1.transaction.id, `${lan1.transaction?.id} vs ${lan2.transaction?.id}`);
const sauKhiGui = (await GET('/transactions', an.token)).transactions;
ok('sổ chỉ có MỘT khoản, không phải hai', sauKhiGui.length === truocKhiGui + 1, `${truocKhiGui} -> ${sauKhiGui.length}`);
ok('và đúng là khoản vừa ghi', sauKhiGui.some((t) => /cà phê ghi lúc mất sóng/.test(t.note || '')));

const maKhac = await guiKemMa('/transactions', { type: 'expense', amount: 45_000, note: 'cà phê ghi lúc mất sóng' }, an.token, 'op-ca-phe-2');
ok('mã khác thì vẫn ghi bình thường (hai ly cà phê giống hệt nhau là chuyện thường)',
  maKhac.transaction?.id !== lan1.transaction.id
  && (await GET('/transactions', an.token)).transactions.length === truocKhiGui + 2);

ok('mã của người này không dùng được ở sổ người kia',
  (await guiKemMa('/transactions', { type: 'expense', amount: 999, note: 'của Bình' }, binh.token, 'op-ca-phe-1')).replay !== true);

const loi = await guiKemMa('/transactions', { type: 'expense', amount: 0 }, an.token, 'op-hong-1');
ok('việc máy chủ từ chối cũng được nhớ', loi.status >= 400 && /Số tiền/.test(loi.error || ''), JSON.stringify(loi).slice(0, 80));
ok('gửi lại việc hỏng thì nhận lại đúng lời từ chối đó, không thử ghi lại',
  (await guiKemMa('/transactions', { type: 'expense', amount: 0 }, an.token, 'op-hong-1')).replay === true);

srv.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? '✗' : '✓'} smoke-sync: ${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
