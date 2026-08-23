import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { router, runAutomation } from './routes/api.js';
import { setting } from './db.js';
import { requireAuth, pinIsSet } from './services/auth.js';
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
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // app gọi cùng origin, curl, webhook
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(new Error('Origin không được phép'));
    },
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '2mb' }));

// Cho phép webhook gửi SMS thô dạng text/plain
app.use('/api', (req, res, next) => {
  if (typeof req.body === 'string') req.body = { text: req.body };
  const token = setting('ingest_token');
  if (token && req.path.startsWith('/ingest')) {
    const given = req.get('x-finmate-token') || req.query.token;
    if (given !== token) return res.status(401).json({ ok: false, error: 'token không hợp lệ' });
  }
  next();
});

app.use('/api', requireAuth);
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

const boot = runAutomation();
ensureWelcome();
console.log(`[finmate] tự động hoá khởi động: ${boot.posted.length} giao dịch định kỳ, ${boot.interest.length} bút toán lãi, ${boot.insights} cảnh báo`);

// Chạy lại engine mỗi giờ (đăng giao dịch định kỳ, tính lãi, snapshot, sinh cảnh báo)
setInterval(() => {
  try {
    const r = runAutomation();
    if (r.posted.length || r.interest.length) console.log('[finmate] tự động hoá:', r.posted.length, 'định kỳ,', r.interest.length, 'lãi');
  } catch (e) {
    console.error('[finmate] lỗi tự động hoá', e.message);
  }
}, 60 * 60 * 1000).unref?.();

app.listen(PORT, HOST, () => {
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
