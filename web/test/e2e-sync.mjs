/**
 * Sổ đi từ máy này lên tài khoản, rồi quay về — trên trình duyệt thật.
 *
 * Đây là bộ kiểm duy nhất chứng minh được lời hứa "dùng offline trên điện
 * thoại, mở laptop vẫn thấy đúng sổ đó": nó chạy BẢN NHÚNG (SQLite chạy trong
 * trang, không có máy chủ) rồi bắt nó nói chuyện với một MÁY CHỦ THẬT ở cổng
 * khác — đúng cảnh người dùng gặp, kể cả chuyện hai bên khác tên miền.
 *
 * Chạy: E2E_BASE=http://127.0.0.1:4100 E2E_API=http://127.0.0.1:4002 node test/e2e-sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4100';   // bản nhúng (chạy trên máy)
const API = process.env.E2E_API || 'http://127.0.0.1:4002';     // máy chủ có tài khoản
const MA_MOI = process.env.E2E_SIGNUP_CODE || '';
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'finmate-e2e-sync');
fs.mkdirSync(SHOTS, { recursive: true });

const skip = (why) => {
  if (process.env.E2E_REQUIRED === '1') { console.error('✗ ' + why); process.exit(1); }
  console.log('⚠ ' + why + ' — bỏ qua hành trình đồng bộ');
  process.exit(0);
};
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { skip('chưa cài playwright-core'); }

const findChrome = () => {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const rels = ['chrome-linux/headless_shell', 'chrome-linux/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe'];
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')].filter((r) => r && fs.existsSync(r));
  for (const root of roots) {
    for (const d of fs.readdirSync(root)) {
      for (const rel of rels) { const f = path.join(root, d, rel); if (fs.existsSync(f)) return f; }
      const f = path.join(root, d);
      if (fs.statSync(f).isFile()) return f;
    }
  }
  for (const f of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (fs.existsSync(f)) return f;
  }
  return null;
};
const exe = findChrome();
if (!exe) skip('không tìm thấy Chromium (đặt E2E_CHROME)');

let pass = 0; const fails = []; const pageErrors = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const step = (s) => console.log('\n▸ ' + s);

// ── tài khoản trên máy chủ để máy này gửi sổ lên ───────────────────────────
const EMAIL = 'nam@example.com';
const MK = 'mat-khau-cua-nam';
const goiApi = async (method, p, body, token) => {
  const r = await fetch(API + '/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-finmate-key': token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const dangKy = await goiApi('POST', '/account/register', { email: EMAIL, password: MK, name: 'Nam', ...(MA_MOI ? { code: MA_MOI } : {}) });
if (!dangKy.token) skip(`không tạo được tài khoản trên máy chủ thử: ${JSON.stringify(dangKy).slice(0, 120)}`);
let token = dangKy.token;

const b = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'vi-VN' });
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|manifest|Failed to load resource/i.test(t)) return;
  pageErrors.push('console: ' + t.slice(0, 200));
});
const text = async (sel = '.main') => (await page.$eval(sel, (e) => e.innerText).catch(() => ''));
const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(900); };

console.log('═══ FinMate E2E · đồng bộ bản chạy trên máy ↔ tài khoản ═══');
console.log(`    bản nhúng ${BASE}  ·  máy chủ ${API}`);

// ── 1. Ghi dữ liệu trên máy, chưa nối mạng gì cả ───────────────────────────
step('1. Bản chạy trên máy: ghi sổ như bình thường');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero, .chat-in textarea', { timeout: 60000 });
await page.waitForTimeout(2500);
await go('accounts');
await page.click('text=+ Thêm tài khoản');
await page.waitForSelector('.modal', { timeout: 8000 });
const f = await page.$$('.modal input, .modal select, .modal textarea');
await f[0].fill('Ví của Nam');
await f[1].selectOption('cash');
await f[4].fill('3500000');
await page.click('.modal >> text=Lưu');
await page.waitForTimeout(1200);
ok('ghi được tài khoản trên máy (không cần máy chủ)', /Ví của Nam/.test(await text()));

// ── 2. Nối vào tài khoản ───────────────────────────────────────────────────
step('2. Nối máy này vào tài khoản trên máy chủ');
await go('settings');
const theDongBo = await page.$('text=Đồng bộ với tài khoản trên máy chủ');
ok('bản chạy trên máy có mục đồng bộ trong Cài đặt', Boolean(theDongBo));
await page.fill('input[inputmode=url]', API);
await page.fill('input[type=email]', EMAIL);
await page.fill('.card:has-text("Đồng bộ với tài khoản") input[type=password]', MK);
await page.click('.card:has-text("Đồng bộ với tài khoản") button.primary');
await page.waitForTimeout(2500);
const sauNoi = await text();
ok('nối được, hiện đúng tài khoản đang dùng', new RegExp(EMAIL).test(sauNoi), sauNoi.slice(0, 120));
await page.screenshot({ path: SHOTS + '/01-da-noi.png' });

// ── 3. Gửi sổ lên ──────────────────────────────────────────────────────────
step('3. Gửi nguyên cuốn sổ lên tài khoản');
await page.click('text=Đồng bộ ngay');
await page.waitForTimeout(4000);
ok('báo đã gửi lên', /Đã gửi sổ lên máy chủ/.test(await text()), (await text()).slice(0, 160));

const tk = await goiApi('GET', '/accounts', null, token);
ok('MÁY CHỦ giờ có đúng dữ liệu ghi trên máy', tk.accounts?.some((a) => a.name === 'Ví của Nam'), JSON.stringify(tk.accounts?.map((a) => a.name)).slice(0, 120));

// ── 4. Sửa ở "máy khác" (qua API của máy chủ) rồi mở lại app trên máy ──────
step('4. Sửa ở máy khác, mở lại app trên máy này');
const them = await goiApi('POST', '/transactions', { type: 'expense', amount: 88000, note: 'ăn trưa ghi từ laptop' }, token);
ok('ghi được một giao dịch phía máy chủ', them.transaction?.id > 0, JSON.stringify(them).slice(0, 100));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.botnav', { timeout: 60000 });
await page.waitForTimeout(4000);
await go('transactions');
ok('mở lại app trên máy là thấy giao dịch ghi từ máy khác', /ăn trưa ghi từ laptop/.test(await text()), (await text()).slice(0, 160));
ok('và dữ liệu cũ trên máy vẫn còn', /Ví của Nam/.test(await (go('accounts').then(() => text()))));
await page.screenshot({ path: SHOTS + '/02-da-keo-ve.png' });

// ── 5. Hai bên cùng đổi: app phải DỪNG và hỏi ─────────────────────────────
step('5. Hai bên cùng đổi thì dừng lại, không tự chọn hộ');
// máy chủ đổi…
await goiApi('POST', '/transactions', { type: 'expense', amount: 15000, note: 'gửi xe ghi từ laptop' }, token);
// …và máy này cũng đổi, ngay trong phiên đang mở (nên không kịp kéo về)
await go('accounts');
await page.click('text=+ Thêm tài khoản');
await page.waitForSelector('.modal', { timeout: 8000 });
const f2 = await page.$$('.modal input, .modal select, .modal textarea');
await f2[0].fill('Momo của Nam');
await f2[1].selectOption('ewallet');
await f2[4].fill('500000');
await page.click('.modal >> text=Lưu');
await page.waitForTimeout(1500);

await go('settings');
await page.click('text=Đồng bộ ngay');
await page.waitForTimeout(3000);
const manLech = await text();
ok('app nói thẳng là hai bên cùng đổi', /Hai bên cùng đổi/.test(manLech), manLech.slice(0, 200));
ok('đưa đúng hai lựa chọn, không tự trộn', /Lấy bản máy chủ về/.test(manLech) && /Đẩy bản máy này lên/.test(manLech));
ok('không âm thầm gửi đè lên máy chủ',
  (await goiApi('GET', '/accounts', null, token)).accounts?.every((a) => a.name !== 'Momo của Nam'));
await page.screenshot({ path: SHOTS + '/03-lech.png' });

step('6. Người dùng chọn giữ bản trên máy này');
await page.click('text=Đẩy bản máy này lên');
await page.waitForTimeout(4000);
const sauEp = await goiApi('GET', '/accounts', null, token);
ok('máy chủ nhận bản của máy này', sauEp.accounts?.some((a) => a.name === 'Momo của Nam'), JSON.stringify(sauEp.accounts?.map((a) => a.name)).slice(0, 140));
const saoLuu = await goiApi('GET', '/backup/list', null, token);
ok('bản bị ghi đè trên máy chủ vẫn được sao lưu lại',
  (saoLuu.backups || []).some((b) => /truoc-khi-nhan-tu-may/.test(b.file)),
  JSON.stringify((saoLuu.backups || []).map((b) => b.file)).slice(0, 140));
ok('hết báo lệch', !/Hai bên cùng đổi/.test(await text()), (await text()).slice(0, 120));

ok('không có lỗi JavaScript nào trong suốt hành trình', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await b.close();
console.log('\n════════════════════════════════════════════════════════════');
console.log(fails.length ? `❌ đồng bộ: ${pass} đạt, ${fails.length} hỏng` : `🎉 đồng bộ: ${pass}/${pass} bước đạt`);
for (const x of fails) console.log('   • ' + x);
console.log('════════════════════════════════════════════════════════════');
process.exit(fails.length ? 1 : 0);
