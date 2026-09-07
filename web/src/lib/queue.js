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

/**
 * Và việc đó thuộc về SỔ NÀO.
 *
 * Gắn theo người thôi là chưa đủ từ khi một người mở được nhiều sổ. Ghi một
 * khoản ngoài chợ vào sổ NHÀ lúc mất mạng, về nhà đổi sang sổ RIÊNG rồi mới
 * có sóng — nếu việc trong hàng chờ không tự khai sổ của nó thì khoản đó rơi
 * vào sổ riêng, im lặng, và không ai phát hiện ra cho tới lúc đối chiếu số dư.
 *
 * Sổ được gửi kèm trong header từng request (x-finmate-ledger), nên máy chủ
 * ghi đúng chỗ bất kể lúc đó phiên đang mở sổ nào.
 */
let soHienTai = null;
export const datSo = (v) => { soHienTai = v || null; };
export const so = () => soHienTai;

/**
 * Khoá một trang trong kho đệm GET.
 *
 * Ở chung chỗ với hàng chờ vì cả hai trả lời đúng một câu: "cái này thuộc sổ
 * nào". Tách ra hai nơi là sớm muộn một bên được sửa còn bên kia thì không.
 *
 * Không có phần sổ trong khoá thì: mở /transactions ở sổ nhà, đổi về sổ riêng,
 * mất mạng — và giao dịch của cả nhà hiện ra như sổ riêng của mình. Chiều
 * ngược lại tệ hơn: khoản riêng tư hiện giữa màn hình sổ chung, trước mặt
 * người nhà. Cách ly vật lý ở máy chủ mà rò ở kho đệm trên máy thì vẫn là rò.
 */
export const khoaKho = (p) => `${soHienTai || '-'}|${p}`;

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
/**
 * Đếm việc đang chờ của SỔ ĐANG MỞ.
 *
 * Chỉ đếm sổ đang mở chứ không đếm tất: băng "3 việc đang chờ gửi" mà ba việc
 * đó thuộc một cuốn sổ khác thì vừa vô nghĩa vừa làm người ta hoảng.
 */
export const soViec = () => doc().filter(hopLe).length;
const hopLe = (v) => !v.loi && (v.chu || 'local') === chuHienTai && (v.so ?? null) === soHienTai;

/** Việc đang chờ của MỌI sổ, để chỗ nào cần thì nói "còn sổ khác cũng đang chờ". */
export const soViecTatCa = () => doc().filter((v) => !v.loi && (v.chu || 'local') === chuHienTai).length;
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
    && (v.so ?? null) === soHienTai
    && Date.now() - new Date(v.at).getTime() < 5 * 60_000);
  if (trung) return trung;
  ds.push({ id: maMoi(), method, path, body: body ?? null, at: new Date().toISOString(), chu: chuHienTai, so: soHienTai });
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
    // Nhưng việc của SỔ khác thì vẫn gửi — trông như thiếu sót, thật ra là cố
    // ý: mỗi việc tự khai sổ đích trong header, nên nó về đúng chỗ dù người
    // dùng đang mở sổ nào. Bắt phải mở đúng sổ mới gửi được thì một khoản ghi
    // ở sổ nhà có thể nằm kẹt hàng tuần chỉ vì người ta đang dùng sổ riêng.
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
