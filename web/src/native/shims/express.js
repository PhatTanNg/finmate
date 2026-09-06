/**
 * express giả: chỉ cần Router() để routes/api.js đăng ký được các đường; việc
 * gọi thực hiện ở ../router.js (dispatch) — không có HTTP, không có cổng.
 */
import { createRouter } from '../router.js';
const express = () => { throw new Error('express() không dùng trong bản điện thoại'); };
express.Router = createRouter;
express.json = () => (req, res, next) => next?.();
express.text = () => (req, res, next) => next?.();
// Đường nhận nguyên file .db chỉ có ở bản máy chủ; ở đây chỉ cần tồn tại để
// routes/api.js đăng ký được mà không nổ lúc nạp.
express.raw = () => (req, res, next) => next?.();
express.static = () => (req, res, next) => next?.();
export default express;
export const Router = createRouter;
