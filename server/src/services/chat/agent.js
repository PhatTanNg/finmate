/**
 * AI cố vấn tài chính: vòng lặp tool-calling.
 *
 * Khác với bộ luật cũ (hỏi A đáp A), agent tự quyết định cần tra cứu gì,
 * cần ghi gì vào app, rồi trả lời bằng ngôn ngữ tự nhiên dựa trên số liệu thật.
 * Không có API key thì tầng trên tự lùi về bộ luật tiếng Việt.
 */
import { all, get, beginAudit, endAudit, abortAudit } from '../../db.js';
import { today, monthKey, monthStart, monthEnd } from '../../util/date.js';
import { baseCurrency } from '../fx.js';
import { currency as curInfo } from '../../util/currency.js';
import { taxCountry, COUNTRIES } from '../tax_router.js';
import { totals } from '../reports.js';
import { netWorth } from '../networth.js';
import { fireStats, emergencyStatus } from '../fire.js';
import { healthScore } from '../advisor.js';
import { safeToSpend } from '../forecast.js';
import { monthlyFundLoad, fundsOverview } from '../funds.js';
import { budgetStatus } from '../budgets.js';
import { portfolio } from '../investments.js';
import { upcoming } from '../recurring.js';
import { memoryBrief } from '../ai_memory.js';
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

  // Tài nguyên mà agent điều phối. Không có phần này thì agent phải đoán hoặc
  // gọi tool mò từng thứ, và sẽ không tự thấy được phân bổ đang lệch.
  let quy = []; let tongPct = 0; let canBang = true;
  try {
    const ov = fundsOverview();
    tongPct = ov.total_percent;
    canBang = ov.balanced;
    quy = ov.funds.filter((x) => !x.archived).map((x) => ({
      ten: x.name, phan_tram: x.percent, uu_tien: x.priority, so_du: x.balance,
      dong_tien: x.currency, muc_tieu: x.target_amount || null, han: x.target_date || null,
      can_moi_thang: x.plan?.monthly_needed || null, trang_thai: x.plan?.status || x.status,
    }));
  } catch { /* chưa có quỹ */ }

  let nganSach = [];
  try {
    nganSach = (budgetStatus().items || []).map((b) => ({
      danh_muc: b.name, han_muc: b.limit, da_tieu: b.spent, con_lai: b.remaining,
      dong_tien: b.currency, trang_thai: b.status,
    }));
  } catch { /* chưa đặt */ }

  let dauTu = null;
  try {
    const pf = portfolio();
    dauTu = { so_ma: pf.holdings?.length || 0, gia_tri: pf.total_value, lai_lo_chua_ban: pf.unrealized_pnl, co_tuc_du_kien: pf.projected_dividend };
  } catch { /* chưa có */ }

  let dinhKy = [];
  try { dinhKy = (upcoming(30) || []).slice(0, 8).map((r) => ({ ten: r.name, loai: r.type, so_tien: r.amount, ngay: r.date })); } catch { /* chưa có */ }

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
    vi_va_so_du: accs.map((a) => ({ ten: a.name, loai: a.type, dong_tien: a.currency, so_du: a.balance })),
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
    cac_quy: quy,
    tong_phan_tram_quy: tongPct,
    phan_bo_can_bang: canBang,
    ngan_sach: nganSach,
    dau_tu: dauTu,
    khoan_dinh_ky_30_ngay_toi: dinhKy,
    ghi_nho_lau_dai: memoryBrief() || undefined,
  };
}

const COMMON = `
NGUYÊN TẮC LÀM VIỆC
- Bạn là **cố vấn tài chính riêng** của người dùng, không phải chatbot trả lời máy móc. Hãy nói chuyện như một người bạn am hiểu tiền bạc: tự nhiên, ấm áp, thẳng thắn, có chính kiến.
- Người dùng nhắn trên **điện thoại**. Câu trả lời phải NGẮN: tối đa 6-8 dòng, ưu tiên 3-4 dòng. Không viết bài luận, không lặp lại câu hỏi của họ.
- Dùng markdown nhẹ: **in đậm** cho con số quan trọng, gạch đầu dòng khi liệt kê, emoji vừa phải. Không dùng bảng, không tiêu đề lớn.
- **Không bao giờ bịa số**. Muốn biết số liệu thì gọi công cụ tra cứu. Số trong TÌNH HÌNH đã có sẵn thì dùng luôn, khỏi gọi lại.
- **Không bao giờ nói suông là đã làm.** Chỉ được viết "đã ghi", "đã cập nhật", "đã tạo"… SAU KHI đã thực sự gọi công cụ tương ứng trong chính lượt này và nhận được kết quả ok. Các câu trả lời cũ trong lịch sử hội thoại có thể do bộ máy khác của app sinh ra — **đừng bắt chước định dạng của chúng để mô tả một việc bạn chưa làm**. Chưa làm được thì nói thẳng là chưa làm được.
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

TRÍ NHỚ VÀ TRÁCH NHIỆM GIẢI TRÌNH
- Hội thoại chỉ giữ 14 lượt gần nhất. Thứ gì cần nhớ lâu — hoàn cảnh gia đình, ràng buộc không được phá, khẩu vị rủi ro, quyết định đã chốt và lý do — hãy gọi **ghi_nho** ngay lúc nghe được. Đừng để tháng sau phải hỏi lại người dùng những điều họ đã kể.
- Phần **ghi_nho_lau_dai** trong TÌNH HÌNH là những gì bạn đã nhớ. Tôn trọng nó: đừng khuyên ngược lại ràng buộc người dùng đã đặt ra, và nếu buộc phải khuyên ngược thì nói rõ là bạn đang đề nghị thay đổi một điều đã chốt.
- Khi hoàn cảnh đổi khiến điều đã nhớ không còn đúng, gọi **ghi_nho** đè lên hoặc **quen_di**, đừng giữ thông tin cũ.
- Mọi thao tác của bạn đều được ghi nhật ký. Người dùng nói bạn làm sai thì gọi **hoan_tac** — nó trả lại cả số dư tài khoản, số dư quỹ và tiến độ mục tiêu, không chỉ xoá giao dịch. Dùng **xem_nhat_ky_thao_tac** khi cần xem lại mình đã làm gì.

ĐIỀU PHỐI TÀI NGUYÊN — BẠN CÓ SẴN BỨC TRANH TOÀN CẢNH
- Phần TÌNH HÌNH liệt kê sẵn **mọi tài nguyên bạn đang quản**: từng ví và số dư, từng quỹ kèm % + độ ưu tiên + hạn + số tiền cần mỗi tháng, ngân sách, danh mục đầu tư, các khoản định kỳ sắp tới. Dùng thẳng, đừng gọi công cụ hỏi lại thứ đã nằm sẵn trước mắt.
- Nếu **phan_bo_can_bang = false**: tổng % các quỹ đang khác 100, nên tiền được chia theo tỉ lệ chứ không đúng con số hiển thị cho người dùng. Hãy chủ động chia lại cho đủ 100% rồi báo một dòng — đây là việc hoàn tác được, không cần xin phép.
- Trước khi nhận thêm một mục tiêu mới, cộng **can_moi_thang** của mọi quỹ và so với tiền dư mỗi tháng. Nếu vượt, nói thẳng con số thiếu hụt rồi đề xuất cụ thể: giãn hạn quỹ nào, hạ mục tiêu quỹ nào, hay hoãn quỹ ưu tiên thấp nào. Đừng im lặng nhận thêm rồi để kế hoạch vỡ.
- Khi tiền không đủ cho mọi quỹ, cắt theo **uu_tien** từ số lớn xuống (số càng lớn càng ít quan trọng), không cắt đều tay.
- Rà soát chủ động: quỹ quá hạn, ngân sách sắp vượt, tiền nằm chết trong ví không sinh lời, nợ lãi cao trong khi quỹ hưởng thụ vẫn đầy — thấy thì nói, dù người dùng không hỏi.

QUẢN LÝ QUỸ THEO MỤC TIÊU VÀ THỜI HẠN- Mỗi quỹ tích luỹ nên có **số tiền mục tiêu + hạn hoàn thành**. Từ đó dat_muc_tieu_quy trả về monthly_needed = số tiền phải bỏ vào mỗi tháng. Luôn nói con số này cho người dùng.
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

/**
 * Câu trả lời có đang tuyên bố là đã thay đổi dữ liệu không?
 *
 * Vì sao cần: lịch sử chat chứa những câu bộ luật từng trả lời ("✍️ Đã ghi
 * chi 45.000đ…"). Model — nhất là model nhỏ — coi đó là mẫu và bắt chước y
 * hệt mà không gọi công cụ nào, nên người dùng đọc thấy "đã ghi" trong khi sổ
 * không hề có giao dịch. Trong một app tài chính thì đó là lời nói dối tệ
 * nhất có thể có: người ta tin là đã ghi rồi và không ghi lại nữa.
 *
 * Chỉ bắt những động từ chỉ hành động của app, không bắt những câu kể lại số
 * liệu ("bạn đã chi 32 triệu tháng này") để tránh chặn nhầm.
 *
 * Lưu ý: KHÔNG dùng `\b` ở đây. Trong regex JavaScript, `\w` chỉ gồm [A-Za-z0-9_]
 * nên chữ tiếng Việt có dấu không phải "ký tự từ": `/\bđã/` không bao giờ khớp
 * với "đã". Bản đầu tiên của chốt chặn này viết có `\b` và im lặng không hoạt
 * động — nhìn mã thì thấy đúng, chỉ chạy thật mới lộ ra.
 */
const CLAIM_RE = /(đã|vừa)\s+(tự động\s+)?(ghi|thêm|tạo|lưu|cập nhật|chỉnh|điều chỉnh|sửa|xoá|xóa|đặt|phân bổ|chuyển|nạp|rút|đóng|mở|lập|bật|tắt|gia hạn|hoàn tất|thiết lập)/i;
const claimsMutation = (t) => CLAIM_RE.test(String(t || ''));

/**
 * Chuyển lịch sử DB sang định dạng hội thoại của model.
 *
 * Những lượt trước có thể do **bộ luật** trả lời chứ không phải agent (khi
 * chưa cắm AI, hoặc khi agent lỗi). Chúng có định dạng rất đặc trưng —
 * "✍️ Đã ghi chi 45.000đ…" — và nếu để nguyên thì model đọc như thể chính nó
 * đã viết, rồi bắt chước: viết y hệt câu "đã ghi" mà không gọi công cụ nào.
 * Đánh dấu rõ nguồn gốc để nó biết đó không phải việc mình làm, đồng thời cắt
 * ngắn vì nội dung đó chỉ còn giá trị ngữ cảnh.
 */
const AGENT_INTENTS = new Set(['agent', 'onboarding']);
function toMessages(history) {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-HISTORY_TURNS)
    .map((m) => {
      const content = String(m.content || '').slice(0, 4000);
      if (m.role === 'assistant' && m.intent && !AGENT_INTENTS.has(m.intent)) {
        return { role: m.role, content: `[app tự trả lời bằng mẫu có sẵn, không phải bạn làm] ${content.slice(0, 400)}` };
      }
      return { role: m.role, content };
    });
}

/**
 * Chạy một lượt hội thoại.
 * @returns {{reply: string, calls: string[], mutated: boolean, onboarded: boolean}|null}
 *          null nghĩa là agent không dùng được -> tầng trên lùi về bộ luật.
 */
export async function runAgent(message, history, { onboarding = false, source = 'chat', allow = null } = {}) {
  if (!agentEnabled()) return null;

  // Phiên rà soát chạy lúc người dùng vắng mặt, nên mặc định chỉ được dùng công
  // cụ đọc. Lọc ngay ở danh sách gửi cho model để nó không đề xuất việc bị cấm,
  // và chặn lần nữa lúc thực thi phòng khi model tự bịa tên công cụ.
  const toolset = allow ? TOOLS.filter((t) => allow.test(t.function.name)) : TOOLS;

  const batch = `${source}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const messages = [
    { role: 'system', content: onboarding ? systemOnboarding() : systemNormal() },
    ...toMessages(history),
    { role: 'user', content: String(message).slice(0, 4000) },
  ];

  const calls = [];
  let mutated = false;
  let onboarded = false;
  let nudged = false;   // đã nhắc model một lần vì nói suông chưa

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let msg;
    try {
      msg = await complete(messages, toolset, { temperature: 0.55 });
    } catch (e) {
      // Hết hạn mức, mạng lỗi, model sai... -> để bộ luật xử lý tiếp.
      // Nhưng phải kêu lên: im lặng lùi về bộ luật khiến người dùng tưởng AI
      // đang chạy trong khi thật ra key sai hoặc hết tiền, và họ không có cách
      // nào biết ngoài việc thấy câu trả lời nhạt đi.
      console.warn(`[finmate] agent lùi về bộ luật vì lỗi gọi model: ${String(e?.message || e).slice(0, 200)}`);
      return calls.length
        ? { reply: `Mình đã cập nhật xong nhưng phần diễn giải bị lỗi kết nối (${e.message}). Bạn hỏi lại giúp mình nhé.`, calls, mutated, onboarded, batch }
        : null;
    }
    if (!msg) return null;

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      const reply = String(msg.content || '').trim();
      if (!reply) return null;

      // Chốt chặn nói dối: model bảo đã làm nhưng chưa hề gọi công cụ nào.
      // Nhắc một lần cho nó tự sửa — thường là nó gọi công cụ thật ngay.
      if (claimsMutation(reply) && !mutated) {
        if (!nudged) {
          nudged = true;
          messages.push({ role: 'assistant', content: reply });
          // Vai `user` chứ không phải `system`: với Claude, mọi message system
          // đều bị gom lên đầu request, nên lời nhắc "bạn vừa nói suông" sẽ mất
          // đúng cái nó cần nhất là vị trí — ngay sau câu vừa nói.
          messages.push({
            role: 'user',
            content: 'Khoan đã: bạn vừa nói là đã ghi/cập nhật, nhưng bạn CHƯA gọi công cụ nào nên trong app thực tế chưa có gì thay đổi. Hãy gọi đúng công cụ ngay bây giờ để thực hiện việc đó. Nếu thiếu thông tin hoặc không có công cụ phù hợp thì nói thật là chưa làm được và hỏi lại mình — đừng mô tả một việc chưa xảy ra.',
          });
          continue;
        }
        // Nhắc rồi vẫn nói suông: thà nhường cho bộ luật xử lý — nó thao tác
        // thật — còn hơn trả về một câu khẳng định sai sự thật.
        console.warn('[finmate] agent nói đã cập nhật nhưng không gọi công cụ nào; nhường cho bộ luật.');
        return null;
      }

      return { reply, calls, mutated, onboarded, batch };
    }

    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }

      // Ghi nhật ký quanh mỗi lần gọi công cụ: có nó thì mọi việc AI làm đều
      // xem lại và hoàn tác được, thay vì là chuyện đã rồi.
      // Vì sao AI làm việc này: ưu tiên lời model tự nói, không có thì lấy chính
      // câu người dùng vừa nhắn — đọc lại nhật ký sau vài tuần vẫn hiểu ngữ cảnh.
      const ly_do = (typeof args.ly_do === 'string' && args.ly_do)
        || (msg.content ? String(msg.content).slice(0, 300) : null)
        || `Người dùng nhắn: "${String(message).slice(0, 200)}"`;
      let out;

      if (allow && !allow.test(name)) {
        out = { ok: false, error: `Phiên rà soát tự động chỉ được đọc dữ liệu, không được gọi "${name}". Hãy nêu đề xuất bằng lời để người dùng tự quyết.` };
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
        continue;
      }

      beginAudit({ tool: name, args, batch, source, reason: ly_do });
      try {
        out = runTool(name, args);
      } finally {
        try { endAudit(out, out?.ok !== false); } catch { abortAudit(); }
      }

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
    if (reply) return { reply, calls, mutated, onboarded, batch };
  } catch { /* bỏ qua, rơi xuống dưới */ }

  return calls.length
    ? { reply: 'Mình đã cập nhật xong rồi. Bạn muốn xem lại phần nào không?', calls, mutated, onboarded, batch }
    : null;
}
