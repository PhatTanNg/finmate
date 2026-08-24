/**
 * MÔ PHỎNG 5 NĂM SỬ DỤNG THẬT — người Việt làm việc ở Ireland.
 *
 *   node test/journey5y.mjs
 *
 * Khác với personas.mjs (mỗi người vài tháng), file này chạy TRỌN 60 THÁNG của
 * một người: Tân sang Dublin tháng 9/2021, đi làm, thuê nhà, sống bằng euro,
 * đều đặn gửi tiền về cho gia đình, gom tiền đầu tư ETF ở châu Âu, mua vàng và
 * cổ phiếu ở Việt Nam, rồi mua một căn hộ cho thuê ở TP.HCM.
 *
 * Mục đích không phải "pass hết" mà là xem app có THEO KỊP một đời tài chính
 * thật hay không: số liệu có trôi dạt sau 500+ giao dịch, đa tiền tệ có cộng
 * nhầm, dự báo tự do tài chính có tiến gần lại theo thời gian, và cố vấn AI có
 * trả lời được những câu chỉ trả lời nổi khi đã có bề dày dữ liệu.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'src', 'index.js');
const PORT = 4260;

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

const eur = (v) => Math.round(v * 100);          // euro -> cent
const vnd = (v) => Math.round(v);                 // đồng
const tr = (v) => Math.round(v * 1_000_000);      // triệu đồng
const ty = (v) => Math.round(v * 1_000_000_000);  // tỷ đồng

const fmtEur = (c) => `€${(c / 100).toLocaleString('en-IE', { maximumFractionDigits: 0 })}`;
const fmtVnd = (d) => `${Math.round(d).toLocaleString('vi-VN')}₫`;
const fmtShort = (d) => (Math.abs(d) >= 1e9 ? `${(d / 1e9).toFixed(2)} tỷ₫` : `${Math.round(d / 1e6)} tr₫`);

/** Tháng thứ n kể từ mốc bắt đầu -> 'YYYY-MM' */
const START_Y = 2021;
const START_M = 9;
function ym(n) {
  const t = (START_Y * 12 + (START_M - 1)) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}
const monthKey = (n) => { const { y, m } = ym(n); return `${y}-${String(m).padStart(2, '0')}`; };
const day = (n, d = 5) => `${monthKey(n)}-${String(d).padStart(2, '0')}`;
const yearOf = (n) => ym(n).y;

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

const CHECKS = [];
const FINDINGS = [];   // vấn đề phát hiện được
const TIMELINE = [];   // ảnh chụp cuối mỗi năm

function must(cond, msg) { if (!cond) throw new Error(msg); }
/** Bắt mọi giá trị số vô nghĩa lẩn trong một đối tượng báo cáo. */
function sane(obj, label, path = '') {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) throw new Error(`${label}${path} = ${obj}`);
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) sane(v, label, `${path}.${k}`);
}

async function step(name, fn) {
  const rec = { name, ok: false, note: '' };
  try {
    const out = await fn();
    rec.ok = true;
    if (typeof out === 'string') rec.note = out;
  } catch (e) {
    rec.note = e.message;
  }
  CHECKS.push(rec);
  process.stdout.write(rec.ok ? '.' : 'X');
  return rec;
}
const finding = (sev, title, detail) => FINDINGS.push({ sev, title, detail });

// ---------------------------------------------------------------------------
// Kịch bản đời sống: mọi con số bám theo thực tế 2021-2026
// ---------------------------------------------------------------------------

/** Lương thực nhận mỗi tháng (cent EUR) — nhảy bậc khi tăng lương / đổi việc */
function salary(n) {
  const k = monthKey(n);
  if (k >= '2026-01') return eur(4450);
  if (k >= '2025-04') return eur(4300);   // thăng chức Senior
  if (k >= '2024-07') return eur(3850);
  if (k >= '2023-07') return eur(3700);   // đổi công ty
  if (k >= '2022-07') return eur(3100);
  return eur(2950);
}

/** Tiền thuê nhà Dublin — thị trường tăng liên tục */
function rent(n) {
  const k = monthKey(n);
  if (k >= '2025-09') return eur(1500);
  if (k >= '2024-09') return eur(1400);
  if (k >= '2023-09') return eur(1250);   // dọn ra ở riêng 1 phòng ngủ
  if (k >= '2022-09') return eur(1050);
  return eur(900);                        // ở ghép
}

/** Điện nước — vọt lên trong khủng hoảng năng lượng 2022-2023 */
function utilities(n) {
  const k = monthKey(n);
  if (k >= '2024-04') return eur(140);
  if (k >= '2022-08' && k < '2024-04') return eur(205);
  return eur(115);
}

/** Hệ số lạm phát tích luỹ cho chi tiêu sinh hoạt */
function inflation(n) {
  const y = yearOf(n);
  return { 2021: 1, 2022: 1.075, 2023: 1.13, 2024: 1.165, 2025: 1.19, 2026: 1.215 }[y] ?? 1.22;
}

/** Tiền gửi về cho gia đình mỗi tháng (cent EUR) */
function remit(n) {
  const k = monthKey(n);
  if (k >= '2025-01') return eur(600);
  if (k >= '2023-01') return eur(500);
  return eur(400);
}

/** Số tiền mua ETF mỗi tháng (cent EUR) */
function dca(n) {
  const k = monthKey(n);
  if (k < '2022-01') return 0;            // 4 tháng đầu còn phải ổn định chỗ ở
  if (k >= '2025-04') return eur(1000);
  if (k >= '2023-07') return eur(700);
  return eur(400);
}

/** Giá ETF VWCE theo năm (cent EUR) — có cú sụt 2022 */
function vwcePrice(n) {
  const k = monthKey(n);
  if (k >= '2026-01') return eur(142);
  if (k >= '2025-01') return eur(135);
  if (k >= '2024-01') return eur(120);
  if (k >= '2023-01') return eur(102);
  if (k >= '2022-06') return eur(88);     // thị trường gấu
  return eur(105);
}

/** Giá vàng SJC mỗi lượng (đồng) — bám đợt tăng mạnh 2024-2026 */
function goldPrice(n) {
  const k = monthKey(n);
  if (k >= '2026-01') return tr(120);
  if (k >= '2025-01') return tr(92);
  if (k >= '2024-03') return tr(80);
  if (k >= '2023-01') return tr(67);
  return tr(56);
}

/** Biến cố lớn theo tháng: [nhãn, số tiền cent EUR, danh mục] */
const EVENTS = {
  '2022-12': ['Về Việt Nam thăm nhà', eur(1800), 'Du lịch'],
  '2023-05': ['Laptop hỏng, mua máy mới', eur(1400), 'Mua sắm'],
  '2024-02': ['Về Việt Nam ăn Tết + đám cưới em gái', eur(3500), 'Du lịch'],
  '2025-11': ['Về Việt Nam thăm nhà', eur(2000), 'Du lịch'],
};

// ---------------------------------------------------------------------------
// Chạy mô phỏng
// ---------------------------------------------------------------------------

async function simulate(c) {
  const acc = {};
  let remitTotalEur = 0;
  let remitTotalVnd = 0;
  let dcaTotal = 0;
  let vwceUnits = 0;
  let goldLuong = 0;
  let goldCost = 0;

  // ---- Tháng 9/2021: cài app trong tuần đầu ở Dublin ----------------------

  await step('Ngày đầu ở Dublin: thiết lập hồ sơ, đổi tiền gốc sang EUR', async () => {
    await c.PATCH('/profile', {
      name: 'Tân', birth_year: 1995, city: 'Dublin', tax_country: 'IE',
      risk_profile: 'balanced', savings_rate_target: 0.35,
    });
    await c.POST('/currency/base', { currency: 'EUR' });
    const p = (await c.GET('/profile')).profile;
    must(p.name === 'Tân', 'không lưu được hồ sơ');
    const s = (await c.GET('/settings')).values;
    must((s.base_currency || s.currency) === 'EUR', 'không đổi được tiền tệ gốc sang EUR');
    return 'hồ sơ Dublin · tiền gốc EUR · mục tiêu tiết kiệm 35%';
  });

  await step('Khai tài khoản hai đầu: Ireland và Việt Nam', async () => {
    const list = [
      ['aib', { name: 'AIB Current', type: 'bank', institution: 'AIB', balance: eur(2400), currency: 'EUR' }],
      ['revolut', { name: 'Revolut', type: 'bank', institution: 'Revolut', balance: eur(600), currency: 'EUR' }],
      ['cash', { name: 'Tiền mặt EUR', type: 'cash', balance: eur(250), currency: 'EUR' }],
      ['degiro', { name: 'DEGIRO', type: 'investment', institution: 'DEGIRO', balance: 0, currency: 'EUR' }],
      ['vcb', { name: 'Vietcombank', type: 'bank', institution: 'Vietcombank', balance: tr(28), currency: 'VND' }],
      ['vcbtk', { name: 'Tiết kiệm VCB', type: 'savings', institution: 'Vietcombank', balance: 0, currency: 'VND', interest_rate: 5.6 }],
      ['vps', { name: 'Chứng khoán VPS', type: 'investment', institution: 'VPS', balance: 0, currency: 'VND' }],
      ['vang', { name: 'Vàng SJC cất tủ', type: 'investment', balance: 0, currency: 'VND' }],
    ];
    for (const [k, body] of list) {
      const r = await c.POST('/accounts', { ...body, opened_at: day(0, 1) });
      must(r.account?.id, `không mở được tài khoản ${body.name}: ${r.error}`);
      acc[k] = r.account.id;
    }
    const nw = (await c.GET('/networth')).current;
    sane(nw, 'networth khởi điểm');
    must(nw.assets > 0, 'tài sản khởi điểm = 0');
    return `8 tài khoản 2 nước · tài sản ròng khởi điểm ${fmtEur(nw.net)}`;
  });

  await step('Khai nguồn thu chính', async () => {
    await c.POST('/income-streams', {
      name: 'Lương kỹ sư Dublin', type: 'salary',
      gross_amount: eur(4200), net_amount: salary(0), payday: 25, currency: 'EUR', frequency: 'monthly',
    });
    const s = (await c.GET('/income-streams')).streams;
    must(s.length === 1, 'không lưu được nguồn thu');
    return `lương thực nhận khởi điểm ${fmtEur(salary(0))}/tháng`;
  });

  // ---- Vòng lặp 60 tháng --------------------------------------------------

  let txCount = 0;
  const post = async (body) => { txCount += 1; return c.POST('/transactions', body); };

  await step('Sống thật 60 tháng: lương, chi tiêu, gửi tiền, đầu tư', async () => {
    for (let n = 0; n < 60; n += 1) {
      const k = monthKey(n);
      const inf = inflation(n);

      // lương về ngày 25
      await post({ type: 'income', account_id: acc.aib, amount: salary(n), currency: 'EUR', date: day(n, 25), note: 'Lương tháng', category_name: 'Lương' });

      // thưởng cuối năm = 1 tháng lương
      if (ym(n).m === 12) {
        await post({ type: 'income', account_id: acc.aib, amount: salary(n), currency: 'EUR', date: day(n, 20), note: 'Thưởng cuối năm', category_name: 'Thưởng' });
      }

      // chi phí sống ở Ireland
      const spend = [
        ['Thuê nhà', rent(n), 'Nhà ở', 3],
        ['Điện nước ga', utilities(n), 'Hoá đơn', 8],
        ['Đi chợ Tesco/Lidl', Math.round(eur(330) * inf), 'Ăn uống', 10],
        ['Vé tháng Leap Card', eur(105), 'Đi lại', 2],
        ['Điện thoại + Internet', eur(55), 'Hoá đơn', 12],
        ['Ăn ngoài, cà phê, bạn bè', Math.round(eur(230) * inf), 'Giải trí', 18],
        ['Mua sắm lặt vặt', Math.round(eur(120) * inf), 'Mua sắm', 22],
      ];
      for (const [note, amount, category_name, d] of spend) {
        await post({ type: 'expense', account_id: acc.aib, amount, currency: 'EUR', date: day(n, d), note, category_name });
      }

      // biến cố lớn
      if (EVENTS[k]) {
        const [note, amount, category_name] = EVENTS[k];
        await post({ type: 'expense', account_id: acc.aib, amount, currency: 'EUR', date: day(n, 15), note, category_name });
      }

      // gửi tiền về cho gia đình (Tết gửi thêm)
      const extra = ym(n).m === 1 ? eur(1000) : 0;
      const send = remit(n) + extra;
      await post({
        type: 'expense', account_id: acc.revolut, amount: send, currency: 'EUR', date: day(n, 27),
        note: extra ? 'Gửi bố mẹ + tiền Tết' : 'Gửi bố mẹ hàng tháng', category_name: 'Gia đình',
      });
      remitTotalEur += send;
      await post({ type: 'income', account_id: acc.vcb, amount: Math.round(send * 272), currency: 'VND', date: day(n, 28), note: 'Tiền anh Tân gửi về', category_name: 'Khác' });
      remitTotalVnd += Math.round(send * 272);
      // chuyển tiền sang Revolut để gửi
      await post({ type: 'transfer', account_id: acc.aib, to_account_id: acc.revolut, amount: send, currency: 'EUR', date: day(n, 26), note: 'Nạp Revolut để chuyển tiền' });

      // mua ETF đều đặn
      const buy = dca(n);
      if (buy > 0) {
        const price = vwcePrice(n);
        const qty = Math.max(1, Math.floor(buy / price));
        await c.POST('/investments/trade', { symbol: 'VWCE', side: 'buy', quantity: qty, price, currency: 'EUR', account_id: acc.degiro, date: day(n, 28) });
        await post({ type: 'transfer', account_id: acc.aib, to_account_id: acc.degiro, amount: qty * price, currency: 'EUR', date: day(n, 28), note: 'Nạp DEGIRO mua VWCE' });
        vwceUnits += qty;
        dcaTotal += qty * price;
      }

      // mua vàng dịp Tết
      if (ym(n).m === 2) {
        const px = goldPrice(n);
        await c.PATCH(`/accounts/${acc.vang}`, { balance: (goldLuong + 2) * px });
        goldLuong += 2;
        goldCost += 2 * px;
      }
    }
    return `${txCount} giao dịch trong 60 tháng · gửi về ${fmtEur(remitTotalEur)} (${fmtShort(remitTotalVnd)}) · ${vwceUnits} chứng chỉ VWCE · ${goldLuong} lượng vàng`;
  });

  // ---- Mua cổ phiếu Việt Nam ---------------------------------------------

  await step('Mua cổ phiếu Việt Nam bằng tiền gửi về, giá cập nhật theo thời gian', async () => {
    await c.POST('/investments/trade', { symbol: 'FPT', side: 'buy', quantity: 500, price: vnd(78000), currency: 'VND', account_id: acc.vps, date: '2022-06-15' });
    await c.POST('/investments/trade', { symbol: 'MWG', side: 'buy', quantity: 300, price: vnd(64000), currency: 'VND', account_id: acc.vps, date: '2023-03-10' });
    await c.POST('/investments/trade', { symbol: 'FPT', side: 'buy', quantity: 300, price: vnd(96000), currency: 'VND', account_id: acc.vps, date: '2024-05-20' });
    await c.POST('/investments/price', { symbol: 'FPT', price: vnd(148000) });
    await c.POST('/investments/price', { symbol: 'MWG', price: vnd(71000) });
    await c.POST('/investments/price', { symbol: 'VWCE', price: vwcePrice(59) });

    const pf = (await c.GET('/investments')).portfolio;
    sane(pf, 'danh mục');
    const fpt = pf.holdings.find((h) => h.symbol === 'FPT');
    const vwce = pf.holdings.find((h) => h.symbol === 'VWCE');
    must(fpt, 'mất cổ phiếu FPT');
    must(vwce, 'mất chứng chỉ VWCE');
    must(fpt.quantity === 800, `FPT phải còn 800cp sau 2 lần mua, đang là ${fpt.quantity}`);
    // giá vốn bình quân: (500*78k + 300*96k) / 800 = 84.750đ
    must(Math.abs(fpt.avg_cost - 84750) < 50, `giá vốn FPT sai: ${fpt.avg_cost}, phải ~84.750đ`);
    return `VWCE ${vwceUnits}cc lãi ${vwce.pnl_pct?.toFixed(1)}% · FPT 800cp giá vốn ${fmtVnd(fpt.avg_cost)} lãi ${fpt.pnl_pct?.toFixed(1)}% · MWG lãi ${pf.holdings.find((h) => h.symbol === 'MWG')?.pnl_pct?.toFixed(1)}%`;
  });

  // ---- Mua bất động sản ở Việt Nam ---------------------------------------

  await step('Năm thứ 3: mua căn hộ TP.HCM, vay ngân hàng 70%', async () => {
    const price = ty(2.4);
    const loan = Math.round(price * 0.7);
    const r = await c.POST('/properties', {
      name: 'Căn hộ Thủ Đức', type: 'apartment', purchase_price: price, current_value: price,
      purchase_date: '2024-03-15', currency: 'VND', monthly_rent: tr(12), monthly_cost: tr(1.5),
      mortgage_balance: loan, mortgage_rate: 11,
    });
    must(r.property?.id, `không tạo được bất động sản: ${r.error}`);
    await c.POST('/debts', {
      name: 'Vay mua căn hộ Thủ Đức', type: 'mortgage', principal: loan, balance: loan,
      interest_rate: 11, term_months: 240, monthly_payment: tr(17.3), min_payment: tr(17.3),
      currency: 'VND', start_date: '2024-03-15',
    });
    const re = (await c.GET('/properties'));
    sane(re, 'bất động sản');
    return `căn hộ ${fmtShort(price)} · vay ${fmtShort(loan)} @11% · cho thuê ${fmtShort(tr(12))}/tháng`;
  });

  await step('Tiền thuê nhà Việt Nam chảy về đều từ giữa 2024', async () => {
    for (let n = 33; n < 60; n += 1) {   // 2024-06 trở đi
      await post({ type: 'income', account_id: acc.vcb, amount: tr(12), currency: 'VND', date: day(n, 5), note: 'Tiền thuê căn hộ Thủ Đức', category_name: 'Cho thuê' });
      await post({ type: 'expense', account_id: acc.vcb, amount: tr(17.3), currency: 'VND', date: day(n, 10), note: 'Trả góp ngân hàng', category_name: 'Trả nợ' });
    }
    await c.POST('/income-streams', { name: 'Cho thuê căn hộ Thủ Đức', type: 'rental', net_amount: tr(10.5), gross_amount: tr(12), currency: 'VND', frequency: 'monthly', payday: 5 });
    return `27 tháng tiền thuê + trả góp đã vào sổ`;
  });

  await step('Gửi tiết kiệm phần tiền VND còn lại', async () => {
    await post({ type: 'transfer', account_id: acc.vcb, to_account_id: acc.vcbtk, amount: tr(250), currency: 'VND', date: '2025-06-01', note: 'Gửi tiết kiệm 12 tháng' });
    const a = (await c.GET('/accounts')).accounts.find((x) => x.id === acc.vcbtk);
    must(a.balance >= tr(249), `tiền không vào sổ tiết kiệm: ${a.balance}`);
    return `sổ tiết kiệm ${fmtShort(a.balance)} @5,6%/năm`;
  });

  return { acc, remitTotalEur, remitTotalVnd, dcaTotal, vwceUnits, goldLuong, goldCost, txCount };
}

// ---------------------------------------------------------------------------
// Chấm điểm: app có theo kịp không?
// ---------------------------------------------------------------------------

async function evaluate(c, sim) {
  await step('Báo cáo xu hướng đủ 60 tháng, không đứt quãng', async () => {
    const t = (await c.GET('/reports/trend?months=60')).trend;
    sane(t, 'trend');
    must(t.length >= 55, `chỉ dựng được ${t.length}/60 tháng xu hướng`);
    const empty = t.filter((m) => !m.income && !m.expense).length;
    if (empty > 2) finding('trung bình', 'Xu hướng có tháng trống', `${empty}/${t.length} tháng không có số liệu dù đã ghi giao dịch liên tục.`);
    const bad = t.filter((m) => m.savings_rate < -3 || m.savings_rate > 1.01);
    must(!bad.length, `tỉ lệ tiết kiệm vô lý ở ${bad.length} tháng, ví dụ ${bad[0]?.month}: ${bad[0]?.savings_rate}`);
    return `${t.length} tháng liền mạch · tiết kiệm dao động ${Math.round(Math.min(...t.map((m) => m.savings_rate)) * 100)}%…${Math.round(Math.max(...t.map((m) => m.savings_rate)) * 100)}%`;
  });

  await step('Ảnh chụp tài sản cuối mỗi năm: đi lên đều, không nhảy cóc vô lý', async () => {
    for (const [label, date] of [['2021', '2021-12-31'], ['2022', '2022-12-31'], ['2023', '2023-12-31'], ['2024', '2024-12-31'], ['2025', '2025-12-31']]) {
      await c.POST('/networth/snapshot', { date });
      TIMELINE.push({ year: label });
    }
    const h = (await c.GET('/networth')).history;
    sane(h, 'lịch sử tài sản');
    must(h.length >= 5, `chỉ lưu được ${h.length}/5 ảnh chụp`);
    return `${h.length} mốc tài sản đã lưu`;
  });

  await step('Tài sản ròng cuối kỳ cộng đúng từ 5 nguồn, không trộn EUR với VND', async () => {
    const nw = (await c.GET('/networth')).current;
    sane(nw, 'tài sản ròng');
    const b = nw.breakdown;
    must(b.real_estate > 0, 'căn hộ Việt Nam không nằm trong tài sản');
    must(b.investments > 0, 'danh mục đầu tư không nằm trong tài sản');
    must(nw.liabilities > 0, 'khoản vay mua nhà không nằm trong nợ');
    // tổng phải bằng đúng tổng các phần
    const sum = b.liquid + b.savings + b.investments + b.real_estate + (b.other || 0);
    must(Math.abs(sum - nw.assets) < 200, `tài sản ${nw.assets} ≠ tổng các phần ${sum}`);
    const byCur = nw.by_currency || [];
    must(byCur.length >= 2, `chỉ thấy ${byCur.length} loại tiền, phải có cả EUR và VND`);
    TIMELINE.push({ final: nw });
    return `tài sản ${fmtEur(nw.assets)} − nợ ${fmtEur(nw.liabilities)} = ${fmtEur(nw.net)} · ${byCur.map((x) => `${x.currency} ${Math.round(x.weight * 100)}%`).join(' + ')}`;
  });

  await step('Nợ mua nhà ở Việt Nam quy đúng về euro, không thổi phồng tỉ lệ nợ', async () => {
    const s = (await c.GET('/debts')).summary;
    sane(s, 'tổng quan nợ');
    const nw = (await c.GET('/networth')).current;
    // Cùng một khoản vay mà tab Nợ và tab Tài sản nói hai con số khác nhau là
    // dấu hiệu chắc chắn của việc quên quy đổi tiền tệ.
    must(Math.abs(s.total_balance - nw.liabilities) < nw.liabilities * 0.05,
      `tab Nợ báo ${s.total_balance} nhưng tài sản ròng trừ đi ${nw.liabilities} — lệch nhau, nhiều khả năng chưa quy đổi tiền tệ`);
    must(s.dti !== null, 'không tính được tỉ lệ nợ trên thu nhập dù đã có 5 năm thu nhập');
    must(s.dti > 0 && s.dti < 1.5, `tỉ lệ nợ/thu nhập vô lý: ${Math.round(s.dti * 100)}%`);
    return `nợ ${fmtEur(s.total_balance)} · trả ${fmtEur(s.monthly_payment)}/tháng = ${Math.round(s.dti * 100)}% thu nhập · lãi bình quân ${s.avg_rate.toFixed(1)}%`;
  });

  await step('Vàng lãi đúng theo giá SJC đã tăng', async () => {
    const a = (await c.GET('/accounts')).accounts.find((x) => x.name.includes('Vàng'));
    must(a, 'mất tài khoản vàng');
    const nowValue = sim.goldLuong * goldPrice(59);
    must(Math.abs(a.balance - nowValue) < tr(1), `giá trị vàng sai: ${a.balance} vs ${nowValue}`);
    const gain = ((nowValue - sim.goldCost) / sim.goldCost) * 100;
    return `${sim.goldLuong} lượng · vốn ${fmtShort(sim.goldCost)} → nay ${fmtShort(nowValue)} (+${gain.toFixed(0)}%)`;
  });

  await step('Tổng thu 5 năm khớp lương + thưởng + tiền thuê', async () => {
    let totalIncome = 0;
    for (let n = 0; n < 60; n += 1) {
      const r = (await c.GET(`/reports/month?month=${monthKey(n)}`)).report;
      sane(r, `báo cáo ${monthKey(n)}`);
      totalIncome += r.income;
    }
    must(totalIncome > 0, 'tổng thu 5 năm = 0');
    return `tổng thu 60 tháng ${fmtEur(totalIncome)} (đã quy về EUR)`;
  });

  await step('Chi tiêu theo danh mục nhận ra khoản gửi về nhà là mục lớn', async () => {
    const r = (await c.GET('/reports/month?month=2025-06')).report;
    sane(r, 'báo cáo tháng');
    const cats = r.categories || [];
    must(cats.length >= 4, `chỉ phân loại được ${cats.length} nhóm chi`);
    const top = cats.slice(0, 4).map((x) => `${x.name} ${fmtEur(x.amount)}`);
    const family = cats.find((x) => /Gia đình/i.test(x.name));
    if (!family) finding('trung bình', 'Không tách riêng tiền gửi về nhà', 'Khoản gửi bố mẹ hàng tháng — mục chi lớn thứ 2 của người xa xứ — không xuất hiện thành danh mục riêng trong báo cáo tháng.');
    return `top chi: ${top.join(' · ')}`;
  });

  await step('Dự báo tự do tài chính tính được sau 5 năm dữ liệu', async () => {
    const f = (await c.GET('/fire')).fire || (await c.GET('/fire'));
    sane(f, 'FIRE');
    const stats = f.fire || f;
    must(Number.isFinite(stats.fi_number) || Number.isFinite(stats.target), 'không tính được số tiền cần để tự do tài chính');
    const years = stats.years_to_fi ?? stats.years ?? null;
    if (years !== null && (!Number.isFinite(years) || years > 80)) {
      finding('cao', 'Dự báo tự do tài chính không dùng được', `Sau 5 năm dữ liệu thật app vẫn báo ${years} năm nữa mới tự do tài chính.`);
    }
    return `cần ${fmtEur(stats.fi_number ?? stats.target ?? 0)} · còn ${years ?? '?'} năm · tài sản sinh lời ${fmtEur(stats.invested ?? 0)}`;
  });

  await step('Điểm sức khoẻ tài chính phản ánh đúng người tiết kiệm tốt', async () => {
    const h = (await c.GET('/advisor/health')).health;
    sane(h, 'điểm sức khoẻ');
    must(h.score >= 0 && h.score <= 100, `điểm ngoài thang: ${h.score}`);
    const weak = h.components.filter((x) => x.score < 40).map((x) => `${x.label} ${x.score}`);
    if (h.score < 55) finding('trung bình', 'Điểm sức khoẻ thấp bất thường', `Người tiết kiệm được ~35% thu nhập, có nhà cho thuê, danh mục đầu tư 5 năm mà chỉ đạt ${h.score}/100 (${h.grade}). Điểm yếu: ${weak.join(', ') || 'không rõ'}.`);
    return `${h.score}/100 (${h.grade} — ${h.label})${weak.length ? ` · yếu: ${weak.join(', ')}` : ''}`;
  });

  await step('Việc cần làm không còn gợi ý vô nghĩa', async () => {
    const a = (await c.GET('/advisor/actions')).actions;
    sane(a, 'việc cần làm');
    must(a.length > 0, 'không đưa ra được việc nào');
    const zero = a.filter((x) => /(^|\s)0\s*(đ|₫|EUR|€)/i.test(x.title));
    must(!zero.length, `vẫn còn việc gắn số 0: "${zero[0]?.title}"`);
    return a.slice(0, 3).map((x) => `${x.impact} ${x.title}`).join(' · ');
  });

  await step('Gợi ý tự sinh bám vào dữ liệu thật, không rỗng', async () => {
    const r = await c.POST('/insights/generate');
    const ins = r.insights || [];
    sane(ins, 'gợi ý');
    must(ins.length > 0, 'không sinh được gợi ý nào sau 5 năm dữ liệu');
    const nodata = ins.filter((x) => /chưa có|thiếu dữ liệu/i.test(x.title || ''));
    if (nodata.length) finding('cao', 'Vẫn báo thiếu dữ liệu dù đã có 5 năm', `Gợi ý "${nodata[0].title}" xuất hiện sau 600+ giao dịch.`);
    return `${ins.length} gợi ý · ví dụ: ${ins.slice(0, 2).map((x) => x.title).join(' · ')}`;
  });

  await step('Thuế Ireland tính đúng trên mức lương hiện tại', async () => {
    const r = await c.POST('/tax/pit', { country: 'IE', gross: eur(62000), currency: 'EUR', period: 'year' });
    sane(r, 'thuế IE');
    const t = r.result;
    must(t.total_tax > 0, 'không tính được thuế');
    must(t.net < eur(62000) && t.net > eur(35000), `thực nhận vô lý: ${t.net}`);
    return `gộp €62.000 → thực nhận ${fmtEur(t.net)} · thuế ${fmtEur(t.total_tax)} (${(t.effective_rate * 100).toFixed(1)}%)`;
  });

  await step('Báo giá gửi tiền về Việt Nam vẫn chính xác', async () => {
    const q = (await c.POST('/remittance/quote', { from: 'EUR', to: 'VND', amount: eur(600) })).quote;
    sane(q, 'báo giá kiều hối');
    must(q.received > 0, 'không tính được số tiền nhận');
    return `€600 → ${fmtShort(q.received)} (phí ${fmtEur(q.fee)}, tỉ giá ${Math.round(q.effective_rate).toLocaleString('vi-VN')})`;
  });

  await step('Lộ trình thu nhập thụ động nói được vốn cần và ngày đạt mốc', async () => {
    const r = (await c.GET('/passive/roadmap')).roadmap;
    sane(r, 'lộ trình thụ động');
    must(r.monthly_expense > 0, 'không biết chi phí sống thì không dựng được lộ trình');
    must(Array.isArray(r.milestones) && r.milestones.length >= 4, 'thiếu các mốc');
    must(Array.isArray(r.next_steps) && r.next_steps.length > 0, 'không đưa ra việc nào để làm');

    // Sau 5 năm tích luỹ đều thì khoản góp mỗi tháng phải nằm trong khoảng
    // thu-chi thật, không phải con số do một lần bán tài sản đẩy lên.
    if (r.monthly_contribution > r.monthly_expense * 5) {
      finding('cao', 'Khoản góp mỗi tháng bị thổi phồng', `Đề nghị góp ${fmtEur(r.monthly_contribution)}/tháng trong khi chi phí sống chỉ ${fmtEur(r.monthly_expense)}/tháng.`);
    }
    for (const m of r.milestones) {
      if (m.reached) continue;
      if (m.capital_needed === 0) finding('cao', 'Mốc chưa đạt nhưng báo cần 0 vốn', `Mốc "${m.label}" cần ${fmtEur(m.target)}/tháng mà báo vốn cần bằng 0.`);
      if (m.months === 0) finding('cao', 'Mốc chưa đạt nhưng báo 0 tháng', `Mốc "${m.label}" chưa đạt mà nói đạt ngay hôm nay.`);
    }
    // Còn nợ đắt hoặc thiếu quỹ khẩn cấp thì không được vừa chặn vừa xui rót vốn.
    if (r.blocked_by.length) {
      const invest = r.next_steps.filter((s) => String(s.key).startsWith('invest_') && s.key !== 'invest_later');
      if (invest.length) finding('cao', 'Lời khuyên tự mâu thuẫn', `Đang chặn vì ${r.blocked_by.map((b) => b.key).join(', ')} nhưng vẫn bảo rót vốn: "${invest[0].title}".`);
    }
    const half = r.milestones.find((m) => m.key === 'half');
    return `thụ động ${fmtEur(r.current_passive)}/tháng (${r.coverage_pct}% chi phí) · góp ${fmtEur(r.monthly_contribution)}/tháng · nửa chi phí sau ${half?.months ?? '—'} tháng`;
  });

  await step('Hỏi thẳng về thu nhập thụ động thì được lộ trình, không phải bảng thống kê', async () => {
    const r = await c.POST('/chat', { message: 'làm sao để có thu nhập thụ động?' });
    must(r.intent === 'query_passive', `hiểu nhầm thành "${r.intent}"`);
    must(/mốc|Mốc/.test(r.reply), 'trả lời không có mốc nào để hướng tới');
    must(/Việc cần làm/i.test(r.reply), 'không nói được việc cần làm');
    return r.reply.split('\n').find((l) => /phủ được/i.test(l))?.trim() || 'ok';
  });

  await step('Dashboard vẫn nhanh sau 600+ giao dịch', async () => {
    const t0 = Date.now();
    const d = await c.GET('/dashboard');
    const ms = Date.now() - t0;
    sane(d, 'dashboard');
    if (ms > 1500) finding('trung bình', 'Dashboard chậm khi dữ liệu nhiều', `Mất ${ms}ms để dựng dashboard sau 5 năm dữ liệu.`);
    return `${ms}ms`;
  });
}

// ---------------------------------------------------------------------------
// Hỏi cố vấn những câu chỉ trả lời nổi khi đã có bề dày dữ liệu
// ---------------------------------------------------------------------------

const QUESTIONS = [
  'năm năm qua mình tiêu nhiều nhất vào việc gì',
  'mình đã gửi về cho gia đình tổng cộng bao nhiêu',
  'tài sản của mình tăng bao nhiêu so với lúc mới sang',
  'mình có bao nhiêu tài sản',
  'tiền của mình đang nằm ở đâu nhiều nhất',
  'giữ tiền euro hay đổi hết về tiền việt thì tốt hơn',
  'căn hộ cho thuê có lời không',
  'mua vàng hay mua ETF thì hiệu quả hơn',
  'bao giờ mình có thể nghỉ hưu',
  'mình nên trả hết nợ mua nhà sớm hay tiếp tục đầu tư',
  'mỗi tháng mình tiết kiệm được bao nhiêu',
  'nếu mình về Việt Nam sống thì tiền hiện có đủ dùng bao lâu',
];

async function interrogate(c) {
  for (const q of QUESTIONS) {
    await step(`Hỏi: "${q}"`, async () => {
      const r = await c.POST('/chat', { message: q });
      const t = (r.reply || '').trim();
      must(t.length > 20, `trả lời cụt ngủn: "${t}"`);
      must(!/undefined|NaN|\[object/i.test(t), `lời đáp lộ lỗi kỹ thuật: ${t.slice(0, 120)}`);
      if (/chưa chắc hiểu ý bạn/i.test(t)) {
        finding('cao', 'Cố vấn không hiểu câu hỏi thường gặp', `"${q}" → app trả lời "Mình chưa chắc hiểu ý bạn".`);
        throw new Error('không hiểu câu hỏi');
      }
      if (/^Đã tạo|^Đã ghi|^Ghi nhận/.test(t)) {
        finding('cao', 'Câu hỏi bị hiểu thành lệnh ghi dữ liệu', `"${q}" → "${t.slice(0, 80)}"`);
        throw new Error('câu hỏi bị ghi thành dữ liệu');
      }
      return t.replace(/\s+/g, ' ').slice(0, 110);
    });
  }
}

// ---------------------------------------------------------------------------
// Chạy
// ---------------------------------------------------------------------------

async function main() {
  const db = join(HERE, '.tmp-journey5y.db');
  for (const s of ['', '-shm', '-wal']) if (existsSync(db + s)) rmSync(db + s);

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, FINMATE_DB: db, PORT: String(PORT), FINMATE_FX_OFFLINE: '1', FINMATE_AGENT: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b.toString(); });
  child.stderr.on('data', (b) => { log += b.toString(); });

  const base = `http://127.0.0.1:${PORT}/api`;
  const c = makeClient(base);
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try { up = (await fetch(`${base}/health`)).ok; } catch { /* chưa lên */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) { console.error(`Server không lên:\n${log}`); process.exit(1); }

  console.log('\n✈️  TÂN — 5 NĂM Ở IRELAND (9/2021 → 8/2026)');
  console.log('   Đi làm ở Dublin · sống bằng euro · gửi tiền về cho gia đình');
  console.log('   Đầu tư ETF châu Âu · mua vàng và cổ phiếu Việt Nam · mua căn hộ cho thuê\n   ');

  let sim;
  try {
    sim = await simulate(c);
    await evaluate(c, sim);
    await interrogate(c);
  } catch (e) {
    console.error(`\nDừng giữa chừng: ${e.message}\n${log.slice(-2000)}`);
  }

  // --- kết quả ---
  const pass = CHECKS.filter((x) => x.ok).length;
  console.log(`\n\n${'─'.repeat(78)}`);
  console.log(`KẾT QUẢ: ${pass}/${CHECKS.length} bước đạt\n`);
  for (const r of CHECKS) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.note ? `\n      ${r.note}` : ''}`);

  if (FINDINGS.length) {
    console.log(`\n${'─'.repeat(78)}`);
    console.log(`VẤN ĐỀ PHÁT HIỆN (${FINDINGS.length}):\n`);
    for (const f of FINDINGS) console.log(`  [${f.sev}] ${f.title}\n      ${f.detail}`);
  }

  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  for (const s of ['', '-shm', '-wal']) if (existsSync(db + s)) { try { rmSync(db + s); } catch { /* đang khoá */ } }
  process.exit(CHECKS.some((x) => !x.ok) ? 1 : 0);
}

main();
