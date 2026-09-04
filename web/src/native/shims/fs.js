/** node:fs tối thiểu trên hệ tệp ảo — đủ cho sao lưu và bản chụp cứu hộ. */
import { vfs } from '../vfs.js';
const enoent = (op, p) => { const e = new Error(`ENOENT: no such file or directory, ${op} '${p}'`); e.code = 'ENOENT'; return e; };
const fs = {
  existsSync: (p) => vfs.exists(p),
  mkdirSync: () => undefined,
  readdirSync: (d) => vfs.list(d),
  statSync: (p) => vfs.stat(p),
  rmSync: (p, opts = {}) => { if (!vfs.exists(p) && !opts.force) throw enoent('rm', p); vfs.remove(p); },
  unlinkSync: (p) => { if (!vfs.exists(p)) throw enoent('unlink', p); vfs.remove(p); },
  readFileSync: (p, enc) => { const b = vfs.read(p); if (!b) throw enoent('open', p); return enc ? new TextDecoder().decode(b) : b; },
  writeFileSync: (p, data) => vfs.write(p, data),
  copyFileSync: (a, b) => { const d = vfs.read(a); if (!d) throw enoent('copyfile', a); vfs.write(b, new Uint8Array(d)); },
};
export default fs;
export const { existsSync, mkdirSync, readdirSync, statSync, rmSync, unlinkSync, readFileSync, writeFileSync, copyFileSync } = fs;
