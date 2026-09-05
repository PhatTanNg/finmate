/**
 * Bản đồ thay thế module khi đóng gói FinMate chạy ngay trên điện thoại.
 * Dùng chung cho vite.config.js (build) và test/embedded.mjs (esbuild).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const native = (f) => path.join(here, 'src/native', f);
export const SERVER_SRC = path.resolve(here, '../server/src');

export const SPECIFIER_ALIASES = {
  'boot-stub': native('boot.stub.js'),
  express: native('shims/express.js'),
  'node:fs': native('shims/fs.js'), fs: native('shims/fs.js'),
  'node:path': native('shims/path.js'), path: native('shims/path.js'),
  'node:os': native('shims/os.js'), os: native('shims/os.js'),
  'node:url': native('shims/url.js'), url: native('shims/url.js'),
  'node:crypto': native('shims/crypto.js'), crypto: native('shims/crypto.js'),
};
/** File trong server/src bị thay bằng bản trình duyệt (so theo đường dẫn tuyệt đối). */
export const FILE_ALIASES = {
  [path.join(SERVER_SRC, 'db_engine.js')]: native('db_engine.browser.js'),
  [path.join(SERVER_SRC, 'db_context.js')]: native('db_context.browser.js'),
};

/** Giải một import: trả đường dẫn thay thế hoặc null. */
export function resolveNative(source, importer) {
  if (SPECIFIER_ALIASES[source]) return SPECIFIER_ALIASES[source];
  if (importer && source.startsWith('.')) {
    const abs = path.resolve(path.dirname(importer), source);
    if (FILE_ALIASES[abs]) return FILE_ALIASES[abs];
  }
  return null;
}
