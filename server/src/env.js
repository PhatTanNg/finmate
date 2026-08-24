/**
 * Nạp biến môi trường từ `server/.env` nếu có.
 *
 * Phải chạy TRƯỚC mọi import khác: các module như `llm.js` hay `auth.js` đọc
 * `process.env` ngay lúc nạp module, nên nếu nạp .env sau chúng thì key có
 * trong file cũng như không.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Nạp cả .env ở gốc repo lẫn server/.env. Người ta đặt file này ở cả hai chỗ
// tuỳ thói quen; nạp thiếu một chỗ nghĩa là người dùng làm đúng hướng dẫn mà
// vẫn không thấy tác dụng, và chẳng có gì báo cho họ biết vì sao.
const candidates = [
  path.join(here, '..', '..', '.env'),
  path.join(here, '..', '.env'),
];

for (const envFile of candidates) {
  if (!fs.existsSync(envFile)) continue;
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn(`[finmate] không đọc được ${envFile}: ${e.message}`);
  }
}
