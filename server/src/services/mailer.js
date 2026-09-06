/**
 * Gửi email — chỉ dùng cho đúng một việc: gửi đường dẫn đặt lại mật khẩu.
 *
 * Vì sao gọi API HTTP chứ không nói SMTP: máy chủ nhỏ đặt trên nền tảng như
 * Fly gần như luôn bị chặn cổng 25/587 để chống spam, và thư gửi thẳng từ IP
 * lạ thì rơi vào hộp rác. Dịch vụ gửi thư lo phần đó. Ở đây chỉ có một lời gọi
 * fetch nên không kéo thêm thư viện nào vào máy chủ.
 *
 * Không cấu hình gì thì tính năng quên mật khẩu vẫn dùng được, chỉ là chủ máy
 * chủ phải tự phát vé bằng tay:
 *   fly ssh console -C "node server/src/scripts/reset_password.js --email ban@example.com"
 */

/** Địa chỉ người nhận thấy ở ô "From". Phải là tên miền đã xác minh với nhà cung cấp. */
const FROM = () => process.env.FINMATE_MAIL_FROM || 'FinMate <onboarding@resend.dev>';
const KEY = () => process.env.FINMATE_MAIL_KEY || '';
const URL_ = () => process.env.FINMATE_MAIL_URL || 'https://api.resend.com/emails';
const TIMEOUT = Number(process.env.FINMATE_MAIL_TIMEOUT_MS) || 15000;

/** Có gửi được thư hay không. Giao diện hỏi để biết nên hiện gì ở màn quên mật khẩu. */
export const mailEnabled = () => Boolean(KEY());

/**
 * Gửi một lá thư. Ném lỗi kèm nguyên văn lời nhà cung cấp nói — sai khoá hay
 * chưa xác minh tên miền là hai lỗi hay gặp nhất và chỉ đọc thông điệp gốc mới
 * biết đường sửa.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) throw new Error('Máy chủ chưa cấu hình gửi email (FINMATE_MAIL_KEY)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(URL_(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to], subject, text, ...(html ? { html } : {}) }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const loi = body?.message || body?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Nhà cung cấp email từ chối: ${loi}`);
    }
    return { sent: true, id: body?.id || null };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Gửi email quá lâu, đã bỏ cuộc');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Nội dung thư đặt lại mật khẩu. Tách riêng để bộ kiểm soi được từng phần. */
export function resetMail({ link, minutes, name }) {
  const xung = name ? `Chào ${name},` : 'Chào bạn,';
  const text = [
    xung,
    '',
    'Có người vừa yêu cầu đặt lại mật khẩu FinMate cho email này. Nếu là bạn, mở đường dẫn dưới đây:',
    '',
    link,
    '',
    `Đường dẫn dùng được MỘT LẦN và hết hạn sau ${minutes} phút.`,
    'Nếu không phải bạn thì bỏ qua thư này — mật khẩu hiện tại vẫn nguyên vẹn.',
    '',
    'Lưu ý: đặt lại mật khẩu sẽ đăng xuất FinMate trên mọi thiết bị. Sổ sách của bạn không mất gì cả.',
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>${xung}</p>
  <p>Có người vừa yêu cầu đặt lại mật khẩu FinMate cho email này. Nếu là bạn, bấm nút dưới đây:</p>
  <p><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px">Đặt mật khẩu mới</a></p>
  <p style="color:#666;font-size:13px">Hoặc chép đường dẫn này: <br>${link}</p>
  <p>Đường dẫn dùng được <b>một lần</b> và hết hạn sau <b>${minutes} phút</b>.<br>
  Nếu không phải bạn thì bỏ qua thư này — mật khẩu hiện tại vẫn nguyên vẹn.</p>
  <p style="color:#666;font-size:13px">Đặt lại mật khẩu sẽ đăng xuất FinMate trên mọi thiết bị. Sổ sách của bạn không mất gì cả.</p>
</div>`;
  return { subject: 'Đặt lại mật khẩu FinMate', text, html };
}
