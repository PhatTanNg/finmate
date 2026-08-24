/**
 * Render thật từng trang trong jsdom, gọi API thật ở localhost:4000
 * và báo lỗi nếu React/console throw. Chạy khi server đang chạy:
 *   node test/render.mjs
 */
import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.FINMATE_URL || 'http://localhost:4000';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.Element = window.Element;
global.SVGElement = window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.confirm = () => true;
window.alert = () => {};
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollTo = function () {};

const realFetch = globalThis.fetch;
const proxy = (u, o) => realFetch(String(u).startsWith('/') ? API + u : u, o);
global.fetch = proxy;
window.fetch = proxy;

const errors = [];
const origErr = console.error;
console.error = (...a) => {
  const s = a.map(String).join(' ');
  errors.push(s);
  if (!/not wrapped in act|ReactDOMTestUtils/i.test(s)) origErr('   ↳', s.slice(0, 300));
};
window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
process.on('unhandledRejection', (e) => errors.push('unhandledRejection: ' + (e?.message || e)));

const out = path.join(here, '.build.mjs');
await esbuild.build({
  entryPoints: [path.join(here, 'entry.jsx')],
  bundle: true, format: 'esm', outfile: out, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"development"' },
});

const { PAGES, React, Wrap, Boundary, setBaseCurrency } = await import('file://' + out.replace(/\\/g, '/'));
const { createRoot } = await import('react-dom/client');

let dash = null;
try { dash = await (await proxy('/api/dashboard')).json(); } catch { /* ignore */ }
setBaseCurrency(dash?.base_currency || dash?.profile?.currency || 'VND');
console.log(`Đồng tiền gốc: ${dash?.base_currency || dash?.profile?.currency || 'VND'}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

for (const [name, Comp] of Object.entries(PAGES)) {
  errors.length = 0;
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host);
  const props = name === 'Dashboard' ? { d: dash, go: () => {} } : {};
  const crashes = [];
  try {
    root.render(React.createElement(Boundary, { onError: (e) => crashes.push(e.message) }, React.createElement(Wrap, { Comp, props })));
    await sleep(900);
    const text = host.textContent || '';
    const bad = ['undefined', 'NaN', '[object Object]'].filter((w) => text.includes(w));
    const real = [...crashes, ...errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|validateDOMNesting|The above error occurred/i.test(e))];
    if (real.length) { failed++; console.log(`❌ ${name}: ${real[0].slice(0, 160)}`); }
    else if (text.trim().length < 25) { failed++; console.log(`❌ ${name}: render rỗng (${text.trim().length} ký tự)`); }
    else if (bad.length) {
      failed++;
      const at = text.indexOf(bad[0]);
      console.log(`❌ ${name}: hiển thị "${bad.join('/')}" — ...${text.slice(Math.max(0, at - 70), at + 40)}...`);
    }
    else { console.log(`✅ ${name} (${text.trim().length} ký tự)`); if (process.env.DUMP && new RegExp(process.env.DUMP, 'i').test(name)) console.log('---\n' + text.trim().slice(0, 1600) + '\n---'); }
  } catch (e) {
    failed++; console.log(`❌ ${name}: throw — ${e.message}`);
  } finally {
    try { root.unmount(); } catch { /* ignore */ }
    host.remove();
  }
}

fs.rmSync(out, { force: true });
console.log(failed ? `\n${failed} trang lỗi.` : '\n🎉 Toàn bộ trang render sạch với dữ liệu thật.');
process.exit(failed ? 1 : 0);
