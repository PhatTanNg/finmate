/**
 * Bản chạy thẳng trên máy KHÔNG có sổ của người khác để đồng bộ: chính nó là
 * sổ gốc. Việc gửi sổ lên tài khoản do màn "Đồng bộ" trong Cài đặt lo, gọi
 * thẳng ra máy chủ bằng fetch chứ không đi qua router trong tiến trình này.
 *
 * Có bản thay thế này để node:sqlite (và cả tầng sổ nhiều người dùng) không bị
 * kéo vào gói cho trình duyệt.
 */
const khong = () => { throw new Error('Bản chạy trên máy không có tầng đồng bộ nhiều người dùng'); };

export const rev = () => 0;
export const bumpRev = () => 0;
export const deviceOwned = () => false;
export const syncInfo = () => ({ rev: 0, at: null, device: null, owner: 'device' });
export const checkLedgerBytes = khong;
export const backupBeforeReplace = () => null;
export const replaceLedger = khong;
