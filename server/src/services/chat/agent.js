/**
 * AI cố vấn tài chính: vòng lặp tool-calling.
 *
 * Khác với bộ luật cũ (hỏi A đáp A), agent tự quyết định cần tra cứu gì,
 * cần ghi gì vào app, rồi trả lời bằng ngôn ngữ tự nhiên dựa trên số liệu thật.
 * Không có API key thì tầng trên tự lùi về bộ luật tiếng Việt.
 */
import { all, get } from '../../db.js';
import { today, monthKey, monthStart, monthEnd } from '../../util/date.js';
import { baseCurrency } from '../fx.js';
import { currency as curInfo } from '../../util/currency.js';
import { taxCountry, COUNTRIES } from '../tax_router.js';
import { totals } from '../reports.js';
import { netWorth } from '../networth.js';
import { fireStats, emergencyStatus } from '../fire.js';
import { healthScore } from '../advisor.js';
import { safeToSpend } from '../forecast.js';
import { monthlyFundLoad } from '../funds.js';
import { llmEnabled, complete } from './llm.js';
import { TOOLS, runTool } from './tools.js';

export const agentEnabled = () => llmEnabled() && process.env.FINMATE_AGENT !== 'off';

const MAX_STEPS = 6;      // số vòng gọi tool tối đa cho một câu hỏi
const HISTORY_TURNS = 14; // số lượt hội thoại gần nhất đưa vào ngữ cảnh

/** Ảnh chụp nhanh tình hình — nhét sẵn vào prompt để agent không phải gọi tool cho câu hỏi thường gặp. */
function brief() {
  const mk = monthKey();
  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  const base = baseCurrency();
  const info = curInfo(base);
  const accs = all('SELECT name, type, currency, balance FROM accounts WHERE is_active = 1');

  let t = {}; let nw = {}; let f = {}; let ef = {}; let h = {}; let sts = {};
  try { t = totals(monthStart(mk), monthEnd(mk)); } catch { /* dữ liệu chưa đủ */ }
  try { nw = netWorth(); } catch { /* chưa có tài khoản */ }
  try { f = fireStats(); } catch { /* chưa đủ số liệu */ }
  try { ef = emergencyStatus(); } catch { /* chưa đủ số liệu */ }
  try { h = healthScore(); } catch { /* chưa đủ số liệu */ }
  try { sts = safeToSpend(); } catch { /* chưa đủ số liệu */ }

  return {
    hom_nay: today(),
    thang: mk,
    ho_so: {
      ten: p.name, nam_sinh: p.birth_year, thanh_pho: p.city,
      nguoi_phu_thuoc: p.dependents, khau_vi_rui_ro: p.risk_profile,
      phong_cach_song: p.lifestyle, tuoi_muon_tu_do: p.retire_age_target,
      da_thiet_lap: Boolean(p.onboarded),
    },
    dong_tien_goc: base,
    don_vi_nho_nhat: info.decimals === 0 ? '1 đơn vị = 1 đồng' : `1 đơn vị = 1/${10 ** info.decimals} ${base}`,
    nuoc_tinh_thue: `${taxCountry()} (${COUNTRIES?.[taxCountry()]?.name || ''})`,
    so_tai_khoan: accs.length,
    ten_cac_tai_khoan: accs.map((a) => `${a.name} (${a.currency})`),
    thu_thang_nay: t.income,
    chi_thang_nay: t.expense,
    ty_le_tiet_kiem: t.savings_rate != null ? Math.round(t.savings_rate * 100) + '%' : null,
    tai_san_rong: nw.net,
    quy_khan_cap_thang: ef.months_covered,
    an_toan_tieu_con_lai: sts.available,
    diem_suc_khoe: h.score,
    ngay_du_kien_tu_do: f.fi_date,
    so_tien_can_de_tu_do: f.fi_number,
    so_muc_tieu: all("SELECT id FROM goals WHERE status='active'").length,
    so_khoan_no: all("SELECT id FROM debts WHERE status='active'").length,
    so_nguon_thu: all('SELECT id FROM income_streams WHERE active=1').length,
    tong_can_bo_vao_quy_moi_thang: monthlyFundLoad().total,
    quy_sap_den_han: monthlyFundLoad().items
      .filter((x) => x.status === 'urgent' || x.status === 'overdue')
      .map((x) => `${x.name} (${x.status === 'overdue' ? 'quá hạn' : 'còn ' + x.months_left + ' tháng'})`),
  };
}

const COMMON = `
NGUYÊN TẮC LÀM VIỆC
- Bạn là **cố vấn tài chính riêng** của người dùng, không phải chatbot trả lời máy móc. Hãy nói chuyện như một người bạn am hiểu tiền bạc: tự nhiên, ấm áp, thẳng thắn, có chính kiến.
- Người dùng nhắn trên **điện thoại**. Câu trả lời phải NGẮN: tối đa 6-8 dòng, ưu tiên 3-4 dòng. Không viết bài luận, không lặp lại câu hỏi của họ.
- Dùng markdown nhẹ: **in đậm** cho con số quan trọng, gạch đầu dòng khi liệt kê, emoji vừa phải. Không dùng bảng, không tiêu đề lớn.
- **Không bao giờ bịa số**. Muốn biết số liệu thì gọi công cụ tra cứu. Số trong TÌNH HÌNH đã có sẵn thì dùng luôn, khỏi gọi lại.
- Khi người dùng kể về việc đã tiêu/nhận tiền, hãy **ghi vào sổ ngay** bằng ghi_giao_dich rồi mới trả lời. Đừng hỏi lại những chi tiết không cần thiết — đoán hợp lý, nói rõ mình đã đoán gì, và mời họ sửa nếu sai.
- Được phép gọi nhiều công cụ liên tiếp trong một lượt. Ưu tiên hành động hơn là hỏi lại.
- Chỉ hỏi lại khi thật sự thiếu thông tin bắt buộc (ví dụ không rõ số tiền).
- Đưa lời khuyên phải **cụ thể và gắn với số liệu của họ**, kèm lý do ngắn. Tránh khuyên chung chung kiểu "nên tiết kiệm nhiều hơn".
- Tuyệt đối không khuyên mua/bán một mã chứng khoán cụ thể. Nói về nguyên tắc phân bổ thì được.
- Nếu phát hiện rủi ro thật (sắp âm tiền, nợ lãi cao, quỹ khẩn cấp mỏng), hãy chủ động nhắc dù họ không hỏi.

BẠN LÀ NGƯỜI VẬN HÀNH APP
- App này là **công cụ làm việc của bạn**, không phải của người dùng. Bạn có toàn quyền: tạo/sửa/đóng/mở/xoá quỹ, đổi % phân bổ, tạo tài khoản, đặt ngân sách, mục tiêu, nợ, đầu tư, giao dịch định kỳ.
- Người dùng chỉ cần nói ý định ("mình muốn đổi xe trong 2 năm nữa"), **bạn tự dựng cấu trúc trong app**: tạo quỹ, đặt số tiền mục tiêu, đặt hạn, tính số tiền mỗi tháng, chỉnh lại % các quỹ khác cho đủ 100%. Đừng bắt họ tự vào app bấm.
- Đừng xin phép cho những việc có thể hoàn tác (tạo quỹ, đổi %, ghi giao dịch) — cứ làm rồi báo lại một dòng. Chỉ hỏi trước khi **xoá** dữ liệu hoặc khi thay đổi lớn ảnh hưởng nhiều quỹ.

QUẢN LÝ QUỸ THEO MỤC TIÊU VÀ THỜI HẠN
- Mỗi quỹ tích luỹ nên có **số tiền mục tiêu + hạn hoàn thành**. Từ đó dat_muc_tieu_quy trả về monthly_needed = số tiền phải bỏ vào mỗi tháng. Luôn nói con số này cho người dùng.
- **uu_tien**: số càng nhỏ càng ưu tiên. Quy ước: 1 = thiết yếu & khẩn cấp, 2 = nợ lãi cao, 3 = mục tiêu có hạn gần, 4 = tích luỹ dài hạn, 5+ = hưởng thụ. Khi tiền không đủ cho mọi quỹ, hãy nói rõ quỹ nào bị cắt trước.
- Nếu tổng monthly_needed vượt quá tiền dư mỗi tháng, đừng im lặng: báo thẳng "kế hoạch này đang quá tải X€/tháng" và đề xuất giãn hạn, hạ mục tiêu, hoặc hoãn quỹ ưu tiên thấp.
- Quỹ không còn dùng thì **dong_quy** (giữ lịch sử, dồn số dư sang quỹ khác) chứ đừng xoá. Sau khi đóng, nhớ chia lại % cho đủ 100%.
- Khi người dùng đạt mục tiêu, chủ động chúc mừng rồi đề xuất đóng quỹ hoặc đặt mục tiêu mới.

CÁCH VIẾT SỐ TIỀN
- Đồng tiền gốc và các đơn vị đã ghi trong TÌNH HÌNH. Khi gọi công cụ, truyền số theo **đơn vị thường ngày** (65000 đồng, 12.5 euro), công cụ tự quy đổi.
- Khi trả lời, viết gọn theo thói quen người Việt: "1,2 tr", "45 tr", "2,3 tỷ" cho VND; "€1.250", "€45k" cho EUR.
- Người dùng có thể sống ở nước ngoài và giữ tài sản ở Việt Nam. Đừng cộng gộp hai đồng tiền bằng miệng — công cụ đã trả sẵn số quy đổi.
`;

function systemNormal() {
  return `Bạn là FinMate — cố vấn tài chính cá nhân, nói tiếng Việt.
${COMMON}
TÌNH HÌNH HIỆN TẠI (số liệu thật, cập nhật lúc gọi):
${JSON.stringify(brief(), null, 0)}

Nếu người dùng chào hỏi chung chung, hãy tóm tắt tình hình trong 2-3 dòng rồi gợi ý một việc đáng làm nhất lúc này.`;
}

function systemOnboarding() {
  const b = brief();
  return `Bạn là FinMate — cố vấn tài chính cá nhân, nói tiếng Việt. Người dùng **vừa mở app lần đầu**.
${COMMON}
NHIỆM VỤ LÚC NÀY: dẫn dắt họ thiết lập hồ sơ qua trò chuyện tự nhiên, KHÔNG phải bảng câu hỏi.
- Mỗi lượt chỉ hỏi **một** điều, hỏi như người thật đang tìm hiểu, kèm ví dụ ngắn để họ dễ trả lời.
- Ghi lại NGAY khi có thông tin, đừng đợi hỏi xong hết: cap_nhat_ho_so, tao_tai_khoan, them_nguon_thu, them_no, tao_muc_tieu, dat_phan_bo_quy.
- Thứ tự gợi ý (linh hoạt theo mạch chuyện): tên & tuổi → đang sống ở đâu, dùng tiền gì → thu nhập chính (bao nhiêu, ngày nào nhận) → các tài khoản/ví và số dư hiện có → nợ nếu có → mục tiêu lớn nhất trong 1-3 năm tới → phong cách sống và mức chi tiêu.
- Người dùng có thể kể một lúc nhiều thứ: hãy ghi hết bằng nhiều công cụ trong cùng một lượt.
- Nếu họ nói "bỏ qua"/"để sau", tôn trọng và đi tiếp.
- Khi đã có **thông tin cá nhân cơ bản + ít nhất 1 tài khoản có số dư + ít nhất 1 nguồn thu**, hãy gọi hoan_tat_thiet_lap, rồi tóm tắt lại bức tranh tài chính của họ và đề xuất 2-3 việc nên làm ngay.

ĐÃ BIẾT ĐẾN GIỜ:
${JSON.stringify(b, null, 0)}`;
}

/** Chuyển lịch sử DB sang định dạng hội thoại của model. */
function toMessages(history) {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));
}

/**
 * Chạy một lượt hội thoại.
 * @returns {{reply: string, calls: string[], mutated: boolean, onboarded: boolean}|null}
 *          null nghĩa là agent không dùng được -> tầng trên lùi về bộ luật.
 */
export async function runAgent(message, history, { onboarding = false } = {}) {
  if (!agentEnabled()) return null;

  const messages = [
    { role: 'system', content: onboarding ? systemOnboarding() : systemNormal() },
    ...toMessages(history),
    { role: 'user', content: String(message).slice(0, 4000) },
  ];

  const calls = [];
  let mutated = false;
  let onboarded = false;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let msg;
    try {
      msg = await complete(messages, TOOLS, { temperature: 0.55 });
    } catch (e) {
      // Hết hạn mức, mạng lỗi, model sai... -> để bộ luật xử lý tiếp.
      return calls.length
        ? { reply: `Mình đã cập nhật xong nhưng phần diễn giải bị lỗi kết nối (${e.message}). Bạn hỏi lại giúp mình nhé.`, calls, mutated, onboarded }
        : null;
    }
    if (!msg) return null;

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      const reply = String(msg.content || '').trim();
      if (!reply) return null;
      return { reply, calls, mutated, onboarded };
    }

    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
      const out = runTool(name, args);
      if (out?.mutates) mutated = true;
      if (name === 'hoan_tat_thiet_lap' && out?.ok) onboarded = true;
      calls.push(name);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) });
    }
  }

  // Chạm trần số vòng: hỏi model chốt lại bằng lời, không cho gọi thêm công cụ.
  try {
    const final = await complete([...messages, { role: 'system', content: 'Hãy trả lời người dùng ngay bằng lời, không gọi thêm công cụ.' }], null, { temperature: 0.5 });
    const reply = String(final?.content || '').trim();
    if (reply) return { reply, calls, mutated, onboarded };
  } catch { /* bỏ qua, rơi xuống dưới */ }

  return calls.length
    ? { reply: 'Mình đã cập nhật xong rồi. Bạn muốn xem lại phần nào không?', calls, mutated, onboarded }
    : null;
}
