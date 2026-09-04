/** Bản máy chủ: không có engine nhúng. Giữ import tĩnh ổn định cho rollup. */
export const readEnv = () => ({});
export const writeEnv = () => {};
export const embedded = () => null;
export async function bootEmbedded() { throw new Error('Bản này chạy với máy chủ, không có engine nhúng'); }
