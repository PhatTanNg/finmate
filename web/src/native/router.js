/**
 * Bộ điều phối thay cho HTTP: giao diện gọi `dispatch('POST', '/chat', body)`
 * và các handler của routes/api.js chạy ngay trong tiến trình, với req/res
 * giả đủ những gì chúng dùng (params, query, body, status/json, write cho SSE,
 * download cho file sao lưu).
 */
export function createRouter() {
  const routes = [];
  const add = (method) => (path, ...handlers) => {
    const keys = [];
    const pattern = String(path)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    routes.push({ method, path, keys, regex: new RegExp(`^${pattern}/?$`), handlers });
    return router;
  };
  const router = { get: add('GET'), post: add('POST'), patch: add('PATCH'), put: add('PUT'), delete: add('DELETE'), use: () => router, _routes: routes };
  return router;
}

const middlewares = [];
/** Middleware kiểu express (req, res, next) chạy trước mọi route — dùng cho khoá PIN. */
export function useMiddleware(fn) { middlewares.push(fn); }

let active = null;
export function mountRouter(r) { active = r; }

function parseSse(chunk, onEvent) {
  for (const block of String(chunk).split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const raw = /^data: (.+)$/m.exec(block)?.[1];
    if (!ev || !raw) continue;
    try { onEvent?.(ev, JSON.parse(raw)); } catch { /* bỏ qua khối hỏng */ }
  }
}

/**
 * @returns {Promise<{status:number, body:any, headers:object, file?:{name:string, bytes:Uint8Array}}>}
 */
export function dispatch(method, url, { body = undefined, headers = {}, onEvent = null, readFile = null } = {}) {
  if (!active) return Promise.reject(new Error('Router chưa được gắn'));
  const u = new URL(url, 'http://app.local');
  const path = u.pathname.replace(/^\/api/, '') || '/';
  const query = Object.fromEntries(u.searchParams.entries());
  const hdr = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const M = method.toUpperCase();

  return new Promise((resolve) => {
    let status = 200;
    const outHeaders = {};
    let done = false;
    let sseBuf = '';
    const finish = (payload) => { if (done) return; done = true; resolve({ status, headers: outHeaders, ...payload }); };

    const req = {
      method: M, url: u.pathname + u.search, path, originalUrl: u.pathname + u.search, query, params: {}, body, headers: hdr,
      get: (name) => hdr[String(name).toLowerCase()],
      ip: '127.0.0.1', protocol: 'app', hostname: 'app.local', socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      get writableEnded() { return done; },
      status(n) { status = n; return res; },
      setHeader(k, v) { outHeaders[String(k).toLowerCase()] = v; return res; },
      writeHead(n, h = {}) { status = n; Object.assign(outHeaders, Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))); return res; },
      flushHeaders() {},
      json(obj) { finish({ body: obj }); return res; },
      send(x) { finish({ body: x }); return res; },
      write(chunk) {
        sseBuf += String(chunk);
        const idx = sseBuf.lastIndexOf('\n\n');
        if (idx >= 0) { parseSse(sseBuf.slice(0, idx + 2), onEvent); sseBuf = sseBuf.slice(idx + 2); }
        return true;
      },
      end() { if (sseBuf) parseSse(sseBuf, onEvent); finish({ body: null }); },
      download(file, name, cb) {
        const bytes = readFile?.(file) || null;
        finish({ body: null, file: { name: name || String(file).split('/').pop(), bytes } });
        try { cb?.(); } catch { /* dọn file tạm lỗi thì thôi */ }
      },
    };

    const chain = [...middlewares];
    const route = active._routes.find((r) => r.method === M && r.regex.test(path));
    if (route) {
      const m = route.regex.exec(path);
      route.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
      chain.push(...route.handlers);
    } else {
      chain.push((rq, rs) => rs.status(404).json({ ok: false, error: `Không có đường ${M} ${path}` }));
    }

    let i = 0;
    const next = (err) => {
      if (done) return;
      if (err) { status = status >= 400 ? status : 500; return finish({ body: { ok: false, error: err.message || String(err) } }); }
      const fn = chain[i++];
      if (!fn) return finish({ body: { ok: false, error: 'Không có phản hồi' } });
      try {
        const r = fn(req, res, next);
        if (r && typeof r.then === 'function') r.then(() => { if (!done && i >= chain.length && fn.length < 3) finish({ body: { ok: false, error: 'Handler không trả lời' } }); }, next);
      } catch (e) { next(e); }
    };
    next();
  });
}
