/**
 * Bản chạy ngay trên điện thoại, kiểm trong Node: gói boot.js bằng esbuild với
 * đúng bản đồ thay thế của vite.config (SQLite WebAssembly, shim fs/crypto/
 * express), rồi gọi router trong tiến trình như giao diện sẽ gọi — không
 * node:sqlite, không HTTP, không cổng.
 */
import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveNative } from '../native.aliases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.build-embedded.mjs');
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

await esbuild.build({
  entryPoints: [path.join(here, '../src/native/boot.js')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
  external: ['sql.js', 'scrypt-js'],
  plugins: [{
    name: 'finmate-native',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const r = resolveNative(args.path, args.importer);
        return r ? { path: r } : null;
      });
    },
  }],
});

process.env.FINMATE_FX_OFFLINE = '1';
const { bootEmbedded } = await import(`file://${out}`);
const { memoryStorage } = await import('../src/native/storage.js');

const store = memoryStorage();
const t0 = Date.now();
const app = await bootEmbedded({ storage: store, env: { FINMATE_FX_OFFLINE: '1' } });
const call = (m, u, body, headers) => app.dispatch(m, u, { body, headers });
console.log(`khởi động ${Date.now() - t0}ms`);

head('Engine WebAssembly thay node:sqlite');
{
  const h = await call('GET', '/health');
  ok('health trả lời qua router trong tiến trình', h.status === 200 && h.body.ok === true && h.body.offline_ok === true, JSON.stringify(h.body).slice(0, 120));
  const p = await call('GET', '/profile');
  ok('schema dựng xong, có hồ sơ mặc định', p.body.profile?.id === 1);
  const cats = await call('GET', '/categories');
  ok('bootstrap tạo danh mục và quỹ', (cats.body.categories || []).length > 5);
  ok('tự động hoá chạy lúc khởi động', app.boot && typeof app.boot.insights === 'number');
}

head('Ghi sổ, chat bộ luật, trang chủ');
{
  const acc = await call('POST', '/accounts', { name: 'Ví', type: 'cash', balance: 1_000_000, currency: 'VND' });
  ok('tạo tài khoản', acc.status === 200 && acc.body.account?.id > 0, JSON.stringify(acc.body).slice(0, 120));
  await call('PATCH', '/profile', { onboarded: 1, onboarding_step: 'done', name: 'Mai' });
  const c = await call('POST', '/chat', { message: 'trưa nay ăn 65k' });
  ok('bộ luật ghi giao dịch từ câu tự nhiên', c.status === 200 && /65/.test(c.body.reply), JSON.stringify(c.body).slice(0, 160));
  const tx = await call('GET', '/transactions?limit=5');
  ok('giao dịch nằm trong DB WebAssembly', tx.body.transactions?.some((t) => t.amount === 65_000));
  const d = await call('GET', '/dashboard');
  ok('trang chủ tính được số liệu', d.status === 200 && typeof d.body.net_worth?.net === 'number' && d.body.totals?.expense === 65_000, JSON.stringify(d.body.totals));
  const events = [];
  const s = await app.dispatch('POST', '/chat/stream', { body: { message: 'cà phê 30k' }, onEvent: (ev, data) => events.push(ev) });
  ok('luồng SSE qua res.write vẫn phát sự kiện', events.includes('start') && events.includes('done'), events.join(','));
  const nf = await call('GET', '/khong-co');
  ok('đường không có -> 404', nf.status === 404);
}

head('Nhật ký AI (trigger SQLite) và đề xuất chạy trên WebAssembly');
{
  const { runAutopilot } = app.api;
  void runAutopilot;
  const props = await call('GET', '/ai/proposals');
  ok('đọc được đề xuất', props.status === 200 && Array.isArray(props.body.proposals));
  const undo = await call('POST', '/ai/undo', { n: 1 });
  ok('hoàn tác qua nhật ký trigger hoạt động (hoặc báo không có gì)', undo.status === 200, JSON.stringify(undo.body).slice(0, 100));
}

head('PIN qua scrypt thuần JS, khoá như máy chủ');
{
  const s = await call('POST', '/auth/setup', { pin: '2468' });
  ok('đặt PIN', s.status === 200 && typeof s.body.key === 'string', JSON.stringify(s.body).slice(0, 100));
  const locked = await call('GET', '/profile');
  ok('không có khoá phiên thì bị chặn', locked.status === 401 && locked.body.locked === true, JSON.stringify(locked.body));
  const bad = await call('POST', '/auth/login', { pin: '0000' });
  ok('PIN sai bị từ chối', bad.status !== 200 || bad.body.ok === false);
  const good = await call('POST', '/auth/login', { pin: '2468' });
  ok('PIN đúng mở khoá', good.status === 200 && good.body.key);
  const withKey = await call('GET', '/profile', undefined, { 'x-finmate-key': good.body.key });
  ok('có khoá phiên thì vào được', withKey.status === 200);
  await call('POST', '/auth/disable', { pin: '2468' }, { 'x-finmate-key': good.body.key });
  ok('tắt PIN', (await call('GET', '/profile')).status === 200);
}

head('Sao lưu vào hệ tệp ảo, xuất/nhập DB');
{
  const b = await call('POST', '/backup/run');
  ok('VACUUM INTO -> file sao lưu ảo', b.status === 200 && b.body.backup?.size > 0, JSON.stringify(b.body).slice(0, 120));
  const l = await call('GET', '/backup/list');
  ok('liệt kê được bản sao lưu', l.body.backups?.length === 1 && l.body.backups[0].file.endsWith('.db'));
  const dl = await call('GET', '/backup/download');
  ok('tải bản sao lưu ra byte', dl.file?.bytes?.length > 0 && dl.file.name.endsWith('.db'));
  const ex = await call('GET', '/export');
  ok('xuất JSON toàn bộ', ex.body.data?.transactions?.length >= 2);

  // Bền vững: chờ gộp ghi rồi khởi động lại từ byte đã lưu.
  await app.db.flush();
  const saved = store._peek().dbBytes;
  ok('DB được chép xuống kho sau khi ghi', saved && saved.length > 0);
  const bytes = app.exportDb();
  ok('export ra byte SQLite hợp lệ', bytes.length > 0 && String.fromCharCode(...bytes.slice(0, 6)) === 'SQLite');
}

head('Xoá sạch có chốt (VACUUM INTO bản cứu hộ)');
{
  const bad = await call('POST', '/admin/wipe', { confirm: 'xoa' });
  ok('chốt XOA HET vẫn hoạt động', bad.status === 400);
  const good = await call('POST', '/admin/wipe', { confirm: 'XOA HET', keep_profile: true });
  ok('xoá sạch xong có bản cứu hộ trong hệ tệp ảo', good.status === 200 && app.files().some((f) => /truoc-khi-xoa-het/.test(f.path)), JSON.stringify(good.body).slice(0, 120));
  ok('sổ trống', (await call('GET', '/transactions?limit=5')).body.transactions.length === 0);
}

fs.rmSync(out, { force: true });
console.log(`\n${fail ? '✗' : '✓'} embedded: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
