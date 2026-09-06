/**
 * Bảng giá model, để app nói được "tháng này bạn tốn khoảng bao nhiêu".
 *
 * Giá lấy từ tài liệu chính thức của Anthropic (bản ghi ngày 2026-06-24), tính
 * theo đô la trên MỘT TRIỆU token. Đây là giá của API hạng nhất của Anthropic;
 * gọi qua Bedrock/Vertex hay các nhà cung cấp khác thì giá khác.
 *
 * Cố ý KHÔNG đoán giá của nhà cung cấp mình không có bảng giá chắc chắn: model
 * lạ thì app hiện số token và nói thẳng là chưa quy ra tiền được, chứ không bịa
 * một con số để người dùng tưởng thật rồi lập kế hoạch chi tiêu theo nó.
 */
const BANG = {
  'claude-fable-5-1': { vao: 10, ra: 50 },
  'claude-fable-5': { vao: 10, ra: 50 },
  'claude-opus-5': { vao: 5, ra: 25 },
  'claude-opus-4-8': { vao: 5, ra: 25 },
  'claude-opus-4-7': { vao: 5, ra: 25 },
  'claude-opus-4-6': { vao: 5, ra: 25 },
  'claude-sonnet-5': { vao: 2, ra: 10 },
  'claude-sonnet-4-6': { vao: 3, ra: 15 },
  'claude-haiku-4-5': { vao: 1, ra: 5 },
};

/**
 * Đọc bộ đệm rẻ hơn hẳn token thường (khoảng 1/10), còn ghi vào bộ đệm đắt hơn
 * một chút (khoảng 1,25 lần) — đó chính là lý do prompt caching đáng bật.
 */
const HE_SO_DOC_DEM = 0.1;
const HE_SO_GHI_DEM = 1.25;

export const coGia = (model) => Boolean(BANG[String(model || '').trim()]);

/**
 * Ước tính tiền cho một mớ token. Trả null nếu không biết giá model — bên gọi
 * phải nói "chưa quy ra tiền được" chứ đừng hiện 0.
 */
export function uocTinh(model, { vao = 0, ra = 0, cache_doc = 0, cache_ghi = 0 } = {}) {
  const g = BANG[String(model || '').trim()];
  if (!g) return null;
  const usd = (vao * g.vao + cache_doc * g.vao * HE_SO_DOC_DEM + cache_ghi * g.vao * HE_SO_GHI_DEM + ra * g.ra) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** Giá niêm yết của một model, để giao diện so sánh khi người dùng đổi model. */
export const giaCua = (model) => BANG[String(model || '').trim()] || null;

/** Danh sách model có bảng giá, kèm giá — dùng cho gợi ý "rẻ hơn thì dùng gì". */
export const bangGia = () => Object.entries(BANG).map(([model, g]) => ({ model, ...g }));
