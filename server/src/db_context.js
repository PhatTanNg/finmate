/**
 * Ngữ cảnh cơ sở dữ liệu theo từng request (chế độ nhiều người dùng).
 *
 * Mỗi người dùng có MỘT FILE SQLite riêng, không phải chung bảng có cột
 * user_id. Lý do: mã hiện có 651 lời gọi truy vấn trên 44 file và 27 bảng —
 * thêm cột user_id nghĩa là phải sửa đúng cả 651 chỗ, và sót một mệnh đề
 * WHERE là người này đọc được sổ tài chính của người kia. Tách file thì cách
 * ly là VẬT LÝ: không có câu SQL nào chạm sang sổ của người khác được, dù
 * lập trình viên có quên gì đi nữa.
 *
 * AsyncLocalStorage giữ sổ của request đang chạy, nên toàn bộ 651 lời gọi kia
 * không phải sửa một dòng nào — chúng vẫn gọi all/get/run như cũ.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** Ngữ cảnh của request đang chạy, hoặc null khi chạy một sổ duy nhất. */
export const currentCtx = () => store.getStore() || null;

/** Chạy `fn` với sổ của một người dùng cụ thể. */
export const runInCtx = (ctx, fn) => store.run(ctx, fn);

/**
 * Người đang thao tác, và vai của họ trong sổ đang mở.
 *
 * Khác `currentCtx().userId` — cái đó là CHỦ sổ. Trong sổ chung của một nhà,
 * chủ sổ và người đang gõ là hai người khác nhau.
 */
export const actorId = () => currentCtx()?.actorId ?? currentCtx()?.userId ?? null;
export const vaiHienTai = () => currentCtx()?.role || null;

/**
 * Vai này chỉ được thấy phần của CHÍNH MÌNH trong sổ chung.
 *
 * Chỉ đúng với 'child'. Chặn theo đường dẫn (family_guard) giữ con khỏi mở
 * trang thu nhập hay nợ, nhưng không ngăn được con đọc danh sách giao dịch
 * chung — mà nhìn hết mọi khoản chi của bố mẹ thì cũng gần như biết hết. Nên
 * chỗ này lọc thêm ở tầng truy vấn, và cố ý chỉ có ĐÚNG MỘT hàm quyết định.
 */
export const chiThayCuaMinh = () => currentCtx()?.role === 'child';
