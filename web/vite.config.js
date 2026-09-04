import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveNative, SERVER_SRC } from './native.aliases.js';

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

export default defineConfig(({ mode }) => {
  const embedded = mode === 'embedded';
  return {
    base: embedded ? './' : '/',
    plugins: [react(), nativePlugin(embedded)],
    define: { 'import.meta.env.VITE_EMBEDDED': JSON.stringify(embedded ? '1' : '0') },
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
