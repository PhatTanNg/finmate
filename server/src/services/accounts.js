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
// Sổ chung để thư mục riêng, không trộn vào users/: tên file ở đó là id NGƯỜI
// dùng, nên một sổ chung nằm lẫn vào là sớm muộn có người đọc nhầm nó thành
// sổ riêng của ai đó.
const FAMILY_DIR = path.join(DATA_DIR, 'families');

/** Bật chế độ nhiều người dùng. Không bật thì app chạy y như cũ: một sổ, khoá bằng PIN. */
export const multiUser = () => /^(1|true|yes|on)$/i.test(String(process.env.FINMATE_MULTIUSER || ''));

const SESSION_DAYS = Number(process.env.FINMATE_SESSION_DAYS) || 30;

let ctl = null;
function control() {
  if (ctl) return ctl;
  fs.mkdirSync(USERS_DIR, { recursive: true });
  fs.mkdirSync(FAMILY_DIR, { recursive: true });
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

    -- ── Sổ chung của một nhà ────────────────────────────────────────────
    --
    -- Sổ RIÊNG không có hàng nào ở đây: nó luôn tồn tại, một-một với tài khoản,
    -- và đường dẫn suy ra thẳng từ id người dùng. Chỉ sổ chung mới cần một hàng,
    -- vì nó có tên, có chủ, và có nhiều người cùng mở.
    CREATE TABLE IF NOT EXISTS ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    -- Vai quyết định được làm gì. 'owner' là người tạo và không bao giờ được
    -- để trống — sổ không có chủ thì không ai mời hay gỡ được ai nữa.
    CREATE TABLE IF NOT EXISTS ledger_members (
      ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ledger_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_members_user ON ledger_members(user_id);
    -- Mã mời: lưu BĂM chứ không lưu mã, cùng lý do với mật khẩu và vé đặt lại.
    -- Ai đọc trộm được file này cũng không tự thêm mình vào sổ nhà người khác.
    CREATE TABLE IF NOT EXISTS ledger_invites (
      hash TEXT PRIMARY KEY,
      ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invites_ledger ON ledger_invites(ledger_id);
  `);
  // Băm token webhook của từng người, để một tin nhắn ngân hàng bắn vào
  // /api/ingest tìm được đúng sổ mà không cần mở lần lượt sổ của mọi người.
  // Lưu băm chứ không lưu token: sổ danh bạ rò ra ngoài cũng không ai đẩy được
  // giao dịch giả vào sổ người khác.
  try { ctl.exec('ALTER TABLE users ADD COLUMN ingest_hash TEXT'); } catch { /* đã có */ }
  ctl.exec('CREATE INDEX IF NOT EXISTS idx_users_ingest ON users(ingest_hash)');
  // Sổ đang mở của từng PHIÊN, không phải của từng người: điện thoại đang xem
  // sổ nhà mà máy tính vẫn xem sổ riêng là chuyện bình thường, và bắt cả hai
  // cùng một sổ thì đổi bên này là bên kia nhảy theo giữa chừng.
  // Trống = sổ riêng, nên mọi phiên đang có sẵn vẫn đúng sau khi nâng cấp.
  try { ctl.exec('ALTER TABLE sessions ADD COLUMN ledger_key TEXT'); } catch { /* đã có */ }
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

// ── Khoá sổ ────────────────────────────────────────────────────────────────
//
// Một chuỗi ngắn nói rõ ĐANG MỞ SỔ NÀO: 'u12' là sổ riêng của người #12,
// 'g3' là sổ chung #3. Trước đây chỗ nào cũng dùng thẳng userId, và điều đó
// ngầm khẳng định "một người = một sổ" — đúng cho tới khi có sổ chung.
//
// Dùng chuỗi chứ không phải số vì hai không gian id chồng lên nhau: người #3
// và sổ chung #3 cùng tồn tại, mà lẫn hai cái đó là mở nhầm sổ của nhà khác.
export const khoaCaNhan = (userId) => `u${Number(userId)}`;
export const khoaChung = (ledgerId) => `g${Number(ledgerId)}`;
export const laKhoaChung = (key) => /^g\d+$/.test(String(key || ''));
const soCuaKhoa = (key) => Number(String(key).slice(1));

/** Đường dẫn file sổ ứng với một khoá. Khoá hỏng thì ném, không đoán bừa. */
export function ledgerPathFor(key) {
  const k = String(key || '');
  if (/^u\d+$/.test(k)) return path.join(USERS_DIR, `${soCuaKhoa(k)}.db`);
  if (/^g\d+$/.test(k)) return path.join(FAMILY_DIR, `${soCuaKhoa(k)}.db`);
  throw new Error(`Khoá sổ không hợp lệ: ${k}`);
}

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

/**
 * Phiên của một token: người dùng + sổ họ đang mở trên CHÍNH thiết bị này.
 *
 * Trả về cả hai cùng lúc chứ không tách hai lần đọc: mỗi request đều cần cả
 * hai, và đọc rời thì có khoảng hở để sổ đổi giữa hai lần đọc.
 */
export function sessionForToken(token) {
  if (!token) return null;
  const c = control();
  const s = c.prepare('SELECT * FROM sessions WHERE token = ?').get(bamToken(token));
  if (!s) return null;
  if (Date.parse(s.expires_at) < Date.now()) {
    c.prepare('DELETE FROM sessions WHERE token = ?').run(bamToken(token));
    return null;
  }
  const user = publicUser(c.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id));
  if (!user) return null;
  return { user, ledgerKey: s.ledger_key || khoaCaNhan(user.id) };
}

/** Người dùng của một phiên, hoặc null nếu token sai/hết hạn. */
export function userForToken(token) {
  return sessionForToken(token)?.user || null;
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
  c.prepare('INSERT INTO resets (hash, user_id, expires_at) VALUES (?,?,?)').run(bamToken(token), u.id, het);
  return { token, expires_at: het, user: publicUser(u), minutes: phut };
}

/** Người dùng của một vé còn hiệu lực, hoặc null. Không tiêu vé. */
export function resetOwner(token) {
  if (!token) return null;
  const c = control();
  const r = c.prepare('SELECT * FROM resets WHERE hash = ?').get(bamToken(token));
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
  const h = bamToken(token);
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

// ── Cửa webhook của từng người ─────────────────────────────────────────────

/** Nhớ token webhook (dạng băm) của một người, để tra ngược khi có tin nhắn tới. */
export function setIngestHash(userId, token) {
  control().prepare('UPDATE users SET ingest_hash = ? WHERE id = ?')
    .run(token ? bamToken(token) : null, Number(userId));
}

/** Người dùng sở hữu token webhook này, hoặc null. */
export function userByIngestToken(token) {
  if (!token) return null;
  const u = control().prepare('SELECT * FROM users WHERE ingest_hash = ?').get(bamToken(token));
  return u ? publicUser(u) : null;
}

/** Id của mọi người dùng — để chạy tự động hoá trên sổ của từng người. */
export const allUserIds = () => control().prepare('SELECT id FROM users ORDER BY id').all().map((r) => Number(r.id));

/**
 * Đóng sổ danh bạ. Gọi lúc tắt máy chủ (để SQLite gộp nốt WAL) và trong test.
 * Lần gọi sau sẽ tự mở lại, nên đóng nhầm cũng không hỏng gì.
 */
// ── Sổ chung của một nhà ───────────────────────────────────────────────────
//
// Vai, từ nhiều quyền tới ít:
//   owner   người tạo sổ. Như adult, cộng thêm: mời/gỡ người, đổi vai, xoá sổ.
//   adult   đọc ghi xoá mọi thứ trong sổ. Vợ chồng ngang quyền nhau ở đây.
//   child   ghi được khoản chi của mình, xem được chi tiêu và ngân sách của
//           mình. Không xoá được gì, không vào phần thu nhập và cài đặt.
//   viewer  chỉ xem, không ghi gì.
//
// Quyền chặn ở tầng ROUTE (xem family_guard.js) chứ không lọc trong 651 câu
// truy vấn — lọc sâu như thế thì chỉ cần sót một mệnh đề WHERE là rò dữ liệu,
// đúng cái bẫy mà kiến trúc "mỗi sổ một file" sinh ra để tránh.
export const VAI = ['owner', 'adult', 'child', 'viewer'];
const vaiHopLe = (r) => VAI.includes(String(r));

export function taoSoChung(userId, name) {
  const ten = String(name ?? '').trim();
  if (!ten) throw new Error('Sổ chung cần một cái tên');
  if (ten.length > 60) throw new Error('Tên sổ dài quá (tối đa 60 ký tự)');
  const c = control();
  const res = c.prepare('INSERT INTO ledgers (name, owner_id) VALUES (?,?)').run(ten, Number(userId));
  const id = Number(res.lastInsertRowid);
  c.prepare('INSERT INTO ledger_members (ledger_id, user_id, role) VALUES (?,?,?)')
    .run(id, Number(userId), 'owner');
  return { id, key: khoaChung(id), name: ten, role: 'owner' };
}

/** Vai của một người trong một sổ, hoặc null nếu họ không phải thành viên. */
export function vaiTrongSo(key, userId) {
  const k = String(key || '');
  // Sổ riêng: chỉ chính chủ mở được, và luôn toàn quyền.
  if (/^u\d+$/.test(k)) return soCuaKhoa(k) === Number(userId) ? 'owner' : null;
  if (!laKhoaChung(k)) return null;
  const r = control().prepare('SELECT role FROM ledger_members WHERE ledger_id = ? AND user_id = ?')
    .get(soCuaKhoa(k), Number(userId));
  return r ? r.role : null;
}

/** Mọi sổ một người mở được: sổ riêng luôn đứng đầu, rồi tới các sổ chung. */
export function soCuaNguoi(userId) {
  const id = Number(userId);
  const chung = control().prepare(`
    SELECT l.id, l.name, l.owner_id, m.role,
           (SELECT COUNT(*) FROM ledger_members WHERE ledger_id = l.id) AS members
      FROM ledgers l JOIN ledger_members m ON m.ledger_id = l.id
     WHERE m.user_id = ? ORDER BY l.id`).all(id);
  return [
    { key: khoaCaNhan(id), kind: 'personal', name: 'Sổ riêng của tôi', role: 'owner', members: 1 },
    ...chung.map((l) => ({
      key: khoaChung(l.id), kind: 'family', id: Number(l.id), name: l.name,
      role: l.role, members: Number(l.members), owner: Number(l.owner_id) === id,
    })),
  ];
}

export function thanhVien(ledgerId) {
  return control().prepare(`
    SELECT u.id, u.name, u.email, m.role, m.joined_at
      FROM ledger_members m JOIN users u ON u.id = m.user_id
     WHERE m.ledger_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 WHEN 'child' THEN 2 ELSE 3 END, u.id`)
    .all(Number(ledgerId))
    .map((m) => ({ id: Number(m.id), name: m.name || null, email: m.email, role: m.role, joined_at: m.joined_at }));
}

const INVITE_PHUT = () => Number(process.env.FINMATE_INVITE_MINUTES) || 60 * 24 * 7;

/**
 * Mã mời dùng MỘT lần, có hạn. Trả về mã thật đúng một lần ở đây — về sau chỉ
 * còn băm trong sổ danh bạ, nên không ai (kể cả người quản trị) đọc lại được.
 */
export function taoLoiMoi(ledgerId, byUserId, role = 'adult') {
  if (!vaiHopLe(role) || role === 'owner') throw new Error('Vai không hợp lệ');
  const code = crypto.randomBytes(9).toString('base64url');   // 12 ký tự, đủ để không đoán ra
  const exp = new Date(Date.now() + INVITE_PHUT() * 60000).toISOString();
  control().prepare('INSERT INTO ledger_invites (hash, ledger_id, role, created_by, expires_at) VALUES (?,?,?,?,?)')
    .run(bamToken(code), Number(ledgerId), role, Number(byUserId), exp);
  return { code, role, expires_at: exp };
}

export function vaoSoBangMa(userId, code) {
  const c = control();
  const inv = c.prepare('SELECT * FROM ledger_invites WHERE hash = ?').get(bamToken(String(code ?? '')));
  // Cùng một câu trả lời cho mã sai, mã hết hạn và mã đã dùng: nói rõ cái nào
  // là chỉ cho người dò biết họ đoán gần đúng tới đâu.
  if (!inv || inv.used_at || Date.parse(inv.expires_at) < Date.now()) {
    throw new Error('Mã mời không dùng được (sai, đã dùng, hoặc đã hết hạn)');
  }
  const l = c.prepare('SELECT * FROM ledgers WHERE id = ?').get(inv.ledger_id);
  if (!l) throw new Error('Sổ này không còn nữa');
  const da = c.prepare('SELECT role FROM ledger_members WHERE ledger_id = ? AND user_id = ?')
    .get(inv.ledger_id, Number(userId));
  if (da) throw new Error('Bạn đã ở trong sổ này rồi');
  c.prepare('INSERT INTO ledger_members (ledger_id, user_id, role) VALUES (?,?,?)')
    .run(inv.ledger_id, Number(userId), inv.role);
  c.prepare("UPDATE ledger_invites SET used_at = datetime('now'), used_by = ? WHERE hash = ?")
    .run(Number(userId), inv.hash);
  return { key: khoaChung(inv.ledger_id), id: Number(inv.ledger_id), name: l.name, role: inv.role };
}

export function doiVai(ledgerId, userId, role) {
  if (!vaiHopLe(role) || role === 'owner') throw new Error('Vai không hợp lệ');
  const c = control();
  const l = c.prepare('SELECT owner_id FROM ledgers WHERE id = ?').get(Number(ledgerId));
  // Chủ sổ tự hạ vai mình xuống là sổ mất chủ: không còn ai mời hay gỡ được ai.
  if (l && Number(l.owner_id) === Number(userId)) throw new Error('Không đổi được vai của chủ sổ');
  return c.prepare('UPDATE ledger_members SET role = ? WHERE ledger_id = ? AND user_id = ?')
    .run(role, Number(ledgerId), Number(userId)).changes > 0;
}

export function goThanhVien(ledgerId, userId) {
  const c = control();
  const l = c.prepare('SELECT owner_id FROM ledgers WHERE id = ?').get(Number(ledgerId));
  if (l && Number(l.owner_id) === Number(userId)) throw new Error('Chủ sổ không gỡ được chính mình. Hãy xoá sổ nếu muốn dừng hẳn.');
  const n = c.prepare('DELETE FROM ledger_members WHERE ledger_id = ? AND user_id = ?')
    .run(Number(ledgerId), Number(userId)).changes;
  // Ai bị gỡ mà đang mở sổ đó thì đá về sổ riêng ngay, không đợi hết phiên.
  if (n) c.prepare('UPDATE sessions SET ledger_key = NULL WHERE user_id = ? AND ledger_key = ?')
    .run(Number(userId), khoaChung(ledgerId));
  return n > 0;
}

/** Xoá sổ chung. KHÔNG xoá file — dữ liệu tài chính không bao giờ bị xoá âm thầm. */
export function xoaSoChung(ledgerId) {
  const c = control();
  c.prepare('UPDATE sessions SET ledger_key = NULL WHERE ledger_key = ?').run(khoaChung(ledgerId));
  return c.prepare('DELETE FROM ledgers WHERE id = ?').run(Number(ledgerId)).changes > 0;
}

export function doiTenSo(ledgerId, name) {
  const ten = String(name ?? '').trim();
  if (!ten) throw new Error('Sổ chung cần một cái tên');
  return control().prepare('UPDATE ledgers SET name = ? WHERE id = ?').run(ten.slice(0, 60), Number(ledgerId)).changes > 0;
}

/** Đổi sổ đang mở của MỘT phiên. Không phải thành viên thì không đổi được. */
export function doiSoDangMo(token, key, userId) {
  if (!vaiTrongSo(key, userId)) throw new Error('Bạn không có quyền mở sổ này');
  const luu = /^u\d+$/.test(String(key)) ? null : String(key);
  return control().prepare('UPDATE sessions SET ledger_key = ? WHERE token = ?')
    .run(luu, bamToken(token)).changes > 0;
}

export function closeControl() {
  try { ctl?.close(); } catch { /* đã đóng hoặc đang bận */ }
  ctl = null;
}

/** Chỉ dùng cho test: đóng và quên sổ danh bạ. */
export const _resetForTests = closeControl;
