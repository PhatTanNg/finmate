/**
 * Bản chạy thẳng trên máy KHÔNG có tài khoản: không có máy chủ để giữ danh bạ
 * người dùng, và cũng không cần — máy này chỉ phục vụ đúng chủ của nó, sổ nằm
 * ngay trong máy. Mọi route /account/* vì thế trả 404 "máy chủ này chạy chế độ
 * một sổ", đúng như khi chạy server không bật FINMATE_MULTIUSER.
 *
 * Có bản thay thế này để node:sqlite không bị kéo vào gói cho trình duyệt.
 */
const khong = () => { throw new Error('Bản chạy trên máy không có tài khoản người dùng'); };

export const multiUser = () => false;
export const ledgerPath = khong;
export const register = khong;
export const verify = khong;
export const startSession = khong;
export const userForToken = () => null;
export const endSession = () => false;
export const endAllSessions = () => 0;
export const changePassword = khong;
export const signupCodeRequired = () => false;
export const startReset = () => null;
export const resetOwner = () => null;
export const resetWithToken = khong;
export const pruneResets = () => 0;
export const allUserIds = () => [];
// Bản chạy trên máy chỉ có một chủ, nên token webhook không cần tra ngược ai.
export const setIngestHash = () => {};
export const userByIngestToken = () => null;
export const closeControl = () => {};
export const countUsers = () => 0;
export const _resetForTests = () => {};

// ── Sổ chung, giám hộ, tiêu vặt ───────────────────────────────────────────
//
// Không có gì trong nhóm này chạy trên bản để trong máy: cả ba đều cần một
// máy chủ giữ danh bạ chung cho nhiều người. Vẫn phải khai đủ tên vì tầng
// dùng chung import chúng — thiếu một cái là cả gói không build được.
export const sessionForToken = () => null;
export const khoaCaNhan = (id) => `u${Number(id)}`;
export const khoaChung = (id) => `g${Number(id)}`;
export const laKhoaChung = () => false;
export const ledgerPathFor = khong;
export const VAI = ['owner'];
export const VAI_GIAM_HO = 'guardian';
// Máy này chỉ có một sổ và chủ của nó toàn quyền — trả 'owner' để tầng gác
// quyền đi thẳng qua, thay vì null (nghĩa là "không mở được sổ nào").
export const vaiTrongSo = () => 'owner';
export const soCuaNguoi = () => [];
export const taoSoChung = khong;
export const thanhVien = () => [];
export const taoLoiMoi = khong;
export const vaoSoBangMa = khong;
export const doiVai = khong;
export const goThanhVien = khong;
export const xoaSoChung = khong;
export const doiTenSo = khong;
export const doiSoDangMo = khong;
export const conCuaNguoi = () => [];
export const nguoiGiamHo = () => [];
export const themGiamHo = khong;
export const goGiamHo = khong;
export const soDanhBa = khong;
export const dsTieuVat = () => [];
export const datTieuVat = khong;
export const xoaTieuVat = () => false;
export const danhDauDaCap = () => false;
