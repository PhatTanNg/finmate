/**
 * Cơ sở tri thức tài chính cá nhân (bối cảnh Việt Nam).
 * Mỗi chủ đề trả lời câu hỏi mở nhưng luôn gắn với số liệu thật của người dùng,
 * để trả lời giống một cố vấn đang nhìn vào hồ sơ của bạn chứ không phải bài báo chung chung.
 */
import { get } from '../../db.js';
import { norm } from '../../util/vi.js';
import { short, pct } from '../../util/money.js';
import { averageMonthlyExpense, averageMonthlyIncome } from '../reports.js';
import { netWorth } from '../networth.js';
import { fireStats, emergencyStatus, passiveIncomeMonthly, marketAssumptions as MK } from '../fire.js';
import { debtSummary } from '../debts.js';
import { portfolio, realEstate } from '../investments.js';

const P = () => get('SELECT * FROM profile WHERE id = 1') || {};
const B = (arr) => arr.filter(Boolean).join('\n');

function ctx() {
  const expense = averageMonthlyExpense(6) || 0;
  const income = averageMonthlyIncome(6) || 0;
  const nw = netWorth();
  return {
    p: P(),
    expense,
    income,
    surplus: income - expense,
    nw,
    ef: emergencyStatus(),
    debt: debtSummary(income),
    pf: portfolio(),
    re: realEstate(),
    fire: fireStats(),
    passive: passiveIncomeMonthly(),
  };
}

/** kw: từ khoá (không dấu). Cần ít nhất 1 từ khoá xuất hiện trong câu. */
const TOPICS = [
  {
    key: 'inflation',
    kw: ['lam phat', 'truot gia', 'tien mat gia', 'mat gia'],
    title: '📉 Lạm phát ảnh hưởng gì tới kế hoạch của bạn',
    build: (c) => B([
      `Lạm phát giả định trong kế hoạch của bạn là **${pct(c.p.inflation ?? MK().inflation, 1)}/năm**. Nghĩa là chi phí sống **${short(c.expense)}/tháng** hôm nay sẽ thành khoảng **${short(c.expense * Math.pow(1 + (Number(c.p.inflation) || MK().inflation), 10))}/tháng** sau 10 năm.`,
      '',
      '**Ba hệ quả trực tiếp:**',
      `• Tiền để không trong tài khoản thanh toán mất giá thật ~${pct(c.p.inflation ?? MK().inflation, 1)}/năm. Bạn đang giữ **${short(c.nw.breakdown?.liquid || c.nw.liquid)}** tiền lỏng — phần vượt quỹ khẩn cấp nên đưa sang kênh sinh lời.`,
      `• Gửi tiết kiệm ~5-6%/năm chỉ thắng lạm phát khoảng 1-2%/năm — đủ để bảo toàn, không đủ để giàu.`,
      `• Mục tiêu tự do tài chính **${short(c.fire.fi_number)}** đã được tính theo lợi suất **thực** (${pct(c.fire.real_return, 1)}/năm sau lạm phát), nên con số này vẫn đúng dù giá cả tăng.`,
      '',
      '**Việc nên làm:** giữ quỹ khẩn cấp bằng tiền gửi (ưu tiên an toàn, chấp nhận lỗ thật nhẹ), phần còn lại phân bổ vào tài sản tăng theo lạm phát (cổ phiếu, quỹ chỉ số, bất động sản cho thuê). Đàm phán tăng lương ít nhất bằng lạm phát mỗi năm — đây là "kênh chống lạm phát" hiệu quả nhất mà đa số người bỏ quên.',
    ]),
  },
  {
    key: 'compound',
    kw: ['lai kep', 'lai suat kep', 'compound'],
    title: '🌱 Lãi kép hoạt động thế nào với tiền của bạn',
    build: (c) => {
      const m = Math.max(0, c.surplus);
      const r = (Number(c.p.expected_return) || MK().expected_return) / 12;
      const fv = (n) => (r ? m * ((Math.pow(1 + r, n) - 1) / r) : m * n);
      return B([
        `Nếu mỗi tháng bạn đầu tư đều **${short(m)}** với lợi suất **${pct(c.p.expected_return ?? 0.09, 1)}/năm**:`,
        `• 5 năm → **${short(fv(60))}** (tự bỏ ra ${short(m * 60)})`,
        `• 10 năm → **${short(fv(120))}** (tự bỏ ra ${short(m * 120)})`,
        `• 20 năm → **${short(fv(240))}** (tự bỏ ra ${short(m * 240)})`,
        '',
        'Phần chênh lệch chính là tiền do tiền đẻ ra. Điểm mấu chốt: lãi kép chỉ bùng nổ ở những năm cuối, nên **thời gian ở trong thị trường quan trọng hơn thời điểm vào**. Trễ 5 năm không mất 5 năm đầu — mất đúng 5 năm cuối, phần lớn nhất.',
      ]);
    },
  },
  {
    key: 'gold',
    kw: ['vang', 'sjc', 'vang nhan'],
    title: '🥇 Có nên giữ vàng?',
    build: (c) => B([
      'Vàng là **bảo hiểm**, không phải máy tạo dòng tiền: không trả lãi, không cổ tức, giá phụ thuộc tâm lý và tỷ giá. Ở Việt Nam còn thêm rủi ro chênh lệch giá SJC với giá thế giới và spread mua-bán 1-3%.',
      '',
      `**Tỷ trọng hợp lý: 5-10% tài sản ròng.** Với ${short(c.nw.net)} của bạn, tương đương **${short(c.nw.net * 0.05)} – ${short(c.nw.net * 0.1)}**.`,
      '',
      'Nên dùng vàng để: chống khủng hoảng, giữ giá trị dài hạn, đa dạng hoá. Không nên dùng vàng để: làm quỹ khẩn cấp (thanh khoản kém khi cần gấp), hay đầu cơ lướt sóng.',
    ]),
  },
  {
    key: 'crypto',
    kw: ['crypto', 'bitcoin', 'btc', 'tien ao', 'tien dien tu', 'coin'],
    title: '₿ Crypto có phù hợp với bạn không?',
    build: (c) => B([
      `Khẩu vị rủi ro hiện tại của bạn: **${{ conservative: 'thận trọng', balanced: 'cân bằng', aggressive: 'mạo hiểm' }[c.p.risk_profile] || 'cân bằng'}**.`,
      '',
      'Nguyên tắc an toàn: chỉ dùng tiền **mất hoàn toàn cũng không ảnh hưởng cuộc sống** — thực tế là **tối đa 5% tài sản ròng**' + `, tức khoảng **${short(c.nw.net * 0.05)}** với bạn.`,
      '',
      `${!c.ef.ok ? `⚠️ Quỹ khẩn cấp của bạn ${c.ef.has_data ? `mới đủ **${c.ef.months_covered} tháng**` : 'chưa đo được (app chưa có dữ liệu chi tiêu)'} — hãy lấp đầy trước khi nghĩ tới crypto.` : '✅ Quỹ khẩn cấp của bạn đã đủ, nên phần rủi ro cao là lựa chọn cá nhân.'}`,
      `${c.debt.high_interest?.length ? `⚠️ Bạn còn nợ lãi cao (${c.debt.high_interest.join(', ')}). Trả nợ ${c.debt.avg_rate.toFixed(1)}%/năm là "lợi nhuận" chắc chắn, hơn hẳn kỳ vọng đầu cơ.` : ''}`,
      '',
      'Ở Việt Nam crypto chưa được pháp luật bảo vệ như tài sản tài chính — rủi ro sàn và pháp lý là có thật. Nếu tham gia: chia nhỏ mua đều (DCA), tự quản khoá, không dùng đòn bẩy.',
    ]),
  },
  {
    key: 'rent_vs_buy',
    kw: ['mua nha hay thue', 'thue nha hay mua', 'co nen mua nha', 'mua nha', 'mua chung cu', 'thue nha'],
    title: '🏠 Mua nhà hay tiếp tục thuê?',
    build: (c) => {
      const afford = Math.round(c.income * 0.4);
      const price = Math.round(afford * 12 * 8);
      return B([
        `**Ba con số quyết định, tính theo hồ sơ của bạn:**`,
        `• Tổng nợ phải trả mỗi tháng không nên vượt **40% thu nhập** = **${short(afford)}/tháng**. Bạn đang trả nợ ${short(c.debt.monthly_payment)} (${pct(c.debt.dti)} thu nhập).`,
        `• Với mức trả đó, giá nhà hợp lý rơi vào khoảng **${short(price)}** (vay 70%, 20 năm).`,
        `• Cần sẵn **${short(price * 0.3)}** tiền mặt cho 30% vốn tự có + ~2% phí, thuế, nội thất. Bạn đang có ${short(c.nw.breakdown?.liquid ?? c.nw.liquid)} tiền lỏng.`,
        '',
        '**Nên mua khi:** ở ổn định >7 năm, thu nhập vững, tiền thuê ≥ 0,4%/tháng giá trị căn nhà, và sau khi mua vẫn giữ được quỹ khẩn cấp.',
        '**Nên tiếp tục thuê khi:** còn có thể đổi việc/đổi thành phố, giá thuê rẻ hơn nhiều so với lãi vay, hoặc mua nhà sẽ khiến bạn phải rút cạn tiền dự phòng.',
        '',
        'Mẹo: chênh lệch giữa "tiền thuê" và "tiền trả góp" nếu đem đầu tư đều đặn cũng tạo tài sản — thuê không phải là "tiền vứt đi" nếu bạn kỷ luật đầu tư phần chênh.',
      ]);
    },
  },
  {
    key: 'insurance',
    kw: ['bao hiem', 'nhan tho', 'suc khoe', 'bhyt', 'bhxh'],
    title: '🛡️ Bảo hiểm: mua gì, bao nhiêu là đủ',
    build: (c) => B([
      '**Thứ tự ưu tiên:**',
      '1. **BHYT/BHXH** — rẻ nhất, bắt buộc, đừng bỏ.',
      `2. **Bảo hiểm sức khoẻ** (nội trú/viện phí): 3-6 triệu/năm, chống cú sốc viện phí — đây là rủi ro phá vỡ kế hoạch tài chính phổ biến nhất.`,
      `3. **Bảo hiểm nhân thọ tử kỳ (term)** nếu có người phụ thuộc. Bạn khai **${c.p.dependents || 0} người phụ thuộc**${(c.p.dependents || 0) > 0 ? ` → mệnh giá hợp lý ≈ 10 năm chi phí sống = **${short(c.expense * 120)}**` : ' → nếu chưa ai phụ thuộc vào thu nhập của bạn, nhân thọ chưa cấp thiết'}.`,
      '',
      `**Ngân sách:** tổng phí bảo hiểm nên nằm trong **5-10% thu nhập**, tức **${short(c.income * 0.05)} – ${short(c.income * 0.1)}/tháng** với bạn.`,
      '',
      '⚠️ Tránh gộp bảo hiểm với đầu tư (sản phẩm liên kết đầu tư) nếu mục tiêu chính là bảo vệ: phí cao, minh bạch thấp. Mua term rẻ + tự đầu tư phần chênh thường hiệu quả hơn.',
    ]),
  },
  {
    key: 'saving_vs_invest',
    kw: ['gui tiet kiem hay dau tu', 'nen gui tiet kiem', 'tiet kiem hay dau tu', 'gui ngan hang hay'],
    title: '⚖️ Gửi tiết kiệm hay đầu tư?',
    build: (c) => B([
      '**Chia theo thời hạn cần dùng tiền — đây là nguyên tắc quan trọng nhất:**',
      `• Cần trong **0-1 năm** → tiền gửi/không kỳ hạn. Đây là quỹ khẩn cấp: mục tiêu ${c.ef.target_months} tháng = **${short(c.ef.target_amount)}**, bạn đang có ${short(c.ef.current)}.`,
      '• Cần trong **1-3 năm** (mua xe, cưới, học) → tiền gửi có kỳ hạn hoặc quỹ trái phiếu. Không bỏ vào cổ phiếu.',
      `• Cần **sau 5 năm trở lên** → cổ phiếu/quỹ chỉ số. Đây là phần đưa bạn tới tự do tài chính; kỳ vọng ${pct(c.p.expected_return ?? 0.09, 1)}/năm.`,
      '',
      `Hiện tại bạn có **${short(c.nw.invested)}** tài sản sinh lời và **${short(c.nw.breakdown?.liquid ?? c.nw.liquid)}** tiền lỏng. Tỷ lệ tiết kiệm 6 tháng gần nhất: **${pct(c.fire.savings_rate)}** (mục tiêu bạn đặt: ${pct(c.p.savings_rate_target ?? 0.3)}).`,
    ]),
  },
  {
    key: 'prepay_debt',
    kw: ['tra no truoc han', 'tat toan som', 'nen tra no', 'tra het no hay dau tu', 'no truoc han', 'tra som', 'tra truoc han', 'tra xe som', 'tra nha som'],
    title: '💳 Trả nợ trước hạn hay đầu tư?',
    build: (c) => B([
      `So sánh đơn giản: **lãi vay ${c.debt.avg_rate ? c.debt.avg_rate.toFixed(1) + '%/năm' : '—'}** với **lợi suất đầu tư kỳ vọng ${pct(c.p.expected_return ?? 0.09, 1)}/năm**.`,
      '',
      '• Lãi vay **> 10%/năm** → trả nợ trước. Đây là khoản "đầu tư" chắc chắn, không rủi ro, không thuế.',
      '• Lãi vay **< 8%/năm** → ưu tiên đầu tư, trả nợ theo lịch. Tiền rẻ nên giữ để làm việc khác.',
      '• Khoảng giữa → chia đôi, hoặc chọn theo cảm giác an tâm của bạn.',
      '',
      c.debt.high_interest?.length
        ? `🔥 Bạn đang có nợ lãi cao: **${c.debt.high_interest.join(', ')}** — dồn tiền dư vào đây trước.`
        : '✅ Bạn không có khoản nợ lãi cao nào — cứ trả theo lịch và ưu tiên đầu tư.',
      '',
      `⚠️ Luôn kiểm tra hợp đồng: nhiều khoản vay ở Việt Nam có **phí trả trước hạn 1-3%** dư nợ trong vài năm đầu. Nếu phí cao hơn phần lãi tiết kiệm được thì không nên tất toán sớm.`,
    ]),
  },
  {
    key: 'credit_card',
    kw: ['the tin dung', 'credit card', 'quet the', 'tra gop 0'],
    title: '💳 Dùng thẻ tín dụng sao cho có lợi',
    build: () => B([
      '**Quy tắc sống còn:** luôn thanh toán **toàn bộ dư nợ** trước hạn. Trả tối thiểu là cái bẫy — lãi 25-40%/năm tính trên toàn bộ dư nợ, cộng dồn hằng ngày.',
      '',
      '• Rút tiền mặt từ thẻ tín dụng: tính lãi ngay từ ngày rút + phí 3-4%. Gần như không bao giờ đáng.',
      '• "Trả góp 0%" thường đã cộng phí chuyển đổi 1,5-3% — vẫn có thể đáng nếu bạn giữ được tiền để sinh lời, nhưng phải tính lại chi phí thật.',
      '• Hạn mức không phải thu nhập. Coi thẻ như công cụ thanh toán tiện lợi + hoàn tiền, không phải nguồn tiền.',
      '',
      'FinMate sẽ tự cảnh báo bạn trước ngày sao kê và ngày đến hạn để không bao giờ trễ.',
    ]),
  },
  {
    key: 'etf',
    kw: ['chung chi quy', 'quy mo', 'etf', 'quy chi so', 'vn30', 'dcds', 'vfmvn'],
    title: '📊 Quỹ chỉ số / ETF có hợp với bạn không?',
    build: (c) => B([
      'Với người bận đi làm, quỹ chỉ số/ETF thường tốt hơn tự chọn cổ phiếu: phí thấp, đa dạng hoá sẵn, không cần theo dõi hằng ngày, tránh được sai lầm cảm xúc.',
      '',
      `Danh mục hiện tại của bạn: **${short(c.pf.total_value)}** (${c.pf.holdings.length} mã), lãi/lỗ tạm tính **${short(c.pf.unrealized_pnl)}** (${pct(c.pf.unrealized_pct)}).`,
      '',
      '**Cách làm đơn giản mà hiệu quả:** đặt lệnh mua tự động một khoản cố định vào ngày nhận lương (DCA). Không đoán đáy, không dừng khi thị trường đỏ — chính lúc đỏ mới mua được nhiều chứng chỉ quỹ hơn.',
      '',
      `Bạn nói cho mình biết số tiền muốn đầu tư đều mỗi tháng, mình sẽ tạo khoản định kỳ và trừ vào ngân sách giúp bạn.`,
    ]),
  },
  {
    key: 'budget_rule',
    kw: ['50 30 20', '50/30/20', 'quy tac ngan sach', 'chia luong', 'phan bo luong', 'chia tien'],
    title: '🧮 Chia lương thế nào cho hợp lý',
    build: (c) => B([
      `Quy tắc **50/30/20** áp lên thu nhập **${short(c.income)}/tháng** của bạn:`,
      `• 50% thiết yếu (nhà, ăn, đi lại, hoá đơn): **${short(c.income * 0.5)}**`,
      `• 30% mong muốn (giải trí, du lịch, mua sắm): **${short(c.income * 0.3)}**`,
      `• 20% tương lai (trả nợ thêm + đầu tư): **${short(c.income * 0.2)}**`,
      '',
      `Thực tế bạn đang chi **${short(c.expense)}/tháng** (${pct(c.income ? c.expense / c.income : 0)} thu nhập), để dành **${short(c.surplus)}** (${pct(c.fire.savings_rate)}).`,
      '',
      c.fire.savings_rate >= 0.2
        ? '✅ Bạn đang đi trên chuẩn. Việc cần làm giờ là **tự động hoá**: chuyển tiền vào quỹ ngay ngày nhận lương, trước khi kịp tiêu.'
        : '👉 Cách dễ nhất để tăng tỷ lệ này không phải là cắt cà phê, mà là **tự động chuyển tiền đi ngay ngày nhận lương** và tăng thu nhập. Bảo mình "phân bổ lương tự động" để thiết lập.',
    ]),
  },
  {
    key: 'raise_income',
    kw: ['tang thu nhap', 'kiem them tien', 'lam them', 'nghe tay trai', 'freelance', 'side job'],
    title: '💼 Tăng thu nhập — đòn bẩy mạnh nhất',
    build: (c) => B([
      `Cắt chi có giới hạn (bạn chỉ chi ${short(c.expense)}/tháng), nhưng tăng thu thì không có trần.`,
      '',
      `Theo mô hình của bạn, **tăng thu nhập 20%** sẽ rút ngắn ngày tự do tài chính xuống **${c.fire.scenarios?.find((s) => /thu nhap/i.test(s.label))?.date ? new Date(c.fire.scenarios.find((s) => /thu nhap/i.test(s.label)).date).toLocaleDateString('vi-VN') : '—'}**, sớm hơn nhiều so với việc cắt chi tiêu tương đương.`,
      '',
      '**Thứ tự ưu tiên thực tế:**',
      '1. Đàm phán lương ở công việc chính (đòn bẩy lớn nhất, chi phí thấp nhất).',
      '2. Kỹ năng có thể bán lẻ theo giờ (freelance đúng chuyên môn).',
      '3. Tài sản tạo dòng tiền: cho thuê, cổ tức, lãi.',
      '',
      `Thu nhập thụ động của bạn hiện **${short(c.passive.total)}/tháng**, phủ **${pct(c.fire.passive_coverage)}** chi phí sống. Khi con số này chạm 100%, bạn đã tự do về mặt dòng tiền.`,
    ]),
  },
  {
    key: 'market_drop',
    kw: ['thi truong giam', 'sap ham', 'lo nang', 'chung khoan giam', 'do lua', 'bat day', 'cat lo'],
    title: '📉 Thị trường giảm thì làm gì?',
    build: (c) => B([
      `Danh mục của bạn hiện **${short(c.pf.total_value)}**, tương đương **${pct(c.nw.net ? c.pf.total_value / c.nw.net : 0)}** tài sản ròng — mức giảm 30% sẽ làm bạn mất khoảng ${short(c.pf.total_value * 0.3)} tạm tính.`,
      '',
      '**Ba câu hỏi trước khi hành động:**',
      '1. Tiền này bạn có cần trong 3 năm tới không? Nếu không, biến động chỉ là con số trên màn hình.',
      `2. Quỹ khẩn cấp còn nguyên chứ? ${c.ef.has_data ? `Bạn đang có ${c.ef.months_covered} tháng.` : 'App chưa đo được vì chưa có dữ liệu chi tiêu.'} Có đệm thì không bị ép bán đáy.`,
      '3. Lý do bạn mua ban đầu còn đúng không? Nếu còn, giảm giá là **hàng giảm giá**, không phải tin xấu.',
      '',
      'Sai lầm đắt nhất là bán khi hoảng rồi mua lại khi đã tăng. Nếu thấy khó ngủ, đó là dấu hiệu tỷ trọng cổ phiếu đang cao hơn khẩu vị thật của bạn — hãy hạ tỷ trọng khi thị trường bình thường, không phải lúc đang hoảng.',
    ]),
  },
  {
    key: 'kids',
    kw: ['cho con', 'nuoi con', 'hoc phi', 'con cai', 'sinh con'],
    title: '👶 Chuẩn bị tài chính cho con',
    build: (c) => B([
      'Ba lớp cần chuẩn bị, theo thứ tự:',
      `1. **Bảo vệ**: bảo hiểm sức khoẻ cho con + nhân thọ tử kỳ cho bố mẹ (mệnh giá ≈ 10 năm chi phí sống = ${short(c.expense * 120)}).`,
      '2. **Quỹ học phí**: đặt mục tiêu theo mốc thời gian rõ ràng (18 năm cho đại học). Tiền cần sau >10 năm nên nằm ở quỹ chỉ số, không phải sổ tiết kiệm.',
      '3. **Ngân sách sinh hoạt tăng thêm**: trung bình 3-6 triệu/tháng cho trẻ nhỏ ở thành phố, chưa kể học phí trường tư.',
      '',
      'Nói với mình _"tạo mục tiêu học phí cho con 500 triệu trong 15 năm"_ — mình sẽ tính số tiền cần để dành mỗi tháng và tự trích vào quỹ.',
    ]),
  },
  {
    key: 'retire_early',
    kw: ['nghi huu som', 'nghi lam', 'fire', 'tu do tai chinh la gi', 'coast fire', 'lean fire'],
    title: '🔥 Nghỉ hưu sớm cần gì',
    build: (c) => B([
      `Bạn cần **${short(c.fire.fi_number)}** (quy tắc rút ${pct(c.fire.swr)}/năm cho chi phí ${short(c.expense)}/tháng). Đang có **${short(c.fire.invested)}** → hoàn thành **${pct(c.fire.progress)}**.`,
      `Dự kiến đạt: **${c.fire.fi_date ? new Date(c.fire.fi_date).toLocaleDateString('vi-VN') : '—'}**${c.fire.fi_age ? ` (bạn ${Math.round(c.fire.fi_age)} tuổi)` : ''}.`,
      '',
      '**Các mức tự do:**',
      `• Lean FIRE (chỉ chi thiết yếu): ${short(c.fire.lean_number)}`,
      `• FIRE tiêu chuẩn: ${short(c.fire.fi_number)}`,
      `• Fat FIRE (sống thoải mái): ${short(c.fire.fat_number)}`,
      `• Coast FIRE: ${short(c.fire.coast_number)} — chạm mốc này thì ngừng tích luỹ vẫn nghỉ hưu đúng tuổi ${c.p.retire_age_target || 50}.`,
      '',
      'Ba đòn bẩy duy nhất: **tăng thu**, **giảm chi**, **kéo dài thời gian**. Hỏi mình _"làm sao nghỉ hưu sớm hơn 5 năm"_ để xem kịch bản cụ thể.',
    ]),
  },
  {
    key: 'emergency',
    kw: ['quy khan cap', 'quy du phong', 'mat viec', 'that nghiep', 'de danh bao nhieu', 'thang it viec', 'thu nhap khong deu', 'thang khong co viec'],
    title: '🛟 Quỹ khẩn cấp — tấm đệm đầu tiên',
    build: (c) => B([
      c.ef.has_data
        ? `Bạn đang có **${short(c.ef.current)}**, đủ sống **${c.ef.months_covered} tháng** nếu mất thu nhập. Mục tiêu: **${c.ef.target_months} tháng = ${short(c.ef.target_amount)}**.`
        : `Bạn đang có **${short(c.ef.current)}** tiền lỏng. App chưa tính được "đủ sống mấy tháng" vì chưa ghi nhận khoản chi nào — bật đọc tin nhắn ngân hàng hoặc nhắn cho mình vài khoản chi là ra ngay.`,
      c.ef.ok ? '✅ Đã đủ — bạn có thể tự tin đầu tư phần dư.' : c.ef.has_data ? `👉 Còn thiếu **${short(c.ef.gap)}**. Đây là ưu tiên số 1 trước mọi khoản đầu tư rủi ro.` : `👉 Quy tắc chung: để dành ${c.ef.target_months} tháng chi phí sinh hoạt trước mọi khoản đầu tư rủi ro.`,
      '',
      '**Để ở đâu:** tài khoản tiết kiệm không kỳ hạn hoặc kỳ hạn ngắn rút linh hoạt. Tiêu chí là **rút được trong 24h mà không lỗ**, không phải lãi cao.',
      '**Bao nhiêu là đủ:** 3 tháng nếu thu nhập ổn định và không ai phụ thuộc; 6 tháng nếu có người phụ thuộc; 9-12 tháng nếu thu nhập bấp bênh hoặc tự kinh doanh.',
    ]),
  },
  {
    key: 'tax',
    kw: ['thue tncn', 'thue thu nhap', 'quyet toan thue', 'giam tru gia canh'],
    title: '🧾 Thuế thu nhập cá nhân',
    build: (c) => B([
      'Lương chịu thuế luỹ tiến 5% → 35% sau khi trừ bảo hiểm bắt buộc (10,5%) và giảm trừ gia cảnh (bản thân 15,5 triệu + 6,2 triệu/người phụ thuộc mỗi tháng).',
      `Bạn khai **${c.p.dependents || 0} người phụ thuộc** — mỗi người giúp giảm khoảng **1-2 triệu tiền thuế mỗi tháng** tuỳ bậc. Nếu có bố mẹ/con đủ điều kiện mà chưa đăng ký, đây là khoản tiết kiệm dễ nhất.`,
      '',
      '**Các nguồn thu khác:**',
      '• Lãi tiết kiệm cá nhân: **miễn thuế**.',
      '• Cổ tức tiền mặt: 5%. Bán chứng khoán: 0,1% giá trị bán.',
      '• Cho thuê nhà: doanh thu >100 triệu/năm chịu 10% (5% GTGT + 5% TNCN) trên doanh thu.',
      '',
      'Gõ _"tính thuế lương 40 triệu"_ để mình tính thực nhận chi tiết cho bạn.',
    ]),
  },
  {
    key: 'lend',
    kw: ['cho vay', 'cho muon tien', 'ban muon tien', 'nguoi than vay', 'cho ban vay', 'ban vay tien', 'nguoi ta vay', 'ai do vay'],
    title: '🤝 Cho người quen vay tiền',
    build: (c) => B([
      'Nguyên tắc bảo vệ cả tiền lẫn quan hệ: **chỉ cho vay số tiền mà bạn sẵn sàng coi như đã cho**.',
      '',
      `Với hồ sơ của bạn, mức đó nên nằm dưới **${short(Math.max(0, c.surplus * 3))}** (khoảng 3 tháng tiền dư) và tuyệt đối không lấy từ quỹ khẩn cấp.`,
      '',
      '• Ghi rõ số tiền và ngày trả, dù là người thân — bảo mình _"ghi cho A vay 10 triệu"_ để theo dõi.',
      '• Không vay nợ (đặc biệt thẻ tín dụng) để cho người khác vay.',
      '• Nếu người vay đang mất khả năng trả, cho một khoản nhỏ hơn dưới dạng giúp đỡ dứt điểm thường lành mạnh hơn khoản vay kéo dài.',
    ]),
  },
  {
    key: 'spend_guilt',
    kw: ['co nen tieu', 'tieu tien co loi', 'thuong cho ban than', 'du lich co nen', 'xai sang', 'tu thuong', 'di du lich', 'nghi duong', 'huong thu'],
    title: '🎁 Tiêu tiền cho bản thân thế nào cho đúng',
    build: (c) => B([
      'Tiết kiệm không phải để khổ. Vấn đề không phải "tiêu bao nhiêu" mà "tiêu có đúng thứ mình thật sự quý không".',
      '',
      `Với thu nhập ${short(c.income)}/tháng, một khoản **hưởng thụ có kế hoạch 5-10% = ${short(c.income * 0.05)} – ${short(c.income * 0.1)}/tháng** là hoàn toàn lành mạnh — miễn là tiền vào quỹ tương lai đã được trích **trước**.`,
      '',
      '**Ba câu hỏi trước khi chi khoản lớn:** (1) Nó có mua lại thời gian hoặc sức khoẻ cho mình không? (2) Một năm nữa mình còn thấy vui vì đã mua không? (3) Nếu chi, kế hoạch tự do tài chính lùi bao lâu?',
      '',
      `Hỏi mình _"có nên mua ... giá ..."_ — mình sẽ trả lời bằng đúng con số của bạn: ảnh hưởng tới quỹ, tới mục tiêu và tới ngày tự do tài chính.`,
    ]),
  },
];

/** Tìm chủ đề khớp câu hỏi. Trả về null nếu không đủ tự tin. */
export function findTopic(text) {
  const n = norm(String(text || ''));
  let best = null;
  for (const t of TOPICS) {
    for (const k of t.kw) {
      if (n.includes(k) && (!best || k.length > best.len)) best = { topic: t, len: k.length };
    }
  }
  return best?.topic || null;
}

export function answerTopic(topic) {
  const c = ctx();
  return `## ${topic.title}\n${topic.build(c)}`;
}

export const TOPIC_LIST = TOPICS.map((t) => ({ key: t.key, title: t.title }));
