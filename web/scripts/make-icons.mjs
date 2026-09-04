/**
 * Sinh icon PNG từ public/icon.svg.
 *
 * Vì sao cần PNG: iOS KHÔNG đọc được SVG cho `apple-touch-icon`. Cài app vào
 * màn hình chính iPhone mà chỉ có SVG thì được cái icon trống hoặc ảnh chụp
 * trang, không phải logo. Android đọc được SVG nhưng nhiều nơi vẫn thích PNG.
 *
 * Hai kiểu:
 *   icon-<n>.png       bo góc sẵn — dùng cho manifest purpose "any"
 *   icon-sq-<n>.png    vuông tràn viền — cho apple-touch-icon (iOS tự bo góc,
 *                      đưa ảnh bo sẵn vào sẽ bị bo hai lần) và cho maskable
 *                      của Android (logo nằm gọn trong vùng an toàn 80%).
 *
 * Chạy: node scripts/make-icons.mjs   (cần playwright-core + một bản Chromium)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '..', 'public');

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('Cần playwright-core: npm i -D playwright-core'); process.exit(1); }

const findChrome = () => {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const rels = ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')]
    .filter((r) => r && fs.existsSync(r));
  for (const root of roots) {
    for (const d of fs.readdirSync(root)) {
      for (const rel of rels) { const f = path.join(root, d, rel); if (fs.existsSync(f)) return f; }
    }
  }
  for (const f of ['/usr/bin/chromium', '/usr/bin/google-chrome']) if (fs.existsSync(f)) return f;
  return null;
};
const exe = findChrome();
if (!exe) { console.error('Không tìm thấy Chromium (đặt E2E_CHROME hoặc: npx playwright install chromium)'); process.exit(1); }

const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f5eff"/><stop offset="1" stop-color="#6d5cff"/></linearGradient></defs>';
const LETTER = (y, size) => `<text x="256" y="${y}" text-anchor="middle" font-family="Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#fff">F</text>`;
// Bo góc sẵn: dùng cho manifest "any".
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRAD}<rect width="512" height="512" rx="120" fill="url(#g)"/>${LETTER(338, 280)}</svg>`;
// Vuông tràn viền, chữ nhỏ hơn để nằm trong vùng an toàn khi bị cắt tròn.
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRAD}<rect width="512" height="512" fill="url(#g)"/>${LETTER(320, 224)}</svg>`;

const b = await chromium.launch({ executablePath: exe, headless: true });
const made = [];
for (const [svg, prefix, sizes] of [[rounded, 'icon', [192, 512]], [square, 'icon-sq', [180, 512]]]) {
  for (const n of sizes) {
    const page = await b.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;width:${n}px;height:${n}px;overflow:hidden}svg{display:block;width:${n}px;height:${n}px}</style>${svg}`,
      { waitUntil: 'load' },
    );
    await page.waitForTimeout(120);          // chờ font hệ thống nhận chữ F
    const file = path.join(pub, `${prefix}-${n}.png`);
    await page.screenshot({ path: file, omitBackground: false });
    await page.close();
    made.push(`${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(1)}KB)`);
  }
}
await b.close();
console.log('Đã sinh: ' + made.join(', '));
