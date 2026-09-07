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
import {
  multiUser, userForToken, userByIngestToken, sessionForToken, vaiTrongSo, khoaCaNhan,
} from './accounts.js';
import { ledgerFor } from './ledgers.js';
import { bumpRev } from './sync.js';

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

/**
 * Cửa webhook: tin nhắn ngân hàng bắn vào bằng TOKEN, không phải bằng phiên.
 *
 * iOS Shortcuts trên điện thoại không giữ được mật khẩu tài khoản, nên đường
 * này nhận diện bằng token riêng của từng người. Không có nhánh này thì ở chế
 * độ nhiều người dùng, cửa /ingest bị đòi đăng nhập và tính năng tự động ghi
 * thu chi — thứ đáng giá nhất của app — chết hẳn.
 */
const laIngest = (req) => req.method === 'POST' && /^\/ingest\/?$/.test(req.path);
const tokenIngest = (req) => req.get?.('x-finmate-token') || req.query?.token;

export function requireAccount(req, res, next) {
  if (!multiUser()) return next();

  if (laIngest(req)) {
    const chu = userByIngestToken(tokenIngest(req));
    if (chu) {
      req.user = chu;
      // Tin nhắn ngân hàng luôn đổ vào sổ RIÊNG của chủ token, kể cả khi họ
      // đang mở sổ nhà trên điện thoại. Token gắn với người, không gắn với sổ
      // đang xem — và một cái webhook thì không có "đang xem" nào cả.
      const ctxIngest = ledgerFor(khoaCaNhan(chu.id));
      req.ledger = { key: ctxIngest.key, kind: 'personal', role: 'owner' };
      return runInCtx({ ...ctxIngest, actorId: chu.id }, () => next());
    }
    // Không có token đúng thì vẫn cho phiên đăng nhập bình thường đi tiếp
    // (giao diện tự thử nhập liệu qua đường này), nhưng không mở tự do.
  }

  if (OPEN.some((re) => re.test(req.path))) {
    // /health vẫn nhận diện người gửi nếu có token hợp lệ (không có thì thôi).
    // Giao diện hỏi /health lúc mở trang để biết còn đăng nhập hay không —
    // không trả lời câu đó thì mỗi lần tải lại trang là bị đá về màn đăng nhập
    // dù token trong máy vẫn còn tốt.
    //
    // Và phải trả lời cả câu "đang mở SỔ NÀO": giao diện vẽ nút đổi sổ, ẩn
    // phần mà vai này không mở được, và gắn tên người ghi lên từng giao dịch
    // — cả ba đều dựa vào câu trả lời này ngay từ lượt tải trang đầu tiên.
    const phienMo = sessionForToken(tokenOf(req));
    if (phienMo) {
      req.user = phienMo.user;
      // Tôn trọng header ở đây nữa: giao diện hỏi /health để biết đang ở sổ
      // nào và vai gì. Trả lời theo sổ của phiên trong khi client đang thao
      // tác trên sổ khác là vẽ sai cả màn hình.
      const xinMo = req.get?.('x-finmate-ledger') || null;
      const key0 = xinMo && vaiTrongSo(xinMo, phienMo.user.id) ? xinMo : phienMo.ledgerKey;
      const vaiMo = vaiTrongSo(key0, phienMo.user.id);
      const keyMo = vaiMo ? key0 : khoaCaNhan(phienMo.user.id);
      req.ledger = { key: keyMo, kind: keyMo.startsWith('g') ? 'family' : 'personal', role: vaiMo || 'owner' };
    }
    return next();
  }

  const phien = sessionForToken(tokenOf(req));
  if (!phien) {
    return res.status(401).json({ ok: false, error: 'Cần đăng nhập', locked: true, need_login: true });
  }
  const { user } = phien;
  req.user = user;

  // Sổ đích của CHÍNH request này.
  //
  // Ưu tiên header x-finmate-ledger hơn sổ đang mở của phiên, và đây không
  // phải chuyện tiện tay. Một việc ghi lúc mất mạng nằm trong hàng chờ hàng
  // giờ; trong lúc đó người dùng có thể đã đổi sang sổ khác. Nếu sổ đích lấy
  // từ phiên thì lúc có sóng lại, khoản chi ghi ngoài chợ cho sổ NHÀ sẽ lặng
  // lẽ rơi vào sổ RIÊNG. Bắt mỗi việc tự khai sổ của nó thì không còn khoảng
  // hở đó — và hai tab mở hai sổ khác nhau cũng hết đá nhau.
  //
  // Vẫn kiểm tư cách thành viên ở MỖI request: người vừa bị gỡ khỏi sổ nhà mà
  // còn giữ phiên cũ phải mất quyền ngay, không đợi tới khi đăng nhập lại.
  const xin = req.get?.('x-finmate-ledger') || null;
  let vai = xin ? vaiTrongSo(xin, user.id) : null;
  let key = vai ? xin : null;
  if (!key) {
    // Header sai/không có quyền thì KHÔNG âm thầm ghi vào sổ khác. Chỉ khi
    // không có header mới rơi về sổ của phiên.
    if (xin) {
      return res.status(403).json({
        ok: false, forbidden: true, wrong_ledger: true,
        error: 'Bạn không còn quyền ghi vào sổ này.',
      });
    }
    vai = vaiTrongSo(phien.ledgerKey, user.id);
    key = vai ? phien.ledgerKey : khoaCaNhan(user.id);
    if (!vai) vai = 'owner';   // rơi về sổ riêng, nơi ai cũng là chủ của chính mình
  }
  const ctx0 = ledgerFor(key);
  // Vai đi thẳng vào ngữ cảnh sổ, không chỉ nằm trên req: tầng truy vấn cần
  // nó để lọc dữ liệu con được thấy, mà tầng đó không nhìn thấy req.
  const ctx = { ...ctx0, actorId: user.id, role: vai };
  req.ledger = { key, kind: key.startsWith('g') ? 'family' : 'personal', role: vai };

  // Mỗi lần sổ đổi thì nhích số hiệu bản lên một. Thiết bị đang giữ sổ nhờ số
  // này mà biết máy chủ đã đổi kể từ lần mình tải về — không có nó thì lần gửi
  // sổ lên sau sẽ lặng lẽ xoá mất những gì vừa ghi qua giao diện web.
  //
  // Bỏ qua /account/*: đăng nhập, đổi mật khẩu hay chính việc gửi sổ lên đều
  // không phải thay đổi nội dung sổ (riêng việc gửi sổ lên đã tự đặt số hiệu).
  if (req.method !== 'GET' && req.method !== 'HEAD' && !/^\/account\b/.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      try { runInCtx(ctx, () => bumpRev()); } catch { /* sổ có thể vừa bị đóng */ }
    });
  }

  // Cả phần còn lại của request — kể cả các chặng async — chạy trong ngữ cảnh
  // sổ của người này. Đây là chỗ duy nhất quyết định "sổ nào", nên không có
  // đường nào để một truy vấn lạc sang sổ người khác.
  return runInCtx(ctx, () => next());
}
