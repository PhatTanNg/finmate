/**
 * Khoá ứng dụng bằng mã PIN. Dữ liệu tài chính là riêng tư nên mọi endpoint
 * đều phải có phiên hợp lệ, trừ:
 *  - /auth/*   : để đặt PIN và đăng nhập
 *  - /health   : để kiểm tra server sống
 *  - /ingest   : webhook nhận giao dịch từ điện thoại — KHÔNG mở tự do,
 *                phải kèm token bí mật (điện thoại không giữ được PIN).
 *                Các đường /ingest/preview, /ingest/csv, /ingest/log vẫn cần PIN.
 */
import crypto from 'node:crypto';
import { setting } from '../db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày
const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;

/** token phiên -> hạn dùng (mất khi restart, người dùng chỉ cần nhập lại PIN) */
const sessions = new Map();
const fails = new Map();

// Chỉ đúng POST /ingest được miễn PIN, và vẫn bị chặn bởi token webhook ở index.js.
const OPEN_PATHS = [/^\/auth\b/, /^\/health\b/, /^\/ingest\/?$/];

export const pinIsSet = () => Boolean(setting('app_pin'));

/**
 * Token bí mật cho webhook. Luôn tồn tại: sinh ngay lần gọi đầu tiên.
 * Nhờ vậy không bao giờ có cửa sổ thời gian mà /ingest mở toang cho cả mạng LAN.
 */
export function ingestToken() {
  let t = setting('ingest_token');
  if (!t) {
    t = crypto.randomBytes(24).toString('base64url');
    setting('ingest_token', t);
  }
  return t;
}

/** Đổi token webhook (khi nghi bị lộ). */
export function rotateIngestToken() {
  const t = crypto.randomBytes(24).toString('base64url');
  setting('ingest_token', t);
  return t;
}

export function setPin(pin) {
  const clean = String(pin ?? '').trim();
  if (clean.length < 4) throw new Error('Mã PIN phải có ít nhất 4 ký tự');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clean, salt, 64).toString('hex');
  setting('app_pin', `${salt}:${hash}`);
  ingestToken();
  sessions.clear();
  return true;
}

export function clearPin() {
  setting('app_pin', '');
  sessions.clear();
  return true;
}

export function verifyPin(pin) {
  const stored = setting('app_pin');
  if (!stored) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(String(pin ?? ''), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Chống dò PIN: khoá tạm sau nhiều lần sai liên tiếp. */
export function lockedFor(ip) {
  const f = fails.get(ip);
  if (!f || f.count < MAX_FAILS) return 0;
  const left = f.until - Date.now();
  if (left <= 0) {
    fails.delete(ip);
    return 0;
  }
  return left;
}

export function noteFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
  fails.set(ip, f);
}

export const noteSuccess = (ip) => fails.delete(ip);

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function destroySession(token) {
  return sessions.delete(token);
}

export function validSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

const tokenOf = (req) =>
  req.get('x-finmate-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.key;

/** Người dùng đang thao tác trong app (đã mở khoá), hay chưa hề đặt PIN. */
export const sessionOk = (req) => !pinIsSet() || validSession(tokenOf(req));

export function requireAuth(req, res, next) {
  if (!pinIsSet()) return next();
  if (OPEN_PATHS.some((re) => re.test(req.path))) return next();
  if (validSession(tokenOf(req))) return next();
  return res.status(401).json({ ok: false, error: 'Cần mở khoá bằng mã PIN', locked: true });
}
