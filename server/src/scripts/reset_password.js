/**
 * Đặt lại mật khẩu bằng tay, từ chính máy chủ.
 *
 * Đây là đường luôn dùng được, kể cả khi máy chủ chưa gắn dịch vụ gửi thư —
 * và cũng là đường cứu khi chính chủ máy chủ quên mật khẩu của mình.
 *
 *   node server/src/scripts/reset_password.js --list
 *   node server/src/scripts/reset_password.js --email ban@example.com
 *   node server/src/scripts/reset_password.js --email ban@example.com --password "mat khau moi"
 *
 * Trên Fly:
 *   fly ssh console -C "node server/src/scripts/reset_password.js --email ban@example.com"
 *
 * Không kèm --password thì script phát một VÉ và in ra đường dẫn đặt lại: chủ
 * máy chủ chuyển đường dẫn đó cho người dùng, người dùng tự gõ mật khẩu mới.
 * Cách này tốt hơn là tự đặt hộ rồi nhắn mật khẩu qua chat.
 */
import '../env.js';
import { multiUser, startReset, resetWithToken, allUserIds, countUsers } from '../services/accounts.js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (ten) => {
  const i = args.indexOf(`--${ten}`);
  return i >= 0 ? args[i + 1] : null;
};
const co = (ten) => args.includes(`--${ten}`);

if (!multiUser()) {
  console.error('Máy chủ này chạy chế độ MỘT SỔ (không bật FINMATE_MULTIUSER) nên không có tài khoản nào.');
  console.error('Quên mã PIN thì xoá dòng app_pin trong bảng settings của file dữ liệu, hoặc tắt khoá trong Cài đặt.');
  process.exit(1);
}

// Đọc danh sách trực tiếp từ sổ danh bạ: script này chạy trên máy chủ, cùng
// quyền với chính app, nên không cần cửa API nào.
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FINMATE_DATA_DIR || path.resolve(here, '..', '..', 'data');
const ctl = new DatabaseSync(path.join(DATA_DIR, 'finmate-accounts.db'), { readOnly: true });
const users = ctl.prepare('SELECT id, email, name, created_at, last_seen FROM users ORDER BY id').all();
ctl.close();

if (co('list') || !arg('email')) {
  console.log(`\n${countUsers()} tài khoản trên máy chủ này (${allUserIds().length} sổ):\n`);
  for (const u of users) {
    console.log(`  #${u.id}  ${u.email}${u.name ? `  (${u.name})` : ''}  — tạo ${u.created_at}${u.last_seen ? `, vào lần cuối ${u.last_seen}` : ''}`);
  }
  if (!arg('email')) {
    console.log('\nĐặt lại mật khẩu cho một người:');
    console.log('  node server/src/scripts/reset_password.js --email <email>              # phát đường dẫn để họ tự đặt');
    console.log('  node server/src/scripts/reset_password.js --email <email> --password "..."  # đặt thẳng luôn\n');
  }
  process.exit(0);
}

const email = arg('email');
const matKhau = arg('password');

const ve = startReset(email, { boQuaChoNghi: true });
if (!ve) {
  // startReset trả null cả khi email không tồn tại lẫn khi vừa phát vé xong —
  // ở đây là chủ máy chủ chứ không phải người lạ nên nói rõ được.
  console.error(`Không có tài khoản nào dùng email ${email}. Chạy --list để xem danh sách.`);
  process.exit(1);
}

if (matKhau) {
  const u = resetWithToken(ve.token, matKhau);
  console.log(`\n✅ Đã đặt mật khẩu mới cho ${u.email}. Mọi thiết bị đã bị đăng xuất.`);
  console.log('   Bảo họ đổi lại mật khẩu trong app sau khi đăng nhập — mật khẩu này bạn cũng biết.\n');
} else {
  const base = (process.env.FINMATE_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
  console.log(`\n✅ Vé đặt lại cho ${ve.user.email}, dùng được MỘT LẦN, hết hạn sau ${ve.minutes} phút:\n`);
  console.log(`   ${base}/#reset=${ve.token}\n`);
  console.log('   (đặt FINMATE_PUBLIC_URL nếu địa chỉ trên chưa đúng tên miền thật)\n');
}
