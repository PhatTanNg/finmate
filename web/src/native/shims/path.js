/** node:path kiểu POSIX — chỉ những hàm app dùng. */
const norm = (p) => {
  const abs = p.startsWith('/');
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return (abs ? '/' : '') + out.join('/');
};
const path = {
  sep: '/',
  join: (...parts) => norm(parts.filter(Boolean).join('/')),
  resolve: (...parts) => { let acc = '/'; for (const p of parts) acc = p.startsWith('/') ? p : `${acc}/${p}`; return norm(acc); },
  dirname: (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); },
  basename: (p, ext) => { const b = norm(p).split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  extname: (p) => { const b = norm(p).split('/').pop() || ''; const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
};
export default path;
export const { join, resolve, dirname, basename, extname, sep } = path;
