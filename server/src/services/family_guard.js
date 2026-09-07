/**
 * Quyền theo vai, trong sổ chung của một nhà.
 *
 * Chặn ở tầng ĐƯỜNG DẪN, không lọc trong câu truy vấn. Lý do giống hệt lý do
 * mỗi người một file SQLite: lọc sâu nghĩa là rải mệnh đề WHERE vào 651 lời
 * gọi, và sót đúng một chỗ là rò dữ liệu tài chính của người khác. Một bảng
 * luật đọc hết trong một màn hình thì soi lại được; 651 chỗ thì không.
 *
 * Đổi lại, phải nói thẳng cái này KHÔNG làm được: nó chặn theo cửa, không
 * theo từng dòng. Con không mở được trang thu nhập, nhưng những khoản chi con
 * đọc được vẫn có thể để lộ ít nhiều. Đây là ranh giới cho lứa tuổi, không
 * phải bức tường chống một đứa 16 tuổi biết mở tab Network.
 *
 * Sổ RIÊNG không đi qua đây: ở đó ai cũng là chủ của chính mình.
 */

/**
 * Những cửa con KHÔNG mở được, bất kể phương thức.
 *
 * Chọn theo nguyên tắc: cái gì để lộ bức tranh tài chính của bố mẹ (lương, nợ,
 * đầu tư, tài sản, tổng tài sản ròng), và cái gì đổi được luật chơi của cả sổ
 * (cài đặt, khoá AI, sao lưu, đồng bộ, tự lái, xoá sạch).
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
