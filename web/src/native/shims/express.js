/**
 * express giả: chỉ cần Router() để routes/api.js đăng ký được các đường; việc
 * gọi thực hiện ở ../router.js (dispatch) — không có HTTP, không có cổng.
 */
import { createRouter } from '../router.js';
const express = () => { throw new Error('express() không dùng trong bản điện thoại'); };
express.Router = createRouter;
express.json = () => (req, res, next) => next?.();
express.text = () => (req, res, next) => next?.();
express.static = () => (req, res, next) => next?.();
export default express;
export const Router = createRouter;
