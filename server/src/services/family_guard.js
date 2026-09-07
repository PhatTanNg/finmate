/**
 * Quyền theo vai, trong sổ chung của một nhà.
 *
 * Chặn ở tầng ĐƯỜNG DẪN, không lọc trong câu truy vấn. Lý do giống hệt lý do
 * mỗi người một file SQLite: lọc sâu nghĩa là rải mệnh đề WHERE vào 651 lời
 * gọi, và sót đúng một chỗ là rò dữ liệu tài chính của người khác. Một bảng
 * luật đọc hết trong một màn hình thì soi lại được; 651 chỗ thì không.
 *
 * Chặn theo cửa có một giới hạn thật: nó không lọc theo từng DÒNG. Bản đầu
 * cho con làm thành viên sổ chung rồi chặn cửa, và con vẫn đọc được mọi khoản
 * chi của bố mẹ — nhìn hết chi tiêu thì cũng gần như biết hết. Bịt bằng bộ lọc
 * thì phải lọc trong listTransactions, listAccounts, budgets, funds, goals,
 * dashboard VÀ cả 74 công cụ AI; sót một chỗ là rò.
 *
 * Nên con không còn là thành viên sổ chung nữa: con giữ sổ RIÊNG của mình, bố
 * mẹ mở sổ đó bằng vai 'guardian' (xem bảng guardians). Cách ly quay lại là
 * VẬT LÝ. Tệp này còn hai việc: giới hạn người giám hộ trong sổ của con, và
 * giữ lớp chặn cũ cho vai 'child' nếu một sổ nào đó còn sót từ bản trước.
 *
 * Sổ riêng của CHÍNH MÌNH không đi qua đây: ở đó ai cũng là chủ.
 */

/**
 * Những cửa NGƯỜI GIÁM HỘ không mở được trong sổ RIÊNG của con.
 *
 * Bố mẹ xem được sổ con, đặt hạn mức, cấp tiền tiêu vặt. Nhưng sổ đó vẫn là
 * chỗ riêng của đứa trẻ, nên có mấy thứ không phải việc của người ngoài:
 * xoá lịch sử của nó, đổi khoá AI hay khoá PIN của nó, gửi cả cuốn sổ đè lên,
 * hay xoá sạch dữ liệu. Cho phép hết thì "giám hộ" thành "chiếm tài khoản".
 */
const CAM_GIAM_HO = [
  /^\/auth\//,                  // khoá PIN của chính đứa trẻ
  /^\/ai\/key/,                 // khoá API của nó
  /^\/account\/ledger/,         // tải/gửi cả cuốn sổ
  /^\/admin/,                   // xoá sạch, gộp trùng
  /^\/backup\/(run|download)/,
];

/**
 * Những cửa con KHÔNG mở được, bất kể phương thức.
 *
 * Chọn theo nguyên tắc: cái gì để lộ bức tranh tài chính của bố mẹ (lương, nợ,
 * đầu tư, tài sản, tổng tài sản ròng), và cái gì đổi được luật chơi của cả sổ
 * (cài đặt, khoá AI, sao lưu, đồng bộ, tự lái, xoá sạch).
 *
 * Danh sách này giờ là lớp phòng thân thứ hai chứ không còn là lớp duy nhất:
 * con không còn là thành viên sổ chung nữa (xem bảng guardians), nên đường
 * chính để con chạm vào tiền của bố mẹ đã bị cắt ở tầng file. Giữ lại vì một
 * sổ cũ có thể còn thành viên vai 'child' từ trước khi đổi thiết kế.
 */
const CAM_TRE = [
  /^\/income-streams/,          // lương và nguồn thu của bố mẹ
  /^\/debts/,                   // nợ, thẻ tín dụng
  /^\/investments/,
  /^\/properties/,
  /^\/networth/,
  /^\/forecast/, /^\/fire/, /^\/passive/,
  /^\/tax/,
  /^\/remittance/,
  /^\/settings/, /^\/currency\/base/,
  /^\/ai\/key/, /^\/ai\/autopilot/, /^\/ai\/review/, /^\/ai\/brief/,
  /^\/automation/,
  /^\/backup/, /^\/export/,
  /^\/admin/,
  /^\/auth\//,                  // PIN của cả sổ
  /^\/account\/ledger/,         // tải/gửi cả cuốn sổ
  /^\/reports\//,               // báo cáo tách thu — chi của cả nhà
  /^\/advisor/, /^\/insights/,
];

/** Đường thuộc về TÀI KHOẢN của chính người đó, không phải nội dung sổ. */
const RIENG_CUA_MINH = /^\/account\/(me|logout|logout-all|password|ledgers|switch|families)/;

const laDoc = (m) => m === 'GET' || m === 'HEAD' || m === 'OPTIONS';

const tuChoi = (res, ly_do) => res.status(403).json({ ok: false, error: ly_do, forbidden: true });

/**
 * Chặn theo vai. Đặt SAU requireAccount (cần req.ledger) và TRƯỚC mọi route.
 */
export function requireRole(req, res, next) {
  const vai = req.ledger?.role;
  // Không có ngữ cảnh sổ (chạy một sổ, hoặc đường mở như /health) thì không gác.
  if (!vai || vai === 'owner' || vai === 'adult') return next();

  if (RIENG_CUA_MINH.test(req.path)) return next();

  if (vai === 'viewer') {
    if (laDoc(req.method)) return next();
    return tuChoi(res, 'Bạn đang xem sổ này ở chế độ chỉ đọc, không ghi được gì.');
  }

  if (vai === 'guardian') {
    if (CAM_GIAM_HO.some((re) => re.test(req.path))) {
      return tuChoi(res, 'Đây là sổ riêng của con bạn — phần này bạn không đổi được. Bạn xem được sổ, đặt hạn mức và cấp tiền tiêu vặt.');
    }
    // Xoá thì không: lịch sử chi tiêu của đứa trẻ là của nó. Sửa và ghi vẫn
    // được, vì đặt hạn mức và cấp tiền tiêu vặt đều là ghi.
    if (req.method === 'DELETE') {
      return tuChoi(res, 'Bạn không xoá được mục nào trong sổ của con. Hãy để con tự xoá nếu cần.');
    }
    return next();
  }

  if (vai === 'child') {
    if (CAM_TRE.some((re) => re.test(req.path))) {
      return tuChoi(res, 'Phần này chỉ người lớn trong nhà xem được.');
    }
    // Xoá là thao tác không hoàn tác được từ phía người dùng thường; sửa và
    // ghi thì còn lần theo nhật ký và hoàn tác được.
    if (req.method === 'DELETE') {
      return tuChoi(res, 'Bạn không xoá được mục nào trong sổ chung. Nhờ bố mẹ nếu cần xoá.');
    }
    return next();
  }

  return tuChoi(res, 'Vai của bạn trong sổ này không cho làm việc đó.');
}

/** Dùng trong route: đòi đúng vai chủ sổ (mời người, đổi vai, xoá sổ). */
export const laChuSo = (req) => req.ledger?.role === 'owner';

/** Dùng trong route: người lớn (chủ hoặc adult). */
export const laNguoiLon = (req) => req.ledger?.role === 'owner' || req.ledger?.role === 'adult';
