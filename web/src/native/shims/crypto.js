/**
 * node:crypto tối thiểu: randomBytes, scryptSync (cùng tham số mặc định của
 * Node: N=16384, r=8, p=1 — nên mã PIN đặt trên máy chủ và trên điện thoại
 * băm ra giống nhau), timingSafeEqual, createHash('sha1').
 */
import scryptPkg from 'scrypt-js';
const { syncScrypt } = scryptPkg;
import { sha1Hex } from '../sha1.js';

const HEX = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const B64URL = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromHex = (h) => new Uint8Array((h.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));

/** Uint8Array biết toString(encoding) như Buffer. */
export class Bytes extends Uint8Array {
  toString(enc) {
    if (enc === 'hex') return HEX(this);
    if (enc === 'base64url') return B64URL(this);
    if (enc === 'base64') return btoa(String.fromCharCode(...this));
    return new TextDecoder().decode(this);
  }
  static from(x, enc) {
    if (x instanceof Uint8Array) return new Bytes(x);
    if (typeof x === 'string') {
      if (enc === 'hex') return new Bytes(fromHex(x));
      if (enc === 'base64' || enc === 'base64url') return new Bytes(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
      return new Bytes(new TextEncoder().encode(x));
    }
    return new Bytes(x);
  }
  static isBuffer(x) { return x instanceof Uint8Array; }
}

export function randomBytes(n) {
  const b = new Bytes(n);
  crypto.getRandomValues(b);
  return b;
}
export function scryptSync(password, salt, keylen, { N = 16384, r = 8, p = 1 } = {}) {
  const pw = typeof password === 'string' ? new TextEncoder().encode(password.normalize('NFKC')) : new Uint8Array(password);
  const sl = typeof salt === 'string' ? new TextEncoder().encode(salt.normalize('NFKC')) : new Uint8Array(salt);
  return new Bytes(syncScrypt(pw, sl, N, r, p, keylen));
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
export function createHash(alg) {
  if (!/^sha-?1$/i.test(alg)) throw new Error(`Chưa hỗ trợ ${alg} trên điện thoại`);
  let buf = '';
  return { update(s) { buf += String(s); return this; }, digest(enc) { const hex = sha1Hex(buf); return enc === 'hex' ? hex : Bytes.from(hex, 'hex'); } };
}
export default { randomBytes, scryptSync, timingSafeEqual, createHash };
