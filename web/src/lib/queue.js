/**
 * Hàng chờ gửi cho bản dùng máy chủ.
 *
 * Bản này đọc/ghi thẳng vào sổ trên máy chủ nên mất mạng là không ghi được.
 * Chuyện đó xảy ra đúng vào lúc hay cần ghi nhất: trong thang máy, dưới hầm
 * gửi xe, trên tàu điện. Nên thay vì báo lỗi rồi để người dùng gõ lại, app
 * giữ việc đó lại trong máy và tự gửi khi có sóng.
 *
 * Hai điều làm cho việc này an toàn:
 *   - Mỗi việc mang một MÃ RIÊNG gửi kèm. Gửi lại mà máy chủ đã nhận rồi thì
 *     nó trả lại câu trả lời cũ chứ không ghi thêm lần nữa (xem op_log ở máy
 *     chủ) — không có mã này thì mất sóng giữa chừng là thành hai khoản chi.
 *   - Gửi TUẦN TỰ theo đúng thứ tự đã xếp. Tạo tài khoản rồi mới ghi giao dịch
 *     vào tài khoản đó; gửi lộn xộn là hỏng.
 *
 * KHÔNG xếp hàng những việc mà câu trả lời mới là thứ có giá trị (chat với cố
 * vấn, đăng nhập): gửi lại sau vài tiếng thì câu trả lời chẳng còn nghĩa gì.
 */
const KHOA = 'finmate.queue';
const nghe = new Set();

/**
 * Việc đang chờ là của TÀI KHOẢN NÀO.
 *
 * Một máy có thể đăng nhập lần lượt hai người (máy nhà, máy công ty). Gửi việc
 * người này xếp vào sổ người đang đăng nhập là ghi nhầm sổ — chuyện tệ nhất mà
 * tầng này có thể gây ra. Nên mỗi việc mang theo tên chủ của nó, và chỉ được
 * gửi khi đúng người đó đang đăng nhập.
 */
let chuHienTai = 'local';
export const datChu = (v) => { chuHienTai = v || 'local'; };
export const chu = () => chuHienTai;

const doc = () => {
  try { return JSON.parse(localStorage.getItem(KHOA) || '[]') || []; } catch { return []; }
};
const ghi = (ds) => {
  try { localStorage.setItem(KHOA, JSON.stringify(ds)); } catch { /* riêng tư */ }
  for (const fn of nghe) { try { fn(ds); } catch { /* người nghe hỏng không được kéo theo */ } }
  return ds;
};

/**
 * Đường nào KHÔNG được xếp hàng khi mất mạng.
 *
 * Chỉ xếp hàng những việc GHI VÀO SỔ — thêm khoản chi, sửa tài khoản, đặt mục
 * tiêu. Những việc còn lại có chung một điểm: thứ có giá trị là CÂU TRẢ LỜI
 * ngay lúc đó (cố vấn trả lời, giá vừa cập nhật, đăng nhập), hoặc là quyết
 * định chỉ đúng vào thời điểm bấm (đồng ý một đề xuất, hoàn tác một việc AI
 * vừa làm). Gửi lại sau vài tiếng thì hoặc vô nghĩa, hoặc gây bất ngờ.
 */
const KHONG_XEP = [
  /^\/chat/, /^\/auth\//, /^\/account\//, /^\/backup\//,
  /^\/ai\//, /^\/admin\//, /^\/fx\//, /^\/prices\//, /^\/investments\/refresh-prices/,
];
export const xepDuoc = (method, p) =>
  method !== 'GET' && method !== 'HEAD' && !KHONG_XEP.some((re) => re.test(p));

export const danhSach = () => doc();
export const soViec = () => doc().filter((v) => !v.loi && (v.chu || 'local') === chuHienTai).length;
export const theoDoi = (fn) => { nghe.add(fn); return () => nghe.delete(fn); };

const maMoi = () => (globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/** Nhãn tiếng Việt cho một việc đang chờ, để người dùng biết mình đang chờ cái gì. */
export function nhan(v) {
  const ten = {
    '/transactions': 'giao dịch', '/accounts': 'tài khoản', '/goals': 'mục tiêu',
    '/budgets': 'ngân sách', '/funds': 'quỹ', '/debts': 'khoản nợ',
    '/income-streams': 'nguồn thu', '/recurring': 'khoản định kỳ', '/investments': 'đầu tư',
  };
  const goc = `/${String(v.path || '').split('/')[1] || ''}`;
  const viec = { POST: 'Thêm', PATCH: 'Sửa', PUT: 'Sửa', DELETE: 'Xoá' }[v.method] || v.method;
  return `${viec} ${ten[goc] || goc.replace('/', '')}`;
}

export function xepHang(method, path, body) {
  const ds = doc();
  // Bấm Lưu hai lần vì lần đầu "không thấy gì xảy ra" là phản xạ rất thường.
  // Xếp y hệt nhau hai lần thì lúc có mạng sẽ thành hai khoản chi thật, nên
  // việc trùng khít trong vài phút gần đây được coi là chính nó.
  const than = JSON.stringify(body ?? null);
  const trung = ds.find((v) => v.method === method && v.path === path && JSON.stringify(v.body ?? null) === than
    && Date.now() - new Date(v.at).getTime() < 5 * 60_000);
  if (trung) return trung;
  ds.push({ id: maMoi(), method, path, body: body ?? null, at: new Date().toISOString(), chu: chuHienTai });
  ghi(ds);
  return ds[ds.length - 1];
}

export const boViec = (id) => ghi(doc().filter((v) => v.id !== id));
export const boHet = () => ghi([]);

/**
 * Gửi hết hàng chờ, tuần tự.
 *
 * @param {(v: object) => Promise<any>} gui gửi một việc (kèm mã chống trùng)
 * @returns {Promise<{gui: number, loi: number, con: number}>}
 */
export async function guiHangCho(gui) {
  let daGui = 0; let hong = 0;
  for (const v of doc()) {
    if (v.loi) continue;                 // việc máy chủ đã từ chối: chờ người dùng xử lý
    // Việc của tài khoản khác: để yên tới khi chính người đó đăng nhập lại.
    if ((v.chu || 'local') !== chuHienTai) continue;
    try {
      await gui(v);
      ghi(doc().filter((x) => x.id !== v.id));
      daGui += 1;
    } catch (e) {
      if (e?.mat_mang) break;            // vẫn chưa có sóng: để nguyên hàng, lát nữa thử lại
      // Máy chủ trả lời hẳn hoi là "không được" (số tiền sai, tài khoản đã xoá…).
      // Gửi lại bao nhiêu lần cũng thế, nên giữ lại kèm lý do cho người dùng thấy.
      ghi(doc().map((x) => (x.id === v.id ? { ...x, loi: e?.message || 'Không gửi được' } : x)));
      hong += 1;
    }
  }
  return { gui: daGui, loi: hong, con: doc().length };
}
