/**
 * Không có AI, không có mạng: mọi việc vẫn làm tay được.
 *
 *  1. Các đường API mà giao diện dùng để làm những việc trước đây chỉ AI làm:
 *     trả nợ, cân bằng quỹ, gộp trùng, xoá sạch (có chốt "XOA HET").
 *  2. Cầu dao mất mạng: sau một lần lỗi mạng, model không được gọi nữa trong
 *     một phút — bộ luật trả lời tức thì; cờ offline từ giao diện thì bỏ qua
 *     model ngay từ đầu.
 */
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

const DB = fileURLToPath(new URL('./.tmp-manual.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

process.env.FINMATE_DB = DB;
process.env.FINMATE_FX_OFFLINE = '1';
// Model "có" nhưng máy chủ không tồn tại: giả lập mất mạng.
process.env.FINMATE_LLM_KEY = 'test-key';
process.env.FINMATE_LLM_URL = 'http://127.0.0.1:9/v1/chat/completions';
process.env.FINMATE_LLM_MODEL = 'mock';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { all, get, run, update, insert } = await import('../src/db.js');
const { router } = await import('../src/routes/api.js');
const { chat } = await import('../src/services/chat/index.js');
const { llmStatus, llmPaused, resumeLlm } = await import('../src/services/chat/llm.js');
update('profile', 1, { onboarded: 1, onboarding_step: 'done', name: 'Thư' });

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', router);
const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/api`;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

head('Trả nợ bằng tay');
{
  const acc = insert('accounts', { name: 'VCB', type: 'bank', balance: 20_000_000, currency: 'VND' });
  const id = insert('debts', { name: 'Vay bạn', balance: 5_000_000, principal: 5_000_000, interest_rate: 0, monthly_payment: 1_000_000, currency: 'VND', status: 'active' });
  const r = await post(`/debts/${id}/pay`, { amount: 2_000_000, account_id: acc });
  ok('trừ dư nợ và ghi khoản chi', r.ok && r.debt.balance === 3_000_000 && r.transaction?.amount === 2_000_000, JSON.stringify(r).slice(0, 200));
  ok('số dư tài khoản giảm theo', get('SELECT balance FROM accounts WHERE id = ?', [acc]).balance === 18_000_000);
  const r2 = await post(`/debts/${id}/pay`, { amount: 3_000_000 });
  ok('trả hết thì đánh dấu đã trả xong', r2.paid_off === true && r2.debt.status === 'paid');
  ok('số âm bị chặn', (await post(`/debts/${id}/pay`, { amount: -5 })).status === 400);
}

head('Cân bằng quỹ bằng tay');
{
  run('UPDATE funds SET percent = percent + 10 WHERE id = (SELECT id FROM funds ORDER BY id LIMIT 1)');
  const r = await post('/funds/rebalance', {});
  const tong = all('SELECT percent FROM funds WHERE archived = 0').reduce((s, f) => s + f.percent, 0);
  ok('tổng % về 100', r.ok && Math.abs(tong - 100) < 0.01, `tổng=${tong}`);
  ok('làm tay thì KHÔNG vào nhật ký AI', get("SELECT COUNT(*) n FROM ai_actions WHERE tool = 'can_bang_phan_bo'").n === 0);
}

head('Gộp trùng bằng tay');
{
  insert('goals', { name: 'Mua xe', target_amount: 1, current_amount: 0, currency: 'VND', status: 'active' });
  insert('goals', { name: 'mua xe', target_amount: 1, current_amount: 0, currency: 'VND', status: 'active' });
  const pre = await post('/admin/dedupe', { loai: 'muc_tieu', dry_run: true });
  ok('xem trước nói rõ sẽ xoá gì', pre.ok && pre.tong_xoa === 1 && pre.thu_truoc === true, JSON.stringify(pre).slice(0, 160));
  ok('xem trước chưa xoá', all("SELECT id FROM goals WHERE lower(name) = 'mua xe'").length === 2);
  const real = await post('/admin/dedupe', { loai: 'muc_tieu', dry_run: false });
  ok('gộp thật', real.ok && all("SELECT id FROM goals WHERE lower(name) = 'mua xe'").length === 1);
  ok('loại lạ bị chặn', (await post('/admin/dedupe', { loai: 'xyz' })).status === 400);
}

head('Xoá sạch có chốt chặn');
{
  const bad = await post('/admin/wipe', { confirm: 'ok xoa di' });
  ok('không gõ đúng XOA HET thì từ chối', bad.status === 400 && bad.can_xac_nhan === true, JSON.stringify(bad).slice(0, 160));
  ok('dữ liệu còn nguyên', all('SELECT id FROM accounts').length >= 1);
  const good = await post('/admin/wipe', { confirm: 'XOA HET', keep_profile: true });
  ok('gõ đúng thì xoá và có bản sao lưu', good.ok && typeof good.ban_sao === 'string', JSON.stringify(good).slice(0, 200));
  ok('sổ trống (chỉ còn tài khoản/quỹ mặc định dựng lại)', !get("SELECT id FROM accounts WHERE name = 'VCB'") && all('SELECT id FROM transactions').length === 0 && all('SELECT id FROM debts').length === 0);
  ok('giữ lại hồ sơ', get('SELECT name FROM profile WHERE id = 1').name === 'Thư');
}

head('Cầu dao mất mạng');
{
  update('profile', 1, { onboarded: 1, onboarding_step: 'done' });
  const acc = insert('accounts', { name: 'Ví', type: 'cash', balance: 1_000_000, currency: 'VND' });
  void acc;
  const t0 = Date.now();
  const r1 = await chat('trưa nay ăn 40k');
  const dt1 = Date.now() - t0;
  ok('lượt đầu: model không tới được -> bộ luật vẫn ghi sổ', /40/.test(r1.reply) && all('SELECT id FROM transactions').length === 1, r1.reply);
  ok('kèm cờ fallback', r1.fallback?.nguon === 'rules', JSON.stringify(r1.fallback));
  ok('sau lỗi mạng, cầu dao ngắt', llmPaused() === true && Boolean(llmStatus().tam_dung_den));
  const t1 = Date.now();
  const r2 = await chat('cà phê 30k');
  const dt2 = Date.now() - t1;
  ok('lượt sau trả lời tức thì, không chờ thử lại', dt2 < Math.max(300, dt1 / 3), `lượt 1: ${dt1}ms, lượt 2: ${dt2}ms`);
  ok('cờ fallback nói rõ là ngoại tuyến', r2.fallback?.offline === true, JSON.stringify(r2.fallback));
  const before = llmStatus().lan_goi;
  await chat('hôm nay tiêu bao nhiêu');
  ok('trong lúc ngắt không gọi model thêm lần nào', llmStatus().lan_goi === before, `${before} -> ${llmStatus().lan_goi}`);
  resumeLlm();
  ok('mở lại được cầu dao', llmPaused() === false);
}

head('Cờ offline từ giao diện');
{
  resumeLlm();
  const before = llmStatus().lan_goi;
  const r = await post('/chat', { message: 'trà sữa 55k', offline: true });
  ok('offline=true -> không gọi model, bộ luật ghi ngay', r.ok && /55/.test(r.reply) && llmStatus().lan_goi === before, JSON.stringify(r).slice(0, 160));
  ok('cờ fallback offline cho giao diện', r.fallback?.offline === true && r.fallback.ly_do === 'offline');
  const h = await fetch(base + '/health').then((x) => x.json());
  ok('health nói app dùng được khi mất mạng', h.offline_ok === true);
}

await new Promise((r) => srv.close(r));
console.log(`\n${fail ? '✗' : '✓'} smoke-manual: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
