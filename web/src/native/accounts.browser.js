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
