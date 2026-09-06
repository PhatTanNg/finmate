/**
 * Tài khoản người dùng: đăng ký, đăng nhập, phiên — và MỖI NGƯỜI MỘT SỔ RIÊNG.
 *
 * Vì sao mỗi người một file SQLite thay vì thêm cột user_id vào 27 bảng: mã
 * hiện có 651 lời gọi truy vấn trên 44 file. Thêm cột nghĩa là phải sửa đúng
 * cả 651 chỗ, và chỉ cần sót MỘT mệnh đề WHERE là người này đọc được sổ tài
 * chính của người kia. Tách file thì cách ly là vật lý: không câu SQL nào với
 * sang sổ người khác được, dù ai đó viết thiếu. Đổi lại, mỗi người vẫn "mang
 * sổ của mình đi" được — vẫn đúng một file .db như bản chạy trên máy.
 *
 * Sổ danh bạ (users, sessions) nằm riêng ở một file khác, không lẫn với sổ
 * tài chính của bất kỳ ai.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FINMATE_DATA_DIR || path.resolve(here, '..', '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

/** Bật chế độ nhiều người dùng. Không bật thì app chạy y như cũ: một sổ, khoá bằng PIN. */
export const multiUser = () => /^(1|true|yes|on)$/i.test(String(process.env.FINMATE_MULTIUSER || ''));

const SESSION_DAYS = Number(process.env.FINMATE_SESSION_DAYS) || 30;

let ctl = null;
function control() {
  if (ctl) return ctl;
  fs.mkdirSync(USERS_DIR, { recursive: true });
  ctl = new DatabaseSync(path.join(DATA_DIR, 'finmate-accounts.db'));
  ctl.exec('PRAGMA journal_mode = WAL;');
  ctl.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      pass TEXT NOT NULL,              -- salt:hash (scrypt)
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      device TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    -- Vé đặt lại mật khẩu. Chỉ lưu BĂM của vé, không lưu vé: ai đọc trộm được
    -- file này cũng không dùng nó để chiếm tài khoản người khác được.
    CREATE TABLE IF NOT EXISTS resets (
      hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_resets_user ON resets(user_id);
  `);
  return ctl;
}

/** Email dùng làm định danh: chuẩn hoá để "A@x.com" và "a@x.com " là một người. */
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const hashPass = (pass) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pass, salt, 64).toString('hex')}`;
};
const checkPass = (pass, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(String(pass ?? ''), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};

/** Đường dẫn sổ tài chính của một người. Tên file theo id, không theo email. */
export const ledgerPath = (userId) => path.join(USERS_DIR, `${Number(userId)}.db`);

const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name || null, created_at: u.created_at } : null);

/**
 * Mã mời. Máy chủ đặt công khai trên Internet thì cửa đăng ký là cửa duy nhất
 * ai cũng gọi được: không khoá thì người lạ tạo tài khoản thoải mái, mỗi tài
 * khoản đẻ thêm một file sổ và ăn hết dung lượng ổ đĩa. Đặt FINMATE_SIGNUP_CODE
 * là chỉ người biết mã mới đăng ký được — đủ cho một máy chủ dùng riêng trong
 * nhà. Không đặt thì cửa mở như cũ (chạy trong LAN, hoặc cố tình mở cho mọi người).
 */
export const signupCodeRequired = () => Boolean(process.env.FINMATE_SIGNUP_CODE);

/** Trần số tài khoản, để một máy chủ nhỏ không bị đăng ký tràn cho tới hết đĩa. */
const maxUsers = () => Number(process.env.FINMATE_MAX_USERS) || 0;

const codeOk = (given) => {
  const want = String(process.env.FINMATE_SIGNUP_CODE || '');
  if (!want) return true;
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(want);
  // So sánh hằng thời gian, và độ dài phải khớp trước — timingSafeEqual ném lỗi
  // nếu hai buffer khác độ dài.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function register({ email, password, name, code }) {
  if (!codeOk(code)) throw new Error('Mã mời không đúng');
  const mail = normEmail(email);
  if (!validEmail(mail)) throw new Error('Email không hợp lệ');
  const pass = String(password ?? '');
  if (pass.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự');
  const c = control();
  const tran = maxUsers();
  if (tran && c.prepare('SELECT COUNT(*) n FROM users').get().n >= tran) {
    throw new Error('Máy chủ này đã đủ số tài khoản cho phép');
  }
  if (c.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    throw new Error('Email này đã có tài khoản');
  }
  const res = c.prepare('INSERT INTO users (email, name, pass) VALUES (?,?,?)')
    .run(mail, String(name ?? '').trim() || null, hashPass(pass));
  const id = Number(res.lastInsertRowid);
  return publicUser(c.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function verify({ email, password }) {
  const c = control();
  const u = c.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email));
  // Vẫn băm một lần cả khi email không tồn tại: thời gian trả lời giống nhau
  // thì kẻ dò không đoán được email nào đã đăng ký.
  if (!u) { hashPass(String(password ?? '')); return null; }
  return checkPass(password, u.pass) ? publicUser(u) : null;
}

/**
 * Phiên đăng nhập cũng chỉ lưu BĂM, như mật khẩu và vé đặt lại.
 *
 * Token phiên là thứ dùng được ngay: ai cầm được nó thì vào thẳng sổ, không
 * cần mật khẩu. Lưu nguyên văn nghĩa là một bản sao lưu sổ danh bạ lọt ra
 * ngoài (hoặc một lỗi nào đó đọc được bảng này) là mọi phiên đang mở của mọi
 * người đều bị chiếm. Băm thì bảng đó vô dụng với người đọc trộm.
 */
const bamToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function startSession(userId, device = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  const c = control();
  c.prepare('INSERT INTO sessions (token, user_id, expires_at, device) VALUES (?,?,?,?)')
    .run(bamToken(token), Number(userId), exp, device ? String(device).slice(0, 120) : null);
  c.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(Number(userId));
  return { token, expires_at: exp };
}

/** Người dùng của một phiên, hoặc null nếu token sai/hết hạn. */
export function userForToken(token) {
  if (!token) return null;
  const c = control();
  const s = c.prepare('SELECT * FROM sessions WHERE token = ?').get(bamToken(token));
  if (!s) return null;
  if (Date.parse(s.expires_at) < Date.now()) {
    c.prepare('DELETE FROM sessions WHERE token = ?').run(bamToken(token));
    return null;
  }
  return publicUser(c.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id));
}

export function endSession(token) {
  if (!token) return false;
  return control().prepare('DELETE FROM sessions WHERE token = ?').run(bamToken(token)).changes > 0;
}

/** Đăng xuất khỏi MỌI thiết bị — dùng khi nghi lộ mật khẩu. */
export const endAllSessions = (userId) =>
  control().prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId)).changes;

export function changePassword(userId, { current, next }) {
  const c = control();
  const u = c.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!u || !checkPass(current, u.pass)) throw new Error('Mật khẩu hiện tại không đúng');
  if (String(next ?? '').length < 8) throw new Error('Mật khẩu mới phải có ít nhất 8 ký tự');
  c.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(next), Number(userId));
  endAllSessions(userId);   // đổi mật khẩu thì mọi thiết bị cũ phải đăng nhập lại
  return true;
}

export const countUsers = () => control().prepare('SELECT COUNT(*) c FROM users').get().c;

// ── Quên mật khẩu ──────────────────────────────────────────────────────────
//
// Vé đặt lại là một chuỗi ngẫu nhiên gửi tới email của chủ tài khoản. Ba luật
// làm nên toàn bộ độ an toàn của nó:
//   1. Chỉ lưu BĂM của vé trong sổ danh bạ (như mật khẩu). Đọc trộm file cũng
//      không chiếm được tài khoản ai.
//   2. Dùng một lần, và hết hạn nhanh.
//   3. Đặt lại xong thì mọi phiên đang mở đều bị đăng xuất — nếu ai đó đã lén
//      vào được tài khoản, việc chủ tài khoản đặt lại mật khẩu phải đá được
//      kẻ đó ra, không thì chức năng này thành vô nghĩa.
//
// Dữ liệu KHÔNG mất khi quên mật khẩu: sổ nằm ở file riêng theo id người dùng,
// mật khẩu chỉ là cửa vào chứ không phải chìa khoá mã hoá.

const resetMinutes = () => Number(process.env.FINMATE_RESET_MINUTES) || 60;
/** Không phát vé mới dồn dập cho cùng một người (bấm nhầm nút, hoặc bị chọc). */
const RESET_COOLDOWN_S = 60;

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/**
 * Phát vé đặt lại mật khẩu cho một email.
 *
 * Trả về null khi email không có tài khoản, hoặc vừa phát vé xong chưa lâu.
 * Bên gọi PHẢI trả lời người dùng y hệt nhau trong mọi trường hợp — nói
 * "email này không tồn tại" là biếu không cho người lạ danh sách ai đã đăng ký.
 */
export function startReset(email, { boQuaChoNghi = false } = {}) {
  const c = control();
  const u = c.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email));
  if (!u) return null;
  // Chủ máy chủ chạy lệnh tay thì không bắt chờ: quãng nghỉ này để chặn người
  // lạ chọc phá qua cửa API, chứ người đang ngồi trong máy chủ thì đã toàn quyền.
  const gan = boQuaChoNghi ? null : c.prepare(
    "SELECT created_at FROM resets WHERE user_id = ? AND created_at > datetime('now', ?) ORDER BY created_at DESC LIMIT 1"
  ).get(u.id, `-${RESET_COOLDOWN_S} seconds`);
  if (gan) return null;
  // Vé cũ chưa dùng của người này hết giá trị ngay khi có vé mới.
  c.prepare('DELETE FROM resets WHERE user_id = ? AND used_at IS NULL').run(u.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const phut = resetMinutes();
  const het = new Date(Date.now() + phut * 60_000).toISOString();
  c.prepare('INSERT INTO resets (hash, user_id, expires_at) VALUES (?,?,?)').run(hashToken(token), u.id, het);
  return { token, expires_at: het, user: publicUser(u), minutes: phut };
}

/** Người dùng của một vé còn hiệu lực, hoặc null. Không tiêu vé. */
export function resetOwner(token) {
  if (!token) return null;
  const c = control();
  const r = c.prepare('SELECT * FROM resets WHERE hash = ?').get(hashToken(token));
  if (!r || r.used_at || new Date(r.expires_at).getTime() < Date.now()) return null;
  return publicUser(c.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id));
}

/**
 * Tiêu vé và đặt mật khẩu mới. Ném lỗi nếu vé sai/hết hạn/đã dùng.
 * Đăng xuất mọi thiết bị, kể cả thiết bị đang cầm vé.
 */
export function resetWithToken(token, password) {
  const pass = String(password ?? '');
  if (pass.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự');
  const c = control();
  const h = hashToken(token);
  const r = c.prepare('SELECT * FROM resets WHERE hash = ?').get(h);
  if (!r || r.used_at || new Date(r.expires_at).getTime() < Date.now()) {
    throw new Error('Đường dẫn đặt lại mật khẩu đã hết hạn hoặc đã dùng rồi');
  }
  c.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(pass), r.user_id);
  c.prepare("UPDATE resets SET used_at = datetime('now') WHERE hash = ?").run(h);
  c.prepare('DELETE FROM resets WHERE user_id = ? AND used_at IS NULL').run(r.user_id);
  c.prepare('DELETE FROM sessions WHERE user_id = ?').run(r.user_id);
  return publicUser(c.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id));
}

/** Dọn vé đã hết hạn — gọi cùng lượt tự động hoá mỗi giờ. */
export const pruneResets = () =>
  Number(control().prepare("DELETE FROM resets WHERE expires_at < datetime('now', '-1 day')").run().changes || 0);

/** Id của mọi người dùng — để chạy tự động hoá trên sổ của từng người. */
export const allUserIds = () => control().prepare('SELECT id FROM users ORDER BY id').all().map((r) => Number(r.id));

/**
 * Đóng sổ danh bạ. Gọi lúc tắt máy chủ (để SQLite gộp nốt WAL) và trong test.
 * Lần gọi sau sẽ tự mở lại, nên đóng nhầm cũng không hỏng gì.
 */
export function closeControl() {
  try { ctl?.close(); } catch { /* đã đóng hoặc đang bận */ }
  ctl = null;
}

/** Chỉ dùng cho test: đóng và quên sổ danh bạ. */
export const _resetForTests = closeControl;
