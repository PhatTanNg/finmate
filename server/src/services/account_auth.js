/**
 * Cổng vào cho chế độ nhiều người dùng.
 *
 * Mỗi request được chạy TRONG ngữ cảnh sổ của chính người gửi, nên toàn bộ
 * mã nghiệp vụ phía sau (651 lời gọi truy vấn, 74 công cụ AI) không biết và
 * không cần biết là app đang phục vụ bao nhiêu người — chúng chỉ thấy "sổ".
 *
 * Không bật FINMATE_MULTIUSER thì middleware này đứng ngoài hoàn toàn: app
 * chạy y như cũ, một sổ, khoá bằng PIN, dùng được offline trên điện thoại.
 */
import { runInCtx } from '../db_context.js';
import { multiUser, userForToken } from './accounts.js';
import { ledgerFor } from './ledgers.js';

/** Những đường không cần đăng nhập. */
const OPEN = [
  /^\/health$/,
  // Quên mật khẩu thì đương nhiên chưa đăng nhập được — hai đường này phải mở.
  /^\/account\/(register|login|forgot|reset)$/,
];

const tokenOf = (req) =>
  req.get?.('x-finmate-key')
  || (req.get?.('authorization') || '').replace(/^Bearer\s+/i, '')
  || req.query?.key;

export function requireAccount(req, res, next) {
  if (!multiUser()) return next();
  if (OPEN.some((re) => re.test(req.path))) {
    // /health vẫn nhận diện người gửi nếu có token hợp lệ (không có thì thôi).
    // Giao diện hỏi /health lúc mở trang để biết còn đăng nhập hay không —
    // không trả lời câu đó thì mỗi lần tải lại trang là bị đá về màn đăng nhập
    // dù token trong máy vẫn còn tốt.
    const ai = userForToken(tokenOf(req));
    if (ai) req.user = ai;
    return next();
  }

  const user = userForToken(tokenOf(req));
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Cần đăng nhập', locked: true, need_login: true });
  }
  req.user = user;
  // Cả phần còn lại của request — kể cả các chặng async — chạy trong ngữ cảnh
  // sổ của người này. Đây là chỗ duy nhất quyết định "sổ nào", nên không có
  // đường nào để một truy vấn lạc sang sổ người khác.
  return runInCtx(ledgerFor(user.id), () => next());
}
