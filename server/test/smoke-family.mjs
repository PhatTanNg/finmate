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

head('Con giữ sổ RIÊNG của mình, không vào sổ chung');
{
  await POST('/account/switch', { key: khoaNha }, nam);
  const moi = await POST('/account/families/invite', { role: 'child' }, nam);
  const vao = await POST('/account/families/join', { code: moi.invite.code }, be);
  ok('nhận lời mời làm con thì KHÔNG vào sổ chung', vao.status === 200 && vao.ledger?.kind === 'child', JSON.stringify(vao).slice(0, 160));
  ok('mà nhận về chính sổ riêng của mình', vao.ledger?.key?.startsWith('u'), String(vao.ledger?.key));
  // Giấu chuyện bố mẹ xem được sổ là không tử tế — app phải nói ra.
  ok('và nói thẳng là bố mẹ xem được sổ này', /Bố mẹ xem được/.test(vao.ledger?.ghi_chu || ''), vao.ledger?.ghi_chu);
  ok('con biết ai đang giám hộ mình', (await GET('/account/guardians', be)).guardians?.length === 2,
    JSON.stringify((await GET('/account/guardians', be)).guardians));

  // ĐÂY LÀ ĐIỂM CỦA CẢ THIẾT KẾ: không có bộ lọc nào cả, con đơn giản là
  // không mở nổi file sổ của nhà.
  const doi = await POST('/account/switch', { key: khoaNha }, be);
  ok('con KHÔNG mở được sổ chung của nhà', doi.status !== 200, JSON.stringify(doi).slice(0, 120));
  const khai = await GET('/transactions?limit=50', be, khoaNha);
  ok('khai thẳng khoá sổ nhà cũng bị chặn', khai.status === 403, String(khai.status));

  const cuaBe = await GET('/transactions?limit=50', be);
  ok('con không thấy khoản nào của nhà', !cuaBe.transactions.some((t) => t.merchant === 'chợ' || t.merchant === 'xăng'),
    JSON.stringify(cuaBe.transactions.map((t) => t.merchant)));
  const dsBe = await GET('/account/ledgers', be);
  ok('trong danh sách sổ của con không hề có sổ nhà', !dsBe.ledgers.some((l) => l.key === khoaNha), JSON.stringify(dsBe.ledgers));

  // Và trong sổ của CHÍNH MÌNH thì con toàn quyền: đây là điểm khác hẳn bản
  // trước, nơi con là thành viên hạng hai của một cuốn sổ không phải của nó.
  ok('con toàn quyền trong sổ của chính mình', (await GET('/income-streams', be)).status === 200);
}

head('Bố mẹ mở được sổ của con, nhưng không xoá lịch sử của nó');
{
  const ds = await GET('/account/children', nam);
  ok('bố thấy con trong danh sách', ds.children?.length === 1 && ds.children[0].email === 'be@example.com', JSON.stringify(ds.children).slice(0, 160));
  ok('mẹ cũng thấy con — mời một lần, cả hai người lớn đều giám hộ',
    (await GET('/account/children', thu)).children?.length === 1);
  const khoaCon = ds.children[0].key;

  const xem = await GET('/transactions?limit=50', nam, khoaCon);
  ok('bố mở được sổ của con', xem.status === 200, JSON.stringify(xem).slice(0, 120));
  const h = await GET('/health', nam, khoaCon);
  ok('và vai trong đó là giám hộ, không phải chủ', h.ledger?.role === 'guardian', JSON.stringify(h.ledger));

  // Sổ đó vẫn là chỗ riêng của đứa trẻ.
  const tk = await POST('/accounts', { name: 'Ví của Bé', type: 'cash', balance: 0 }, nam, khoaCon);
  ok('bố mở được ví cho con (ghi thì được)', tk.status === 200, JSON.stringify(tk).slice(0, 120));
  const xoa = await DEL(`/accounts/${tk.account.id}`, nam, khoaCon);
  ok('nhưng KHÔNG xoá được gì trong sổ của con', xoa.status === 403, JSON.stringify(xoa).slice(0, 120));
  const pin = await POST('/auth/setup', { pin: '1234' }, nam, khoaCon);
  ok('và không đụng được vào khoá riêng của con', pin.status === 403, JSON.stringify(pin).slice(0, 120));

  const nguoiLa = await GET('/transactions?limit=50', laNguoiDung, khoaCon);
  ok('người ngoài không mở được sổ của đứa trẻ', nguoiLa.status === 403, String(nguoiLa.status));
}

head('Tiền tiêu vặt: một lần cấp, hai cuốn sổ đều đúng');
{
  const con = (await GET('/account/children', nam)).children[0];
  const truocNha = (await GET('/transactions?limit=100', nam, khoaNha)).transactions.length;

  const cap = await POST('/account/children/pay', { child_id: con.id, amount: 300_000, note: 'tuần này' }, nam);
  ok('cấp được tiền tiêu vặt', cap.status === 200 && cap.amount === 300_000, JSON.stringify(cap).slice(0, 160));

  const soCon = await GET('/transactions?limit=50', be);
  const thu1 = soCon.transactions.find((t) => t.merchant === 'Tiền tiêu vặt');
  ok('sổ CON có một khoản THU', thu1 && thu1.type === 'income' && thu1.amount === 300_000, JSON.stringify(thu1));

  const soNha = await GET('/transactions?limit=100', nam, khoaNha);
  const chi = soNha.transactions.find((t) => /Tiền tiêu vặt cho/.test(t.merchant || ''));
  ok('sổ NHÀ có một khoản CHI tương ứng', chi && chi.type === 'expense' && chi.amount === 300_000, JSON.stringify(chi));
  ok('sổ nhà đúng thêm một dòng, không nhân đôi', soNha.transactions.length === truocNha + 1, `${truocNha} -> ${soNha.transactions.length}`);

  const th = await GET('/account/children', nam);
  ok('bố mẹ thấy con đã nhận bao nhiêu tháng này', th.children[0].thang_nay?.nhan === 300_000, JSON.stringify(th.children[0].thang_nay));

  // Người ngoài không cấp tiền cho con nhà khác được.
  const la = await POST('/account/children/pay', { child_id: con.id, amount: 1000 }, laNguoiDung);
  ok('người ngoài không cấp tiền cho con nhà người ta', la.status === 403, JSON.stringify(la).slice(0, 120));

  // Lịch định kỳ.
  const lich = await POST('/account/children/allowance', { child_id: con.id, amount: 500_000, day_of_month: 1 }, nam);
  ok('đặt được lịch cấp hằng tháng', lich.status === 200 && lich.allowance?.amount === 500_000, JSON.stringify(lich).slice(0, 160));
  const lai = await POST('/account/children/allowance', { child_id: con.id, amount: 600_000, day_of_month: 5 }, nam);
  ok('đặt lại thì SỬA lịch cũ chứ không đẻ thêm lịch thứ hai',
    lai.allowance?.amount === 600_000 && (await GET('/account/children', nam)).children[0].tieu_vat?.day_of_month === 5);
}

head('Tiêu vặt tới hạn: cấp đúng một lần mỗi tháng');
{
  const { toiHan, ngayCapTrongThang } = await import('../src/services/allowance.js');
  ok('ngày 31 ở tháng 2 rơi vào ngày cuối tháng', ngayCapTrongThang('2026-02-15', 31) === '2026-02-28', ngayCapTrongThang('2026-02-15', 31));
  ok('chưa tới ngày thì chưa cấp', toiHan({ active: 1, day_of_month: 20, last_paid_on: null }, '2026-03-10') === false);
  ok('tới ngày mà chưa cấp thì cấp', toiHan({ active: 1, day_of_month: 20, last_paid_on: null }, '2026-03-20') === true);
  // Không có phần này thì mỗi lần khởi động lại máy chủ là con được cấp thêm
  // một lần nữa — và đó là tiền thật.
  ok('tháng này cấp rồi thì thôi', toiHan({ active: 1, day_of_month: 20, last_paid_on: '2026-03-20' }, '2026-03-25') === false);
  ok('sang tháng sau thì cấp tiếp', toiHan({ active: 1, day_of_month: 20, last_paid_on: '2026-03-20' }, '2026-04-20') === true);
  ok('lịch đã tắt thì không cấp', toiHan({ active: 0, day_of_month: 1, last_paid_on: null }, '2026-04-20') === false);
}

head('Hạn mức riêng cho từng người trong sổ chung');
{
  const idNam = (await GET('/account/me', nam)).user.id;
  const idThu = (await GET('/account/me', thu)).user.id;
  const dm = (await GET('/categories', nam, khoaNha)).categories.find((c) => c.name && !c.parent_id) || { id: null };

  const b1 = await POST('/budgets', { category_id: dm.id, amount: 2_000_000, user_id: idNam }, nam, khoaNha);
  const b2 = await POST('/budgets', { category_id: dm.id, amount: 3_000_000, user_id: idThu }, nam, khoaNha);
  ok('đặt được hạn mức riêng cho hai người', b1.status === 200 && b2.status === 200, JSON.stringify(b2).slice(0, 120));
  // Bản đầu nhận diện hạn mức "đã có" chỉ theo danh mục + tháng, nên hạn mức
  // của vợ ĐÈ lên hạn mức của chồng — cùng danh mục, cùng tháng là khớp ngay.
  ok('hạn mức của người sau KHÔNG đè lên người trước',
    b1.budget?.id !== b2.budget?.id, `${b1.budget?.id} vs ${b2.budget?.id}`);

  const st = await GET('/budgets', nam, khoaNha);
  const rieng = (st.items || []).filter((x) => x.user_id != null);
  ok('cả hai hạn mức riêng đều hiện ra', rieng.length === 2, JSON.stringify((st.items || []).map((i) => [i.id, i.user_id, i.limit])));
  ok('mỗi hạn mức giữ đúng số của chủ nó',
    rieng.find((x) => Number(x.user_id) === idNam)?.limit === 2_000_000
    && rieng.find((x) => Number(x.user_id) === idThu)?.limit === 3_000_000,
    JSON.stringify(rieng.map((x) => [x.user_id, x.limit])));
  ok('app biết hạn mức nào là của chính người đang xem',
    rieng.find((x) => Number(x.user_id) === idNam)?.cua_toi === true
    && rieng.find((x) => Number(x.user_id) === idThu)?.cua_toi === false);

  // Chi tiêu tính theo người ghi: khoản của chồng không được trừ vào hạn mức
  // của vợ. Không có phần này thì hạn mức riêng chỉ là cái nhãn.
  const tkNha = (await GET('/accounts', nam, khoaNha)).accounts[0];
  await POST('/transactions', { amount: 400_000, type: 'expense', category_id: dm.id, account_id: tkNha.id, date: `${new Date().toISOString().slice(0, 7)}-10` }, nam, khoaNha);
  const st2 = await GET('/budgets', nam, khoaNha);
  const cuaNam2 = (st2.items || []).find((x) => Number(x.user_id) === idNam);
  const cuaThu2 = (st2.items || []).find((x) => Number(x.user_id) === idThu);
  ok('khoản chồng vừa ghi trừ vào hạn mức của chồng', cuaNam2?.spent === 400_000, String(cuaNam2?.spent));
  ok('và KHÔNG trừ vào hạn mức của vợ', cuaThu2?.spent === 0, String(cuaThu2?.spent));
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
