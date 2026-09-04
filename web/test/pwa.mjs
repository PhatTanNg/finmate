/**
 * Bản chạy trên điện thoại phải mở được khi MẤT MẠNG HOÀN TOÀN.
 *
 * Điều kiện là service worker đệm sẵn đủ tài nguyên ngay lúc cài đặt. Không
 * thể trông vào kiểu "gặp request nào đệm request đó": tên tệp build có hash
 * nên trình duyệt tự đệm ở tầng HTTP, request không chạm tới service worker,
 * kho rỗng, và mất mạng là app mở ra TRANG TRẮNG. Test này giữ cho danh sách
 * đệm sẵn luôn khớp với những gì thực sự được build ra.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };

const out = path.join(root, 'dist-embedded');
if (!fs.existsSync(path.join(out, 'sw.js'))) {
  console.log('⚠ chưa build bản nhúng (npm run build:embedded) — bỏ qua');
  process.exit(0);
}

const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
const listed = JSON.parse((sw.match(/self\.__FINMATE_ASSETS__ = (\[[^\n]*?\]);/) || [])[1] || 'null');

console.log('\nService worker đệm sẵn đủ tài nguyên');
ok('sw.js có danh sách đệm sẵn', Array.isArray(listed) && listed.length > 0);
ok('chỗ giữ tên bản build đã được thay', !/__FINMATE_BUILD__/.test(sw));
ok('tên kho gắn với bản build (bản mới tự dọn kho cũ)', /const CACHE = 'finmate-' \+/.test(sw) && /const BUILD = '[0-9a-f]{6,}'/.test(sw));

const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (
  d.isDirectory() ? walk(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`]
));
const built = walk(out).filter((f) => !/^(sw\.js|index\.html)$/.test(f)).map((f) => `./${f}`);
const missing = built.filter((f) => !listed?.includes(f));
ok('mọi tệp build ra đều nằm trong danh sách đệm', missing.length === 0, missing.join(', '));
ok('có trang chủ để mở lúc mất mạng', /'\.\/', '\.\/index\.html'/.test(sw) || /\['\.\/', '\.\/index\.html'\]/.test(sw));

const js = built.filter((f) => f.endsWith('.js'));
ok('bundle JavaScript được đệm', js.length > 0 && js.every((f) => listed.includes(f)), js.join(', '));
ok('SQLite WebAssembly được đệm (không có nó thì không mở nổi sổ)',
  listed.some((f) => /sql-wasm.*\.wasm$/.test(f)), listed.filter((f) => /wasm/.test(f)).join(', '));
ok('CSS được đệm', listed.some((f) => f.endsWith('.css')));
ok('manifest được đệm (để cài như app)', listed.some((f) => f.endsWith('.webmanifest')));

console.log('\nĐiều hướng lúc mất mạng');
ok('mất mạng thì lấy trang đã đệm thay vì báo lỗi', /\.catch\(\(\) => caches\.match\('\.\/index\.html'\)/.test(sw));
ok('một tệp lỗi không kéo sập cả mẻ đệm', /\.map\(\(u\) => c\.add\(.*\)\.catch\(\(\) => \{\}\)\)/.test(sw));

const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.webmanifest'), 'utf8'));
console.log('\nCài được lên màn hình chính');
ok('manifest có tên app', !!manifest.name);
ok('manifest chạy toàn màn hình', /standalone|fullscreen/.test(manifest.display || ''));
ok('manifest có icon', Array.isArray(manifest.icons) && manifest.icons.length > 0);
ok('start_url dùng đường dẫn tương đối (chạy được cả khi bọc Capacitor)',
  !manifest.start_url || !manifest.start_url.startsWith('/'), manifest.start_url);

// ── iPhone ────────────────────────────────────────────────────────────────
// iOS bỏ qua manifest khi lấy icon màn hình chính: nó chỉ đọc apple-touch-icon,
// và KHÔNG đọc được SVG. Để SVG ở đó thì cài vào iPhone ra icon trống.
console.log('\nRiêng cho iPhone');
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const apple = html.match(/<link[^>]+rel="apple-touch-icon"[^>]*>/i)?.[0] || '';
ok('có khai báo apple-touch-icon', !!apple);
ok('apple-touch-icon là PNG, không phải SVG (iOS không đọc được SVG)',
  /\.png/i.test(apple) && !/\.svg/i.test(apple), apple);
const appleSrc = apple.match(/href="\.?\/?([^"]+)"/)?.[1];
ok('tệp icon cho iOS thật sự tồn tại trong bản build',
  !!appleSrc && fs.existsSync(path.join(out, appleSrc)), String(appleSrc));
ok('icon cho iOS được đệm sẵn để cài xong mở offline vẫn có',
  !!appleSrc && listed?.includes('./' + appleSrc), String(appleSrc));
ok('manifest có ít nhất một icon PNG (Android thích PNG hơn)',
  (manifest.icons || []).some((i) => i.type === 'image/png'));
ok('có icon maskable cho Android', (manifest.icons || []).some((i) => /maskable/.test(i.purpose || '')));
ok('khai báo chạy toàn màn hình trên iOS', /apple-mobile-web-app-capable"\s+content="yes"/.test(html));
ok('viewport phủ hết tai thỏ (viewport-fit=cover)', /viewport-fit=cover/.test(html));

// iOS Safari tự phóng to cả trang khi chạm vào ô nhập có cỡ chữ dưới 16px.
const css = walk(out).find((f) => f.endsWith('.css'));
const cssText = css ? fs.readFileSync(path.join(out, css), 'utf8') : '';
ok('ô nhập trên thiết bị cảm ứng tối thiểu 16px (iPhone không tự phóng to)',
  /@media\s*\(pointer:\s*coarse\)[^}]*\{[^@]*?(input|textarea)[^{]*\{[^}]*font-size:\s*16px/s.test(cssText));
ok('không chặn phóng to bằng user-scalable=no (người mắt kém vẫn zoom được)',
  !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(html));

console.log(`\n${fail ? '✗' : '✓'} pwa: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
