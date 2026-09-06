/**
 * Máy chủ thật: dữ liệu phải sống sót qua một lần khởi động lại.
 *
 * Bộ kiểm này chạy CHÍNH tiến trình server (`node src/index.js`) chứ không
 * lắp router vào một app express giả như các bộ kiểm khác. Lý do: hai lỗi
 * nặng nhất của bản triển khai chỉ lộ ra ở mức tiến trình.
 *
 *  1. Sổ nằm sai chỗ. FINMATE_DATA_DIR quyết định danh bạ tài khoản và sổ
 *     riêng của từng người nằm ở đâu. Đặt thiếu thì chúng rơi vào thư mục mã
 *     nguồn trong container — mỗi lần deploy là mọi người dùng mất sạch sổ,
 *     trong khi FINMATE_DB vẫn trỏ đúng volume nên nhìn qua tưởng ổn.
 *  2. Tắt không êm. Nền tảng nào cũng gửi SIGTERM rồi mới giết. Không đóng sổ
 *     kịp thì phần ghi mới còn nằm trong file -wal.
 *
 * Nên bộ kiểm: ghi dữ liệu → SIGTERM → chờ tiến trình tự thoát → bật lại →
 * đòi lại đúng dữ liệu đó, và soi cả đường dẫn file trên đĩa.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');
// "Volume" giả: đúng vai trò /data trên máy chủ thật, nằm ngoài mã nguồn.
const vol = path.join(here, '.tmp-deploy');
rmSync(vol, { recursive: true, force: true });
mkdirSync(vol, { recursive: true });

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

const freePort = () => new Promise((r) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}/api`;

// Đúng bộ biến môi trường mà Dockerfile đặt, chỉ khác chỗ trỏ vào thư mục tạm.
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  FINMATE_HOST: '127.0.0.1',
  FINMATE_MULTIUSER: '1',
  FINMATE_FX_OFFLINE: '1',
  FINMATE_DATA_DIR: vol,
  FINMATE_DB: path.join(vol, 'finmate.db'),
  FINMATE_BACKUP_DIR: path.join(vol, 'backups'),
};

const logs = [];
async function start() {
  const p = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (b) => logs.push(String(b)));
  p.stderr.on('data', (b) => logs.push(String(b)));
  p.exited = new Promise((r) => p.on('exit', (code, sig) => r({ code, sig })));
  // Chờ server nghe cổng. Có sổ mới phải dựng bảng nên lần đầu chậm hơn.
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return p;
    } catch { /* chưa lên */ }
    await sleep(100);
  }
  throw new Error(`server không lên sau 10s:\n${logs.join('')}`);
}

const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-finmate-key': token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

head('Khởi động tiến trình server thật');
let srv = await start();
const h1 = await call('GET', '/health');
ok('server lên và trả /health', h1.ok !== false && h1.time, JSON.stringify(h1).slice(0, 120));
ok('chạy ở chế độ nhiều người dùng', h1.multi_user === true);

head('Ghi dữ liệu như một người dùng thật');
const reg = await call('POST', '/account/register', { email: 'lan@example.com', password: 'mat-khau-cua-lan', name: 'Lan' });
ok('đăng ký được', reg.user?.id > 0, JSON.stringify(reg).slice(0, 120));
const token = reg.token;

const tx = await call('POST', '/transactions', { type: 'expense', amount: 123456, note: 'cà phê sau khi deploy' }, token);
ok('ghi được giao dịch', tx.transaction?.id > 0, JSON.stringify(tx).slice(0, 120));

head('Sổ nằm trên volume, không nằm trong mã nguồn');
ok('danh bạ tài khoản nằm trong FINMATE_DATA_DIR', existsSync(path.join(vol, 'finmate-accounts.db')), readdirSync(vol).join(', '));
ok('sổ riêng của người dùng nằm trong FINMATE_DATA_DIR', existsSync(path.join(vol, 'users', `${reg.user.id}.db`)), existsSync(path.join(vol, 'users')) ? readdirSync(path.join(vol, 'users')).join(', ') : 'không có thư mục users');
// Đây là cái bẫy của Dockerfile: quên FINMATE_DATA_DIR thì mọi thứ rơi vào đây.
ok('KHÔNG ghi lạc vào thư mục mã nguồn server/data', !existsSync(path.join(here, '..', 'data', 'finmate-accounts.db')));

head('Dockerfile đặt đủ biến trỏ dữ liệu vào volume');
// Đoạn trên chứng minh MÃ NGUỒN tôn trọng FINMATE_DATA_DIR. Còn đây là bản
// triển khai thật: image phải thực sự đặt biến đó, nếu không thì mọi thứ
// chạy đúng trong test mà vẫn mất sổ mỗi lần deploy.
const dockerfile = readFileSync(path.join(here, '..', '..', 'Dockerfile'), 'utf8');
const envDir = /^ENV\s+FINMATE_DATA_DIR=(\S+)/m.exec(dockerfile)?.[1];
const mounts = [...dockerfile.matchAll(/^VOLUME\s+\[([^\]]*)\]/gm)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
ok('Dockerfile có ENV FINMATE_DATA_DIR', Boolean(envDir), 'thiếu — sổ của mọi người dùng sẽ nằm trong container và mất khi deploy lại');
ok('FINMATE_DATA_DIR nằm trong volume được mount', mounts.some((m) => envDir === m || envDir?.startsWith(`${m}/`)), `${envDir} không nằm dưới ${mounts.join(', ')}`);
for (const bien of ['FINMATE_DB', 'FINMATE_BACKUP_DIR']) {
  const v = new RegExp(`^ENV\\s+${bien}=(\\S+)`, 'm').exec(dockerfile)?.[1];
  ok(`${bien} cũng nằm trong volume`, Boolean(v) && mounts.some((m) => v === m || v.startsWith(`${m}/`)), String(v));
}

head('Tên miền thật: trang của chính app gọi được, trang lạ thì không');
// Trình duyệt gửi kèm Origin cả với request cùng origin. Trên máy chủ thật,
// Origin là tên miền đã deploy chứ không phải localhost — nếu chỉ cho phép
// localhost thì bản deploy tự chặn chính mình và mọi thao tác ghi đều 403.
// `fetch` không cho đặt Host nên phải gọi bằng http thô.
const rawPost = (p, body, headers) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const r = http.request({
    host: '127.0.0.1', port: PORT, path: `/api${p}`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
  }, (r2) => { let b = ''; r2.on('data', (c) => { b += c; }); r2.on('end', () => res({ status: r2.statusCode, body: b })); });
  r.on('error', rej);
  r.end(data);
});
const nha = await rawPost('/account/login', { email: 'lan@example.com', password: 'sai-mat-khau' },
  { Host: 'finmate.fly.dev', Origin: 'https://finmate.fly.dev' });
ok('giao diện trên tên miền đã deploy gọi được API', nha.status !== 403, `${nha.status} ${nha.body.slice(0, 80)}`);
const la = await rawPost('/account/login', { email: 'lan@example.com', password: 'sai-mat-khau' },
  { Host: 'finmate.fly.dev', Origin: 'https://ke-gian.example' });
ok('trang web lạ vẫn bị chặn', la.status === 403, `${la.status} ${la.body.slice(0, 80)}`);

head('Tắt êm bằng SIGTERM');
const t0 = Date.now();
srv.kill('SIGTERM');
const exited = await Promise.race([srv.exited, sleep(9000).then(() => null)]);
ok('tiến trình tự thoát sau SIGTERM (không cần giết cưỡng bức)', exited !== null, 'quá 9s vẫn còn sống');
ok('thoát với mã 0', exited?.code === 0, JSON.stringify(exited));
ok('thoát nhanh, không treo tới hết giờ chờ', Date.now() - t0 < 8000, `${Date.now() - t0}ms`);
ok('có ghi log đóng sổ', /đóng .* sổ người dùng/.test(logs.join('')), logs.join('').slice(-200));
// Đóng sổ tử tế thì SQLite gộp WAL vào file chính và xoá file -wal.
const wal = readdirSync(path.join(vol, 'users')).filter((f) => f.endsWith('-wal'));
ok('sổ người dùng đã gộp WAL, không còn file -wal treo lại', wal.length === 0, wal.join(', '));

head('Bật lại: dữ liệu còn nguyên');
logs.length = 0;
srv = await start();
const login = await call('POST', '/account/login', { email: 'lan@example.com', password: 'mat-khau-cua-lan' });
ok('tài khoản cũ đăng nhập lại được sau khi restart', login.user?.id === reg.user.id, JSON.stringify(login).slice(0, 120));

const list = await call('GET', '/transactions', null, login.token);
const found = (list.transactions || []).find((t) => t.amount === 123456 && /cà phê sau khi deploy/.test(t.note || ''));
ok('giao dịch ghi trước khi restart vẫn còn', Boolean(found), JSON.stringify(list).slice(0, 160));

const me = await call('GET', '/account/me', null, login.token);
ok('phiên mới đọc được hồ sơ', me.user?.email === 'lan@example.com', JSON.stringify(me).slice(0, 120));

head('Tự động hoá chạy trên sổ của từng người');
// Ở chế độ nhiều người dùng, gọi tự động hoá một lần ở ngoài chỉ chạm vào sổ
// mặc định: tiền nhà hàng tháng của mọi người sẽ không bao giờ được đăng.
ok('log khởi động nói rõ đã chạy trên bao nhiêu sổ', /tự động hoá khởi động: \d+ sổ/.test(logs.join('')), logs.join('').slice(-300));
const soRieng = new DatabaseSync(path.join(vol, 'users', `${reg.user.id}.db`), { readOnly: true });
const dau = soRieng.prepare("SELECT value FROM settings WHERE key = 'last_automation_run'").get();
ok('sổ riêng có dấu vết tự động hoá vừa chạy', Boolean(dau?.value), JSON.stringify(dau));
const chao = soRieng.prepare("SELECT COUNT(*) n FROM chat_messages").get();
ok('người mới có lời chào mở đầu trong chat', chao.n > 0, JSON.stringify(chao));
soRieng.close();

head('Không có token thì không vào được');
const trom = await call('GET', '/transactions');
ok('request không token bị chặn', trom.status === 401, String(trom.status));

srv.kill('SIGTERM');
await Promise.race([srv.exited, sleep(9000)]);
rmSync(vol, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✅' : '❌'} smoke-deploy: ${pass} đạt, ${fail} hỏng`);
process.exit(fail === 0 ? 0 : 1);
