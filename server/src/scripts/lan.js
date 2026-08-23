/** Chạy server cho cả mạng LAN (để dùng từ điện thoại). Hoạt động trên mọi HĐH. */
process.env.FINMATE_HOST = process.env.FINMATE_HOST || '0.0.0.0';
await import('../index.js');
