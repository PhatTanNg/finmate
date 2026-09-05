import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveNative, SERVER_SRC } from './native.aliases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Hai cách build:
 *  - `vite build`                 -> dist/           giao diện gọi máy chủ Node qua /api.
 *  - `vite build --mode embedded` -> dist-embedded/  cả engine chạy trong trình duyệt
 *    (SQLite WebAssembly, router trong tiến trình) — gói này cài như app trên
 *    điện thoại (PWA) hoặc bọc bằng Capacitor.
 */
const nativePlugin = (embedded) => ({
  name: 'finmate-native',
  enforce: 'pre',
  resolveId(source, importer) {
    // Bản máy chủ: boot.js (kéo theo server/src và shim Node) thay bằng stub rỗng.
    if (!embedded && /native\/boot\.js$/.test(source)) return resolveNative('boot-stub');
    return embedded ? (resolveNative(source, importer) || null) : null;
  },
});

/**
 * Nhúng danh sách tài nguyên vào service worker sau khi build.
 *
 * Tên tệp build có hash nên trình duyệt tự đệm ở tầng HTTP; request không bao
 * giờ chạm tới service worker, và kiểu "gặp gì đệm nấy" để lại kho rỗng — mất
 * mạng là app mở ra trang trắng. Ở đây ta liệt kê thẳng mọi tệp đã sinh ra
 * (kể cả sql-wasm.wasm chỉ được nhắc tới từ trong bundle) để service worker
 * nạp đủ ngay lúc cài đặt. Tên kho gắn với hash của chính danh sách đó, nên
 * bản build mới tự dọn kho cũ.
 */
const swPrecachePlugin = (outDir) => ({
  name: 'finmate-sw-precache',
  apply: 'build',
  closeBundle() {
    const sw = path.resolve(__dirname, outDir, 'sw.js');
    if (!fs.existsSync(sw)) return;
    const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (
      d.isDirectory() ? walk(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`]
    ));
    const root = path.resolve(__dirname, outDir);
    const assets = walk(root)
      .filter((f) => !/^(sw\.js|index\.html)$/.test(f))
      .map((f) => `./${f}`)
      .sort();
    const build = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
    const src = fs.readFileSync(sw, 'utf8')
      .replace('__FINMATE_BUILD__', build)
      .replace('const BUILD =', `self.__FINMATE_ASSETS__ = ${JSON.stringify(assets)};\nconst BUILD =`);
    fs.writeFileSync(sw, src);
    this.warn?.(`sw.js: đệm sẵn ${assets.length} tệp (build ${build})`);
  },
});

export default defineConfig(({ mode }) => {
  const embedded = mode === 'embedded';
  return {
    base: embedded ? './' : '/',
    plugins: [react(), nativePlugin(embedded), swPrecachePlugin(embedded ? 'dist-embedded' : 'dist')],
    define: {
      'import.meta.env.VITE_EMBEDDED': JSON.stringify(embedded ? '1' : '0'),
      // Vite/esbuild thay `process.env` bằng một OBJECT RỖNG TĨNH khi build cho
      // trình duyệt. Mã máy chủ dùng chung đọc cấu hình qua process.env, nên
      // trong bản nhúng mọi lần đọc đều ra rỗng — trong khi boot.js ghi key
      // vào globalThis.process.env (viết là `g.process.env` nên không bị thay).
      // Đọc và ghi thành hai nơi khác nhau: dán key xong Cài đặt bảo "chưa có
      // key được lưu", Trò chuyện mãi trả lời bằng bộ luật, và FINMATE_FX_OFFLINE,
      // FINMATE_PRICE_PROXY, thư mục sao lưu... cũng câm luôn. Trỏ thẳng về
      // biến toàn cục để đọc và ghi lại về chung một chỗ.
      ...(embedded ? { 'process.env': 'globalThis.process.env' } : {}),
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
      fs: { allow: ['..'] },
    },
    optimizeDeps: { exclude: ['sql.js'] },
    build: {
      outDir: embedded ? 'dist-embedded' : 'dist',
      sourcemap: false,
      target: 'es2022',
      rollupOptions: embedded ? { external: [] } : undefined,
    },
    resolve: { preserveSymlinks: false },
    // cho phép import server/src khi build nhúng
    ...(embedded ? { server: { fs: { allow: ['..', SERVER_SRC] } } } : {}),
  };
});
