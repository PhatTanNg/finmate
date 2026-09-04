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

console.log(`\n${fail ? '✗' : '✓'} pwa: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
