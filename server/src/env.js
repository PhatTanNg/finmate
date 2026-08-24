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
const envFile = path.join(here, '..', '.env');

if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (e) {
    console.warn(`[finmate] không đọc được ${envFile}: ${e.message}`);
  }
}
