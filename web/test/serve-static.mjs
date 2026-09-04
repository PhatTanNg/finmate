// Phục vụ web/dist tĩnh + chuyển tiếp /api sang API thật (giống lúc chạy production).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.E2E_ROOT || path.resolve(here, '..', 'dist');
const API = process.env.E2E_API || 'http://127.0.0.1:4001';
const PORT = Number(process.env.E2E_PORT) || 4200;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    const u = new URL(API + req.url);
    const p = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers); pr.pipe(res);
    });
    p.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: e.message })); });
    req.pipe(p);
    return;
  }
  let f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('dist trên http://127.0.0.1:' + PORT + ' -> API ' + API));
