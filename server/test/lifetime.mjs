/**
 * MÔ PHỎNG TRỌN ĐỜI — 12 người, mỗi người một câu chuyện từ ghế nhà trường
 * đến lúc nghỉ hưu.
 *
 *   node test/lifetime.mjs            # chạy cả 12 (theo nhóm 3 để Node khỏi sặc)
 *   node test/lifetime.mjs 1 2 3      # chỉ chạy vài người
 *
 * personas.mjs xem app có dùng được trong vài tháng; journey5y.mjs xem app có
 * theo kịp 5 năm. File này hỏi câu khó nhất: app có đi hết một ĐỜI người không?
 *
 * Mỗi nhân vật đi qua các chặng thật của đời sống tài chính Việt Nam — đi học,
 * làm thêm, ra trường lương thấp, cưới, sinh con, mua nhà, nuôi con ăn học,
 * phụng dưỡng cha mẹ, khủng hoảng giữa đời, rồi nghỉ hưu — và ở mỗi chặng app
 * phải trả lời đúng câu hỏi mà một cố vấn tài chính thật sẽ phải trả lời.
 *
 * Mỗi chặng nén thành vài giao dịch đại diện chứ không ghi từng tháng: 12 người
 * × 40-50 năm mà ghi đủ thì mất hàng giờ. Cái cần kiểm là app có xử lý đúng
 * BIẾN CỐ và các con số dồn tích qua thời gian, không phải khối lượng ghi.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'src', 'index.js');
const BASE_PORT = 4280;

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

const tr = (v) => Math.round(v * 1_000_000);
const ty = (v) => Math.round(v * 1_000_000_000);
const eur = (v) => Math.round(v * 100);
const short = (d) => (Math.abs(d) >= 1e9 ? `${(d / 1e9).toFixed(2)} tỷ₫` : `${Math.round(d / 1e6).toLocaleString('vi-VN')} tr₫`);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

function makeClient(base) {
  async function api(method, path, body) {
    const r = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { json = { _nonJson: true }; }
    return { status: r.status, ...json };
  }
  return {
    GET: (p) => api('GET', p),
    POST: (p, b) => api('POST', p, b ?? {}),
    PATCH: (p, b) => api('PATCH', p, b),
    DEL: (p) => api('DELETE', p),
  };
}

const FINDINGS = [];
const finding = (sev, who, title, detail) => FINDINGS.push({ sev, who, title, detail });

function must(cond, msg) { if (!cond) throw new Error(msg); }
/**
 * App "lạc" khi nó phải hỏi lại thay vì trả lời. Chỉ nhìn intent là chưa đủ:
 * nhiều câu rơi vào nhánh `unknown` nhưng vẫn được trả lời bằng số liệu thật —
 * cái đáng báo động là khi câu trả lời chỉ có "mình chưa hiểu ý bạn".
 */
function isLost(a) {
  return /chưa chắc hiểu ý bạn|chưa hiểu ý bạn|Thử hỏi kiểu|nhưng chưa chắc ý bạn/.test(a.text);
}
function sane(obj, label, path = '') {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) throw new Error(`${label}${path} = ${obj}`);
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) sane(v, label, `${path}.${k}`);
}

/**
 * Bối cảnh chạy cho một nhân vật: gom bước kiểm, mốc thời gian, và tiện ích
 * ghi giao dịch để mỗi câu chuyện bên dưới đọc như một dòng đời chứ không
 * như một mớ lời gọi API.
 */
function makeStory(c, who) {
  const checks = [];
  const chapters = [];

  async function step(name, fn) {
    const rec = { name, ok: false, note: '' };
    try {
      const out = await fn();
      rec.ok = true;
      if (typeof out === 'string') rec.note = out;
    } catch (e) { rec.note = e.message; }
    checks.push(rec);
    process.stdout.write(rec.ok ? '.' : 'X');
    return rec;
  }

  const tx = (o) => c.POST('/transactions', o);
  /** Ghi n tháng giống nhau, ngày d hằng tháng. */
  async function months(from, count, list, step_ = 1) {
    const [y0, m0] = from.split('-').map(Number);
    for (let i = 0; i < count; i += step_) {
      const t = (y0 * 12 + m0 - 1) + i;
      const k = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
      for (const o of list) {
        await tx({ ...o, date: `${k}-${String(o.d || 5).padStart(2, '0')}`, amount: typeof o.amount === 'function' ? o.amount(i) : o.amount });
      }
    }
  }

  /** Mở một chương đời: ghi lại ảnh chụp tài sản để so sánh về sau. */
  async function chapter(label, fn) {
    await fn();
    const nw = (await c.GET('/networth')).current;
    chapters.push({ label, net: nw.net, assets: nw.assets, debt: nw.liabilities });
    return nw;
  }

  const ask = async (q) => {
    const r = await c.POST('/chat', { message: q });
    return { intent: r.intent, text: String(r.reply?.text || r.reply || '') };
  };

  return { c, who, checks, chapters, step, tx, months, chapter, ask };
}

// ---------------------------------------------------------------------------
// 12 CÂU CHUYỆN
// ---------------------------------------------------------------------------

/**
 * 1. MINH — sinh viên vay học phí → kỹ sư phần mềm → mua nhà → 2 con → nghỉ hưu 60.
 *    Đường đời "chuẩn mực" nhất: kiểm tra app có đi được từ số 0 đến hết.
 */
async function minh(s) {
  const { c, step, tx, months, chapter, ask } = s;

  await step('2014 · sinh viên năm nhất: ví 2 triệu, nợ học phí 40 triệu', async () => {
    await c.PATCH('/profile', { name: 'Minh', birth_year: 1996, currency: 'VND', risk_profile: 'balanced' });
    await c.POST('/accounts', { name: 'Ví tiền mặt', type: 'cash', balance: tr(2), currency: 'VND' });
    await c.POST('/debts', { name: 'Vay học phí ngân hàng CSXH', balance: tr(40), rate: 0.066, monthly_payment: tr(0.8), kind: 'student', currency: 'VND' });
    const d = (await c.GET('/debts')).summary;
    must(d.total_balance === tr(40), `nợ học phí không vào sổ: ${d.total_balance}`);
    // Sinh viên chưa có thu nhập — DTI phải là "chưa biết", không phải 0%.
    if (d.dti === 0) finding('cao', 'Minh', 'DTI = 0% khi chưa có thu nhập', 'Sinh viên vay 40 triệu mà app báo nợ chiếm 0% thu nhập là ru ngủ người dùng.');
    return `nợ ${short(d.total_balance)} · lãi ${pct(d.avg_rate)}`;
  });

  await chapter('Sinh viên', async () => {
    await step('2014-2017 · gia sư + phụ quán, bố mẹ cho 2 triệu/tháng', async () => {
      await months('2014-09', 36, [
        { type: 'income', amount: tr(2), note: 'Bố mẹ chu cấp', category_name: 'Khác', d: 3 },
        { type: 'income', amount: tr(1.8), note: 'Dạy kèm', category_name: 'Freelance', d: 15 },
        { type: 'expense', amount: tr(1.5), note: 'Tiền trọ', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(1.6), note: 'Ăn uống', category_name: 'Ăn uống', d: 10 },
        { type: 'expense', amount: tr(0.4), note: 'Xe buýt', category_name: 'Đi lại', d: 8 },
      ], 3);
      const t = (await c.GET('/reports/trend?months=48')).trend;
      must(t.length > 0, 'không dựng được xu hướng thời sinh viên');
      return `${t.length} tháng có dữ liệu`;
    });
  });

  await chapter('Ra trường', async () => {
    await step('2018 · đi làm lương 12 triệu, bắt đầu trả nợ học phí', async () => {
      await months('2018-01', 36, [
        { type: 'income', amount: (i) => tr(12 + Math.floor(i / 12) * 3), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(3.5), note: 'Thuê nhà', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(3), note: 'Ăn uống', category_name: 'Ăn uống', d: 10 },
        { type: 'expense', amount: tr(0.8), note: 'Trả nợ học phí', category_name: 'Trả nợ', d: 20 },
        { type: 'expense', amount: tr(1), note: 'Biếu bố mẹ', category_name: 'Gia đình', d: 25 },
      ], 2);
      const inc = (await c.GET('/income-streams'));
      sane(inc.sources, 'income-sources');
      return `thu nhập vào sổ · ${(inc.streams || []).length} nguồn`;    });
  });

  await chapter('Cưới vợ', async () => {
    await step('2021 · cưới, thu nhập hộ gia đình gấp đôi, lập quỹ chung', async () => {
      await c.POST('/funds', { name: 'Quỹ Gia đình', target_amount: tr(200), type: 'goal', priority: 2 });
      await months('2021-06', 24, [
        { type: 'income', amount: tr(21), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'income', amount: tr(14), note: 'Lương vợ', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(7), note: 'Thuê nhà', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(8), note: 'Sinh hoạt hai vợ chồng', category_name: 'Ăn uống', d: 10 },
        { type: 'expense', amount: tr(6), note: 'Tiết kiệm mua nhà', category_name: 'Khác', d: 25 },
      ], 2);
      const f = (await c.GET('/funds')).funds;
      must(f.some((x) => x.name === 'Quỹ Gia đình'), 'không tạo được quỹ chung');
      return `${f.length} quỹ`;
    });
  });

  await chapter('Mua nhà + con đầu lòng', async () => {
    await step('2023 · vay 1,5 tỷ mua căn hộ, con đầu lòng chào đời', async () => {
      await c.POST('/accounts', { name: 'Căn hộ Bình Thạnh', type: 'investment', balance: ty(2.6), currency: 'VND' });
      await c.POST('/debts', { name: 'Vay mua nhà Techcombank', balance: ty(1.5), rate: 0.108, monthly_payment: tr(16), kind: 'mortgage', currency: 'VND' });
      await months('2023-06', 36, [
        { type: 'income', amount: (i) => tr(24 + Math.floor(i / 12) * 3), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'income', amount: tr(15), note: 'Lương vợ', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(16), note: 'Trả góp nhà', category_name: 'Trả nợ', d: 10 },
        { type: 'expense', amount: tr(5), note: 'Sữa bỉm, đi khám', category_name: 'Gia đình', d: 12 },
        { type: 'expense', amount: tr(9), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 15 },
      ], 3);
      const d = (await c.GET('/debts')).summary;
      must(d.dti !== null && d.dti > 0.1 && d.dti < 1.2, `DTI vô lý sau khi vay mua nhà: ${d.dti}`);
      const nw = (await c.GET('/networth')).current;
      must(nw.assets > ty(2), 'nhà không được tính vào tài sản');
      return `DTI ${pct(d.dti)} · tài sản ${short(nw.assets)}`;
    });

    await step('Cố vấn cảnh báo đúng khi gánh nợ nhà + con nhỏ', async () => {
      const a = await ask('gánh nợ mua nhà này có nặng quá với thu nhập của mình không');
      must(a.text.length > 60, 'không tư vấn được về gánh nợ');
      if (!/%|DTI|thu nhap|thu nhập/i.test(a.text)) {
        finding('trung bình', 'Minh', 'Tư vấn gánh nợ không nêu tỉ lệ trên thu nhập', a.text.slice(0, 120));
      }
      return a.text.slice(0, 90).replace(/\s+/g, ' ');
    });
  });

  await chapter('Con thứ hai + đỉnh sự nghiệp', async () => {
    await step('2026-2031 · hai con đi học, lương đỉnh, tăng tiết kiệm hưu trí', async () => {
      await c.POST('/funds', { name: 'Quỹ Học vấn cho con', target_amount: ty(1), type: 'goal', priority: 3, target_date: '2042-09-01' });
      await c.POST('/funds', { name: 'Quỹ Hưu trí', target_amount: ty(6), type: 'goal', priority: 4, target_date: '2056-01-01' });
      await months('2026-06', 60, [
        { type: 'income', amount: (i) => tr(38 + Math.floor(i / 12) * 4), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'income', amount: tr(18), note: 'Lương vợ', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(16), note: 'Trả góp nhà', category_name: 'Trả nợ', d: 10 },
        { type: 'expense', amount: tr(12), note: 'Học phí hai con', category_name: 'Giáo dục', d: 12 },
        { type: 'expense', amount: tr(14), note: 'Sinh hoạt gia đình', category_name: 'Ăn uống', d: 15 },
        { type: 'expense', amount: tr(10), note: 'Gửi quỹ hưu trí', category_name: 'Khác', d: 25 },
      ], 4);
      const f = (await c.GET('/funds')).funds;
      const edu = f.find((x) => x.name.includes('Học vấn'));
      must(edu, 'mất quỹ học vấn');
      // Quỹ có hạn hoàn thành phải suy ra được số tiền cần bỏ mỗi tháng.
      if (!edu.plan || !edu.plan.monthly_needed) {
        finding('cao', 'Minh', 'Quỹ có hạn không tính ra số tiền cần góp mỗi tháng', 'Quỹ Học vấn đặt hạn 2042 nhưng app không nói mỗi tháng phải bỏ bao nhiêu.');
      }
      return `${f.length} quỹ · học vấn mục tiêu ${short(edu.target_amount)}`;
    });
  });

  await chapter('Nghỉ hưu', async () => {
    await step('2056 · 60 tuổi, trả hết nợ, sống bằng tài sản tích luỹ', async () => {
      const debts = (await c.GET('/debts')).summary;
      for (const d of debts.debts || []) await c.DEL(`/debts/${d.id}`);
      await c.POST('/income-streams', { name: 'Lương hưu BHXH', net_amount: tr(9), frequency: 'monthly', type: 'pension', currency: 'VND' });
      await c.POST('/income-streams', { name: 'Cho thuê căn hộ cũ', net_amount: tr(12), frequency: 'monthly', type: 'rental', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const inc = (await c.GET('/income-streams')).sources || {};
      // Người đã nghỉ hưu sống 100% bằng thu nhập thụ động — app phải thấy điều đó.
      if (inc.passive_ratio !== null && inc.passive_ratio < 0.5) {
        finding('cao', 'Minh', 'Không nhận ra người nghỉ hưu sống bằng thu nhập thụ động', `passive_ratio = ${inc.passive_ratio} dù mọi nguồn thu đều là hưu trí + cho thuê.`);
      }
      return `cần ${short(fire.fi_number)} · thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });

    await step('Hỏi câu của người sắp nghỉ hưu', async () => {
      const a = await ask('tiền hiện có đủ cho mình sống bao nhiêu năm nữa');
      must(a.text.length > 50, 'không trả lời được câu hỏi tuổi hưu');
      if (isLost(a)) finding('cao', 'Minh', 'Không hiểu câu hỏi cốt lõi của người nghỉ hưu', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });
}

/**
 * 2. LAN — giáo viên lương thấp nhưng ổn định, không nợ, tiết kiệm bền bỉ 35 năm.
 *    Kiểm app có tôn trọng lối sống "chậm mà chắc" hay chỉ ưu ái người thu nhập cao.
 */
async function lan(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2010 · ra trường làm giáo viên, lương 4,2 triệu', async () => {
    await c.PATCH('/profile', { name: 'Lan', birth_year: 1988, currency: 'VND', risk_profile: 'conservative' });
    await c.POST('/accounts', { name: 'Agribank', type: 'bank', balance: tr(6), currency: 'VND' });
    await months('2010-09', 120, [
      { type: 'income', amount: (i) => tr(4.2 + i * 0.06), note: 'Lương giáo viên', category_name: 'Lương', d: 10 },
      { type: 'income', amount: tr(1.5), note: 'Dạy thêm', category_name: 'Freelance', d: 20 },
      { type: 'expense', amount: tr(3.2), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
      { type: 'expense', amount: tr(1), note: 'Biếu bố mẹ', category_name: 'Gia đình', d: 25 },
    ], 6);
    return 'thu nhập nhỏ nhưng đều';
  });

  await chapter('Lấy chồng, sinh con', async () => {
    await step('2016 · cưới, sinh con, thu nhập không tăng nhưng chi tăng', async () => {
      await months('2016-01', 132, [
        { type: 'income', amount: (i) => tr(7 + i * 0.05), note: 'Lương giáo viên', category_name: 'Lương', d: 10 },
        { type: 'income', amount: tr(9), note: 'Lương chồng', category_name: 'Lương', d: 10 },
        { type: 'expense', amount: tr(4), note: 'Nuôi con', category_name: 'Gia đình', d: 12 },
        { type: 'expense', amount: tr(6), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 15 },
        { type: 'expense', amount: tr(3), note: 'Gửi tiết kiệm', category_name: 'Khác', d: 28 },
      ], 6);
      const h = (await c.GET('/advisor/health')).health;
      sane(h, 'health');
      // Người không nợ, tiết kiệm đều, không nên bị chấm điểm thấp chỉ vì thu nhập nhỏ.
      if (h.score < 45) finding('trung bình', 'Lan', 'Chấm điểm khắt khe với người thu nhập thấp mà kỷ luật', `Không nợ, tiết kiệm đều 6 năm mà chỉ ${h.score}/100.`);
      return `điểm ${h.score}/100 (${h.grade})`;
    });
  });

  await chapter('Tích luỹ dài hạn', async () => {
    await step('2024-2040 · gửi tiết kiệm kỳ hạn, mua 5 chỉ vàng mỗi năm', async () => {
      await c.POST('/accounts', { name: 'Sổ tiết kiệm 12 tháng', type: 'savings', balance: tr(420), currency: 'VND' });
      await c.POST('/accounts', { name: 'Vàng tích luỹ', type: 'investment', balance: tr(680), currency: 'VND' });
      await c.POST('/income-streams', { name: 'Lãi tiết kiệm', net_amount: tr(2.4), frequency: 'monthly', type: 'interest', currency: 'VND' });
      const nw = (await c.GET('/networth')).current;
      must(nw.assets > tr(1000), `tài sản tích luỹ không được ghi nhận: ${nw.assets}`);
      return `tài sản ${short(nw.assets)} · không nợ`;
    });

    await step('Hỏi câu của người ngại rủi ro', async () => {
      const a = await ask('mình gửi tiết kiệm hết có an toàn hơn mua chứng khoán không');
      must(a.text.length > 60, 'không tư vấn được');
      if (isLost(a)) finding('trung bình', 'Lan', 'Không hiểu câu hỏi so sánh tiết kiệm và chứng khoán', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Nghỉ hưu giáo viên', async () => {
    await step('2043 · 55 tuổi nghỉ hưu, lương hưu 6,5 triệu', async () => {
      await c.POST('/income-streams', { name: 'Lương hưu', net_amount: tr(6.5), frequency: 'monthly', type: 'pension', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const inc = (await c.GET('/income-streams')).sources || {};
      return `thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });
}

/**
 * 3. TUẤN — công nhân khu công nghiệp, thu nhập theo ca, hay bị mất việc.
 *    Kiểm app có chịu nổi thu nhập THẤT THƯỜNG và những tháng âm.
 */
async function tuan(s) {
  const { c, step, tx, months, chapter, ask } = s;

  await step('2012 · vào làm công nhân, lương cơ bản + tăng ca', async () => {
    await c.PATCH('/profile', { name: 'Tuấn', birth_year: 1992, currency: 'VND', risk_profile: 'conservative' });
    await c.POST('/accounts', { name: 'Vietinbank', type: 'bank', balance: tr(3), currency: 'VND' });
    await months('2012-03', 84, [
      { type: 'income', amount: (i) => tr(6 + (i % 5 === 0 ? 3.5 : i % 3 === 0 ? 1.8 : 0)), note: 'Lương + tăng ca', category_name: 'Lương', d: 10 },
      { type: 'expense', amount: tr(1.8), note: 'Nhà trọ', category_name: 'Nhà ở', d: 5 },
      { type: 'expense', amount: tr(2.6), note: 'Ăn uống', category_name: 'Ăn uống', d: 12 },
      { type: 'expense', amount: tr(1.2), note: 'Gửi về quê', category_name: 'Gia đình', d: 25 },
    ], 4);
    return 'thu nhập lên xuống theo tăng ca';
  });

  await chapter('Mất việc mùa dịch', async () => {
    await step('2021 · nhà máy đóng cửa 5 tháng, không có thu nhập', async () => {
      await months('2021-06', 5, [
        { type: 'expense', amount: tr(1.8), note: 'Nhà trọ', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(2.2), note: 'Ăn uống', category_name: 'Ăn uống', d: 12 },
      ]);
      await tx({ type: 'income', amount: tr(3.7), note: 'Trợ cấp thất nghiệp', category_name: 'Khác', date: '2021-08-15' });
      const t = (await c.GET('/reports/trend?months=180')).trend;
      const neg = t.filter((m) => m.net < 0);
      must(neg.length > 0, 'app không ghi nhận tháng âm nào trong đợt mất việc');
      // Tỉ lệ tiết kiệm âm không được làm hỏng báo cáo.
      sane(t, 'trend');
      return `${neg.length} tháng âm được ghi đúng`;
    });

    await step('Cố vấn phản ứng đúng với cú sốc mất việc', async () => {
      const a = await ask('mình vừa mất việc, tiền còn lại đủ sống bao lâu');
      must(a.text.length > 60, 'không tư vấn được lúc mất việc');
      if (isLost(a)) finding('cao', 'Tuấn', 'Không hiểu câu hỏi lúc khủng hoảng mất việc', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Gây dựng lại', async () => {
    await step('2022-2035 · đi làm lại, học nghề, lên tổ trưởng', async () => {
      await c.POST('/funds', { name: 'Quỹ Dự phòng', target_amount: tr(60), type: 'emergency', priority: 1 });
      await months('2022-01', 156, [
        { type: 'income', amount: (i) => tr(9 + i * 0.05), note: 'Lương', category_name: 'Lương', d: 10 },
        { type: 'expense', amount: tr(2.5), note: 'Nhà trọ', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(3.4), note: 'Ăn uống', category_name: 'Ăn uống', d: 12 },
        { type: 'expense', amount: tr(1.5), note: 'Gửi về quê', category_name: 'Gia đình', d: 25 },
        { type: 'expense', amount: tr(1.5), note: 'Bỏ quỹ dự phòng', category_name: 'Khác', d: 28 },
      ], 6);
      const em = (await c.GET('/advisor/emergency')).emergency ?? (await c.GET('/advisor/health')).health;
      sane(em, 'emergency');
      return 'gây dựng lại quỹ dự phòng';
    });
  });

  await chapter('Về quê nghỉ hưu', async () => {
    await step('2052 · 60 tuổi, về quê, lương hưu thấp + vườn', async () => {
      await c.POST('/income-streams', { name: 'Lương hưu', net_amount: tr(4.2), frequency: 'monthly', type: 'pension', currency: 'VND' });
      await c.POST('/income-streams', { name: 'Bán rau vườn', net_amount: tr(2), frequency: 'monthly', type: 'business', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const h = (await c.GET('/advisor/health')).health;
      sane(h, 'health');
      return `điểm ${h.score}/100`;
    });
  });
}

/**
 * 4. HÀ — bác sĩ: học rất lâu, thu nhập đến muộn nhưng rất cao.
 *    Kiểm app có hiểu "thu nhập đến muộn" thay vì phán xét 10 năm đầu.
 */
async function ha(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2011-2019 · 6 năm y khoa + 3 năm nội trú, gần như không thu nhập', async () => {
    await c.PATCH('/profile', { name: 'Hà', birth_year: 1993, currency: 'VND', risk_profile: 'growth' });
    await c.POST('/accounts', { name: 'BIDV', type: 'bank', balance: tr(5), currency: 'VND' });
    await c.POST('/debts', { name: 'Vay bố mẹ đóng học phí', balance: tr(180), rate: 0, monthly_payment: tr(1), kind: 'personal', currency: 'VND' });
    await months('2011-09', 96, [
      { type: 'income', amount: tr(3), note: 'Bố mẹ chu cấp', category_name: 'Khác', d: 3 },
      { type: 'income', amount: tr(2.5), note: 'Trực đêm', category_name: 'Freelance', d: 18 },
      { type: 'expense', amount: tr(2), note: 'Trọ', category_name: 'Nhà ở', d: 5 },
      { type: 'expense', amount: tr(2.8), note: 'Ăn uống', category_name: 'Ăn uống', d: 12 },
    ], 6);
    const d = (await c.GET('/debts')).summary;
    // Khoản vay 0% lãi từ bố mẹ không được làm hỏng phép tính lãi suất trung bình.
    sane(d, 'debts');
    must(Number.isFinite(d.avg_rate ?? 0), `lãi suất trung bình hỏng khi có khoản vay 0%: ${d.avg_rate}`);
    return `nợ bố mẹ ${short(d.total_balance)} · lãi ${pct(d.avg_rate)}`;
  });

  await chapter('Bác sĩ chính thức', async () => {
    await step('2020-2032 · lương bệnh viện + phòng khám tư, thu nhập nhảy vọt', async () => {
      await months('2020-01', 156, [
        { type: 'income', amount: (i) => tr(25 + i * 0.35), note: 'Lương bệnh viện', category_name: 'Lương', d: 5 },
        { type: 'income', amount: (i) => tr(20 + i * 0.5), note: 'Phòng khám tư', category_name: 'Freelance', d: 20 },
        { type: 'expense', amount: tr(12), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
        { type: 'expense', amount: tr(5), note: 'Trả nợ bố mẹ', category_name: 'Trả nợ', d: 25 },
      ], 6);
      const t = (await c.GET('/reports/trend?months=300')).trend;
      const early = t.slice(0, 12).reduce((a, m) => a + m.income, 0);
      const late = t.slice(-12).reduce((a, m) => a + m.income, 0);
      must(late > early * 3, `app không phản ánh cú nhảy thu nhập: ${early} → ${late}`);
      return `thu nhập 12 tháng đầu ${short(early)} → 12 tháng cuối ${short(late)}`;
    });
  });

  await chapter('Đầu tư mạnh', async () => {
    await step('2033 · mở phòng khám riêng, đầu tư cổ phiếu và bất động sản', async () => {
      await c.POST('/investments/holdings', { symbol: 'VCB', quantity: 5000, avg_cost: tr(0.09), currency: 'VND' });
      await c.POST('/properties', { name: 'Nhà phố Quận 7', current_value: ty(9), monthly_rent: tr(35), currency: 'VND' });
      const p = (await c.GET('/investments'));
      sane(p, 'investments');
      must(p.portfolio.total_value > 0, 'không ghi nhận danh mục cổ phiếu');
      const a = await ask('danh mục đầu tư của mình đang thế nào');
      must(!/€|EUR/.test(a.text), `cổ phiếu VND bị hiển thị bằng euro: ${a.text.slice(0, 100)}`);
      return `danh mục ${short(p.portfolio.total_value)}`;
    });
  });

  await chapter('Nghỉ hưu sớm', async () => {
    await step('2048 · 55 tuổi nghỉ sớm nhờ dòng tiền cho thuê', async () => {
      await c.POST('/income-streams', { name: 'Cho thuê nhà phố', net_amount: tr(35), frequency: 'monthly', type: 'rental', currency: 'VND' });
      await c.POST('/income-streams', { name: 'Cổ tức', net_amount: tr(8), frequency: 'monthly', type: 'dividend', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const inc = (await c.GET('/income-streams')).sources || {};
      return `thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });
}

/**
 * 5. KHOA — khởi nghiệp thất bại, vỡ nợ, làm lại từ đầu.
 *    Kiểm app có xử lý được TÀI SẢN RÒNG ÂM và đường phục hồi.
 */
async function khoa(s) {
  const { c, step, tx, months, chapter, ask } = s;

  await step('2015 · nghỉ việc, dốc 300 triệu mở chuỗi cà phê', async () => {
    await c.PATCH('/profile', { name: 'Khoa', birth_year: 1990, currency: 'VND', risk_profile: 'aggressive' });
    await c.POST('/accounts', { name: 'ACB', type: 'bank', balance: tr(300), currency: 'VND' });
    await months('2015-01', 36, [
      { type: 'income', amount: (i) => tr(40 - i * 0.6), note: 'Doanh thu quán', category_name: 'Kinh doanh', d: 28 },
      { type: 'expense', amount: tr(25), note: 'Mặt bằng', category_name: 'Nhà ở', d: 5 },
      { type: 'expense', amount: tr(18), note: 'Lương nhân viên + nguyên liệu', category_name: 'Khác', d: 10 },
    ], 2);
    return 'doanh thu đi xuống dần';
  });

  await chapter('Vỡ nợ', async () => {
    await step('2018 · đóng quán, ôm 900 triệu nợ, tài sản ròng ÂM', async () => {
      await c.POST('/debts', { name: 'Vay ngân hàng kinh doanh', balance: tr(600), rate: 0.135, monthly_payment: tr(14), kind: 'business', currency: 'VND' });
      await c.POST('/debts', { name: 'Vay bạn bè', balance: tr(300), rate: 0, monthly_payment: tr(5), kind: 'personal', currency: 'VND' });
      const acc = (await c.GET('/accounts')).accounts;
      await c.PATCH(`/accounts/${acc.find((a) => a.name === 'ACB').id}`, { balance: tr(8) });
      const nw = (await c.GET('/networth')).current;
      must(nw.net < 0, `tài sản ròng phải âm sau vỡ nợ, đang là ${nw.net}`);
      sane(nw, 'networth');
      const h = (await c.GET('/advisor/health')).health;
      sane(h, 'health');
      must(h.score >= 0 && h.score <= 100, `điểm sức khoẻ ra ngoài thang khi tài sản âm: ${h.score}`);
      return `tài sản ròng ${short(nw.net)} · điểm ${h.score}/100`;
    });

    await step('Kế hoạch trả nợ xếp đúng thứ tự ưu tiên', async () => {
      const p = (await c.GET('/debts')).avalanche;
      sane(p, 'payoff');
      must(p, 'không lập được kế hoạch trả nợ');
      return `kế hoạch tuyết lở: ${(p.order || p.steps || []).length || '?'} bước`;
    });

    await step('Cố vấn không bỏ rơi người đang âm', async () => {
      const a = await ask('mình đang nợ 900 triệu và không còn gì, nên bắt đầu từ đâu');
      must(a.text.length > 80, 'không tư vấn được cho người vỡ nợ');
      if (isLost(a)) finding('cao', 'Khoa', 'Không hiểu lời cầu cứu của người vỡ nợ', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Làm lại', async () => {
    await step('2019-2030 · đi làm thuê trả nợ, 6 năm sạch nợ', async () => {
      await months('2019-01', 144, [
        { type: 'income', amount: (i) => tr(22 + i * 0.15), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(19), note: 'Trả nợ', category_name: 'Trả nợ', d: 10 },
        { type: 'expense', amount: tr(7), note: 'Sinh hoạt tối giản', category_name: 'Ăn uống', d: 15 },
      ], 6);
      await tx({ type: 'income', amount: tr(150), note: 'Bán xe trả nợ', category_name: 'Khác', date: '2019-04-10' });
      const d = (await c.GET('/debts')).summary;
      sane(d, 'debts');
      return `còn nợ ${short(d.total_balance)} · DTI ${d.dti == null ? 'chưa rõ' : pct(d.dti)}`;
    });
  });

  await chapter('Nghỉ hưu muộn', async () => {
    await step('2055 · 65 tuổi mới nghỉ, tài sản khiêm tốn nhưng dương', async () => {
      await c.POST('/accounts', { name: 'Tiết kiệm hưu trí', type: 'savings', balance: ty(1.8), currency: 'VND' });
      await c.POST('/income-streams', { name: 'Lương hưu', net_amount: tr(5.5), frequency: 'monthly', type: 'pension', currency: 'VND' });
      const nw = (await c.GET('/networth')).current;
      must(nw.net > 0, 'không phục hồi được về dương');
      return `tài sản ròng ${short(nw.net)}`;
    });
  });
}

/**
 * 6. THẢO — nghỉ việc 6 năm nuôi con rồi quay lại thị trường lao động.
 *    Kiểm app có xử lý được KHOẢNG TRỐNG THU NHẬP DÀI mà không kết luận sai.
 */
async function thao(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2013 · marketing lương 15 triệu, độc thân', async () => {
    await c.PATCH('/profile', { name: 'Thảo', birth_year: 1990, currency: 'VND', risk_profile: 'balanced' });
    await c.POST('/accounts', { name: 'Sacombank', type: 'bank', balance: tr(45), currency: 'VND' });
    await months('2013-01', 60, [
      { type: 'income', amount: (i) => tr(15 + i * 0.2), note: 'Lương', category_name: 'Lương', d: 5 },
      { type: 'expense', amount: tr(5), note: 'Thuê nhà', category_name: 'Nhà ở', d: 5 },
      { type: 'expense', amount: tr(5), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
    ], 4);
    return 'sự nghiệp đang lên';
  });

  await chapter('Nghỉ việc nuôi con', async () => {
    await step('2018-2023 · sinh 2 con, ở nhà, sống bằng lương chồng', async () => {
      await months('2018-01', 72, [
        { type: 'income', amount: tr(28), note: 'Lương chồng', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(8), note: 'Thuê nhà', category_name: 'Nhà ở', d: 5 },
        { type: 'expense', amount: tr(9), note: 'Nuôi con', category_name: 'Gia đình', d: 12 },
        { type: 'expense', amount: tr(8), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 15 },
      ], 4);
      const inc = (await c.GET('/income-streams')).sources || {};
      sane(inc, 'income-sources');
      const a = await ask('mình đang ở nhà nuôi con, không có thu nhập riêng thì nên chuẩn bị gì');
      must(a.text.length > 60, 'không tư vấn được cho người nội trợ');
      if (isLost(a)) finding('trung bình', 'Thảo', 'Không hiểu hoàn cảnh người nội trợ không thu nhập riêng', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Quay lại đi làm', async () => {
    await step('2024-2040 · đi làm lại lương thấp hơn cũ, leo dần', async () => {
      await c.POST('/funds', { name: 'Quỹ Tự chủ của mẹ', target_amount: tr(300), type: 'goal', priority: 2, target_date: '2032-01-01' });
      await months('2024-03', 192, [
        { type: 'income', amount: (i) => tr(13 + i * 0.18), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'income', amount: (i) => tr(32 + i * 0.15), note: 'Lương chồng', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(12), note: 'Học phí con', category_name: 'Giáo dục', d: 12 },
        { type: 'expense', amount: tr(14), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 15 },
        { type: 'expense', amount: tr(4), note: 'Quỹ riêng', category_name: 'Khác', d: 28 },
      ], 8);
      const t = (await c.GET('/reports/trend?months=340')).trend;
      sane(t, 'trend');
      return `${t.length} tháng lịch sử liền mạch`;
    });
  });

  await chapter('Nghỉ hưu', async () => {
    await step('2045 · 55 tuổi, lương hưu ít vì đứt 6 năm BHXH', async () => {
      await c.POST('/income-streams', { name: 'Lương hưu', net_amount: tr(3.8), frequency: 'monthly', type: 'pension', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      return 'app tính được dù lịch sử đứt quãng';
    });
  });
}

/**
 * 7. DŨNG — ly hôn, chia đôi tài sản giữa đời.
 *    Kiểm app có chịu được CÚ SỤT TÀI SẢN ĐỘT NGỘT mà không sinh số vô lý.
 */
async function dung(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2010-2024 · 14 năm xây dựng: nhà, xe, tiết kiệm', async () => {
    await c.PATCH('/profile', { name: 'Dũng', birth_year: 1985, currency: 'VND', risk_profile: 'balanced' });
    await c.POST('/accounts', { name: 'MB Bank', type: 'bank', balance: tr(900), currency: 'VND' });
    await c.POST('/accounts', { name: 'Nhà Gò Vấp', type: 'investment', balance: ty(4.2), currency: 'VND' });
    await months('2010-01', 168, [
      { type: 'income', amount: (i) => tr(18 + i * 0.12), note: 'Lương', category_name: 'Lương', d: 5 },
      { type: 'expense', amount: tr(11), note: 'Sinh hoạt gia đình', category_name: 'Ăn uống', d: 12 },
      { type: 'expense', amount: tr(5), note: 'Tiết kiệm', category_name: 'Khác', d: 28 },
    ], 8);
    const nw = (await c.GET('/networth')).current;
    return `tài sản ${short(nw.assets)}`;
  });

  await chapter('Ly hôn', async () => {
    await step('2025 · chia đôi tài sản, thêm nghĩa vụ cấp dưỡng', async () => {
      const before = (await c.GET('/networth')).current.net;
      const list = (await c.GET('/accounts')).accounts;
      const bank = list.find((a) => a.name === 'MB Bank');
      const nha = list.find((a) => a.name === 'Nhà Gò Vấp');
      must(bank && nha, 'không tìm thấy tài khoản đã mở');
      await c.PATCH(`/accounts/${bank.id}`, { balance: tr(450) });
      await c.PATCH(`/accounts/${nha.id}`, { balance: ty(2.1) });
      await c.POST('/income-streams', { name: 'Cấp dưỡng phải trả', net_amount: -tr(8), frequency: 'monthly', type: 'other', currency: 'VND' });
      const after = (await c.GET('/networth')).current;
      sane(after, 'networth sau ly hôn');
      must(after.net < before * 0.7, `chia đôi tài sản không phản ánh: ${before} → ${after.net}`);
      const t = (await c.GET('/reports/trend?months=200')).trend;
      sane(t, 'trend sau ly hôn');
      return `tài sản ròng ${short(before)} → ${short(after.net)}`;
    });

    await step('Cố vấn hiểu tình huống làm lại ở tuổi 40', async () => {
      const a = await ask('mình vừa ly hôn, tài sản còn một nửa, tuổi 40 thì nên tính lại thế nào');
      must(a.text.length > 70, 'không tư vấn được sau ly hôn');
      if (isLost(a)) finding('trung bình', 'Dũng', 'Không hiểu tình huống ly hôn chia tài sản', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Nghỉ hưu một mình', async () => {
    await step('2045 · 60 tuổi, sống một mình, chi phí thấp', async () => {
      await c.POST('/income-streams', { name: 'Lương hưu', net_amount: tr(8), frequency: 'monthly', type: 'pension', currency: 'VND' });
      await c.POST('/income-streams', { name: 'Cho thuê tầng trệt', net_amount: tr(9), frequency: 'monthly', type: 'rental', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const h = (await c.GET('/advisor/health')).health;
      return `điểm ${h.score}/100`;
    });
  });
}

/**
 * 8. MAI — freelancer thiết kế, thu nhập bấp bênh, không BHXH, tự lo hưu trí.
 */
async function mai(s) {
  const { c, step, tx, months, chapter, ask } = s;

  await step('2016 · bỏ công ty ra làm tự do', async () => {
    await c.PATCH('/profile', { name: 'Mai', birth_year: 1994, currency: 'VND', risk_profile: 'growth' });
    await c.POST('/accounts', { name: 'Techcombank', type: 'bank', balance: tr(60), currency: 'VND' });
    await c.POST('/funds', { name: 'Quỹ Dự phòng 12 tháng', target_amount: tr(240), type: 'emergency', priority: 1 });
    // Thu nhập freelance: có tháng 60 triệu, có tháng 0.
    const wave = [0, tr(45), tr(12), 0, tr(60), tr(20), tr(8), tr(38), 0, tr(52), tr(15), tr(30)];
    for (let y = 0; y < 8; y += 1) {
      for (let m = 0; m < 12; m += 3) {
        const amt = wave[(y + m) % 12];
        if (amt > 0) await tx({ type: 'income', amount: amt, note: 'Dự án khách hàng', category_name: 'Freelance', date: `${2016 + y}-${String(m + 1).padStart(2, '0')}-18` });
        await tx({ type: 'expense', amount: tr(11), note: 'Sinh hoạt', category_name: 'Ăn uống', date: `${2016 + y}-${String(m + 1).padStart(2, '0')}-12` });
      }
    }
    const t = (await c.GET('/reports/trend?months=120')).trend;
    const zero = t.filter((m) => m.income === 0);
    sane(t, 'trend freelance');
    if (zero.length === 0) finding('thấp', 'Mai', 'Không có tháng thu nhập 0 nào trong lịch sử freelance', 'Kịch bản có tháng trắng nhưng báo cáo không phản ánh.');
    return `${t.length} tháng · ${zero.length} tháng không có thu`;
  });

  await chapter('Ổn định hoá', async () => {
    await step('Cố vấn hiểu thu nhập bấp bênh', async () => {
      const a = await ask('thu nhập của mình tháng có tháng không thì nên để dành bao nhiêu');
      must(a.text.length > 60, 'không tư vấn được cho freelancer');
      if (isLost(a)) finding('cao', 'Mai', 'Không hiểu bài toán thu nhập bấp bênh của freelancer', a.text.slice(0, 120));
      return `intent=${a.intent}`;
    });

    await step('2024-2040 · thu nhập đều hơn, tự mua bảo hiểm hưu trí', async () => {
      await c.POST('/income-streams', { name: 'Hợp đồng dài hạn', net_amount: tr(38), frequency: 'monthly', type: 'freelance', currency: 'VND' });
      await c.POST('/funds', { name: 'Quỹ Hưu tự lo', target_amount: ty(5), type: 'goal', priority: 3, target_date: '2054-01-01' });
      await months('2024-01', 192, [
        { type: 'income', amount: (i) => tr(38 + i * 0.2), note: 'Hợp đồng', category_name: 'Freelance', d: 18 },
        { type: 'expense', amount: tr(14), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
        { type: 'expense', amount: tr(9), note: 'Bỏ quỹ hưu', category_name: 'Khác', d: 28 },
      ], 8);
      const f = (await c.GET('/funds')).funds;
      const huu = f.find((x) => x.name.includes('Hưu'));
      must(huu, 'mất quỹ hưu tự lo');
      return `quỹ hưu mục tiêu ${short(huu.target_amount)}`;
    });
  });

  await chapter('Nghỉ hưu không lương hưu', async () => {
    await step('2054 · 60 tuổi, không BHXH, sống hoàn toàn bằng tài sản', async () => {
      await c.POST('/accounts', { name: 'Danh mục hưu trí', type: 'investment', balance: ty(6.5), currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const inc = (await c.GET('/income-streams')).sources || {};
      return `tài sản hưu trí đã lập · thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });
}

/**
 * 9. SƠN — lao động xuất khẩu Nhật 5 năm rồi về nước mở xưởng.
 *    Kiểm ĐA TIỀN TỆ theo thời gian: kiếm bằng JPY, tiêu bằng VND, đổi gốc giữa chừng.
 */
async function son(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2016 · sang Nhật, thu nhập bằng yên', async () => {
    await c.PATCH('/profile', { name: 'Sơn', birth_year: 1995, currency: 'VND', risk_profile: 'conservative' });
    await c.POST('/accounts', { name: 'Ngân hàng Nhật', type: 'bank', balance: 0, currency: 'JPY' });
    await c.POST('/accounts', { name: 'Vietcombank', type: 'bank', balance: tr(5), currency: 'VND' });
    const acc = (await c.GET('/accounts')).accounts;
    const jp = acc.find((a) => a.currency === 'JPY');
    must(jp, 'không mở được tài khoản JPY');
    await months('2016-04', 60, [
      { type: 'income', amount: 180000, currency: 'JPY', account_id: jp.id, note: 'Lương xưởng', category_name: 'Lương', d: 25 },
      { type: 'expense', amount: 55000, currency: 'JPY', account_id: jp.id, note: 'Ký túc + ăn', category_name: 'Ăn uống', d: 10 },
    ], 3);
    const nw = (await c.GET('/networth')).current;
    sane(nw, 'networth đa tiền tệ');
    must(nw.assets > 0, 'tài sản JPY không quy đổi được về VND');
    const cur = nw.by_currency || [];
    must(Array.isArray(cur) && cur.length >= 2, `không tách được tài sản theo tiền tệ: ${JSON.stringify(cur).slice(0, 80)}`);
    return `tài sản ${short(nw.assets)} · ${cur.map((x) => `${x.currency} ${pct(x.weight)}`).join(' · ')}`;
  });

  await chapter('Về nước', async () => {
    await step('2021 · mang tiền về, mở xưởng cơ khí', async () => {
      const acc = (await c.GET('/accounts')).accounts;
      const jp = acc.find((a) => a.currency === 'JPY');
      const vn = acc.find((a) => a.currency === 'VND');
      await c.PATCH(`/accounts/${jp.id}`, { balance: 0 });
      await c.PATCH(`/accounts/${vn.id}`, { balance: tr(1200) });
      await c.POST('/debts', { name: 'Vay mua máy', balance: tr(500), rate: 0.115, monthly_payment: tr(12), kind: 'business', currency: 'VND' });
      await months('2021-06', 120, [
        { type: 'income', amount: (i) => tr(45 + i * 0.4), note: 'Doanh thu xưởng', category_name: 'Kinh doanh', account_id: vn.id, d: 28 },
        { type: 'expense', amount: tr(22), note: 'Nguyên liệu + thợ', category_name: 'Khác', account_id: vn.id, d: 10 },
        { type: 'expense', amount: tr(12), note: 'Trả nợ máy', category_name: 'Trả nợ', account_id: vn.id, d: 15 },
        { type: 'expense', amount: tr(9), note: 'Sinh hoạt', category_name: 'Ăn uống', account_id: vn.id, d: 12 },
      ], 6);
      const d = (await c.GET('/debts')).summary;
      must(d.dti !== null && d.dti < 1, `DTI vô lý cho chủ xưởng: ${d.dti}`);
      return `DTI ${pct(d.dti)}`;
    });

    await step('Cố vấn hiểu người vừa hồi hương', async () => {
      const a = await ask('mình mới về nước có 1,2 tỷ nên mở xưởng hay gửi tiết kiệm');
      must(a.text.length > 60, 'không tư vấn được cho người hồi hương');
      return `intent=${a.intent}`;
    });
  });

  await chapter('Nghỉ hưu chủ xưởng', async () => {
    await step('2055 · giao xưởng cho con, nhận tiền hàng tháng', async () => {
      await c.POST('/income-streams', { name: 'Chia lãi xưởng', net_amount: tr(20), frequency: 'monthly', type: 'business', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      return 'dòng tiền hưu trí từ doanh nghiệp gia đình';
    });
  });
}

/**
 * 10. NGỌC — thừa kế đất, giàu tài sản nhưng nghèo dòng tiền.
 *     Kiểm app có phân biệt được TÀI SẢN và DÒNG TIỀN.
 */
async function ngoc(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2020 · thừa kế 3 mảnh đất trị giá 12 tỷ nhưng thu nhập 9 triệu', async () => {
    await c.PATCH('/profile', { name: 'Ngọc', birth_year: 1992, currency: 'VND', risk_profile: 'conservative' });
    await c.POST('/accounts', { name: 'Vietcombank', type: 'bank', balance: tr(30), currency: 'VND' });
    await c.POST('/properties', { name: 'Đất Long An', current_value: ty(4), monthly_rent: 0, currency: 'VND' });
    await c.POST('/properties', { name: 'Đất Bảo Lộc', current_value: ty(3.5), monthly_rent: 0, currency: 'VND' });
    await c.POST('/properties', { name: 'Nhà thừa kế Q.8', current_value: ty(4.5), monthly_rent: tr(7), currency: 'VND' });
    await months('2020-01', 72, [
      { type: 'income', amount: tr(9), note: 'Lương', category_name: 'Lương', d: 5 },
      { type: 'income', amount: tr(7), note: 'Cho thuê nhà Q.8', category_name: 'Cho thuê', d: 8 },
      { type: 'expense', amount: tr(11), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
      { type: 'expense', amount: tr(2), note: 'Thuế đất', category_name: 'Thuế', d: 20 },
    ], 4);
    const nw = (await c.GET('/networth')).current;
    must(nw.assets > ty(10), `đất thừa kế không vào tài sản: ${nw.assets}`);
    const fire = (await c.GET('/fire')).fire;
    sane(fire, 'fire');
    return `tài sản ${short(nw.assets)} · thu nhập 16 tr₫/tháng`;
  });

  await step('App phân biệt giàu tài sản với giàu dòng tiền', async () => {
    const a = await ask('mình có hơn 12 tỷ tài sản nhưng tháng nào cũng thiếu tiền, vì sao');
    must(a.text.length > 70, 'không tư vấn được nghịch lý giàu đất nghèo tiền');
    if (isLost(a)) finding('cao', 'Ngọc', 'Không hiểu nghịch lý giàu tài sản nghèo dòng tiền', a.text.slice(0, 130));
    return `intent=${a.intent}`;
  });

  await chapter('Chuyển hoá tài sản', async () => {
    await step('2026-2040 · bán một mảnh, xây nhà trọ lấy dòng tiền', async () => {
      const props = (await c.GET('/properties')).properties ?? [];
      if (props.length) await c.DEL(`/properties/${props[0].id}`);
      await c.POST('/income-streams', { name: 'Dãy trọ 12 phòng', net_amount: tr(38), frequency: 'monthly', type: 'rental', currency: 'VND' });
      await months('2026-01', 168, [
        { type: 'income', amount: tr(38), note: 'Tiền trọ', category_name: 'Cho thuê', d: 5 },
        { type: 'income', amount: tr(12), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(16), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
      ], 8);
      const inc = (await c.GET('/income-streams')).sources || {};
      sane(inc, 'income-sources');
      return `thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });

  await chapter('Nghỉ hưu địa chủ', async () => {
    await step('2052 · 60 tuổi, sống bằng tiền trọ, để lại cho con', async () => {
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const h = (await c.GET('/advisor/health')).health;
      return `điểm ${h.score}/100`;
    });
  });
}

/**
 * 11. AN — người độc thân theo đuổi FIRE, tiết kiệm 60% thu nhập, nghỉ hưu tuổi 42.
 *     Kiểm dự báo FIRE có tiến gần đúng theo thời gian.
 */
async function an(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2018 · kỹ sư 30 triệu, quyết tiết kiệm 60%', async () => {
    await c.PATCH('/profile', { name: 'An', birth_year: 1994, currency: 'VND', risk_profile: 'aggressive', savings_rate_target: 0.6 });
    await c.POST('/accounts', { name: 'Techcombank', type: 'bank', balance: tr(80), currency: 'VND' });
    await c.POST('/accounts', { name: 'Danh mục ETF', type: 'investment', balance: 0, currency: 'VND' });
    await months('2018-01', 96, [
      { type: 'income', amount: (i) => tr(30 + i * 0.5), note: 'Lương', category_name: 'Lương', d: 5 },
      { type: 'expense', amount: tr(4), note: 'Thuê phòng', category_name: 'Nhà ở', d: 5 },
      { type: 'expense', amount: tr(4.5), note: 'Ăn uống tối giản', category_name: 'Ăn uống', d: 12 },
      { type: 'expense', amount: (i) => tr(18 + i * 0.35), note: 'Mua ETF', category_name: 'Khác', d: 25 },
    ], 4);
    const t = (await c.GET('/reports/trend?months=120')).trend;
    const sr = t.filter((m) => m.income > 0 && m.expense > 0).map((m) => m.savings_rate);
    const avg = sr.reduce((a, b) => a + b, 0) / (sr.length || 1);
    // Tiền chuyển sang mua ETF vẫn bị ghi là "chi", nên tỉ lệ tiết kiệm nhìn
    // thấy thấp hơn thực tế — điều app cần nói rõ chứ không được im lặng.
    if (avg < 0.3) {
      finding('trung bình', 'An', 'Tiền đem đi đầu tư bị tính là chi tiêu', `Tỉ lệ tiết kiệm hiện ${pct(avg)} dù người dùng đẩy phần lớn thu nhập vào ETF. Cần một cách đánh dấu "chi để đầu tư" tách khỏi chi tiêu dùng.`);
    }
    return `tỉ lệ tiết kiệm ghi nhận ${pct(avg)}`;
  });

  await chapter('Tiến gần FIRE', async () => {
    await step('2026-2036 · tài sản đầu tư tăng nhanh, dự báo FIRE ngắn lại', async () => {
      const etfId = (await c.GET('/accounts')).accounts.find((a) => a.name === 'Danh mục ETF')?.id;
      must(etfId, 'không tìm thấy tài khoản ETF');
      await c.PATCH(`/accounts/${etfId}`, { balance: ty(4.5) });
      const f1 = (await c.GET('/fire')).fire;
      await months('2026-01', 120, [
        { type: 'income', amount: (i) => tr(78 + i * 0.6), note: 'Lương', category_name: 'Lương', d: 5 },
        { type: 'expense', amount: tr(11), note: 'Sinh hoạt', category_name: 'Ăn uống', d: 12 },
        { type: 'expense', amount: tr(45), note: 'Mua ETF', category_name: 'Khác', d: 25 },
      ], 6);
      await c.PATCH(`/accounts/${etfId}`, { balance: ty(11) });
      const f2 = (await c.GET('/fire')).fire;
      sane(f2, 'fire');
      const y1 = f1.months_to_fi;
      const y2 = f2.months_to_fi;
      if (y1 != null && y2 != null && y1 > 0 && y2 >= y1) {
        finding('cao', 'An', 'Dự báo FIRE không ngắn lại dù tài sản tăng gấp nhiều lần', `còn ${y1} tháng → vẫn ${y2} tháng sau khi tài sản lên 11 tỷ.`);
      }
      return `còn ${y1 ?? '?'} tháng → ${y2 ?? '?'} tháng${y2 === 0 ? ' (đã vượt mốc tự do tài chính)' : ''}`;
    });

    await step('Hỏi thẳng câu FIRE', async () => {
      const a = await ask('bao giờ mình đạt tự do tài chính và mỗi tháng rút được bao nhiêu');
      must(a.text.length > 70, 'không trả lời được câu FIRE cốt lõi');
      must(/\d/.test(a.text), 'trả lời FIRE không có con số nào');
      return `intent=${a.intent}`;
    });
  });

  await chapter('Nghỉ hưu tuổi 42', async () => {
    await step('2036 · nghỉ việc, sống bằng quy tắc rút 4%', async () => {
      await c.POST('/income-streams', { name: 'Rút danh mục 4%', net_amount: tr(36), frequency: 'monthly', type: 'investment', currency: 'VND' });
      const inc = (await c.GET('/income-streams')).sources || {};
      if (inc.passive_ratio !== null && inc.passive_ratio < 0.5) {
        finding('trung bình', 'An', 'Người FIRE không được nhận là sống bằng thu nhập thụ động', `passive_ratio = ${inc.passive_ratio}`);
      }
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      return `thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });
}

/**
 * 12. BÌNH — chủ doanh nghiệp: dòng tiền lớn, nhiều tiền tệ, thuế phức tạp,
 *     tài sản cá nhân lẫn tài sản công ty.
 */
async function binh(s) {
  const { c, step, months, chapter, ask } = s;

  await step('2015 · mở công ty phần mềm, khách hàng trả bằng USD', async () => {
    await c.PATCH('/profile', { name: 'Bình', birth_year: 1987, currency: 'VND', risk_profile: 'aggressive' });
    await c.POST('/accounts', { name: 'Tài khoản công ty USD', type: 'bank', balance: 0, currency: 'USD' });
    await c.POST('/accounts', { name: 'Cá nhân VCB', type: 'bank', balance: tr(200), currency: 'VND' });
    const acc = (await c.GET('/accounts')).accounts;
    const usd = acc.find((a) => a.currency === 'USD');
    await months('2015-01', 120, [
      { type: 'income', amount: (i) => Math.round((18000 + i * 220) * 100), currency: 'USD', account_id: usd.id, note: 'Hợp đồng outsourcing', category_name: 'Kinh doanh', d: 20 },
      { type: 'expense', amount: (i) => Math.round((12000 + i * 150) * 100), currency: 'USD', account_id: usd.id, note: 'Lương nhân sự', category_name: 'Khác', d: 5 },
    ], 6);
    const nw = (await c.GET('/networth')).current;
    sane(nw, 'networth USD');
    must(nw.assets > 0, 'dòng tiền USD không quy đổi được');
    return `tài sản ${short(nw.assets)}`;
  });

  await chapter('Thuế và phân bổ', async () => {
    await step('Tính thuế thu nhập cá nhân trên phần chia lợi nhuận', async () => {
      const r = await c.POST('/tax/pit', { gross: tr(1800), period: 'year', dependents: 2 });
      must(r.ok !== false, `không tính được thuế: ${JSON.stringify(r).slice(0, 100)}`);
      sane(r.result, 'thuế');
      must(r.result.net > 0 && r.result.net < tr(1800), `thuế ra số vô lý: ${JSON.stringify(r.result).slice(0, 120)}`);
      return `gộp ${short(tr(1800))} → thực nhận ${short(r.result.net)}`;
    });

    await step('Chia tiền vào quỹ theo mức ưu tiên', async () => {
      await c.POST('/funds', { name: 'Quỹ Dự phòng doanh nghiệp', target_amount: ty(2), type: 'emergency', priority: 1 });
      await c.POST('/funds', { name: 'Quỹ Mở rộng', target_amount: ty(5), type: 'goal', priority: 2, target_date: '2030-01-01' });
      await c.POST('/funds', { name: 'Quỹ Cá nhân', target_amount: ty(3), type: 'goal', priority: 3, target_date: '2035-01-01' });
      const alloc = await c.POST('/funds/allocate', { amount: ty(1) });
      sane(alloc, 'phân bổ quỹ');
      must(alloc.ok !== false, `không phân bổ được: ${JSON.stringify(alloc).slice(0, 120)}`);
      return 'phân bổ 1 tỷ vào 3 quỹ theo ưu tiên';
    });
  });

  await chapter('Bán công ty', async () => {
    await step('2026 · bán 60% cổ phần, nhận khoản tiền lớn một lần', async () => {
      await c.POST('/transactions', { type: 'income', amount: ty(28), currency: 'VND', note: 'Bán cổ phần công ty', category_name: 'Khác', date: '2026-04-15' });
      const nw = (await c.GET('/networth')).current;
      sane(nw, 'networth sau thoái vốn');
      const t = (await c.GET('/reports/trend?months=240')).trend;
      sane(t, 'trend sau thoái vốn');
      const spike = t.find((m) => m.month === '2026-04');
      must(spike && spike.income >= ty(28), 'khoản thu một lần không vào báo cáo');
      // Một tháng bất thường không được bóp méo trung bình chi tiêu.
      const avgExp = (await c.GET('/advisor/health')).health;
      sane(avgExp, 'health sau khoản thu đột biến');
      const a = await ask('mình vừa bán công ty được 28 tỷ thì nên làm gì với số tiền này');
      must(a.text.length > 80, 'không tư vấn được cho khoản tiền lớn bất ngờ');
      if (isLost(a)) finding('cao', 'Bình', 'Không xử lý được tình huống nhận khoản tiền lớn một lần', a.text.slice(0, 130));
      return `intent=${a.intent}`;
    });
  });

  await chapter('Nghỉ hưu sớm tuổi 50', async () => {
    await step('2037 · sống bằng cổ tức và trái phiếu', async () => {
      await c.POST('/income-streams', { name: 'Cổ tức danh mục', net_amount: tr(90), frequency: 'monthly', type: 'dividend', currency: 'VND' });
      await c.POST('/income-streams', { name: 'Lãi trái phiếu', net_amount: tr(45), frequency: 'monthly', type: 'interest', currency: 'VND' });
      const fire = (await c.GET('/fire')).fire;
      sane(fire, 'fire');
      const inc = (await c.GET('/income-streams')).sources || {};
      return `thụ động ${inc.passive_ratio == null ? 'chưa rõ' : pct(inc.passive_ratio)}`;
    });
  });
}

// ---------------------------------------------------------------------------

const PEOPLE = [
  { id: 1, name: 'Minh', tag: 'Sinh viên vay học phí → kỹ sư → 2 con → nghỉ hưu 60', run: minh },
  { id: 2, name: 'Lan', tag: 'Giáo viên lương thấp, không nợ, tích luỹ 35 năm', run: lan },
  { id: 3, name: 'Tuấn', tag: 'Công nhân, mất việc mùa dịch, gây dựng lại', run: tuan },
  { id: 4, name: 'Hà', tag: 'Bác sĩ, thu nhập đến muộn nhưng rất cao', run: ha },
  { id: 5, name: 'Khoa', tag: 'Khởi nghiệp thất bại, tài sản âm, làm lại từ đầu', run: khoa },
  { id: 6, name: 'Thảo', tag: 'Nghỉ việc 6 năm nuôi con rồi quay lại', run: thao },
  { id: 7, name: 'Dũng', tag: 'Ly hôn chia đôi tài sản ở tuổi 40', run: dung },
  { id: 8, name: 'Mai', tag: 'Freelancer thu nhập bấp bênh, không BHXH', run: mai },
  { id: 9, name: 'Sơn', tag: 'Xuất khẩu lao động Nhật rồi về mở xưởng', run: son },
  { id: 10, name: 'Ngọc', tag: 'Thừa kế đất: giàu tài sản, nghèo dòng tiền', run: ngoc },
  { id: 11, name: 'An', tag: 'Độc thân theo đuổi FIRE, nghỉ hưu tuổi 42', run: an },
  { id: 12, name: 'Bình', tag: 'Chủ doanh nghiệp, đa tiền tệ, bán công ty', run: binh },
];

async function runPerson(p, port) {
  const db = join(HERE, `.tmp-life-${p.id}.db`);
  for (const s of ['', '-shm', '-wal']) if (existsSync(db + s)) rmSync(db + s);

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FINMATE_DB: db, PORT: String(port), FINMATE_FX_OFFLINE: '1', FINMATE_AGENT: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b.toString(); });
  child.stderr.on('data', (b) => { log += b.toString(); });

  const base = `http://127.0.0.1:${port}/api`;
  const c = makeClient(base);
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try { up = (await fetch(`${base}/health`)).ok; } catch { /* chưa lên */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    child.kill();
    return { ...p, checks: [{ name: 'khởi động server', ok: false, note: log.slice(-300) }], chapters: [] };
  }

  const s = makeStory(c, p.name);
  process.stdout.write(`\n  ${String(p.id).padStart(2)}. ${p.name.padEnd(6)} `);
  try {
    await p.run(s);
  } catch (e) {
    s.checks.push({ name: 'câu chuyện dừng giữa chừng', ok: false, note: e.message });
    process.stdout.write('X');
  }

  child.kill();
  await new Promise((r) => setTimeout(r, 250));
  for (const suf of ['', '-shm', '-wal']) if (existsSync(db + suf)) { try { rmSync(db + suf); } catch { /* đang khoá */ } }
  return { ...p, checks: s.checks, chapters: s.chapters };
}

async function main() {
  const want = process.argv.slice(2).map(Number).filter(Boolean);
  const list = want.length ? PEOPLE.filter((p) => want.includes(p.id)) : PEOPLE;

  console.log('\n👣  MÔ PHỎNG TRỌN ĐỜI — 12 CUỘC ĐỜI TÀI CHÍNH');
  console.log('   Từ ghế nhà trường đến lúc nghỉ hưu · mỗi người một câu chuyện\n');

  const results = [];
  // Chạy tuần tự: mỗi người một server + một DB riêng. Chạy song song nhiều
  // tiến trình node:sqlite từng làm Node sập 0xC0000409.
  for (const p of list) {
    results.push(await runPerson(p, BASE_PORT + p.id));
  }

  console.log(`\n\n${'═'.repeat(78)}`);
  let pass = 0; let total = 0;
  for (const r of results) {
    const ok = r.checks.filter((x) => x.ok).length;
    pass += ok; total += r.checks.length;
    console.log(`\n${r.id}. ${r.name} — ${r.tag}`);
    console.log(`   ${ok}/${r.checks.length} bước đạt`);
    for (const ch of r.checks) console.log(`   ${ch.ok ? '✓' : '✗'} ${ch.name}${ch.note ? `\n       ${ch.note}` : ''}`);
    if (r.chapters.length) {
      console.log(`   ── Đường đời tài sản ròng:`);
      for (const ch of r.chapters) console.log(`      ${ch.label.padEnd(26)} ${short(ch.net).padStart(12)}`);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`TỔNG: ${pass}/${total} bước đạt trên ${results.length} cuộc đời\n`);

  if (FINDINGS.length) {
    console.log(`${'─'.repeat(78)}`);
    console.log(`VẤN ĐỀ PHÁT HIỆN (${FINDINGS.length}):\n`);
    for (const f of FINDINGS) console.log(`  [${f.sev}] ${f.who} — ${f.title}\n      ${f.detail}`);
  } else {
    console.log('Không phát hiện vấn đề nào qua 12 cuộc đời.\n');
  }

  process.exit(pass === total ? 0 : 1);
}

main();
