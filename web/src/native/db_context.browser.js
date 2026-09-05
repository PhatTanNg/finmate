/**
 * Bản chạy ngay trên máy chỉ phục vụ ĐÚNG MỘT người: chủ của thiết bị đó.
 * Không có request, không có nhiều sổ song song, nên không cần tách ngữ cảnh —
 * và trình duyệt cũng không có node:async_hooks.
 */
export const currentCtx = () => null;
export const runInCtx = (ctx, fn) => fn();
