/**
 * Chạy cả hai hành trình đầu-cuối: bản gọi máy chủ và bản chạy thẳng trên máy.
 * Tự dựng máy chủ tĩnh + API trên sổ trắng tinh rồi dọn sạch khi xong.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const server = path.resolve(web, '..', 'server');
const DB = path.join(os.tmpdir(), 'finmate-e2e.db');
const kids = [];
const spawnBg = (cmd, args, opts) => { const p = spawn(cmd, args, { stdio: 'ignore', ...opts }); kids.push(p); return p; };
const stop = () => kids.forEach((p) => { try { p.kill(); } catch {} });
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => { for (let i = 0; i < 40; i += 1) { try { await fetch(url); return true; } catch { await wait(500); } } return false; };

const run = (env, file = 'e2e.mjs') => new Promise((res) => {
  const p = spawn(process.execPath, [path.join(here, file)], { stdio: 'inherit', env: { ...process.env, ...env } });
  p.on('exit', (c) => res(c || 0));
});

for (const s of ['', '-shm', '-wal']) if (fs.existsSync(DB + s)) fs.rmSync(DB + s);
let bad = 0;

if (fs.existsSync(path.join(web, 'dist', 'index.html'))) {
  spawnBg(process.execPath, ['src/index.js'], { cwd: server, env: { ...process.env, FINMATE_DB: DB, PORT: '4001', FINMATE_FX_OFFLINE: '1' } });
  spawnBg(process.execPath, [path.join(here, 'serve-static.mjs')], { env: { ...process.env, E2E_ROOT: path.join(web, 'dist'), E2E_API: 'http://127.0.0.1:4001', E2E_PORT: '4200' } });
  await up('http://127.0.0.1:4200/');
  bad += await run({ E2E_BASE: 'http://127.0.0.1:4200', E2E_LABEL: 'bản máy chủ' });
} else if (process.env.E2E_REQUIRED === '1') { console.error('✗ chưa build dist (npm run build -w web)'); process.exit(1); }
else console.log('⚠ chưa build dist — bỏ qua hành trình bản máy chủ');

if (fs.existsSync(path.join(web, 'dist-embedded', 'index.html'))) {
  spawnBg(process.execPath, [path.join(here, 'serve-static.mjs')], { env: { ...process.env, E2E_ROOT: path.join(web, 'dist-embedded'), E2E_PORT: '4100' } });
  await up('http://127.0.0.1:4100/');
  bad += await run({ E2E_BASE: 'http://127.0.0.1:4100', E2E_LABEL: 'bản chạy trên máy (nhúng)', E2E_EMBEDDED: '1' });
} else if (process.env.E2E_REQUIRED === '1') { console.error('✗ chưa build dist-embedded (npm run build:app -w web)'); process.exit(1); }
else console.log('⚠ chưa build dist-embedded — bỏ qua hành trình bản nhúng');

// Hành trình thứ ba: máy chủ chạy chế độ nhiều người dùng. Dùng lại bản dist
// của bản máy chủ, chỉ khác máy chủ phía sau — cửa vào là tài khoản chứ không
// phải mã PIN, nên phải kiểm riêng.
if (fs.existsSync(path.join(web, 'dist', 'index.html'))) {
  const DATA = path.join(os.tmpdir(), 'finmate-e2e-account');
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  // Hộp thư giả: giữ lại lá thư máy chủ gửi để bộ kiểm mở đúng đường dẫn mà
  // người dùng thật sẽ bấm trong thư — không giả lập bước nào ở giữa.
  const hopThu = [];
  const mail = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        try { hopThu.push(JSON.parse(b)); } catch { /* thư hỏng thì bỏ */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'thu-' + hopThu.length }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(hopThu[hopThu.length - 1] || null));
  });
  await new Promise((r) => mail.listen(4400, '127.0.0.1', r));
  kids.push({ kill: () => mail.close() });

  spawnBg(process.execPath, ['src/index.js'], {
    cwd: server,
    env: {
      ...process.env,
      PORT: '4002',
      FINMATE_FX_OFFLINE: '1',
      FINMATE_MULTIUSER: '1',
      FINMATE_DATA_DIR: DATA,
      FINMATE_DB: path.join(DATA, 'default.db'),
      FINMATE_BACKUP_DIR: path.join(DATA, 'backups'),
      FINMATE_SIGNUP_CODE: 'ma-moi-e2e',
      FINMATE_MAIL_KEY: 'khoa-gia',
      FINMATE_MAIL_URL: 'http://127.0.0.1:4400/emails',
      // Đường dẫn trong thư phải trỏ về trang tĩnh (nơi người dùng mở app),
      // không phải cổng API.
      FINMATE_PUBLIC_URL: 'http://127.0.0.1:4300',
    },
  });
  spawnBg(process.execPath, [path.join(here, 'serve-static.mjs')], { env: { ...process.env, E2E_ROOT: path.join(web, 'dist'), E2E_API: 'http://127.0.0.1:4002', E2E_PORT: '4300' } });
  await up('http://127.0.0.1:4300/');
  bad += await run({ E2E_BASE: 'http://127.0.0.1:4300', E2E_SIGNUP_CODE: 'ma-moi-e2e', E2E_INBOX: 'http://127.0.0.1:4400/last' }, 'e2e-account.mjs');
  fs.rmSync(DATA, { recursive: true, force: true });
}

stop();
process.exit(bad ? 1 : 0);
