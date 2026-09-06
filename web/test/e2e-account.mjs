/**
 * Hành trình tài khoản trên trình duyệt thật: đăng ký → dùng app → tải lại
 * trang vẫn còn đăng nhập → đăng xuất → đăng nhập lại thấy đúng dữ liệu cũ.
 *
 * Vì sao phải mở trình duyệt thật cho việc này: đây đúng là chỗ mà bộ kiểm ở
 * tầng API luôn xanh còn người dùng thì kẹt ngoài cửa — token cất ở đâu, tải
 * lại trang có mất không, màn đăng nhập có hiện đúng ô "mã mời" không. Toàn
 * những thứ chỉ tồn tại trong trình duyệt.
 *
 * Chạy: E2E_BASE=http://127.0.0.1:4300 node test/e2e-account.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4300';
const MA_MOI = process.env.E2E_SIGNUP_CODE || 'ma-moi-e2e';
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'finmate-e2e-account');
fs.mkdirSync(SHOTS, { recursive: true });

const skip = (why) => {
  if (process.env.E2E_REQUIRED === '1') { console.error('✗ ' + why); process.exit(1); }
  console.log('⚠ ' + why + ' — bỏ qua hành trình tài khoản');
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
const text = async (sel = 'body') => (await page.$eval(sel, (e) => e.innerText).catch(() => ''));

console.log('═══ FinMate E2E · tài khoản nhiều người dùng · ' + BASE + ' ═══');

// ── 1. Cửa vào là màn đăng nhập ────────────────────────────────────────────
step('1. Mở app: máy chủ nhiều người dùng thì phải hỏi tài khoản');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.lock-box', { timeout: 60000 });
const dau = await text('.lock-box');
ok('hiện màn đăng nhập, không vào thẳng dữ liệu ai', /Đăng nhập FinMate/.test(dau), dau.split('\n')[1]);
ok('không lộ dữ liệu tài chính khi chưa đăng nhập', !(await page.$('.botnav')));
await page.screenshot({ path: SHOTS + '/01-login.png' });

// ── 2. Tạo tài khoản bằng mã mời ───────────────────────────────────────────
step('2. Tạo tài khoản (máy chủ này đòi mã mời)');
await page.click('text=Chưa có tài khoản? Tạo mới');
await page.waitForTimeout(300);
ok('máy chủ đòi mã mời thì form phải có ô nhập mã', Boolean(await page.$('input[placeholder="Mã mời"]')));

const dien = async (ph, v) => { await page.fill(`input[placeholder^="${ph}"]`, v); };
await dien('Tên bạn', 'Lan');
await page.fill('input[type=email]', 'lan@example.com');
await page.fill('input[type=password]', 'mat-khau-cua-lan');
await page.fill('input[placeholder="Mã mời"]', 'ma-sai-be-bét');
await page.click('button.primary');
await page.waitForTimeout(1200);
ok('mã mời sai thì báo lỗi, không cho vào', Boolean(await page.$('.lock-err')), (await text('.lock-box')).slice(-80));

await page.fill('input[type=password]', 'mat-khau-cua-lan');
await page.fill('input[placeholder="Mã mời"]', MA_MOI);
await page.click('button.primary');
await page.waitForSelector('.botnav', { timeout: 30000 });
ok('mã đúng thì vào thẳng app, không bắt đăng nhập lại', true);
await page.screenshot({ path: SHOTS + '/02-vao-app.png' });

// ── 3. Ghi dữ liệu rồi tải lại trang ───────────────────────────────────────
step('3. Ghi một tài khoản ngân hàng rồi tải lại trang');
await page.evaluate(() => { location.hash = 'accounts'; });
await page.waitForTimeout(900);
await page.click('text=+ Thêm tài khoản');
await page.waitForSelector('.modal', { timeout: 8000 });
const f = await page.$$('.modal input, .modal select, .modal textarea');
await f[0].fill('VCB của Lan');
await f[1].selectOption('bank');
await f[4].fill('12000000');
await page.click('.modal >> text=Lưu');
await page.waitForTimeout(1200);
ok('tài khoản mới hiện ra', /VCB của Lan/.test(await text('.main')));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
ok('tải lại trang vẫn đăng nhập (không văng về màn đăng nhập)', !(await page.$('.lock-box')));
await page.evaluate(() => { location.hash = 'accounts'; });
await page.waitForTimeout(1200);
ok('dữ liệu còn nguyên sau khi tải lại', /VCB của Lan/.test(await text('.main')));

// ── 4. Đăng xuất ───────────────────────────────────────────────────────────
step('4. Đăng xuất');
await page.evaluate(() => { location.hash = 'more'; });
await page.waitForTimeout(900);
const nutRa = await page.$('text=Đăng xuất');
ok('có nút đăng xuất trong trang Thêm', Boolean(nutRa));
if (nutRa) {
  page.once('dialog', (d) => d.accept());
  await nutRa.click();
  await page.waitForSelector('.lock-box', { timeout: 30000 });
}
ok('đăng xuất xong quay về màn đăng nhập', Boolean(await page.$('.lock-box')));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.lock-box', { timeout: 30000 });
ok('tải lại sau khi đăng xuất vẫn ở ngoài cửa', Boolean(await page.$('.lock-box')));

// ── 5. Đăng nhập lại: sổ của mình còn nguyên ───────────────────────────────
step('5. Đăng nhập lại trên chính máy này');
await page.fill('input[type=email]', 'lan@example.com');
await page.fill('input[type=password]', 'sai-mat-khau');
await page.click('button.primary');
await page.waitForTimeout(1500);
ok('mật khẩu sai thì không vào được', Boolean(await page.$('.lock-err')));

await page.fill('input[type=password]', 'mat-khau-cua-lan');
await page.click('button.primary');
await page.waitForSelector('.botnav', { timeout: 30000 });
await page.evaluate(() => { location.hash = 'accounts'; });
await page.waitForTimeout(1200);
ok('đăng nhập lại thấy đúng sổ cũ của mình', /VCB của Lan/.test(await text('.main')));
await page.screenshot({ path: SHOTS + '/03-quay-lai.png' });

ok('không có lỗi JavaScript nào trong suốt hành trình', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await b.close();
console.log('\n════════════════════════════════════════════════════════════');
console.log(fails.length ? `❌ tài khoản: ${pass} đạt, ${fails.length} hỏng` : `🎉 tài khoản: ${pass}/${pass} bước đạt`);
for (const f of fails) console.log('   • ' + f);
console.log('════════════════════════════════════════════════════════════');
process.exit(fails.length ? 1 : 0);
