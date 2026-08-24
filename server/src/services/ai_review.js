/**
 * Phiên rà soát chủ động.
 *
 * Không có phần này thì cố vấn chỉ là người ngồi im chờ được hỏi. Một cố vấn
 * thật tự mở hồ sơ ra xem định kỳ, phát hiện vấn đề trước khi bạn kịp nhận ra,
 * rồi chủ động nhắn cho bạn.
 *
 * Hai chế độ, do người dùng chọn:
 *   suggest (mặc định) — chỉ đọc dữ liệu, ghi nhớ và nhắn cho bạn.
 *   act                — được phép chỉnh những thứ hoàn tác được, và mọi thao
 *                        tác đều nằm trong nhật ký để bạn xem lại.
 */
import { all, get, insert, setting } from '../db.js';
import { today } from '../util/date.js';
import { runAgent, agentEnabled } from './chat/agent.js';

const LAST_KEY = 'last_ai_review';
const MODE_KEY = 'ai_review_mode';
const EVERY_KEY = 'ai_review_every_hours';

/** Công cụ cho phép ở chế độ chỉ gợi ý: đọc dữ liệu và ghi nhớ, không đụng tiền. */
const READ_ONLY = /^(liet_ke_|xem_|tinh_|tu_van_|ghi_nho$)/;

export function reviewConfig() {
  return {
    che_do: setting(MODE_KEY) || 'suggest',
    moi_bao_nhieu_gio: Number(setting(EVERY_KEY) || 24),
    lan_cuoi: setting(LAST_KEY) || null,
    dang_bat: setting(MODE_KEY) !== 'off',
  };
}

export function setReviewConfig({ che_do, moi_bao_nhieu_gio } = {}) {
  if (che_do && ['off', 'suggest', 'act'].includes(che_do)) setting(MODE_KEY, che_do);
  if (moi_bao_nhieu_gio) setting(EVERY_KEY, String(Math.max(1, Math.min(720, Number(moi_bao_nhieu_gio) || 24))));
  return reviewConfig();
}

function dueNow() {
  const cfg = reviewConfig();
  if (cfg.che_do === 'off') return false;
  if (!cfg.lan_cuoi) return true;
  const elapsed = (Date.now() - new Date(cfg.lan_cuoi).getTime()) / 36e5;
  return elapsed >= cfg.moi_bao_nhieu_gio;
}

const PROMPT = `Đây là phiên rà soát định kỳ, người dùng KHÔNG có mặt và sẽ đọc tin nhắn này sau.

Hãy tự mở hồ sơ tài chính ra xem như một cố vấn rà soát hồ sơ khách hàng:
- Phân bổ quỹ còn cân bằng không, quỹ nào trễ tiến độ so với hạn.
- Ngân sách danh mục nào sắp vượt hoặc đã vượt.
- Dòng tiền tháng này so với mọi tháng trước có gì bất thường.
- Nợ lãi cao còn tồn trong khi tiền nằm chết ở ví không sinh lời.
- Khoản định kỳ sắp tới có khiến số dư âm không.
- Có điều gì đáng ghi nhớ lâu dài mà bạn chưa ghi.

Sau khi xem xong, viết MỘT tin nhắn ngắn gửi người dùng:
- Chỉ nêu điều thật sự đáng chú ý. Nếu mọi thứ ổn, nói ngắn gọn là ổn và nêu một con số chứng minh.
- Tối đa 5 gạch đầu dòng, mỗi dòng một ý kèm con số thật.
- Kết bằng một đề xuất cụ thể mà người dùng có thể trả lời "ừ" là xong.
- Đây là tin nhắn đọc trên điện thoại: ngắn, không bảng biểu.`;

/**
 * Chạy một phiên rà soát. Trả về null nếu chưa tới hạn hoặc agent không dùng được
 * — khi đó bộ luật sinh cảnh báo vẫn chạy bình thường như trước.
 */
export async function runReview({ force = false } = {}) {
  const cfg = reviewConfig();
  if (cfg.che_do === 'off' && !force) return null;
  if (!force && !dueNow()) return null;
  if (!agentEnabled()) return null;

  const allow = cfg.che_do === 'act' ? null : READ_ONLY;
  let out;
  try {
    out = await runAgent(PROMPT, [], { source: 'review', allow });
  } catch (e) {
    console.warn('[finmate] phiên rà soát lỗi:', e.message);
    return null;
  }
  setting(LAST_KEY, new Date().toISOString());
  if (!out?.reply) return null;

  insert('chat_messages', {
    role: 'assistant',
    content: out.reply,
    intent: 'ai_review',
    data: JSON.stringify({ review: true, batch: out.batch, calls: out.calls, mode: cfg.che_do }),
  });

  return {
    ok: true,
    che_do: cfg.che_do,
    tin_nhan: out.reply,
    cong_cu_da_dung: out.calls,
    co_thay_doi_du_lieu: out.mutated,
    batch: out.batch,
    luc: new Date().toISOString(),
  };
}

/** Tóm tắt cho màn hình cài đặt: lần rà soát gần nhất nói gì. */
export function lastReview() {
  const m = get("SELECT * FROM chat_messages WHERE intent = 'ai_review' ORDER BY id DESC LIMIT 1");
  if (!m) return null;
  let data = {};
  try { data = JSON.parse(m.data || '{}'); } catch { /* bỏ qua */ }
  return { noi_dung: m.content, luc: m.created_at, batch: data.batch || null, cong_cu: data.calls || [] };
}

export function reviewHistory(limit = 10) {
  return all("SELECT content, created_at, data FROM chat_messages WHERE intent = 'ai_review' ORDER BY id DESC LIMIT ?", [limit])
    .map((m) => ({ noi_dung: m.content, luc: m.created_at }));
}

export const _internals = { dueNow, READ_ONLY, PROMPT, today };
