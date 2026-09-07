/**
 * Bản chạy ngay trên máy chỉ phục vụ ĐÚNG MỘT người: chủ của thiết bị đó.
 * Không có request, không có nhiều sổ song song, nên không cần tách ngữ cảnh —
 * và trình duyệt cũng không có node:async_hooks.
 */
export const currentCtx = () => null;
export const runInCtx = (ctx, fn) => fn();

// Chỉ một người dùng, và người đó là chủ của mọi thứ trong máy này: không có
// "ai ghi khoản này" để mà hỏi, và không có vai nào để mà giới hạn.
export const actorId = () => null;
export const vaiHienTai = () => null;
export const chiThayCuaMinh = () => false;
