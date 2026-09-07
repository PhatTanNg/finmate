/**
 * Sổ chung của một nhà: cùng ghi, cùng xem, và không ai xem quá phần của mình.
 *
 * Ba thứ bộ kiểm này giữ, xếp theo mức độ nguy hiểm nếu hỏng:
 *
 *  1. CÁCH LY. Người ngoài không mở được sổ nhà người khác, và sổ RIÊNG của
 *     từng người vẫn kín như trước — thêm sổ chung không được mở hé sổ riêng.
 *  2. KHÔNG MẤT DỮ LIỆU. Sổ chung phải từ chối nhận cả cuốn sổ gửi lên. Đường
 *     đó ghi đè toàn bộ file, nên một lần đồng bộ offline của vợ là xoá sạch
 *     những gì chồng ghi trong ngày — không cảnh báo, không lấy lại được.
 *  3. PHÂN QUYỀN. Con ghi được khoản chi nhưng không xoá được gì và không mở
 *     được phần thu nhập, nợ, đầu tư, cài đặt.
 */
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';

const dir = fileURLToPath(new URL('./.tmp-family/', import.meta.url));
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
const { requireRole } = await import('../src/services/family_guard.js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', requireAccount);
app.use('/api', requireRole);
app.use('/api', router);
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api`;

/**
 * `so` là sổ đích khai trong header — đúng thứ mà app thật gửi kèm mỗi request.
 * Bỏ trống thì máy chủ dùng sổ mà phiên đang mở, y như client cũ.
 */
const call = async (method, p, body, token, so = null, them = {}) => {
  const r = await fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-finmate-key': token } : {}),
      ...(so ? { 'x-finmate-ledger': so } : {}),
      ...them,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const GET = (p, t, so) => call('GET', p, null, t, so);
const POST = (p, b, t, so) => call('POST', p, b, t, so);
const PATCH = (p, b, t, so) => call('PATCH', p, b, t, so);
const DEL = (p, t, so) => call('DELETE', p, null, t, so);

const dangKy = async (email, name) =>
  (await POST('/account/register', { email, password: `matkhau-${name}`, name })).token;

// ── Ba người: hai vợ chồng, một đứa con, và một người dưng ────────────────
const nam = await dangKy('nam@example.com', 'Nam');
const thu = await dangKy('thu@example.com', 'Thu');
const be = await dangKy('be@example.com', 'Bé');
const laNguoiDung = await dangKy('la@example.com', 'Lạ');

head('Mặc định vẫn là sổ riêng, y như trước');
{
  const d = await GET('/account/ledgers', nam);
  ok('mới đăng ký thì chỉ có sổ riêng', d.ledgers?.length === 1 && d.ledgers[0].kind === 'personal', JSON.stringify(d.ledgers));
  ok('sổ riêng đang là sổ đang mở', d.current === d.ledgers[0].key, `${d.current}`);
  const h = await GET('/health', nam);
  ok('/health nói rõ đang mở sổ nào và vai gì', h.ledger?.kind === 'personal' && h.ledger?.role === 'owner', JSON.stringify(h.ledger));
}

head('Tạo sổ chung và mời vợ vào');
let khoaNha = null;
{
  const d = await POST('/account/ledgers', { name: 'Nhà mình' }, nam);
  ok('tạo được sổ chung', d.status === 200 && d.ledger?.key?.startsWith('g'), JSON.stringify(d).slice(0, 120));
  khoaNha = d.ledger.key;
  ok('người tạo là chủ sổ', d.ledger.role === 'owner');

  const ds = await GET('/account/ledgers', nam);
  ok('sổ riêng KHÔNG biến mất khi có sổ chung', ds.ledgers.some((l) => l.kind === 'personal'), JSON.stringify(ds.ledgers));
  ok('cả hai sổ cùng mở được', ds.ledgers.length === 2);

  await POST('/account/switch', { key: khoaNha }, nam);
  const moi = await POST('/account/families/invite', { role: 'adult' }, nam);
  ok('chủ sổ tạo được mã mời', moi.status === 200 && typeof moi.invite?.code === 'string' && moi.invite.code.length >= 10);
  ok('nói rõ mã chỉ hiện một lần', moi.chi_hien_mot_lan === true);

  const vao = await POST('/account/families/join', { code: moi.invite.code }, thu);
  ok('vợ vào được bằng mã', vao.status === 200 && vao.ledger?.key === khoaNha, JSON.stringify(vao).slice(0, 120));

  const lai = await POST('/account/families/join', { code: moi.invite.code }, laNguoiDung);
  ok('mã đã dùng thì người khác không dùng lại được', lai.status !== 200, JSON.stringify(lai).slice(0, 100));
  ok('và không nói rõ vì sao, để người dò không đoán được', /không dùng được/.test(lai.error || ''), lai.error);
}

head('Hai vợ chồng cùng ghi vào một sổ, và biết ai ghi khoản nào');
{
  await POST('/account/switch', { key: khoaNha }, thu);
  const tk = await POST('/accounts', { name: 'Tiền mặt nhà', type: 'cash', balance: 5_000_000 }, nam);
  const tkId = tk.account?.id;
  await POST('/transactions', { amount: 65_000, type: 'expense', merchant: 'chợ', account_id: tkId, date: '2026-09-01' }, thu);
  await POST('/transactions', { amount: 120_000, type: 'expense', merchant: 'xăng', account_id: tkId, date: '2026-09-01' }, nam);

  const cuaNam = await GET('/transactions?limit=50', nam);
  const cuaThu = await GET('/transactions?limit=50', thu);
  ok('chồng thấy cả khoản vợ vừa ghi', cuaNam.transactions.some((t) => t.merchant === 'chợ'));
  ok('vợ thấy cả khoản chồng vừa ghi', cuaThu.transactions.some((t) => t.merchant === 'xăng'));
  ok('hai người thấy CÙNG một cuốn sổ', cuaNam.transactions.length === cuaThu.transactions.length);

  // Đây là lý do cột created_by phải có ngay từ đầu: gắn tên vào những khoản
  // đã ghi từ trước là chuyện không làm được.
  const cho = cuaNam.transactions.find((t) => t.merchant === 'chợ');
  const xang = cuaNam.transactions.find((t) => t.merchant === 'xăng');
  const idThu = (await GET('/account/me', thu)).user.id;
  const idNam = (await GET('/account/me', nam)).user.id;
  ok('khoản của vợ mang tên vợ', Number(cho?.created_by) === idThu, `${cho?.created_by} vs ${idThu}`);
  ok('khoản của chồng mang tên chồng', Number(xang?.created_by) === idNam, `${xang?.created_by} vs ${idNam}`);

  const tv = await GET('/account/families/members', nam);
  ok('xem được danh sách thành viên', tv.members?.length === 2, JSON.stringify(tv.members));
  ok('vai hiện đúng', tv.members.find((m) => m.id === idNam)?.role === 'owner' && tv.members.find((m) => m.id === idThu)?.role === 'adult');
}

head('Sổ riêng vẫn kín — có sổ chung không làm hé sổ riêng');
{
  // Nam quay về sổ riêng ghi một khoản, rồi Thu phải KHÔNG thấy nó ở đâu cả.
  const dsNam = await GET('/account/ledgers', nam);
  const riengNam = dsNam.ledgers.find((l) => l.kind === 'personal').key;
  await POST('/account/switch', { key: riengNam }, nam);
  const tk = await POST('/accounts', { name: 'Ví riêng', type: 'cash', balance: 1_000_000 }, nam);
  await POST('/transactions', { amount: 500_000, type: 'expense', merchant: 'quà sinh nhật cho Thu', account_id: tk.account.id, date: '2026-09-02' }, nam);

  const nhaCuaThu = await GET('/transactions?limit=50', thu);
  ok('vợ KHÔNG thấy khoản chồng ghi trong sổ riêng', !nhaCuaThu.transactions.some((t) => /quà sinh nhật/.test(t.merchant || '')), JSON.stringify(nhaCuaThu.transactions.map((t) => t.merchant)));

  const tkThu = await GET('/accounts', thu);
  ok('và cũng không thấy tài khoản riêng của chồng', !tkThu.accounts.some((a) => a.name === 'Ví riêng'), JSON.stringify(tkThu.accounts.map((a) => a.name)));

  // Người dưng thì không mở nổi sổ nhà người ta, dù có gõ đúng khoá.
  const trom = await POST('/account/switch', { key: khoaNha }, laNguoiDung);
  ok('người ngoài không mở được sổ nhà người khác', trom.status !== 200, JSON.stringify(trom).slice(0, 100));
  const xem = await GET('/transactions?limit=50', laNguoiDung);
  ok('và vẫn chỉ thấy sổ riêng trống của mình', !xem.transactions.some((t) => t.merchant === 'chợ'));
}

head('Con: ghi được khoản chi, nhưng không xoá và không xem được phần người lớn');
{
  await POST('/account/switch', { key: khoaNha }, nam);
  const moi = await POST('/account/families/invite', { role: 'child' }, nam);
  await POST('/account/families/join', { code: moi.invite.code }, be);
  await POST('/account/switch', { key: khoaNha }, be);

  const h = await GET('/health', be);
  ok('con vào được sổ nhà với vai child', h.ledger?.role === 'child', JSON.stringify(h.ledger));

  const tks = await GET('/accounts', be);
  const ghi = await POST('/transactions', { amount: 20_000, type: 'expense', merchant: 'ăn sáng', account_id: tks.accounts[0]?.id, date: '2026-09-03' }, be);
  ok('con GHI được khoản chi của mình', ghi.status === 200, JSON.stringify(ghi).slice(0, 120));

  const ds = await GET('/transactions?limit=50', be);
  const cuaBe = ds.transactions.find((t) => t.merchant === 'ăn sáng');
  ok('khoản con ghi mang tên con', Number(cuaBe?.created_by) === (await GET('/account/me', be)).user.id);

  const xoa = await DEL(`/transactions/${cuaBe.id}`, be);
  ok('con KHÔNG xoá được, kể cả khoản của chính mình', xoa.status === 403, JSON.stringify(xoa).slice(0, 120));
  ok('và được nói rõ vì sao', /không xoá được/.test(xoa.error || ''), xoa.error);

  for (const [duong, ten] of [
    ['/income-streams', 'thu nhập'],
    ['/debts', 'nợ'],
    ['/investments', 'đầu tư'],
    ['/networth', 'tổng tài sản'],
    ['/settings', 'cài đặt'],
    ['/reports/month', 'báo cáo thu chi'],
  ]) {
    const r = await GET(duong, be);
    ok(`con không mở được phần ${ten}`, r.status === 403, `${duong} -> ${r.status}`);
  }

  const nguoiLon = await GET('/income-streams', nam);
  ok('người lớn thì vẫn mở bình thường', nguoiLon.status === 200, String(nguoiLon.status));

  const moiThem = await POST('/account/families/invite', { role: 'adult' }, be);
  ok('con không mời thêm người vào nhà được', moiThem.status === 403, JSON.stringify(moiThem).slice(0, 100));
}

head('Sổ chung KHÔNG nhận cả cuốn sổ gửi lên — chỗ dễ mất dữ liệu nhất');
{
  await POST('/account/switch', { key: khoaNha }, thu);
  const r = await fetch(`${base}/account/ledger`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'x-finmate-key': thu },
    body: Buffer.from('SQLite format 3\0'),
  });
  const j = await r.json().catch(() => ({}));
  ok('gửi cả cuốn sổ lên sổ chung bị từ chối', r.status === 409, String(r.status));
  ok('và đánh dấu rõ là vì sổ chung', j.shared_ledger === true, JSON.stringify(j).slice(0, 140));
  ok('lời từ chối nói đúng hậu quả sẽ tránh được', /ghi đè mất/.test(j.error || ''), j.error);

  // Nói "không" mà mất luôn đường sao lưu thì cũng là một kiểu hỏng: tải VỀ
  // vẫn phải được, vì nó không ghi đè gì cả.
  const tai = await fetch(`${base}/account/ledger`, { headers: { 'x-finmate-key': thu } });
  ok('nhưng tải sổ chung về làm bản lưu thì vẫn được', tai.status === 200, String(tai.status));
  ok('và đánh dấu đây là bản chụp chỉ để đọc', tai.headers.get('x-finmate-readonly-copy') === '1');

  // Sổ riêng thì đường cũ phải còn nguyên, không được vạ lây.
  const dsThu = await GET('/account/ledgers', thu);
  await POST('/account/switch', { key: dsThu.ledgers.find((l) => l.kind === 'personal').key }, thu);
  const rr = await fetch(`${base}/account/ledger`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'x-finmate-key': thu },
    body: Buffer.from('SQLite format 3\0'),
  });
  ok('sổ riêng vẫn nhận sổ gửi lên như cũ (hỏng vì file rác, không phải vì bị cấm)',
    rr.status !== 409, String(rr.status));
}

head('Gỡ khỏi sổ là mất quyền NGAY, không đợi hết phiên');
{
  await POST('/account/switch', { key: khoaNha }, be);
  const idBe = (await GET('/account/me', be)).user.id;
  const go = await POST('/account/families/remove', { user_id: idBe }, nam);
  ok('chủ sổ gỡ được thành viên', go.status === 200, JSON.stringify(go).slice(0, 100));

  // Phiên của bé vẫn còn hiệu lực, nhưng sổ nhà thì không mở được nữa.
  const h = await GET('/health', be);
  ok('người bị gỡ rơi về sổ riêng ngay lập tức', h.ledger?.kind === 'personal', JSON.stringify(h.ledger));
  const ds = await GET('/transactions?limit=50', be);
  ok('và không còn thấy giao dịch của nhà nữa', !ds.transactions.some((t) => t.merchant === 'chợ'), JSON.stringify(ds.transactions.map((t) => t.merchant)));
}

head('Chủ sổ không tự gỡ mình, sổ không bao giờ mất chủ');
{
  const idNam = (await GET('/account/me', nam)).user.id;
  const r = await POST('/account/families/remove', { user_id: idNam }, nam);
  ok('chủ sổ không gỡ được chính mình', r.status !== 200, JSON.stringify(r).slice(0, 120));
  const r2 = await POST('/account/families/role', { user_id: idNam, role: 'child' }, nam);
  ok('và cũng không tự hạ vai mình xuống', r2.status !== 200, JSON.stringify(r2).slice(0, 120));
}

head('Đợt 2: mỗi việc ghi tự khai sổ đích, không dựa vào sổ phiên đang mở');
{
  // Đây là kịch bản mất dữ liệu thật của đợt 1: ghi ngoài chợ vào SỔ NHÀ lúc
  // mất mạng, về nhà đổi sang SỔ RIÊNG rồi mới có sóng. Nếu sổ đích lấy từ
  // phiên thì khoản đó rơi vào sổ riêng, im lặng.
  const dsNam = await GET('/account/ledgers', nam);
  const riengNam = dsNam.ledgers.find((l) => l.kind === 'personal').key;
  await POST('/account/switch', { key: riengNam }, nam);   // phiên đang ở SỔ RIÊNG

  const tkNha = (await GET('/accounts', nam, khoaNha)).accounts.find((a) => a.name === 'Tiền mặt nhà');
  const ghi = await POST('/transactions',
    { amount: 88_000, type: 'expense', merchant: 'rau ngoài chợ', account_id: tkNha.id, date: '2026-09-05' },
    nam, khoaNha);
  ok('ghi được vào sổ nhà dù phiên đang mở sổ riêng', ghi.status === 200, JSON.stringify(ghi).slice(0, 120));

  const nha = await GET('/transactions?limit=50', nam, khoaNha);
  ok('khoản nằm ĐÚNG trong sổ nhà', nha.transactions.some((t) => t.merchant === 'rau ngoài chợ'));
  const rieng = await GET('/transactions?limit=50', nam);
  ok('và KHÔNG lọt vào sổ riêng', !rieng.transactions.some((t) => t.merchant === 'rau ngoài chợ'),
    JSON.stringify(rieng.transactions.map((t) => t.merchant)));
  ok('vợ thấy khoản đó trong sổ nhà', (await GET('/transactions?limit=50', thu, khoaNha)).transactions.some((t) => t.merchant === 'rau ngoài chợ'));
}

head('Gửi lại việc đã gửi thì không ghi thành hai khoản');
{
  const tkNha = (await GET('/accounts', thu, khoaNha)).accounts.find((a) => a.name === 'Tiền mặt nhà');
  const opId = 'op-thu-mat-song-giua-chung';
  const than = { amount: 45_000, type: 'expense', merchant: 'bánh mì', account_id: tkNha.id, date: '2026-09-06' };
  const lan1 = await call('POST', '/transactions', than, thu, khoaNha, { 'x-finmate-op': opId });
  const lan2 = await call('POST', '/transactions', than, thu, khoaNha, { 'x-finmate-op': opId });
  ok('cả hai lần đều trả lời thành công', lan1.status === 200 && lan2.status === 200);
  const ds = (await GET('/transactions?limit=50', thu, khoaNha)).transactions.filter((t) => t.merchant === 'bánh mì');
  ok('nhưng sổ chỉ có MỘT khoản', ds.length === 1, `thấy ${ds.length}`);

  // Chống trùng phải nằm trong TỪNG sổ. Chung một bảng thì cùng một mã việc
  // gửi sang sổ khác sẽ bị nuốt và không ghi gì cả — người dùng bấm lưu, máy
  // chủ trả lời "xong", mà sổ thì trống.
  const dsThu = await GET('/account/ledgers', thu);
  const riengThu = dsThu.ledgers.find((l) => l.kind === 'personal').key;
  const tkRieng = await POST('/accounts', { name: 'Ví Thu', type: 'cash', balance: 200_000 }, thu, riengThu);
  const rieng = await call('POST', '/transactions',
    { ...than, account_id: tkRieng.account.id }, thu, riengThu, { 'x-finmate-op': opId });
  ok('cùng mã việc nhưng sổ khác thì vẫn được ghi', rieng.status === 200, JSON.stringify(rieng).slice(0, 140));
  ok('và không bị trả lại câu trả lời cũ của sổ kia',
    (await GET('/transactions?limit=50', thu, riengThu)).transactions.filter((t) => t.merchant === 'bánh mì').length === 1);
  ok('sổ nhà vẫn chỉ có đúng một khoản đó',
    (await GET('/transactions?limit=50', thu, khoaNha)).transactions.filter((t) => t.merchant === 'bánh mì').length === 1);
}

head('Khai sổ mình không có quyền thì bị chặn, không âm thầm ghi chỗ khác');
{
  const tkNha = (await GET('/accounts', nam, khoaNha)).accounts[0];
  const r = await POST('/transactions',
    { amount: 10_000, type: 'expense', merchant: 'trộm ghi', account_id: tkNha?.id, date: '2026-09-07' },
    laNguoiDung, khoaNha);
  ok('người ngoài khai sổ nhà người ta thì bị từ chối', r.status === 403, JSON.stringify(r).slice(0, 120));
  ok('và được đánh dấu là sai sổ, để hàng chờ nói đúng lý do', r.wrong_ledger === true, JSON.stringify(r).slice(0, 120));

  const nha = await GET('/transactions?limit=50', nam, khoaNha);
  ok('sổ nhà không hề có khoản đó', !nha.transactions.some((t) => t.merchant === 'trộm ghi'));
  const cuaLa = await GET('/transactions?limit=50', laNguoiDung);
  ok('và nó cũng KHÔNG rơi vào sổ riêng của chính người gửi', !cuaLa.transactions.some((t) => t.merchant === 'trộm ghi'),
    JSON.stringify(cuaLa.transactions.map((t) => t.merchant)));
}

head('File sổ nằm đúng chỗ, không lẫn vào nhau');
{
  // Hai không gian id CHỒNG LÊN NHAU: người dùng #1 và sổ chung #1 cùng tồn
  // tại. Đó chính là lý do khoá sổ là chuỗi 'u1'/'g1' chứ không phải số 1 —
  // lẫn hai cái đó là mở nhầm sổ nhà người khác. Bộ kiểm này giữ cho hai id
  // trùng số vẫn ra hai file khác nhau.
  const idNha = Number(khoaNha.slice(1));
  const fileNha = path.join(dir, 'families', `${idNha}.db`);
  const fileNguoi = path.join(dir, 'users', `${idNha}.db`);
  ok('sổ chung nằm ở thư mục riêng', existsSync(fileNha), fileNha);
  ok('người dùng trùng số id cũng có sổ riêng của mình', existsSync(fileNguoi), fileNguoi);
  ok('và đó là HAI file khác nhau, không đè lên nhau', fileNha !== fileNguoi);
  // Chốt lại bằng nội dung chứ không chỉ bằng đường dẫn: sổ nhà có giao dịch
  // "chợ", sổ riêng của Nam thì không.
  const { DatabaseSync } = await import('node:sqlite');
  const dbNha = new DatabaseSync(fileNha);
  const dbNguoi = new DatabaseSync(fileNguoi);
  const dem = (db, m) => db.prepare('SELECT COUNT(*) c FROM transactions WHERE merchant = ?').get(m).c;
  ok('sổ chung giữ khoản của nhà', dem(dbNha, 'chợ') === 1);
  ok('sổ riêng KHÔNG hề có khoản của nhà', dem(dbNguoi, 'chợ') === 0);
  ok('sổ riêng giữ khoản riêng của chính chủ', dem(dbNguoi, 'quà sinh nhật cho Thu') === 1);
  ok('và sổ chung không hề thấy khoản riêng đó', dem(dbNha, 'quà sinh nhật cho Thu') === 0);
  dbNha.close(); dbNguoi.close();
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} smoke-family: ${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
