/**
 * FinMate — hành trình người dùng đầu-cuối trên trình duyệt thật (mobile 390x844).
 *
 * Chạy đúng những gì một người thật làm trong ngày đầu dùng app: mở app, tự
 * tay thêm tài khoản, ghi giao dịch, sửa lại, đặt mục tiêu và ngân sách, nhắn
 * cho cố vấn, phân bổ quỹ, rồi rút wifi xem có còn dùng được không.
 *
 * Cách chạy:
 *   node test/serve-static.mjs &                  # bản máy chủ (dist + /api)
 *   E2E_BASE=http://127.0.0.1:4200 node test/e2e.mjs
 *   E2E_EMBEDDED=1 E2E_BASE=http://127.0.0.1:4100 node test/e2e.mjs
 *
 * Biến môi trường: E2E_BASE, E2E_LABEL, E2E_EMBEDDED, E2E_SHOTS, E2E_CHROME.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4200';
const LABEL = process.env.E2E_LABEL || 'bản máy chủ';
/** Bản chạy thẳng trên máy: không có /api, engine nằm ngay trong trang. */
const EMBEDDED = process.env.E2E_EMBEDDED === '1';
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'finmate-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

/**
 * Thiếu trình duyệt thì bỏ qua chứ không làm hỏng cả mẻ test — trừ khi đặt
 * E2E_REQUIRED=1 (CI dùng cờ này, vì một bộ test âm thầm bỏ qua trên CI còn
 * tệ hơn là không có nó).
 */
const skip = (why) => {
  if (process.env.E2E_REQUIRED === '1') { console.error('✗ ' + why); process.exit(1); }
  console.log('⚠ ' + why + ' — bỏ qua hành trình đầu-cuối');
  process.exit(0);
};

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { skip('chưa cài playwright-core'); }

/** Tìm Chromium: biến môi trường -> kho của Playwright -> trình duyệt hệ thống. */
const findChrome = () => {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const rels = [
    'chrome-linux/headless_shell', 'chrome-linux/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-win/chrome.exe',
  ];
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),          // Linux
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),  // Windows
  ].filter((r) => r && fs.existsSync(r));
  for (const root of roots) {
    for (const d of fs.readdirSync(root)) {
      for (const rel of rels) {
        const f = path.join(root, d, rel);
        if (fs.existsSync(f)) return f;
      }
      const f = path.join(root, d);
      if (fs.statSync(f).isFile()) return f;
    }
  }
  for (const f of ['/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (fs.existsSync(f)) return f;
  }
  return null;
};
const exe = findChrome();
if (!exe) skip('không tìm thấy Chromium (đặt E2E_CHROME hoặc chạy: npx playwright install chromium)');
let pass = 0; const fails = []; const pageErrors = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};
const step = (s) => console.log('\n▸ ' + s);

let expectOffline = false; // lúc cố ý ngắt mạng thì fetch hỏng là đúng
// Site thật nằm ngoài mạng nội bộ: nếu môi trường bắt đi qua proxy thì
// Chromium cũng phải đi qua, không thì mọi request bị reset.
const proxyUrl = process.env.E2E_PROXY || process.env.HTTPS_PROXY || '';
const useProxy = proxyUrl && /^https?:\/\//.test(BASE) && !/127\.0\.0\.1|localhost/.test(BASE);
const b = await chromium.launch({
  executablePath: exe,
  headless: true,
  ...(useProxy ? { proxy: { server: proxyUrl } } : {}),
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'vi-VN' });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  const t = String(e.message);
  if (expectOffline && /Failed to fetch|NetworkError|ERR_INTERNET|net::/i.test(t)) return;
  pageErrors.push('pageerror: ' + t);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|manifest|Failed to load resource/i.test(t)) return;
  if (expectOffline && /Failed to fetch|NetworkError|ERR_INTERNET|net::/i.test(t)) return;
  pageErrors.push('console: ' + t.slice(0, 200));
});

const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(900); };
const text = async (sel = '.main') => (await page.$eval(sel, (e) => e.innerText).catch(() => ''));
const modal = () => page.waitForSelector('.modal', { timeout: 8000 });
const fields = () => page.$$('.modal input, .modal select, .modal textarea');
const save = async () => { await page.click('.modal >> text=Lưu'); await page.waitForTimeout(1200); };

console.log('═══ FinMate E2E · ' + LABEL + ' · ' + BASE + ' ═══');

// ── 1. Khởi động ───────────────────────────────────────────────────────────
step('1. Mở app lần đầu');
const t0 = Date.now();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero, .chat-in textarea', { timeout: 60000 });
await page.waitForTimeout(EMBEDDED ? 2500 : 1500);
ok('app khởi động và vẽ được màn hình chính', true, (Date.now() - t0) + 'ms');
ok('vào thẳng Trang chủ', (await page.evaluate(() => location.hash)).includes('dashboard'));
const home0 = await text();
ok('không có ô NaN/undefined trên trang chủ', !/NaN|undefined|\[object/.test(home0));
ok('có thanh điều hướng dưới đáy', (await page.$$('.botnav button, .botnav a')).length >= 4);
await page.screenshot({ path: SHOTS + '/01-home-empty.png' });

// ── 2. Tự tay thêm tài khoản ───────────────────────────────────────────────
step('2. Tự tay thêm tài khoản (không cần AI)');
await go('accounts');
await page.click('text=+ Thêm tài khoản');
await modal();
let f = await fields();
await f[0].fill('VCB Thanh toán');
await f[1].selectOption('bank');
await f[2].fill('Vietcombank');
await f[4].fill('50000000');
await save();
const acc = await text();
ok('tài khoản mới hiện trong danh sách', /VCB Thanh toán/.test(acc));
ok('số dư ban đầu đúng 50 triệu', /50\.000\.000/.test(acc), (acc.match(/50\.000\.000\S*/) || [''])[0]);

// ── 3. Tự tay ghi giao dịch ────────────────────────────────────────────────
step('3. Tự tay ghi một khoản chi qua nút ＋');
await go('transactions');
await page.click('.fab');
await modal();
f = await fields();
await f[1].fill('65000');
const accOpts = await f[4].$$eval('option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
const vcb = accOpts.find((c) => /VCB/.test(c.t)) || accOpts.find((c) => c.v);
await f[4].selectOption(vcb.v);
const catOpts = await f[5].$$eval('option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
const anAn = catOpts.find((c) => /Ăn uống/i.test(c.t)) || catOpts.find((c) => c.v);
await f[5].selectOption(anAn.v);
await f[6].fill('Cơm tấm Ba Ghiền');
await save();
let tx = await text();
ok('giao dịch tự ghi hiện trong sổ', /Cơm tấm Ba Ghiền/.test(tx));
ok('số tiền hiển thị đúng 65.000', /65\.000/.test(tx));
await page.screenshot({ path: SHOTS + '/02-transactions.png' });

// ── 4. Sửa giao dịch bằng cách chạm ────────────────────────────────────────
step('4. Chạm vào giao dịch để sửa');
await page.click('text=Cơm tấm Ba Ghiền');
await modal();
f = await fields();
await f[1].fill('75000');
await save();
tx = await text();
ok('sửa số tiền thành công', /75\.000/.test(tx) && !/65\.000/.test(tx));

// ── 5. Số dư & trang chủ cập nhật theo ─────────────────────────────────────
step('5. Số dư tài khoản và trang chủ ăn khớp');
await go('accounts');
ok('số dư trừ đúng còn 49.925.000', /49\.925\.000/.test(await text()));
await go('dashboard');
const home1 = await text();
if (!EMBEDDED) {
  const nw = await page.evaluate(async () => (await (await fetch('/api/dashboard')).json()).net_worth.net);
  ok('tài sản ròng tính đúng 49.925.000', nw === 49925000, String(nw));
}
ok('trang chủ hiện tài sản ròng (dạng rút gọn)', /49,9 tr|49\.925\.000/.test(home1));
ok('trang chủ hiện chi tháng này 75.000', /75\.000/.test(home1));
ok('giao dịch gần đây có mặt trên trang chủ', /Cơm tấm/.test(home1));

// ── 6. Mục tiêu ────────────────────────────────────────────────────────────
step('6. Tự tay đặt mục tiêu');
await go('goals');
await page.click('text=+ Mục tiêu mới');
await modal();
f = await fields();
await f[0].fill('Mua laptop mới');
await f[2].fill('30000000');
await f[3].fill('5000000');
const d = new Date(); d.setFullYear(d.getFullYear() + 1);
await f[4].fill(d.toISOString().slice(0, 10));
await save();
const goals = await text();
ok('mục tiêu mới được lưu', /Mua laptop mới/.test(goals));
ok('mục tiêu hiện tiến độ', /30\.000\.000|5\.000\.000|%/.test(goals));

// ── 7. Ngân sách ───────────────────────────────────────────────────────────
step('7. Tự tay đặt ngân sách');
await go('budgets');
await page.click('text=+ Ngân sách');
await modal();
f = await fields();
const bSel = await page.$$('.modal select');
if (bSel[0]) { const o = await bSel[0].$$eval('option', (x) => x.map((y) => ({ v: y.value, t: y.textContent }))); const an = o.find((c) => /Ăn uống/i.test(c.t)) || o.find((c) => c.v); if (an) await bSel[0].selectOption(an.v); }
const bNum = await page.$$('.modal input[type=number]');
if (bNum[0]) await bNum[0].fill('4000000');
await save();
const bud = await text();
ok('ngân sách được lưu', /4\.000\.000/.test(bud), bud.slice(0, 120).replace(/\n/g, ' | '));

// ── 8. Trò chuyện: hỏi số liệu ─────────────────────────────────────────────
step('8. Hỏi cố vấn (không có khoá API → bộ luật nội bộ)');
await go('chat');
const ask = async (t) => {
  await page.fill('.chat-in textarea', t);
  await page.click('button.send');
  await page.waitForTimeout(2500);
  return page.$$eval('.msg.assistant .bub', (els) => els.map((e) => e.innerText).pop() || '');
};
const r1 = await ask('tháng này mình tiêu bao nhiêu?');
ok('cố vấn trả lời câu hỏi chi tiêu', r1.length > 20, r1.slice(0, 90).replace(/\n/g, ' '));
ok('con số trong câu trả lời khớp sổ (75.000)', /75\.000|75k/.test(r1));

// ── 9. Trò chuyện: ghi giao dịch bằng lời ──────────────────────────────────
step('9. Ghi giao dịch bằng câu nói');
const r2 = await ask('tối qua cà phê 40k');
ok('cố vấn xác nhận đã ghi', /ghi|lưu|40\.000|40k/i.test(r2), r2.slice(0, 90).replace(/\n/g, ' '));
await go('transactions');
tx = await text();
ok('khoản cà phê 40.000 có trong sổ', /40\.000/.test(tx));
await page.screenshot({ path: SHOTS + '/03-chat.png' });

// ── 10. Quỹ ────────────────────────────────────────────────────────────────
step('10. Quỹ: phân bổ tiền');
await go('funds');
const fundsBefore = await text();
ok('trang quỹ có sẵn 6 hũ', (fundsBefore.match(/Thiết yếu|Khẩn cấp|Hưởng thụ/g) || []).length >= 2);
await page.click('text=Phân bổ tiền');
await modal();
const aNum = await page.$$('.modal input[type=number]');
if (aNum[0]) await aNum[0].fill('20000000');
const allocBtns = await page.$$eval('.modal button', (els) => els.map((e) => e.textContent.trim()));
const saveLabel = allocBtns.find((t) => /^(Lưu|Phân bổ|Chia|Xác nhận|Thực hiện)/.test(t)) || 'Lưu';
await page.click(`.modal >> text=${saveLabel}`);
await page.waitForTimeout(1500);
const fundsAfter = await text();
ok('phân bổ chạy được, quỹ có tiền', /\d{1,3}(\.\d{3})+/.test(fundsAfter) && fundsAfter !== fundsBefore);

// ── 11. Đầu tư & giá thị trường ────────────────────────────────────────────
step('11. Đầu tư + làm mới giá');
await go('investments');
const inv = await text();
ok('trang đầu tư mở được', inv.length > 20);
const refreshBtn = await page.$('text=/Cập nhật giá|Làm mới giá/');
if (refreshBtn) {
  await refreshBtn.click(); await page.waitForTimeout(2500);
  const inv2 = await text();
  ok('nhấn cập nhật giá không làm vỡ trang (đang chặn mạng)', !/NaN|undefined/.test(inv2), (inv2.match(/(ngoại tuyến|offline|không có mạng)[^\n]*/i) || ['có phản hồi'])[0].slice(0, 60));
} else ok('có nút cập nhật giá trên trang đầu tư', false);

// ── 12. Mất mạng ───────────────────────────────────────────────────────────
step('12. Mất wifi: app vẫn dùng được?');
expectOffline = true;
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(900);
ok('hiện băng báo mất mạng', !!(await page.$('.offline-bar')), (await text('.offline-bar').catch(() => '')).slice(0, 60));
await go('transactions');
ok('vẫn xem được sổ giao dịch đã tải', (await text()).length > 30);
await go('chat');
const offText = await text();
ok('màn trò chuyện báo rõ đang ngoại tuyến / vẫn mở được', offText.length > 20);
if (EMBEDDED) {
  // Đây mới là điều đáng giá của bản chạy trên máy: mất mạng vẫn ghi sổ được.
  await go('transactions');
  await page.click('.fab');
  await modal();
  const of = await fields();
  await of[1].fill('123000');
  await of[6].fill('Ghi lúc mất mạng');
  await save();
  const offTx = await text();
  ok('MẤT MẠNG VẪN GHI ĐƯỢC GIAO DỊCH', /Ghi lúc mất mạng/.test(offTx) && /123\.000/.test(offTx));
}
await page.screenshot({ path: SHOTS + '/04-offline.png' });
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(1200);
expectOffline = false;
ok('có mạng lại thì băng báo biến mất', !(await page.$('.offline-bar')));

// ── 13. Tải lại: dữ liệu còn nguyên ────────────────────────────────────────
step('13. Tải lại app, dữ liệu còn nguyên');
await page.reload({ waitUntil: 'domcontentloaded' });
// reload giữ nguyên #hash, nên chờ phần khung chung chứ không chờ riêng trang chủ
await page.waitForSelector('.main', { timeout: 60000 });
await page.waitForTimeout(EMBEDDED ? 2500 : 1500);
await go('transactions');
tx = await text();
ok('giao dịch còn sau khi tải lại', /Cơm tấm/.test(tx) && /40\.000/.test(tx));
await go('goals');
ok('mục tiêu còn sau khi tải lại', /Mua laptop mới/.test(await text()));

if (EMBEDDED) {
  step('13b. Mất mạng rồi MỞ LẠI app (bản chạy trên máy)');
  expectOffline = true;
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(6000);
  const body = await text('body');
  ok('MẤT MẠNG MỞ LẠI VẪN VÀO ĐƯỢC APP (không trang trắng)', body.length > 80, 'body ' + body.length + ' ký tự');
  await go('transactions');
  const offBook = await text();
  ok('sổ giao dịch vẫn đủ khi mở lại lúc mất mạng',
    /Cơm tấm/.test(offBook) && /Ghi lúc mất mạng/.test(offBook), offBook.slice(0, 90).replace(/\n/g, ' '));
  await ctx.setOffline(false);
  expectOffline = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.main', { timeout: 60000 });
  await page.waitForTimeout(2000);
}

// ── 14. Sao lưu ────────────────────────────────────────────────────────────
step('14. Sao lưu & xuất dữ liệu');
await go('settings');
const setTxt = await text();
ok('trang cài đặt mở được', setTxt.length > 50);
const backup = await page.$('text=/Sao lưu ngay|Tạo bản sao lưu|Sao lưu/');
if (backup) {
  await backup.click(); await page.waitForTimeout(2000);
  const s2 = await text();
  ok('bấm sao lưu chạy không lỗi', !/NaN|undefined|Lỗi 5\d\d/.test(s2));
} else ok('có nút sao lưu trong cài đặt', false);

// ── 15. Giao diện tối ──────────────────────────────────────────────────────
step('15. Chế độ tối');
const themeBtn = await page.$('.topbar button, header button');
await go('dashboard');
const tgl = await page.$('text=🌗');
if (tgl) {
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    await tgl.click(); await page.waitForTimeout(600);
    seen.push(await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    if (seen[seen.length - 1] === 'dark') await page.screenshot({ path: SHOTS + '/05-dark.png' });
  }
  ok('nút xoay đủ 3 nấc (hệ thống / sáng / tối)', seen.includes('dark') && seen.includes('light'), seen.join(' → '));
} else ok('có nút đổi giao diện sáng/tối', false);

// ── 16. Mọi trang đều mở được ──────────────────────────────────────────────
step('16. Duyệt hết mọi trang');
const routes = ['dashboard', 'chat', 'transactions', 'accounts', 'funds', 'goals', 'budgets', 'income', 'investments', 'debts', 'fire', 'advisor', 'insights', 'currency', 'automation', 'settings', 'ai-log', 'more'];
let bad = [];
for (const r of routes) {
  await go(r);
  const t = await text();
  if (t.length < 15 || /NaN|undefined|\[object Object\]/.test(t)) bad.push(r + '(' + t.length + ')');
}
ok('cả ' + routes.length + ' trang đều có nội dung sạch', bad.length === 0, bad.join(', '));

// ── 17. Chạm được trên điện thoại ──────────────────────────────────────────
step('17. Cỡ vùng chạm trên mobile');
await go('dashboard');
const tiny = [];
for (const r of ['dashboard', 'transactions', 'accounts', 'goals', 'insights', 'more']) {
  await go(r);
  const sm = await page.$$eval('.main button, .botnav button', (els) => els
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ t: (e.textContent || '').trim().slice(0, 16), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((x) => x.h > 0 && x.h < 44));
  for (const x of sm) tiny.push(r + '/' + x.t + ':' + x.h + 'px');
}
ok('mọi nút đều đủ lớn để chạm bằng ngón tay (≥44px)', tiny.length === 0, tiny.slice(0, 8).join(', '));
await go('dashboard');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('trang chủ không tràn ngang', overflow <= 1, 'thừa ' + overflow + 'px');
await go('transactions');
const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('trang giao dịch không tràn ngang', ov2 <= 1, 'thừa ' + ov2 + 'px');

// ── Kết ────────────────────────────────────────────────────────────────────
ok('không có lỗi JavaScript nào trong suốt hành trình', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await b.close();
console.log('\n' + '═'.repeat(60));
console.log(fails.length === 0 ? `🎉 ${LABEL}: ${pass}/${pass} bước đạt` : `❌ ${LABEL}: ${pass} đạt, ${fails.length} hỏng:\n  - ` + fails.join('\n  - '));
console.log('═'.repeat(60));
process.exit(fails.length ? 1 : 0);
