import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { router, runAutomation } from './routes/api.js';
import { setting, closeMainDb } from './db.js';
import { requireAuth, pinIsSet, ingestToken, sessionOk } from './services/auth.js';
import { requireAccount } from './services/account_auth.js';
import { closeAll, withLedger } from './services/ledgers.js';
import { multiUser, closeControl, allUserIds, pruneResets } from './services/accounts.js';
import { ensureWelcome } from './services/chat/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
// Mặc định chỉ nghe trên máy này. Đặt FINMATE_HOST=0.0.0.0 để dùng từ điện thoại
// trong cùng mạng LAN — khi đó nên đặt mã PIN trước.
const HOST = process.env.FINMATE_HOST || '127.0.0.1';
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);

// Chỉ cho phép giao diện của chính app gọi API. Trình duyệt sẽ chặn mọi trang web
// lạ đọc dữ liệu tài chính ở localhost.
const allowedOrigins = (process.env.FINMATE_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const sameHost = (origin, req) => {
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
};
app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    if (!origin) return cb(null, { origin: true }); // curl, webhook, GET cùng origin
    // Chính giao diện của app gọi về máy chủ đang phục vụ nó. Trình duyệt gửi
    // kèm Origin cả khi cùng origin (mọi POST), nên thiếu nhánh này thì bản
    // deploy lên tên miền thật sẽ tự chặn chính mình: mở trang được nhưng
    // đăng nhập, ghi giao dịch — mọi thứ POST — đều 403.
    if (sameHost(origin, req)) return cb(null, { origin: true });
    if (allowedOrigins.includes(origin)) return cb(null, { origin: true });
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return cb(null, { origin: true });
    return cb(new Error('Origin không được phép'));
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '2mb' }));

// Cửa webhook: kiểm tra token trước mọi thứ khác.
app.use('/api', (req, res, next) => {
  // POST /api/ingest là cửa duy nhất mở ra ngoài (iOS Shortcuts gọi vào), nên
  // nó luôn phải kèm token bí mật — kể cả khi người dùng chưa đặt mã PIN.
  if (/^\/ingest\/?$/.test(req.path)) {
    const given = req.get('x-finmate-token') || req.query.token;
    if (given !== ingestToken() && !(pinIsSet() && sessionOk(req))) {
      return res.status(401).json({ ok: false, error: 'token không hợp lệ' });
    }
  }
  next();
});

// JSON hỏng là lỗi của bên gửi, không phải sự cố server — trả 400 kèm lời giải
// thích thay vì 500 khó hiểu (iOS Shortcuts rất hay gửi chuỗi sai định dạng).
app.use('/api', (err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ ok: false, error: 'Dữ liệu gửi lên không phải JSON hợp lệ' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Dữ liệu gửi lên quá lớn' });
  }
  return next(err);
});

app.use('/api', (req, res, next) => {
  if (typeof req.body === 'string') req.body = { text: req.body };
  next();
});

// Nhiều người dùng: đăng nhập bằng tài khoản, mỗi request chạy trong sổ của
// chính người đó. Một sổ: giữ nguyên khoá PIN như trước — bản chạy trên điện
// thoại và người dùng cá nhân không bị ép phải có tài khoản.
app.use('/api', multiUser() ? requireAccount : requireAuth);
app.use('/api', router);

const dist = path.join(__dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  if (err?.message === 'Origin không được phép') {
    return res.status(403).json({ ok: false, error: 'Trang web này không được phép gọi FinMate' });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

/**
 * Tự động hoá (đăng giao dịch định kỳ, tính lãi, chụp số dư, sinh cảnh báo,
 * sao lưu) chạy TRÊN TỪNG SỔ.
 *
 * Ở chế độ nhiều người dùng phải lặp qua từng người: mỗi người một file SQLite
 * riêng, nên gọi một lần ở ngoài chỉ chạm vào sổ mặc định — nghĩa là tiền nhà
 * hàng tháng của mọi người dùng sẽ không bao giờ được đăng, lãi tiết kiệm không
 * bao giờ được cộng, và chẳng ai có bản sao lưu nào.
 */
function tuDongHoa(nhan) {
  if (!multiUser()) {
    const r = runAutomation();
    console.log(`[finmate] tự động hoá ${nhan}: ${r.posted.length} giao dịch định kỳ, ${r.interest.length} bút toán lãi, ${r.insights} cảnh báo`);
    return;
  }
  // Vé đặt lại mật khẩu đã hết hạn thì dọn đi, đừng để tích trong sổ danh bạ.
  try { pruneResets(); } catch (e) { console.warn('[finmate] dọn vé đặt lại mật khẩu lỗi:', e.message); }
  let posted = 0; let interest = 0; let loi = 0;
  const ids = allUserIds();
  for (const id of ids) {
    // Sổ của một người hỏng thì chỉ người đó không được tự động hoá lần này —
    // không được để nó chặn những người còn lại.
    try {
      withLedger(id, () => {
        const r = runAutomation();
        posted += r.posted.length;
        interest += r.interest.length;
      });
    } catch (e) {
      loi += 1;
      console.error(`[finmate] tự động hoá lỗi ở sổ #${id}:`, e.message);
    }
  }
  console.log(`[finmate] tự động hoá ${nhan}: ${ids.length} sổ, ${posted} giao dịch định kỳ, ${interest} bút toán lãi${loi ? `, ${loi} sổ lỗi` : ''}`);
}

tuDongHoa('khởi động');
// Lời chào mở đầu: bản một sổ chào ngay, bản nhiều người dùng chào từng người
// lúc sổ của họ được tạo (xem services/ledgers.js).
if (!multiUser()) ensureWelcome();

// Chạy lại mỗi giờ.
setInterval(() => {
  try {
    tuDongHoa('định kỳ');
  } catch (e) {
    console.error('[finmate] lỗi tự động hoá', e.message);
  }
}, 60 * 60 * 1000).unref?.();

const srv = app.listen(PORT, HOST, () => {
  console.log(`[finmate] server chạy tại http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    for (const ip of ips) console.log(`[finmate] truy cập từ điện thoại cùng wifi: http://${ip}:${PORT}`);
    if (!pinIsSet()) console.warn('[finmate] ⚠ CẢNH BÁO: đang mở ra mạng LAN mà chưa đặt mã PIN. Hãy đặt PIN trong tab Cài đặt.');
  }
});

// Tắt êm: đóng mọi sổ để SQLite gộp nốt file -wal vào file chính trước khi
// tiến trình biến mất. Nền tảng nào cũng gửi SIGTERM rồi mới cưỡng bức giết
// sau ít giây, nên đây là khoảng thời gian duy nhất còn kịp dọn sạch; không
// dọn thì lần khởi động sau phải phục hồi từ WAL và một bản sao lưu chép
// đúng lúc đó sẽ thiếu phần còn nằm trong WAL.
let dangTat = false;
function tatEm(sig) {
  if (dangTat) return;   // SIGTERM rồi SIGINT thì cũng chỉ dọn một lần
  dangTat = true;
  console.log(`[finmate] nhận ${sig}, đang đóng sổ…`);
  // Ngừng nhận request mới; các request đang dở vẫn chạy nốt.
  srv.close(() => {
    const n = closeAll();
    closeControl();
    closeMainDb();
    console.log(`[finmate] đã đóng ${n} sổ người dùng, tạm biệt`);
    process.exit(0);
  });
  // Kết nối keep-alive có thể giữ srv.close() treo vô hạn. Dữ liệu quan trọng
  // hơn vài request dở, nên hết giờ là đóng sổ và đi.
  setTimeout(() => {
    closeAll();
    closeControl();
    closeMainDb();
    console.warn('[finmate] hết giờ chờ, đóng sổ và thoát');
    process.exit(0);
  }, Number(process.env.FINMATE_SHUTDOWN_MS) || 8000).unref();
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => tatEm(sig));
