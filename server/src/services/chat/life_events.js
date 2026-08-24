/**
 * Biến cố lớn của đời — ly hôn, mất việc, sắp có con, thừa kế, bệnh nặng…
 *
 * Vì sao cần riêng một tầng: bộ luật nhận diện theo từ khoá giao dịch nên
 * những câu này rơi vào ý định sai một cách rất vô duyên — "mình vừa ly hôn,
 * tài sản còn một nửa" bị hiểu là muốn cập nhật hồ sơ và app hỏi lại "Bạn tên
 * gì, sinh năm nào?"; "vợ mình sắp sinh" bị hiểu là hỏi mua sắm và app hỏi
 * "Món đó giá bao nhiêu?"; "mình mới được thừa kế mảnh đất" thì bị hỏi đang
 * giữ mã cổ phiếu nào. Đây đúng là những lúc người ta cần cố vấn nhất, nên
 * tầng này chặn trước và trả lời bằng số liệu thật của họ.
 *
 * Không thay thế AI: khi có LLM thì agent xử lý tốt hơn nhiều. Tầng này là
 * đáy an toàn cho người dùng chưa cắm AI hoặc lúc gọi model lỗi.
 */
import { all, get } from '../../db.js';
import { norm } from '../../util/vi.js';
import { netWorth } from '../networth.js';
import { emergencyStatus, fireStats } from '../fire.js';
import { fmt } from '../../util/money.js';

/**
 * Mỗi biến cố: từ khoá (đã bỏ dấu) + hàm dựng lời khuyên từ số liệu thật.
 * Xếp theo thứ tự ưu tiên — cụm càng đặc thù càng đứng trước.
 */
const EVENTS = [
  {
    key: 'ly_hon',
    kw: ['ly hon', 'ly di', 'chia doi tai san', 'chia tai san sau ly hon', 'vua bo chong', 'vua bo vo'],
    build: (m) => [
      '💔 **Chuyện lớn — mình tính lại từ đầu cùng bạn.**',
      `Tài sản ròng hiện tại: **${m.net}**. Quỹ khẩn cấp đang đủ **${m.thang} tháng** chi phí.`,
      '',
      '**Ba việc làm ngay trong tháng này:**',
      '1. **Tách bạch tài chính**: đổi mật khẩu ngân hàng, huỷ tài khoản/thẻ đứng tên chung, tách khoản vay chung nếu còn.',
      `2. **Dựng lại quỹ khẩn cấp**: sau biến cố, mốc an toàn là **6 tháng chi phí** (~${m.canKhanCap}). ${m.thieuKhanCap}`,
      '3. **Cập nhật lại kế hoạch**: số người phụ thuộc, nghĩa vụ cấp dưỡng và mục tiêu dài hạn đều đổi — nên đặt lại mục tiêu thay vì giữ kế hoạch cũ.',
      '',
      m.duThang,
      '_Tuổi 40 với một nửa tài sản vẫn còn 20-25 năm tích luỹ. Điều quan trọng nhất lúc này là dòng tiền hàng tháng, không phải con số tài sản._',
    ],
    quick: ['Cập nhật số dư tài khoản', 'Tạo quỹ khẩn cấp mới', 'Bao giờ mình tự do tài chính'],
  },
  {
    key: 'mat_viec',
    kw: ['mat viec', 'that nghiep', 'bi sa thai', 'bi cho nghi', 'cong ty cat giam', 'layoff', 'nghi viec chua co viec moi'],
    build: (m) => [
      '🛟 **Mất thu nhập — việc đầu tiên là biết mình cầm cự được bao lâu.**',
      `Quỹ khẩn cấp của bạn trụ được **${m.thang} tháng**. Chi phí sống mỗi tháng: **${m.chiThang}**.`,
      '',
      '**Thứ tự ưu tiên:**',
      '1. **Cắt ngay các khoản định kỳ không thiết yếu** (đăng ký dịch vụ, gói tập, mua trả góp mới).',
      '2. **Giữ trả nợ tối thiểu đúng hạn** — trễ hạn làm hỏng lịch sử tín dụng, thiệt hại kéo dài hơn nhiều so với số tiền tiết kiệm được.',
      '3. **Làm hồ sơ trợ cấp thất nghiệp ngay** (Việt Nam: BHXH, tối đa 12 tháng nếu đã đóng đủ; Ireland: Jobseeker\'s Benefit).',
      '4. **Đừng bán tài sản dài hạn vội** nếu quỹ khẩn cấp còn đủ 3 tháng trở lên.',
      '',
      m.thangSo >= 6 ? '✅ Bạn có đệm tốt, đủ thời gian tìm việc phù hợp thay vì nhận đại.' : '⚠️ Đệm còn mỏng — nên chuyển sang chế độ chi tiêu tối thiểu ngay tuần này.',
    ],
    quick: ['Tình hình tài chính của mình', 'Mình cắt chi được ở đâu', 'Quỹ khẩn cấp của mình'],
  },
  {
    key: 'sinh_con',
    kw: ['sap sinh', 'vo sap sinh', 'co bau', 'mang thai', 'sap co con', 'chuan bi sinh con', 'sap don em be', 'sap lam bo', 'sap lam me'],
    build: (m) => [
      '👶 **Chúc mừng! Đây là khoản chi đáng chuẩn bị sớm nhất.**',
      `Tiền dư mỗi tháng của bạn: **${m.duThangSo}**. Tài sản ròng: **${m.net}**.`,
      '',
      '**Ba khoản cần tính:**',
      '1. **Một lần khi sinh**: 15-40 triệu ở Việt Nam tuỳ bệnh viện (Ireland: phần lớn miễn phí qua hệ thống công, khám tư ~€3.000-4.000).',
      '2. **Hàng tháng sau sinh**: sữa, bỉm, tiêm chủng, người trông — thực tế thường **5-12 triệu/tháng**, tăng dần.',
      '3. **Thu nhập giảm tạm thời**: nghỉ thai sản 6 tháng ở Việt Nam hưởng BHXH; nếu người mẹ nghỉ hẳn, dòng tiền hộ gia đình đổi hoàn toàn.',
      '',
      '👉 Nên làm ngay: mở một **quỹ "Sinh con"** với hạn đúng ngày dự sinh để app tự tính số tiền cần bỏ mỗi tháng, và **nâng quỹ khẩn cấp lên 6 tháng** trước khi bé ra đời.',
      m.thangSo < 6 ? `⚠️ Quỹ khẩn cấp mới đủ ${m.thang} tháng — nên ưu tiên phần này trước khi mua sắm đồ sơ sinh.` : '',
    ],
    quick: ['Tạo quỹ Sinh con', 'Quỹ khẩn cấp của mình', 'Tình hình tài chính của mình'],
  },
  {
    key: 'ket_hon',
    kw: ['sap cuoi', 'chuan bi cuoi', 'sap ket hon', 'cuoi vo', 'lay chong', 'lay vo'],
    build: (m) => [
      '💍 **Cưới xin là khoản chi lớn nhưng có ngày hẹn rõ — rất dễ lập kế hoạch.**',
      `Tiền dư mỗi tháng: **${m.duThangSo}**. Tài sản ròng: **${m.net}**.`,
      '',
      '- **Chi phí cưới ở Việt Nam** thường 150-400 triệu tuỳ quy mô; tiền mừng bù lại được một phần nhưng **đừng tính trước vào ngân sách**.',
      '- Nên tách rõ: **tiền cưới** và **tiền dựng tổ ấm** (thuê/mua nhà, nội thất) — gộp chung rất dễ vỡ kế hoạch.',
      '- Sau cưới, hai người nên thống nhất **mô hình quản lý tiền**: chung hết, riêng hết, hay quỹ chung theo tỷ lệ thu nhập.',
      '',
      '👉 Tạo quỹ "Cưới" với hạn là ngày cưới dự kiến, app sẽ tính số tiền cần để dành mỗi tháng và tự nhắc.',
    ],
    quick: ['Tạo quỹ Cưới', 'Tiền dư mỗi tháng của mình', 'Mình nên làm gì tiếp theo?'],
  },
  {
    key: 'thua_ke',
    kw: ['thua ke', 'duoc cho dat', 'bo me cho dat', 'duoc tang nha', 'duoc cho nha', 'di san'],
    build: (m) => [
      '🏡 **Thừa kế tài sản — giàu tài sản không đồng nghĩa dư dòng tiền.**',
      `Tài sản ròng hiện tại: **${m.net}**, tiền dư mỗi tháng: **${m.duThangSo}**.`,
      '',
      '**Ba việc theo thứ tự:**',
      '1. **Hoàn tất pháp lý trước**: sang tên, khai nhận di sản. Bất động sản chưa sang tên thì không vay thế chấp được và cũng khó bán.',
      '2. **Thuế và phí**: thừa kế bất động sản giữa cha mẹ – con cái ở Việt Nam được **miễn thuế thu nhập cá nhân**; vẫn có lệ phí trước bạ và phí công chứng.',
      '3. **Quyết định giữ hay khai thác**: đất bỏ không vẫn tốn phí và không sinh dòng tiền. Cho thuê, hoặc bán một phần để trả nợ lãi cao / dựng quỹ khẩn cấp thường có lợi hơn.',
      '',
      '👉 Nên thêm mảnh đất vào app như một **tài khoản loại "tài sản"** để tài sản ròng và kế hoạch tự do tài chính phản ánh đúng.',
      m.noLaiCao,
    ],
    quick: ['Thêm tài sản bất động sản', 'Tình hình tài chính của mình', 'Mình nên làm gì tiếp theo?'],
  },
  {
    key: 'benh_nang',
    kw: ['benh nang', 'nam vien', 'phau thuat', 'benh hiem ngheo', 'tai nan', 'dieu tri dai ngay'],
    build: (m) => [
      '🏥 **Sức khoẻ trước, tiền tính sau — nhưng vẫn phải tính.**',
      `Quỹ khẩn cấp đang đủ **${m.thang} tháng** (**${m.khanCap}**).`,
      '',
      '1. **Dùng bảo hiểm y tế đúng tuyến** trước khi dùng tiền túi; giữ toàn bộ hoá đơn để yêu cầu chi trả.',
      '2. **Đừng vay tiêu dùng lãi cao để chữa bệnh** nếu còn tài sản thanh khoản — lãi 20-30%/năm sẽ thành gánh nặng thứ hai.',
      '3. **Tạm dừng các mục tiêu dài hạn** (đầu tư định kỳ, quỹ mua nhà) thay vì bán lỗ tài sản đang giảm giá.',
      '',
      '👉 Sau khi ổn định, nên xem lại bảo hiểm sức khoẻ và bảo hiểm thu nhập — đây là lúc thấy rõ nhất vì sao cần chúng.',
    ],
    quick: ['Quỹ khẩn cấp của mình', 'Tình hình tài chính của mình', 'Tạm dừng mục tiêu'],
  },
  {
    key: 'nghi_huu',
    kw: ['sap nghi huu', 'chuan bi nghi huu', 've huu', 'nghi huu nam sau'],
    build: (m) => [
      '🌴 **Nghỉ hưu — chuyển từ tích luỹ sang rút tiền.**',
      `Tài sản ròng: **${m.net}**. Thu nhập thụ động hiện tại: **${m.thuDong}/tháng**, chi phí sống: **${m.chiThang}/tháng**.`,
      '',
      `- Theo **quy tắc rút 4%**, số tiền cần để nghỉ hưu an toàn là **${m.fiNumber}**.`,
      m.duFire ? '✅ Bạn đã đạt mốc đó — có thể sống bằng tài sản mà không cần đi làm.' : `⚠️ Còn thiếu so với mốc an toàn. ${m.duThang}`,
      '- Trước khi nghỉ, nên **chuyển dần sang tài sản ít biến động** và giữ **2 năm chi phí bằng tiền mặt** để không phải bán lúc thị trường giảm.',
      '- Kiểm tra **lương hưu BHXH** (Việt Nam) hoặc **State Pension** (Ireland) — đây là nguồn thu suốt đời, nên tính vào kế hoạch.',
    ],
    quick: ['Bao giờ mình tự do tài chính', 'Thu nhập thụ động của mình', 'Tình hình tài chính của mình'],
  },
  {
    key: 'nguoi_than_mat',
    kw: [
      'nguoi than qua doi', 'tang su',
      // Người ta hiếm khi nói cụt "bố mất" — thường là "bố mình mất tuần
      // trước". Cần chủ ngữ chỉ người thân đứng trước để không bắt nhầm
      // "mất ví", "mất việc", "mất tiền".
      /\b(bo|me|cha|ba|ong|ba noi|ba ngoai|chong|vo|con|anh|chi|em)\s+(minh|toi|em|tui|tao)?\s*(vua |moi )?(mat|qua doi)\b/,
    ],
    build: () => [
      '🕯️ **Xin chia buồn với bạn.**',
      '',
      'Khi nào bạn sẵn sàng, có vài việc tài chính nên làm — không gấp, nhưng để lâu sẽ rắc rối:',
      '1. **Ngưng các khoản định kỳ** đứng tên người đã mất (thuê bao, bảo hiểm, trả góp).',
      '2. **Liên hệ ngân hàng và bảo hiểm** với giấy chứng tử để làm thủ tục thừa kế hoặc chi trả quyền lợi.',
      '3. **Kiểm tra nghĩa vụ nợ**: một số khoản vay có bảo hiểm khoản vay sẽ được xoá, đừng tự trả trước khi hỏi.',
      '',
      '_Mình sẽ giữ nguyên kế hoạch hiện tại cho tới khi bạn muốn cập nhật lại._',
    ],
    quick: ['Tình hình tài chính của mình', 'Cập nhật số dư tài khoản'],
  },
  {
    key: 'chuyen_nuoc',
    kw: ['sap di nuoc ngoai', 'chuyen sang nuoc khac', 'dinh cu', 'sap ve viet nam han', 've nuoc sinh song', 'di xuat khau lao dong'],
    build: (m) => [
      '✈️ **Chuyển nước — dòng tiền và tiền tệ đều đổi.**',
      `Tài sản ròng hiện tại: **${m.net}**.`,
      '',
      '1. **Giữ tài khoản ở cả hai nơi** trong ít nhất 6-12 tháng đầu; đóng sớm rất phiền khi cần chứng minh tài chính.',
      '2. **Tính chi phí sống theo tiền bản địa**, đừng quy đổi theo thói quen cũ — app hỗ trợ nhiều đồng tiền, nên đặt lại đồng tiền chính.',
      '3. **Chuyển tiền lớn nên chia nhiều lần** theo tỷ giá, và so phí giữa các kênh (ngân hàng, Wise, Remitly) — chênh lệch 1-2% trên khoản lớn là con số thật.',
      '4. **Kiểm tra nghĩa vụ thuế hai nơi** và hiệp định tránh đánh thuế hai lần.',
    ],
    quick: ['Đổi đồng tiền chính', 'Xem tỷ giá', 'Tình hình tài chính của mình'],
  },
];

/** Nhận diện biến cố từ câu người dùng. Trả về key hoặc null. */
export function detectLifeEvent(message) {
  const n = norm(String(message || ''));
  if (!n) return null;
  for (const ev of EVENTS) {
    if (ev.kw.some((k) => (k instanceof RegExp ? k.test(n) : n.includes(k)))) return ev.key;
  }
  return null;
}

/** Số liệu thật dùng chung cho mọi lời khuyên — không có thì để trống, không bịa. */
function facts() {
  const nw = safe(() => netWorth(), {});
  const ef = safe(() => emergencyStatus(), {});
  const fi = safe(() => fireStats(), {});
  // months_covered là null khi chưa ghi nhận chi tiêu nào — đừng để thành "0.0
  // tháng" vì hai chuyện đó khác hẳn nhau với người đọc.
  const coDuLieu = ef.has_data === true && ef.months_covered != null;
  const thangSo = coDuLieu ? Number(ef.months_covered) : 0;
  const chiThangSo = Number(fi.monthly_expense) || 0;
  const duThangSo = Number(fi.monthly_surplus) || 0;
  const noLai = all("SELECT name, balance, interest_rate FROM debts WHERE status='active' AND interest_rate >= 15")
    .sort((a, b) => b.interest_rate - a.interest_rate)[0];

  return {
    net: money(nw.net),
    thang: coDuLieu ? thangSo.toFixed(1) : '—', thangSo,
    khanCap: money(ef.current), canKhanCap: money(ef.target_amount),
    chiThang: money(chiThangSo), duThangSo: money(duThangSo),
    thuDong: money(fi.passive_income?.total), fiNumber: money(fi.fi_number),
    duFire: (Number(fi.passive_income?.total) || 0) >= chiThangSo && chiThangSo > 0,
    thieuKhanCap: Number(ef.gap) > 0 ? `Còn thiếu **${money(ef.gap)}**.` : 'Bạn đã đủ mốc này rồi. ✅',
    duThang: duThangSo > 0
      ? `Mỗi tháng bạn đang dư **${money(duThangSo)}** — đây là con số quyết định tốc độ hồi phục.`
      : '⚠️ Hiện dòng tiền tháng đang không dư. Cân lại chi tiêu là việc cấp thiết nhất.',
    noLaiCao: noLai
      ? `⚠️ Bạn còn khoản **${noLai.name}** lãi **${noLai.interest_rate}%/năm** — trả dứt khoản này thường lợi hơn mọi kênh đầu tư.`
      : '',
  };
}

function safe(fn, fallback) {
  try { return fn() ?? fallback; } catch { return fallback; }
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return fmt(n);   // fmt tự lấy đồng tiền hiển thị của người dùng
}

/** Dựng câu trả lời cho biến cố đã nhận diện. */
export function answerLifeEvent(key) {
  const ev = EVENTS.find((e) => e.key === key);
  if (!ev) return null;
  const reply = ev.build(facts()).filter((l) => l !== '').join('\n');
  return { reply, quick: ev.quick, event: key };
}

export const LIFE_EVENT_KEYS = EVENTS.map((e) => e.key);
