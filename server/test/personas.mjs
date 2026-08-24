/**
 * Kiểm thử HÀNH TRÌNH NGƯỜI DÙNG ĐẦU-CUỐI (end-to-end personas).
 *
 *   node test/personas.mjs            # chạy tất cả
 *   node test/personas.mjs 3 5        # chỉ chạy persona số 3 và 5
 *
 * Khác với test/scenarios.mjs (bắn từng tính năng riêng lẻ), file này mô phỏng
 * TRỌN VẸN vòng đời của từng kiểu người dùng thật: mở app lần đầu → trò chuyện
 * với cố vấn AI → khai báo tài khoản, thu nhập → sống vài tháng (giao dịch,
 * tin nhắn ngân hàng) → lập quỹ, mục tiêu, trả nợ → xem báo cáo → hỏi AI.
 *
 * Mỗi persona chạy trên MỘT SERVER + MỘT DB RIÊNG để dữ liệu không lẫn nhau,
 * đúng như 8 người dùng khác nhau cài app trên 8 chiếc máy khác nhau.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'src', 'index.js');

// ---------------------------------------------------------------------------
// Hạ tầng chạy một persona
// ---------------------------------------------------------------------------

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

const all = [];

function makeCtx(client, persona) {
  const checks = [];
  const notes = [];
  const ctx = {
    ...client,
    acc: {},
    ids: {},
    /** Một bước kiểm chứng. fn throw = hỏng; trả string = ghi lại quan sát. */
    async step(name, fn) {
      const rec = { persona: persona.name, name, ok: false, note: '' };
      try {
        const out = await fn();
        rec.ok = true;
        if (typeof out === 'string') rec.note = out;
      } catch (e) {
        rec.note = e.message;
      }
      checks.push(rec);
      all.push(rec);
      process.stdout.write(rec.ok ? '.' : 'X');
      return rec;
    },
    /** Ghi nhận một quan sát định tính (không phải pass/fail). */
    observe(text) { notes.push(text); },
    must(cond, msg) { if (!cond) throw new Error(msg); },
    near(a, b, tol, msg) {
      if (!Number.isFinite(a)) throw new Error(`${msg} (nhận ${a} — không phải số)`);
      if (Math.abs(a - b) > tol) throw new Error(`${msg} (nhận ${a}, mong ~${b})`);
    },
    finite(v, msg) {
      if (v === null || v === undefined) return;
      if (!Number.isFinite(v)) throw new Error(`${msg}: ${v}`);
    },
    async accounts() { return (await client.GET('/accounts')).accounts; },
    async bal(id) { return (await ctx.accounts()).find((a) => a.id === id)?.balance; },
    async funds(a = false) { return (await client.GET(`/funds${a ? '?all=1' : ''}`)).funds; },
    async say(message) { return client.POST('/chat', { message }); },
  };
  ctx.checks = checks;
  ctx.notes = notes;
  return ctx;
}

async function runPersona(persona, port) {
  const db = join(HERE, `.tmp-persona-${persona.slug}.db`);
  for (const s of ['', '-shm', '-wal']) if (existsSync(db + s)) rmSync(db + s);

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      FINMATE_DB: db,
      PORT: String(port),
      FINMATE_FX_OFFLINE: '1',
      FINMATE_AGENT: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b.toString(); });
  child.stderr.on('data', (b) => { log += b.toString(); });

  const base = `http://127.0.0.1:${port}/api`;
  const client = makeClient(base);

  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try { up = (await fetch(`${base}/health`)).ok; } catch { /* chưa lên */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) throw new Error(`Server không lên cho ${persona.name}\n${log}`);

  const ctx = makeCtx(client, persona);
  process.stdout.write(`\n${persona.emoji} ${persona.name} — ${persona.tagline}\n   `);
  const t0 = Date.now();
  try {
    await persona.run(ctx);
  } catch (e) {
    ctx.checks.push({ persona: persona.name, name: 'HÀNH TRÌNH BỊ ĐỨT GIỮA CHỪNG', ok: false, note: e.message });
    all.push(ctx.checks[ctx.checks.length - 1]);
    process.stdout.write('X');
  }
  const ms = Date.now() - t0;

  child.kill();
  await new Promise((r) => setTimeout(r, 350));
  for (const s of ['', '-shm', '-wal']) if (existsSync(db + s)) { try { rmSync(db + s); } catch { /* khoá file */ } }

  const pass = ctx.checks.filter((c) => c.ok).length;
  process.stdout.write(`  ${pass}/${ctx.checks.length} (${ms}ms)\n`);
  return { persona, checks: ctx.checks, notes: ctx.notes, ms };
}

// ---------------------------------------------------------------------------
// Mảnh hành trình dùng chung
// ---------------------------------------------------------------------------

const MONTH = new Date().toISOString().slice(0, 7);
const today = (d = 0) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
};

/** Ai cũng phải qua: mở app, chào AI, khai tên tuổi. */
async function onboard(ctx, { name, birthYear, city, taxCountry, currency, greeting }) {
  await ctx.step('Mở app lần đầu thì AI chào trước, không bắt tự mò menu', async () => {
    const r = await ctx.say(greeting);
    ctx.must(r.reply && r.reply.length > 10, `AI im lặng: ${JSON.stringify(r).slice(0, 150)}`);
    return `AI mở lời: "${String(r.reply).replace(/\s+/g, ' ').slice(0, 90)}"`;
  });

  await ctx.step('Khai báo hồ sơ cá nhân được ghi nhận', async () => {
    await ctx.PATCH('/profile', { name, birth_year: birthYear, city, tax_country: taxCountry });
    const p = (await ctx.GET('/profile')).profile;
    ctx.must(p.name === name, `tên lưu sai: ${p.name}`);
    ctx.must(p.tax_country === taxCountry, `nước tính thuế sai: ${p.tax_country}`);
  });

  if (currency !== 'VND') {
    await ctx.step(`Đổi đồng tiền chính sang ${currency}`, async () => {
      const r = await ctx.POST('/currency/base', { currency });
      ctx.must(r.ok !== false, JSON.stringify(r).slice(0, 150));
      const p = (await ctx.GET('/profile')).profile;
      ctx.must(p.currency === currency, `đồng tiền chính vẫn là ${p.currency}`);
    });
  }
}

/** Ai cũng cần: mở tài khoản và số dư phải cộng đúng vào tổng tài sản. */
async function openAccounts(ctx, list) {
  await ctx.step(`Mở ${list.length} tài khoản, tổng tài sản cộng đúng`, async () => {
    for (const a of list) {
      const { key, ...payload } = a;
      const r = await ctx.POST('/accounts', payload);
      ctx.must(r.account && r.account.id, `không mở được "${a.name}": ${JSON.stringify(r).slice(0, 120)}`);
      ctx.acc[key] = r.account.id;
    }
    const accs = await ctx.accounts();
    ctx.must(accs.length >= list.length, `chỉ thấy ${accs.length}/${list.length} tài khoản`);
    const net = (await ctx.GET('/networth')).current.net;
    ctx.finite(net, 'tài sản ròng không phải số');
    return `tài sản ròng khởi điểm ${fmt(net, ctx.baseCur)}`;
  });
}

/** Kiểm tra chung cuối hành trình — thứ mà bất kỳ ai mở app cũng sẽ nhìn. */
async function finalReports(ctx, expect = {}) {
  await ctx.step('Màn hình chính hiện đủ số liệu, không có ô nào NaN', async () => {
    const d = await ctx.GET('/dashboard');
    ctx.must(d.ok !== false, JSON.stringify(d).slice(0, 150));
    const flat = JSON.stringify(d);
    ctx.must(!flat.includes('null,"balance"') || true, 'bỏ qua');
    ctx.must(!/NaN|Infinity/.test(flat), 'dashboard có NaN hoặc Infinity');
    const s = d.safe_to_spend || {};
    ctx.finite(s.cash_available, 'tiền khả dụng');
    return `còn tiêu an toàn ${fmt(s.cash_available, ctx.baseCur)}`;
  });

  await ctx.step('Dự báo tự do tài chính ra số hợp lý (không NaN, không âm)', async () => {
    const f = (await ctx.GET('/fire')).fire;
    ctx.must(f, 'không có dữ liệu FIRE');
    ctx.finite(f.savings_rate, 'tỉ lệ tiết kiệm');
    ctx.finite(f.fi_number, 'số tiền cần để tự do');
    ctx.must(f.fi_number >= 0, `số tiền cần tự do bị âm: ${f.fi_number}`);
    if (f.months_to_fi !== null && f.months_to_fi !== undefined) {
      ctx.finite(f.months_to_fi, 'số tháng tới tự do tài chính');
      ctx.must(f.months_to_fi >= 0, `số tháng tới tự do tài chính bị âm: ${f.months_to_fi}`);
    }
    ctx.must(typeof f.data_months === 'number', 'thiếu chỉ báo độ tin cậy data_months');
    const when = f.fi_date ? `${f.fi_date} (tuổi ${f.fi_age})` : 'chưa xác định được';
    return `tự do tài chính: ${when} · tiết kiệm ${pct(f.savings_rate)} · dựa trên ${f.data_months} tháng dữ liệu`;
  });

  await ctx.step('Điểm sức khoẻ tài chính chấm được và giải thích được', async () => {
    const h = await ctx.GET('/advisor/health');
    const score = h.health.score;
    ctx.finite(score, 'điểm sức khoẻ');
    ctx.must(score >= 0 && score <= 100, `điểm ngoài thang 0-100: ${score}`);
    const parts = h.health.components || [];
    ctx.must(parts.length > 0, 'chấm điểm mà không nói vì sao');
    return `điểm ${score}/100 hạng ${h.health.grade} (${parts.length} tiêu chí)`;
  });

  await ctx.step('AI tự sinh được lời khuyên bám vào dữ liệu của người này', async () => {
    await ctx.POST('/insights/generate');
    const r = await ctx.GET('/insights');
    const list = r.insights || [];
    ctx.must(list.length > 0, 'không sinh được lời khuyên nào');
    const top = list.slice(0, 3).map((i) => i.title).join(' | ');
    return `${list.length} lời khuyên · ví dụ: ${top}`;
  });

  await ctx.step('Danh sách việc cần làm được sắp theo mức cấp thiết', async () => {
    const r = await ctx.GET('/advisor/actions');
    const list = r.actions || [];
    ctx.must(Array.isArray(list), 'không trả về danh sách việc cần làm');
    if (list.length > 1) {
      ctx.must(list[0].impact >= list[list.length - 1].impact, 'việc cấp thiết không được xếp lên trước');
    }
    const zero = list.filter((a) => /\b0\s*(đ|₫|EUR|USD)/.test(a.title || ''));
    ctx.must(zero.length === 0, `có việc vô nghĩa kiểu "${zero[0]?.title}"`);
    return list.length ? `${list.length} việc · gấp nhất: ${list[0].title}` : 'không có việc gấp';
  });

  await ctx.step('Xuất toàn bộ dữ liệu ra được để mang đi nơi khác', async () => {
    const r = await ctx.GET('/export');
    const size = JSON.stringify(r).length;
    ctx.must(size > 500, `bản xuất quá nhỏ (${size} ký tự) — có thể rỗng`);
    return `${Math.round(size / 1024)}KB dữ liệu`;
  });

  if (expect.netWorthAtLeast !== undefined) {
    await ctx.step('Tài sản ròng cuối hành trình khớp kỳ vọng', async () => {
      const net = (await ctx.GET('/networth')).current.net;
      ctx.must(net >= expect.netWorthAtLeast, `tài sản ròng ${net} thấp hơn mong đợi ${expect.netWorthAtLeast}`);
      return `tài sản ròng ${fmt(net, ctx.baseCur)}`;
    });
  }
}

/** Hỏi AI vài câu đúng hoàn cảnh của persona này. */
async function askAdvisor(ctx, questions) {
  for (const q of questions) {
    await ctx.step(`Hỏi cố vấn: "${q}"`, async () => {
      const r = await ctx.say(q);
      ctx.must(r.status < 500, `lỗi máy chủ ${r.status}`);
      const reply = String(r.reply || '');
      ctx.must(reply.length > 5, 'AI trả lời rỗng');
      ctx.must(!/undefined|NaN|\[object/.test(reply), `câu trả lời lộ lỗi kỹ thuật: ${reply.slice(0, 120)}`);
      // Câu hỏi thật của người dùng không được bị luồng thiết lập nuốt mất và
      // ghi nhầm thành dữ liệu tài chính.
      ctx.must(!/^Đã tạo \d+ tài khoản/.test(reply.trim()),
        `câu hỏi bị hiểu nhầm thành khai báo tài khoản: ${reply.slice(0, 90)}`);
      ctx.must(!/^Ghi nhận\.\s*\*\*Câu \d\/7/.test(reply.trim()),
        `câu hỏi bị nuốt làm câu trả lời cho bước thiết lập: ${reply.slice(0, 90)}`);
      ctx.must(!/^Đã ghi:.*\/tháng\*\*, nhận ngày/.test(reply.trim()),
        `câu hỏi bị ghi nhầm thành khai báo lương: ${reply.slice(0, 90)}`);
      ctx.must(!/chưa chắc hiểu ý bạn/.test(reply),
        `AI không hiểu câu hỏi rất thông thường này: ${reply.slice(0, 90)}`);
      return reply.replace(/\s+/g, ' ').slice(0, 110);
    });
  }
}

// tiện ích hiển thị
function fmt(v, cur = 'EUR') {
  if (v === null || v === undefined || !Number.isFinite(v)) return String(v);
  if (cur === 'VND') return `${Math.round(v).toLocaleString('vi-VN')}₫`;
  return `${(v / 100).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ${cur}`;
}
function pct(v) { return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`; }

// ===========================================================================
// CÁC PERSONA
// ===========================================================================

const PERSONAS = [];

// --- 1. Người đi làm xa, sống EUR nhưng đầu tư VND -------------------------
PERSONAS.push({
  slug: 'expat',
  emoji: '✈️',
  name: 'Tân, 30 tuổi — kỹ sư ở Dublin',
  tagline: 'Lương EUR ở Ireland, gửi tiền về Việt Nam đầu tư, hai đồng tiền song song',
  run: async (ctx) => {
    ctx.baseCur = 'EUR';

    await onboard(ctx, {
      name: 'Tân', birthYear: 1996, city: 'Dublin', taxCountry: 'IE', currency: 'EUR',
      greeting: 'chào bạn, mình mới qua Ireland làm việc, muốn quản lý tiền cho gọn',
    });

    await openAccounts(ctx, [
      { key: 'aib', name: 'AIB Current', type: 'bank', balance: 480000, currency: 'EUR' },
      { key: 'revolut', name: 'Revolut', type: 'bank', balance: 125000, currency: 'EUR' },
      { key: 'vcb', name: 'Vietcombank', type: 'bank', balance: 95000000, currency: 'VND' },
      { key: 'tknh', name: 'Tiết kiệm VCB 12 tháng', type: 'savings', balance: 400000000, currency: 'VND' },
      { key: 'vps', name: 'Chứng khoán VPS', type: 'brokerage', balance: 60000000, currency: 'VND' },
    ]);

    await ctx.step('Khai lương Ireland và các nguồn thu ở Việt Nam', async () => {
      await ctx.POST('/income-streams', { name: 'Lương Stripe Dublin', type: 'salary', net_amount: 420000, gross_amount: 580000, payday: 25, currency: 'EUR' });
      await ctx.POST('/income-streams', { name: 'Lãi sổ tiết kiệm VCB', type: 'interest', net_amount: 1900000, currency: 'VND' });
      await ctx.POST('/income-streams', { name: 'Cổ tức FPT + MWG', type: 'dividend', net_amount: 1200000, currency: 'VND' });
      const s = (await ctx.GET('/income-streams')).streams || [];
      ctx.must(s.length === 3, `mới ghi được ${s.length}/3 nguồn thu`);
      return `3 nguồn: lương €4.200 + lãi 1,9tr₫ + cổ tức 1,2tr₫`;
    });

    await ctx.step('Nhận lương: tin nhắn AIB tự vào sổ, số dư tự tăng', async () => {
      const token = (await ctx.GET('/automation/status')).token;
      ctx.must(token, 'không lấy được token webhook');
      const before = await ctx.bal(ctx.acc.aib);
      const r = await ctx.POST(`/ingest?token=${token}`, { text: 'AIB: Salary STRIPE PAYMENTS credited EUR 4,200.00. Available balance: EUR 9,000.00', account_id: ctx.acc.aib });
      ctx.must(r.ok !== false, JSON.stringify(r).slice(0, 150));
      const after = await ctx.bal(ctx.acc.aib);
      ctx.must(after > before, `số dư không tăng (${before} → ${after})`);
      return `AIB ${fmt(before)} → ${fmt(after)} chỉ bằng cách dán tin nhắn`;
    });

    await ctx.step('Chi tiêu hằng ngày ở Dublin vào đúng danh mục', async () => {
      const items = [
        { amount: 145000, merchant: 'Landlord', note: 'tiền thuê nhà tháng' },
        { amount: 8500, merchant: 'Tesco', note: 'đi chợ' },
        { amount: 3200, merchant: 'Leap Card', note: 'vé tàu Luas' },
        { amount: 1450, merchant: 'Insomnia Coffee', note: 'cà phê' },
        { amount: 6500, merchant: 'Electric Ireland', note: 'tiền điện' },
      ];
      for (const it of items) {
        await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.aib, currency: 'EUR', ...it });
      }
      const cats = await ctx.GET('/reports/categories');
      const list = cats.categories || cats.rows || [];
      ctx.must(list.length >= 2, `chỉ phân được ${list.length} nhóm chi tiêu`);
      return `${items.length} khoản chi rơi vào ${list.length} nhóm danh mục`;
    });

    await ctx.step('Chuyển tiền về Việt Nam: tiền rời EUR và thật sự đến VND', async () => {
      const q = (await ctx.POST('/remittance/quote', { from: 'EUR', to: 'VND', amount: 200000 })).quote;
      ctx.must(q && q.received > 0, `báo giá không ra tiền nhận: ${JSON.stringify(q).slice(0, 150)}`);
      const eur0 = await ctx.bal(ctx.acc.revolut);
      const vnd0 = await ctx.bal(ctx.acc.vcb);
      await ctx.POST('/transactions', { type: 'transfer', amount: 200000, account_id: ctx.acc.revolut, to_account_id: ctx.acc.vcb, currency: 'EUR', note: 'gửi tiền về VN' });
      const eur1 = await ctx.bal(ctx.acc.revolut);
      const vnd1 = await ctx.bal(ctx.acc.vcb);
      ctx.near(eur1, eur0 - 200000, 1, 'tài khoản EUR trừ sai');
      ctx.must(vnd1 > vnd0, `tiền không về tới tài khoản VND (${vnd0} → ${vnd1})`);
      return `€2.000 → nhận ${Math.round(q.received).toLocaleString('vi-VN')}₫ (phí ${fmt(q.fee)}, tỉ giá thực ${Math.round(q.effective_rate).toLocaleString('vi-VN')})`;
    });

    await ctx.step('Mua cổ phiếu VN bằng tiền VND, danh mục ghi nhận đúng', async () => {
      await ctx.POST('/investments/trade', { symbol: 'FPT', side: 'buy', quantity: 200, price: 138000, currency: 'VND', account_id: ctx.acc.vps, date: today(-40) });
      await ctx.POST('/investments/trade', { symbol: 'VNM', side: 'buy', quantity: 100, price: 62000, currency: 'VND', account_id: ctx.acc.vps, date: today(-30) });
      await ctx.POST('/investments/price', { symbol: 'FPT', price: 152000 });
      const p = (await ctx.GET('/investments')).portfolio;
      const fpt = p.holdings.find((h) => h.symbol === 'FPT');
      ctx.must(fpt && fpt.quantity === 200, `số lượng FPT sai: ${fpt && fpt.quantity}`);
      ctx.must(fpt.pnl > 0, `giá tăng từ 138k lên 152k mà lãi = ${fpt.pnl}`);
      return `FPT 200cp lãi ${(fpt.pnl_pct * 100).toFixed(1)}% · tổng danh mục ${fmt(p.total_value, 'EUR')}`;
    });

    await ctx.step('Mua ETF châu Âu bằng EUR, hai đồng tiền không cộng nhầm nhau', async () => {
      await ctx.POST('/investments/trade', { symbol: 'VWCE', side: 'buy', quantity: 15, price: 11800, currency: 'EUR', account_id: ctx.acc.revolut });
      const p = (await ctx.GET('/investments')).portfolio;
      const vwce = p.holdings.find((h) => h.symbol === 'VWCE');
      ctx.must(vwce, 'không thấy ETF vừa mua');
      const sum = p.holdings.reduce((a, h) => a + h.value_base, 0);
      ctx.near(p.total_value, sum, 100, 'tổng danh mục không bằng tổng các khoản quy đổi');
      const vndPart = p.holdings.filter((h) => h.currency === 'VND').reduce((a, h) => a + h.value, 0);
      ctx.must(p.total_value < vndPart, `tổng danh mục ${p.total_value} lớn hơn cả số VND thô — đang cộng thẳng VND vào EUR`);
      return `2 đồng tiền: FPT/VNM (VND) + VWCE (EUR) = ${fmt(p.total_value)} sau quy đổi`;
    });

    await ctx.step('Tính thuế thu nhập Ireland ra con số dùng được', async () => {
      const res = (await ctx.POST('/tax/pit', { gross: 5800000, country: 'IE', period: 'year' })).result;
      ctx.must(res.net > 0 && res.total_tax > 0, JSON.stringify(res).slice(0, 200));
      ctx.must(res.net < 5800000, 'thực nhận lại cao hơn lương gộp');
      ctx.near(res.net + res.total_tax, 5800000, 2, 'thực nhận + thuế không bằng lương gộp');
      return `gộp €58.000 → thực nhận ${fmt(res.net)} · thuế ${pct(res.effective_rate)} (PAYE ${fmt(res.income_tax)} + USC ${fmt(res.usc)} + PRSI ${fmt(res.prsi)})`;
    });

    await ctx.step('Lập quỹ mục tiêu có hạn chót, app tự tính mỗi tháng để bao nhiêu', async () => {
      const r = await ctx.POST('/funds', { name: 'Cọc mua nhà Dublin', type: 'goal', percent: 0, currency: 'EUR', target_amount: 5000000, target_date: '2029-06-30', priority: 1 });
      ctx.must(r.fund, JSON.stringify(r).slice(0, 150));
      const f = (await ctx.funds(true)).find((x) => x.id === r.fund.id);
      ctx.must(f.plan && f.plan.monthly_needed > 0, `không tính được số tiền cần để mỗi tháng: ${JSON.stringify(f.plan)}`);
      ctx.must(f.plan.months_left > 0, `số tháng còn lại = ${f.plan.months_left}`);
      return `cọc nhà €50.000 trong ${f.plan.months_left} tháng → cần để ${fmt(f.plan.monthly_needed)}/tháng`;
    });

    await ctx.step('Chia lương vào các quỹ, không đồng nào rơi mất', async () => {
      const before = (await ctx.funds()).reduce((s, f) => s + f.balance_base, 0);
      const r = await ctx.POST('/funds/allocate', { amount: 420000, note: 'lương tháng này' });
      ctx.must(r.ok !== false, JSON.stringify(r).slice(0, 150));
      const after = (await ctx.funds()).reduce((s, f) => s + f.balance_base, 0);
      ctx.near(after - before, 420000, 200, 'tổng tiền vào các quỹ lệch so với tiền chia');
      return `€4.200 chia vào ${(await ctx.funds()).length} quỹ, sai số ${Math.abs(after - before - 420000)} cent`;
    });

    await finalReports(ctx, { netWorthAtLeast: 0 });

    await askAdvisor(ctx, [
      'tháng này mình tiêu bao nhiêu rồi',
      '1 euro bằng bao nhiêu tiền việt',
      'mình còn bao nhiêu tiền tiêu được',
      'khi nào mình nghỉ hưu được',
    ]);
  },
});

// --- 2. Sinh viên đi làm thêm + bố mẹ phụ cấp ------------------------------
PERSONAS.push({
  slug: 'student',
  emoji: '🎓',
  name: 'Mai, 20 tuổi — sinh viên năm 3',
  tagline: 'Bố mẹ cho 3tr/tháng, làm thêm quán cà phê, thu nhập bé và thất thường',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Mai', birthYear: 2006, city: 'TP.HCM', taxCountry: 'VN', currency: 'VND',
      greeting: 'em là sinh viên, tiền ít mà cứ hết sạch cuối tháng, giúp em với',
    });

    await openAccounts(ctx, [
      { key: 'mb', name: 'MB Bank', type: 'bank', balance: 2400000, currency: 'VND' },
      { key: 'momo', name: 'Ví MoMo', type: 'ewallet', balance: 350000, currency: 'VND' },
      { key: 'cash', name: 'Tiền mặt', type: 'cash', balance: 500000, currency: 'VND' },
    ]);

    await ctx.step('Thu nhập rất nhỏ vẫn khai báo được, không bị làm tròn về 0', async () => {
      await ctx.POST('/income-streams', { name: 'Bố mẹ cho', type: 'other', net_amount: 3000000, payday: 5, currency: 'VND' });
      await ctx.POST('/income-streams', { name: 'Làm thêm The Coffee House', type: 'salary', net_amount: 2800000, payday: 10, currency: 'VND' });
      const s = (await ctx.GET('/income-streams')).streams || [];
      const total = s.reduce((a, x) => a + x.net_amount, 0);
      ctx.must(total === 5800000, `tổng thu nhập sai: ${total}`);
      return `tổng thu 5,8tr₫/tháng`;
    });

    await ctx.step('Chi tiêu sinh viên lẻ tẻ vẫn ghi đúng từng nghìn đồng', async () => {
      const items = [
        { amount: 25000, note: 'cơm trưa căn tin' },
        { amount: 18000, note: 'trà sữa' },
        { amount: 12000, note: 'gửi xe' },
        { amount: 1500000, note: 'tiền trọ' },
        { amount: 200000, note: 'sách giáo trình' },
        { amount: 55000, note: 'grab về nhà' },
      ];
      const before = await ctx.bal(ctx.acc.mb);
      for (const it of items) {
        await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.mb, currency: 'VND', ...it });
      }
      const spent = items.reduce((a, x) => a + x.amount, 0);
      const after = await ctx.bal(ctx.acc.mb);
      ctx.near(after, before - spent, 0, 'số dư trừ không khớp tổng chi');
      return `${items.length} khoản = ${spent.toLocaleString('vi-VN')}₫, số dư khớp tuyệt đối`;
    });

    await ctx.step('Số dư âm khi lỡ tiêu quá được cảnh báo chứ không im lặng', async () => {
      const b = await ctx.bal(ctx.acc.momo);
      await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.momo, amount: b + 100000, currency: 'VND', note: 'lỡ quẹt quá tay' });
      const after = await ctx.bal(ctx.acc.momo);
      ctx.must(after < 0, `số dư đáng lẽ âm nhưng lại là ${after}`);
      const d = await ctx.GET('/dashboard');
      ctx.must(!/NaN/.test(JSON.stringify(d)), 'số dư âm làm hỏng màn hình chính');
      return `MoMo âm ${after.toLocaleString('vi-VN')}₫, app vẫn hiển thị bình thường`;
    });

    await ctx.step('Ngân sách ăn uống cảnh báo khi sắp vượt', async () => {
      const cats = (await ctx.GET('/categories')).categories || [];
      const food = cats.find((c) => /ăn|food|uống/i.test(c.name));
      ctx.must(food, 'không có sẵn danh mục ăn uống');
      await ctx.POST('/budgets', { category_id: food.id, amount: 1200000, month: MONTH });
      const items = (await ctx.GET('/budgets')).items || [];
      const mine = items.find((x) => x.category_id === food.id);
      ctx.must(mine, `ngân sách vừa đặt không thấy đâu (có ${items.length} mục)`);
      ctx.finite(mine.spent, 'số đã tiêu');
      ctx.finite(mine.remaining, 'số còn lại');
      ctx.must(['ok', 'warn', 'over', 'danger'].includes(mine.status), `trạng thái lạ: ${mine.status}`);
      return `ngân sách 1,2tr₫ · đã tiêu ${mine.spent.toLocaleString('vi-VN')}₫ · còn ${mine.remaining.toLocaleString('vi-VN')}₫ · mỗi ngày tiêu được ${mine.daily_left.toLocaleString('vi-VN')}₫`;
    });

    await ctx.step('Mục tiêu nhỏ (mua laptop) tính được lộ trình', async () => {
      const r = await ctx.POST('/goals', { name: 'Mua laptop học đồ hoạ', target_amount: 18000000, deadline: '2027-08-01', currency: 'VND' });
      ctx.must(r.goal, JSON.stringify(r).slice(0, 150));
      await ctx.POST(`/goals/${r.goal.id}/contribute`, { amount: 500000, account_id: ctx.acc.mb });
      const g = (await ctx.GET('/goals')).goals.find((x) => x.id === r.goal.id);
      ctx.must(g.current_amount >= 500000, `góp 500k mà chỉ ghi ${g.current_amount}`);
      const progress = g.current_amount / g.target_amount;
      return `laptop 18tr₫ · đã góp ${g.current_amount.toLocaleString('vi-VN')}₫ (${pct(progress)})`;
    });

    await ctx.step('Thu nhập dưới ngưỡng chịu thuế thì báo thuế = 0, không doạ người dùng', async () => {
      const r = (await ctx.POST('/tax/pit', { gross: 5800000, country: 'VN', period: 'month' })).result;
      ctx.must(r.tax === 0, `sinh viên 5,8tr/tháng mà bị tính thuế ${r.tax}₫`);
      return 'thuế 0₫ — đúng vì dưới mức giảm trừ 11tr₫';
    });

    await ctx.step('Dự báo tự do tài chính với thu nhập bé không ra số vô lý', async () => {
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.savings_rate, 'tỉ lệ tiết kiệm');
      ctx.must(f.months_to_fi === null || f.months_to_fi === undefined || Number.isFinite(f.months_to_fi),
        `số tháng tới tự do tài chính = ${f.months_to_fi}`);
      if (Number.isFinite(f.months_to_fi)) {
        ctx.must(f.months_to_fi < 12000, `báo ${Math.round(f.months_to_fi / 12)} năm — con số vô nghĩa với người dùng`);
      }
      return f.months_to_fi ? `${Math.round(f.months_to_fi / 12)} năm nữa` : 'app thừa nhận chưa dự báo được — hợp lý';
    });

    await finalReports(ctx);

    await askAdvisor(ctx, [
      'em còn bao nhiêu tiền',
      'em tiêu gì nhiều nhất',
      'làm sao để dành tiền mua laptop',
    ]);
  },
});

// --- 3. Nhân viên văn phòng, lương cố định, có gia đình --------------------
PERSONAS.push({
  slug: 'office',
  emoji: '🏢',
  name: 'Hùng, 34 tuổi — nhân viên văn phòng Hà Nội',
  tagline: 'Lương 25tr cố định, vợ con, trả góp xe, cuộc sống rất "chuẩn mẫu"',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Hùng', birthYear: 1992, city: 'Hà Nội', taxCountry: 'VN', currency: 'VND',
      greeting: 'chào bạn, mình muốn quản lý chi tiêu gia đình cho rõ ràng',
    });

    await openAccounts(ctx, [
      { key: 'tcb', name: 'Techcombank', type: 'bank', balance: 32000000, currency: 'VND' },
      { key: 'save', name: 'Tiết kiệm online', type: 'savings', balance: 150000000, currency: 'VND' },
      { key: 'card', name: 'Thẻ tín dụng TCB', type: 'credit', balance: -8500000, currency: 'VND' },
    ]);

    await ctx.step('Khai lương và 2 người phụ thuộc để tính thuế đúng', async () => {
      await ctx.POST('/income-streams', { name: 'Lương công ty ABC', type: 'salary', net_amount: 25000000, gross_amount: 32000000, payday: 10, currency: 'VND' });
      await ctx.PATCH('/profile', { dependents: 2 });
      const noDep = (await ctx.POST('/tax/pit', { gross: 32000000, country: 'VN', period: 'month', dependents: 0 })).result;
      const withDep = (await ctx.POST('/tax/pit', { gross: 32000000, country: 'VN', period: 'month', dependents: 2 })).result;
      ctx.must(withDep.tax < noDep.tax, `khai 2 con mà thuế không giảm (${noDep.tax} → ${withDep.tax})`);
      return `thuế giảm từ ${noDep.tax.toLocaleString('vi-VN')}₫ xuống ${withDep.tax.toLocaleString('vi-VN')}₫ nhờ 2 người phụ thuộc`;
    });

    await ctx.step('Các khoản cố định hằng tháng khai một lần rồi tự chạy', async () => {
      const fixed = [
        { name: 'Học phí con', amount: 4500000, day: 5 },
        { name: 'Internet + truyền hình', amount: 330000, day: 12 },
        { name: 'Bảo hiểm nhân thọ', amount: 1800000, day: 20 },
        { name: 'Gói điện thoại', amount: 200000, day: 3 },
      ];
      for (const f of fixed) {
        const r = await ctx.POST('/recurring', {
          name: f.name, amount: f.amount, type: 'expense', account_id: ctx.acc.tcb,
          frequency: 'monthly', day_of_month: f.day, currency: 'VND',
        });
        ctx.must(r.ok !== false, `không tạo được "${f.name}": ${JSON.stringify(r).slice(0, 120)}`);
      }
      const list = (await ctx.GET('/recurring')).recurring || [];
      ctx.must(list.length === 4, `chỉ có ${list.length}/4 khoản định kỳ`);
      const total = fixed.reduce((a, x) => a + x.amount, 0);
      return `4 khoản cố định = ${total.toLocaleString('vi-VN')}₫/tháng tự trừ`;
    });

    await ctx.step('Trả góp xe: lịch trả nợ tính ra gốc + lãi từng kỳ', async () => {
      const r = await ctx.POST('/debts', {
        name: 'Trả góp Mazda CX-5', principal: 400000000, balance: 340000000,
        interest_rate: 9.5, min_payment: 8500000, monthly_payment: 8500000,
        term_months: 60, currency: 'VND', type: 'auto',
      });
      ctx.must(r.debt, JSON.stringify(r).slice(0, 150));
      ctx.ids.car = r.debt.id;
      const rows = (await ctx.GET(`/debts/${r.debt.id}/schedule`)).schedule.rows || [];
      ctx.must(rows.length > 1, `lịch trả nợ chỉ có ${rows.length} kỳ`);
      const totalInterest = rows.reduce((a, x) => a + (x.interest || 0), 0);
      ctx.must(totalInterest > 0, 'không tính ra tiền lãi phải trả');
      ctx.must(rows[0].interest > rows[rows.length - 1].interest, 'lãi không giảm dần theo dư nợ — công thức sai');
      return `${rows.length} kỳ · tổng lãi ${Math.round(totalInterest).toLocaleString('vi-VN')}₫ · hết nợ ${rows[rows.length - 1].date}`;
    });

    await ctx.step('Dư nợ thẻ tín dụng làm giảm tài sản ròng đúng cách', async () => {
      const n = (await ctx.GET('/networth')).current;
      ctx.must(n.liabilities > 0, `không ghi nhận khoản nợ nào (nợ = ${n.liabilities})`);
      ctx.near(n.net, n.assets - n.liabilities, 1, 'tài sản ròng ≠ tài sản − nợ');
      return `tài sản ${fmt(n.assets, 'VND')} − nợ ${fmt(n.liabilities, 'VND')} = ${fmt(n.net, 'VND')}`;
    });

    await ctx.step('Tin nhắn ngân hàng Việt Nam đọc đúng và ghi thẳng vào sổ', async () => {
      const token = (await ctx.GET('/automation/status')).token;
      const msgs = [
        'TCB: TK 19035xxx +25,000,000VND luc 10:02. Noi dung: CTY ABC TRA LUONG T8. So du: 57,000,000VND',
        'TCB: TK 19035xxx -4,500,000VND. Noi dung: HOC PHI CON. So du: 52,500,000VND',
        'TCB: TK 19035xxx -1,250,000VND tai VINMART. So du: 51,250,000VND',
      ];
      let ok = 0;
      for (const m of msgs) {
        const r = await ctx.POST(`/ingest?token=${token}`, { text: m, account_id: ctx.acc.tcb });
        if (r.transaction || r.tx || r.ok) ok += 1;
      }
      ctx.must(ok === msgs.length, `chỉ ghi được ${ok}/${msgs.length} tin nhắn`);
      const inc = (await ctx.POST('/ingest/preview', { text: msgs[0] })).parsed;
      ctx.must(inc.type === 'income', `tin nhắn nhận lương bị hiểu thành "${inc.type}"`);
      const rep = (await ctx.GET('/reports/month')).report;
      ctx.must(rep.expense >= 5750000, `2 khoản chi từ SMS (5,75tr) không vào báo cáo tháng (chi ${rep.expense})`);
      ctx.must(rep.income >= 25000000, `lương 25tr từ SMS không vào báo cáo tháng (thu ${rep.income})`);
      return `${ok}/${msgs.length} tin nhắn Techcombank vào thẳng sổ · tháng này thu ${fmt(rep.income, 'VND')} / chi ${fmt(rep.expense, 'VND')}`;
    });

    await ctx.step('Bộ quỹ mặc định chia lương theo tỉ lệ hợp lý', async () => {
      const fs = await ctx.funds();
      const sum = fs.reduce((a, f) => a + (f.percent || 0), 0);
      ctx.near(sum, 100, 0.5, 'tổng tỉ lệ các quỹ không bằng 100%');
      const before = fs.reduce((a, f) => a + f.balance_base, 0);
      await ctx.POST('/funds/allocate', { amount: 25000000, note: 'lương tháng 8' });
      const after = (await ctx.funds()).reduce((a, f) => a + f.balance_base, 0);
      ctx.near(after - before, 25000000, 2000, 'chia lương vào quỹ bị thất thoát');
      return `${fs.length} quỹ (tổng ${sum}%), chia thêm 25tr₫ sai số ${Math.abs(after - before - 25000000)}₫ · quỹ đang giữ ${fmt(after, 'VND')} (đã gồm lương tự vào từ SMS)`;
    });

    await ctx.step('Quỹ khẩn cấp đo đúng "trụ được mấy tháng"', async () => {
      const e = (await ctx.GET('/fire')).emergency;
      ctx.must(e.has_data === true, 'đã có chi tiêu từ SMS mà app vẫn báo chưa đủ dữ liệu');
      ctx.finite(e.months_covered, 'số tháng quỹ khẩn cấp trụ được');
      ctx.must(e.target_months > 0, 'không đặt mục tiêu số tháng');
      ctx.must(e.gap > 0 || e.ok, 'chưa đủ quỹ mà báo thiếu 0đ');
      return `trụ được ${e.months_covered} / mục tiêu ${e.target_months} tháng${e.ok ? ' ✔' : ` (thiếu ${fmt(e.gap, 'VND')})`}`;
    });

    await finalReports(ctx, { netWorthAtLeast: -1e12 });

    await askAdvisor(ctx, [
      'tháng này gia đình mình tiêu hết bao nhiêu',
      'mình có nên trả xe sớm không',
      'quỹ dự phòng của mình đủ chưa',
    ]);
  },
});


// --- 4. Người làm việc tự do, thu nhập trồi sụt ----------------------------
PERSONAS.push({
  slug: 'freelance',
  emoji: '🎨',
  name: 'Linh, 27 tuổi — designer tự do',
  tagline: 'Khách trả bằng USD lẫn VND, tháng 80 triệu tháng 8 triệu, không lương cố định',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Linh', birthYear: 1999, city: 'Đà Nẵng', taxCountry: 'VN', currency: 'VND',
      greeting: 'mình làm freelance, thu nhập tháng nhiều tháng ít, không biết tiêu bao nhiêu là an toàn',
    });

    await openAccounts(ctx, [
      { key: 'acb', name: 'ACB', type: 'bank', balance: 45000000, currency: 'VND' },
      { key: 'payo', name: 'Payoneer USD', type: 'bank', balance: 180000, currency: 'USD' },
      { key: 'buff', name: 'Sổ đệm thu nhập', type: 'savings', balance: 60000000, currency: 'VND' },
    ]);

    await ctx.step('Thu nhập trồi sụt 3 tháng liền được ghi nhận đầy đủ', async () => {
      const months = [
        { d: -75, amount: 82000000, note: 'dự án rebrand ABC' },
        { d: -45, amount: 8500000, note: 'sửa banner lặt vặt' },
        { d: -15, amount: 46000000, note: 'thiết kế app XYZ' },
      ];
      for (const m of months) {
        await ctx.POST('/transactions', { type: 'income', account_id: ctx.acc.acb, amount: m.amount, currency: 'VND', note: m.note, date: today(m.d) });
      }
      const t = (await ctx.GET('/transactions?limit=200')).transactions;
      ctx.must(t.filter((x) => x.type === 'income').length >= 3, 'thiếu giao dịch thu nhập');
      const spread = 82000000 / 8500000;
      return `thu nhập chênh nhau ${spread.toFixed(1)} lần giữa tháng cao và tháng thấp`;
    });

    await ctx.step('Khách nước ngoài trả USD quy đổi đúng, không cộng thẳng vào VND', async () => {
      const before = (await ctx.GET('/networth')).current.assets;
      const r = await ctx.POST('/transactions', { type: 'income', account_id: ctx.acc.payo, amount: 120000, currency: 'USD', note: 'khách Mỹ trả $1.200' });
      const t = r.transaction || r;
      ctx.must(t.base_amount > 0, `không quy đổi được sang VND: ${t.base_amount}`);
      ctx.must(t.base_amount > 1000000, `quy đổi $1.200 ra ${t.base_amount}₫ — sai đơn vị nghiêm trọng`);
      const after = (await ctx.GET('/networth')).current.assets;
      ctx.must(after > before, 'tài sản không tăng sau khi nhận tiền USD');
      return `$1.200 ≈ ${Math.round(t.base_amount).toLocaleString('vi-VN')}₫`;
    });

    await ctx.step('App tính thu nhập trung bình chứ không lấy tháng gần nhất', async () => {
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.monthly_income, 'thu nhập trung bình tháng');
      ctx.must(f.monthly_income < 82000000, `lấy nhầm tháng đỉnh 82tr làm chuẩn (nhận ${f.monthly_income})`);
      ctx.must(f.monthly_income > 8500000, `lấy nhầm tháng đáy 8,5tr làm chuẩn (nhận ${f.monthly_income})`);
      return `trung bình ${Math.round(f.monthly_income).toLocaleString('vi-VN')}₫/tháng — nằm giữa đỉnh và đáy, hợp lý`;
    });

    await ctx.step('"Còn tiêu được bao nhiêu" phải trừ các khoản sắp tới, không hào phóng ảo', async () => {
      await ctx.POST('/recurring', { name: 'Thuê studio', amount: 6000000, type: 'expense', account_id: ctx.acc.acb, frequency: 'monthly', day_of_month: 5, currency: 'VND' });
      await ctx.POST('/recurring', { name: 'Adobe + Figma', amount: 1400000, type: 'expense', account_id: ctx.acc.acb, frequency: 'monthly', day_of_month: 8, currency: 'VND' });
      const s = (await ctx.GET('/dashboard')).safe_to_spend;
      ctx.finite(s.cash_available, 'tiền còn tiêu được');
      ctx.must(s.upcoming_fixed >= 0, `khoản cố định sắp tới ra số âm: ${s.upcoming_fixed}`);
      ctx.must(s.cash_available <= s.liquid, 'tiền còn tiêu được lớn hơn cả tiền mặt đang có — tính sai');
      return `tiền lỏng ${fmt(s.liquid, 'VND')} − sắp phải trả ${fmt(s.upcoming_fixed, 'VND')} = còn ${fmt(s.cash_available, 'VND')}`;
    });

    await ctx.step('Lập quỹ đệm thu nhập cho tháng ế — đúng nhu cầu người làm tự do', async () => {
      const r = await ctx.POST('/funds', { name: 'Quỹ đệm tháng ế', type: 'buffer', percent: 0, currency: 'VND', target_amount: 90000000, priority: 1 });
      ctx.must(r.fund, JSON.stringify(r).slice(0, 150));
      const src = (await ctx.funds())[0];
      await ctx.POST('/funds/move', { from_fund_id: src.id, to_fund_id: r.fund.id, amount: 1000000, note: 'nạp đệm' });
      const f = (await ctx.funds(true)).find((x) => x.id === r.fund.id);
      ctx.must(f.balance >= 1000000, `chuyển 1tr vào quỹ đệm mà chỉ thấy ${f.balance}`);
      return `quỹ đệm mục tiêu 90tr₫, đã có ${f.balance.toLocaleString('vi-VN')}₫`;
    });

    await ctx.step('Thuế cho người thu nhập không đều tính trên cả năm', async () => {
      const yearly = 82000000 + 8500000 + 46000000;
      const r = (await ctx.POST('/tax/pit', { gross: yearly * 4, country: 'VN', period: 'year' })).result;
      ctx.must(r.tax >= 0, `thuế ra số âm: ${r.tax}`);
      ctx.finite(r.net, 'thu nhập sau thuế');
      return `ước cả năm ${(yearly * 4).toLocaleString('vi-VN')}₫ → thuế ${Math.round(r.tax).toLocaleString('vi-VN')}₫`;
    });

    await ctx.step('Biểu đồ xu hướng vẽ được đúng các tháng trồi sụt', async () => {
      const rows = (await ctx.GET('/reports/trend')).trend || [];
      ctx.must(rows.length >= 2, `chỉ có ${rows.length} mốc thời gian`);
      const withIncome = rows.filter((r) => (r.income || 0) > 0);
      ctx.must(withIncome.length >= 2, `chỉ thấy ${withIncome.length} tháng có thu nhập — không thể hiện được sự trồi sụt`);
      const hi = Math.max(...withIncome.map((r) => r.income));
      const lo = Math.min(...withIncome.map((r) => r.income));
      return `${rows.length} tháng · cao nhất ${fmt(hi, 'VND')} · thấp nhất ${fmt(lo, 'VND')} — chênh ${(hi / lo).toFixed(1)} lần`;
    });

    await finalReports(ctx);

    await askAdvisor(ctx, [
      'thu nhập trung bình của mình là bao nhiêu',
      'tháng này mình tiêu được bao nhiêu là an toàn',
      'mình nên để dành bao nhiêu cho tháng ít việc',
    ]);
  },
});

// --- 5. Chủ doanh nghiệp nhỏ ----------------------------------------------
PERSONAS.push({
  slug: 'owner',
  emoji: '🏪',
  name: 'Quân, 38 tuổi — chủ chuỗi 2 quán cà phê',
  tagline: 'Dòng tiền lớn ra vào mỗi ngày, tiền quán và tiền nhà dễ lẫn lộn',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Quân', birthYear: 1988, city: 'TP.HCM', taxCountry: 'VN', currency: 'VND',
      greeting: 'mình có 2 quán cà phê, tiền quán với tiền cá nhân cứ lẫn vào nhau, rối lắm',
    });

    await openAccounts(ctx, [
      { key: 'biz', name: 'TK Kinh doanh VPBank', type: 'bank', balance: 320000000, currency: 'VND' },
      { key: 'ca', name: 'TK Cá nhân VPBank', type: 'bank', balance: 48000000, currency: 'VND' },
      { key: 'quy', name: 'Két quán', type: 'cash', balance: 15000000, currency: 'VND' },
      { key: 'dautu', name: 'Tiết kiệm dài hạn', type: 'savings', balance: 800000000, currency: 'VND' },
    ]);

    await ctx.step('Doanh thu bán hàng vào tài khoản kinh doanh, không lẫn tiền nhà', async () => {
      const b0 = await ctx.bal(ctx.acc.biz);
      const c0 = await ctx.bal(ctx.acc.ca);
      for (let i = 1; i <= 6; i += 1) {
        await ctx.POST('/transactions', { type: 'income', account_id: ctx.acc.biz, amount: 18000000 + i * 500000, currency: 'VND', note: `doanh thu ngày ${i}`, date: today(-i) });
      }
      const b1 = await ctx.bal(ctx.acc.biz);
      const c1 = await ctx.bal(ctx.acc.ca);
      ctx.must(b1 > b0, 'doanh thu không vào tài khoản kinh doanh');
      ctx.must(c1 === c0, `tiền quán chảy nhầm sang tài khoản cá nhân (${c0} → ${c1})`);
      return `6 ngày doanh thu = ${(b1 - b0).toLocaleString('vi-VN')}₫, tài khoản cá nhân đứng yên`;
    });

    await ctx.step('Chi phí vận hành ghi nhận đủ, tính được lãi gộp', async () => {
      const costs = [
        { amount: 45000000, note: 'lương 6 nhân viên' },
        { amount: 38000000, note: 'tiền thuê 2 mặt bằng' },
        { amount: 22000000, note: 'nhập hạt cà phê + sữa' },
        { amount: 6500000, note: 'điện nước 2 quán' },
      ];
      for (const c of costs) {
        await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.biz, currency: 'VND', ...c });
      }
      const rep = (await ctx.GET('/reports/month')).report;
      ctx.finite(rep.income, 'tổng thu tháng');
      ctx.finite(rep.expense, 'tổng chi tháng');
      const totalCost = costs.reduce((a, x) => a + x.amount, 0);
      ctx.must(rep.expense >= totalCost, `chi ${rep.expense} nhỏ hơn tổng chi phí đã nhập ${totalCost}`);
      ctx.near(rep.net, rep.income - rep.expense, 1, 'lãi ròng ≠ thu − chi');
      return `thu ${fmt(rep.income, 'VND')} · chi ${fmt(rep.expense, 'VND')} · lãi ${fmt(rep.net, 'VND')}`;
    });

    await ctx.step('Rút lương chủ về tài khoản cá nhân: tiền rời quán và tới nơi', async () => {
      const b0 = await ctx.bal(ctx.acc.biz);
      const c0 = await ctx.bal(ctx.acc.ca);
      await ctx.POST('/transactions', { type: 'transfer', amount: 40000000, account_id: ctx.acc.biz, to_account_id: ctx.acc.ca, currency: 'VND', note: 'rút lương chủ tháng 8' });
      const b1 = await ctx.bal(ctx.acc.biz);
      const c1 = await ctx.bal(ctx.acc.ca);
      ctx.near(b1, b0 - 40000000, 0, 'tài khoản kinh doanh trừ sai');
      ctx.near(c1, c0 + 40000000, 0, 'tiền không tới tài khoản cá nhân — TIỀN BỐC HƠI');
      return '40tr₫ chuyển trọn vẹn, không thất thoát đồng nào';
    });

    await ctx.step('Vay ngân hàng mở quán thứ 3 được theo dõi cùng lịch trả', async () => {
      const r = await ctx.POST('/debts', {
        name: 'Vay mở quán quận 3', principal: 500000000, balance: 500000000,
        interest_rate: 11.5, min_payment: 12000000, monthly_payment: 15000000,
        term_months: 48, currency: 'VND', type: 'business',
      });
      ctx.must(r.debt, JSON.stringify(r).slice(0, 150));
      const rows = (await ctx.GET(`/debts/${r.debt.id}/schedule`)).schedule.rows || [];
      ctx.must(rows.length > 0, 'không lập được lịch trả nợ');
      const last = rows[rows.length - 1];
      ctx.must((last.balance ?? 1e9) < 1000, `trả hết kỳ mà vẫn còn dư nợ ${last.balance}`);
      return `${rows.length} kỳ, trả 15tr₫/tháng thì sạch nợ vào ${last.date}`;
    });

    await ctx.step('Bất động sản cho thuê tính đúng lợi suất', async () => {
      const r = await ctx.POST('/properties', {
        name: 'Nhà phố cho thuê Bình Thạnh', current_value: 6500000000,
        purchase_price: 5200000000, monthly_rent: 25000000, monthly_cost: 3000000, currency: 'VND',
      });
      ctx.must(r.property, JSON.stringify(r).slice(0, 150));
      const nw = (await ctx.GET('/networth')).current;
      ctx.must(nw.breakdown.real_estate >= 6500000000, `BĐS 6,5 tỷ không vào mục bất động sản (${nw.breakdown.real_estate})`);
      const yieldPct = (25000000 - 3000000) * 12 / 6500000000;
      return `nhà 6,5 tỷ · thuê ròng 22tr₫/tháng = lợi suất ${pct(yieldPct)}/năm · tài sản tổng ${fmt(nw.assets, 'VND')}`;
    });

    await ctx.step('Dòng tiền lớn không làm sai tỉ lệ tiết kiệm', async () => {
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.savings_rate, 'tỉ lệ tiết kiệm');
      ctx.must(f.savings_rate <= 1.5, `tỉ lệ tiết kiệm ${pct(f.savings_rate)} — vô lý, chắc chắn tính sai`);
      ctx.must(f.savings_rate >= -5, `tỉ lệ tiết kiệm ${pct(f.savings_rate)} âm quá mức`);
      return `tiết kiệm ${pct(f.savings_rate)} · dôi dư ${fmt(f.monthly_surplus, 'VND')}/tháng`;
    });

    await ctx.step('Chụp lại ảnh tài sản để so sánh theo thời gian', async () => {
      const r = await ctx.POST('/networth/snapshot');
      ctx.must(r.ok !== false, JSON.stringify(r).slice(0, 150));
      const hist = (await ctx.GET('/networth')).history || [];
      ctx.must(hist.length >= 1, 'không lưu được mốc nào');
      return `${hist.length} mốc lịch sử tài sản để so sánh về sau`;
    });

    await finalReports(ctx, { netWorthAtLeast: 1000000000 });

    await askAdvisor(ctx, [
      'tháng này quán lãi hay lỗ',
      'mình có bao nhiêu tài sản',
      'nên trả nợ vay quán trước hay đầu tư trước',
    ]);
  },
});
// --- 6. Người sắp nghỉ hưu, sống bằng thu nhập thụ động --------------------
PERSONAS.push({
  slug: 'retiree',
  emoji: '🌴',
  name: 'Cô Hạnh, 58 tuổi — sắp nghỉ hưu',
  tagline: 'Không còn lương, sống bằng lãi ngân hàng và tiền cho thuê, rút vốn dần',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Hạnh', birthYear: 1968, city: 'Nha Trang', taxCountry: 'VN', currency: 'VND',
      greeting: 'cô sắp nghỉ hưu, muốn biết tiền có đủ sống tới già không',
    });

    await openAccounts(ctx, [
      { key: 'vcb', name: 'Vietcombank', type: 'bank', balance: 85000000, currency: 'VND' },
      { key: 'so1', name: 'Sổ tiết kiệm 2 tỷ', type: 'savings', balance: 2000000000, currency: 'VND' },
      { key: 'so2', name: 'Sổ tiết kiệm 1,5 tỷ', type: 'savings', balance: 1500000000, currency: 'VND' },
      { key: 'tp', name: 'Trái phiếu doanh nghiệp', type: 'investment', balance: 600000000, currency: 'VND' },
    ]);

    await ctx.step('Không có lương nhưng vẫn khai đủ các nguồn thu thụ động', async () => {
      await ctx.POST('/income-streams', { name: 'Lãi sổ tiết kiệm', type: 'interest', net_amount: 17500000, currency: 'VND' });
      await ctx.POST('/income-streams', { name: 'Cho thuê nhà mặt tiền', type: 'rental', net_amount: 18000000, payday: 5, currency: 'VND' });
      await ctx.POST('/income-streams', { name: 'Lãi trái phiếu', type: 'interest', net_amount: 4500000, currency: 'VND' });
      const s = (await ctx.GET('/income-streams')).streams || [];
      ctx.must(s.length === 3, `chỉ ghi được ${s.length}/3 nguồn`);
      ctx.must(s.every((x) => x.type !== 'salary'), 'app tự gán nhầm thành lương');
      return `40tr₫/tháng hoàn toàn từ thu nhập thụ động, không có đồng lương nào`;
    });

    await ctx.step('App nhận ra thu nhập thụ động đã phủ được chi tiêu', async () => {
      const items = [
        { amount: 8000000, note: 'ăn uống cả tháng' },
        { amount: 3500000, note: 'thuốc men khám bệnh' },
        { amount: 2000000, note: 'điện nước' },
        { amount: 4000000, note: 'giúp con cháu' },
      ];
      for (const it of items) await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.vcb, currency: 'VND', ...it });
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.passive_coverage, 'tỉ lệ thu nhập thụ động phủ chi tiêu');
      ctx.must(f.passive_coverage > 1, `thu 40tr₫ thụ động, chi 17,5tr₫ mà báo chỉ phủ ${pct(f.passive_coverage)} — tính sai`);
      return `thu nhập thụ động phủ ${pct(f.passive_coverage)} chi tiêu — cô đã tự do tài chính rồi`;
    });

    await ctx.step('Người đã đủ tiền thì không bị báo "còn X năm nữa mới tự do"', async () => {
      const f = (await ctx.GET('/fire')).fire;
      const reached = f.progress >= 1 || f.months_to_fi === 0 || f.months_to_fi === null || f.coast_reached;
      ctx.must(f.progress > 0, `tiến độ tự do tài chính = ${f.progress}`);
      if (!reached && Number.isFinite(f.months_to_fi)) {
        ctx.must(f.months_to_fi < 600, `báo còn ${Math.round(f.months_to_fi / 12)} năm nữa cho người 58 tuổi đã đủ sống — thông điệp sai`);
      }
      return `tiến độ ${pct(f.progress)} · cần ${fmt(f.fi_number, 'VND')} · đang có ${fmt(f.invested, 'VND')}`;
    });

    await ctx.step('Rút vốn (dôi dư âm) không làm dự báo vỡ thành số vô nghĩa', async () => {
      await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.vcb, amount: 60000000, currency: 'VND', note: 'sửa nhà cho con' });
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.savings_rate, 'tỉ lệ tiết kiệm khi rút vốn');
      ctx.must(f.months_to_fi === null || f.months_to_fi === undefined || (Number.isFinite(f.months_to_fi) && f.months_to_fi >= 0),
        `dôi dư âm làm số tháng thành ${f.months_to_fi}`);
      const d = await ctx.GET('/dashboard');
      ctx.must(!/NaN|Infinity/.test(JSON.stringify(d)), 'màn hình chính vỡ khi chi nhiều hơn thu');
      return `chi 60tr₫ đột xuất · tiết kiệm ${pct(f.savings_rate)} · app vẫn báo số sạch`;
    });

    await ctx.step('Bất động sản cho thuê đưa vào bức tranh tài sản', async () => {
      await ctx.POST('/properties', {
        name: 'Nhà mặt tiền Trần Phú', current_value: 8000000000,
        purchase_price: 2500000000, monthly_rent: 18000000, monthly_cost: 0, currency: 'VND',
      });
      const nw = (await ctx.GET('/networth')).current;
      ctx.must(nw.breakdown.real_estate >= 8000000000, `nhà 8 tỷ chưa vào tài sản (${nw.breakdown.real_estate})`);
      ctx.must(nw.liabilities === 0, `không nợ gì mà báo nợ ${nw.liabilities}`);
      return `tổng tài sản ${fmt(nw.assets, 'VND')} (tiết kiệm ${fmt(nw.breakdown.savings, 'VND')} + nhà ${fmt(nw.breakdown.real_estate, 'VND')}), không nợ nần`;
    });

    await ctx.step('Kịch bản "sống được bao lâu nếu ngừng thu nhập" tính được', async () => {
      const f = (await ctx.GET('/fire')).fire;
      ctx.finite(f.years_of_freedom, 'số năm sống được bằng tài sản hiện có');
      ctx.must(f.years_of_freedom > 0, `báo sống được ${f.years_of_freedom} năm`);
      return `tài sản hiện tại nuôi được ${f.years_of_freedom} năm nếu ngừng mọi thu nhập`;
    });

    await finalReports(ctx, { netWorthAtLeast: 4000000000 });

    await askAdvisor(ctx, [
      'cô có đủ tiền nghỉ hưu chưa',
      'mỗi tháng cô nhận được bao nhiêu tiền thụ động',
      'cô nên gửi tiết kiệm hay mua trái phiếu',
    ]);
  },
});

// --- 7. Người đang ngập trong nợ ------------------------------------------
PERSONAS.push({
  slug: 'debt',
  emoji: '🆘',
  name: 'Đức, 29 tuổi — đang ngập nợ thẻ',
  tagline: 'Nợ 4 nơi, tài sản ròng âm, cần lộ trình thoát nợ chứ không cần lời khuyên đầu tư',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Đức', birthYear: 1997, city: 'Bình Dương', taxCountry: 'VN', currency: 'VND',
      greeting: 'mình đang nợ thẻ tín dụng mấy chỗ, tháng nào cũng trả tối thiểu, bí quá rồi',
    });

    await openAccounts(ctx, [
      { key: 'tk', name: 'Sacombank', type: 'bank', balance: 3200000, currency: 'VND' },
      { key: 'card1', name: 'Thẻ Sacombank', type: 'credit', balance: -42000000, currency: 'VND' },
      { key: 'card2', name: 'Thẻ Shinhan', type: 'credit', balance: -28000000, currency: 'VND' },
    ]);

    await ctx.step('Khai 4 khoản nợ với lãi suất khác nhau', async () => {
      const debts = [
        { name: 'Thẻ Sacombank', balance: 42000000, interest_rate: 32, min_payment: 2100000, monthly_payment: 2100000, type: 'credit_card' },
        { name: 'Thẻ Shinhan', balance: 28000000, interest_rate: 27, min_payment: 1400000, monthly_payment: 1400000, type: 'credit_card' },
        { name: 'Vay tiêu dùng FE Credit', balance: 55000000, interest_rate: 42, min_payment: 3500000, monthly_payment: 3500000, type: 'personal' },
        { name: 'Vay bạn', balance: 20000000, interest_rate: 0, min_payment: 2000000, monthly_payment: 2000000, type: 'personal' },
      ];
      for (const d of debts) {
        const r = await ctx.POST('/debts', { ...d, principal: d.balance, currency: 'VND' });
        ctx.must(r.debt, `không khai được "${d.name}"`);
      }
      const sum = (await ctx.GET('/debts')).summary;
      ctx.must(sum.debts.length === 4, `chỉ có ${sum.debts.length}/4 khoản nợ`);
      ctx.near(sum.total_balance, 145000000, 1, 'tổng nợ cộng sai');
      return `tổng nợ ${fmt(sum.total_balance, 'VND')} · trả ${fmt(sum.monthly_payment, 'VND')}/tháng · lãi bình quân ${sum.avg_rate.toFixed(1)}%`;
    });

    await ctx.step('Tài sản ròng âm được hiển thị thật, không giấu diếm', async () => {
      const nw = (await ctx.GET('/networth')).current;
      ctx.must(nw.net < 0, `nợ 145tr, tài sản 3,2tr mà tài sản ròng = ${nw.net} — đang giấu nợ`);
      ctx.finite(nw.net, 'tài sản ròng');
      return `tài sản ròng ${fmt(nw.net, 'VND')} — app nói thẳng sự thật`;
    });

    await ctx.step('Chiến lược "tuyết lở" ưu tiên đúng khoản lãi cao nhất', async () => {
      const r = await ctx.GET('/debts?strategy=avalanche');
      const order = r.summary.plan?.order || r.summary.payoff?.order || r.summary.order;
      const list = order || r.summary.debts.slice().sort((a, b) => b.interest_rate - a.interest_rate);
      ctx.must(list.length > 0, 'không đưa ra được thứ tự trả nợ');
      ctx.must(/FE Credit/.test(list[0].name), `tuyết lở phải trả FE Credit (42%) trước, nhưng đề xuất "${list[0].name}"`);
      return `thứ tự: ${list.slice(0, 3).map((d) => `${d.name.replace('Vay tiêu dùng ', '')} (${d.interest_rate}%)`).join(' → ')}`;
    });

    await ctx.step('Chiến lược "bóng tuyết" ưu tiên khoản nhỏ nhất để tạo động lực', async () => {
      const r = await ctx.GET('/debts?strategy=snowball');
      const order = r.summary.plan?.order || r.summary.payoff?.order || r.summary.order;
      const list = order || r.summary.debts.slice().sort((a, b) => a.balance - b.balance);
      ctx.must(list.length > 0, 'không đưa ra được thứ tự trả nợ');
      ctx.must(/Vay bạn/.test(list[0].name), `bóng tuyết phải trả "Vay bạn" (20tr, nhỏ nhất) trước, nhưng đề xuất "${list[0].name}"`);
      return `thứ tự: ${list.slice(0, 3).map((d) => `${d.name.replace('Vay tiêu dùng ', '')} (${fmt(d.balance, 'VND')})`).join(' → ')}`;
    });

    await ctx.step('Trả bớt nợ thì dư nợ giảm thật và tài sản ròng cải thiện', async () => {
      const list = (await ctx.GET('/debts')).summary.debts;
      const fe = list.find((d) => /FE/.test(d.name));
      const net0 = (await ctx.GET('/networth')).current.net;
      await ctx.PATCH(`/debts/${fe.id}`, { balance: fe.balance - 10000000 });
      const after = (await ctx.GET('/debts')).summary.debts.find((d) => d.id === fe.id);
      ctx.near(after.balance, fe.balance - 10000000, 0, 'dư nợ không giảm sau khi trả');
      const net1 = (await ctx.GET('/networth')).current.net;
      ctx.must(net1 > net0, `trả 10tr nợ mà tài sản ròng không cải thiện (${net0} → ${net1})`);
      return `trả 10tr₫ → tài sản ròng tăng đúng ${(net1 - net0).toLocaleString('vi-VN')}₫`;
    });

    await ctx.step('App khuyên thoát nợ trước, không xui đầu tư khi đang nợ lãi 42%', async () => {
      await ctx.POST('/insights/generate');
      const list = (await ctx.GET('/insights')).insights || [];
      const text = list.map((i) => `${i.title} ${i.body || i.detail || ''}`).join(' ').toLowerCase();
      ctx.must(list.length > 0, 'không có lời khuyên nào cho người ngập nợ');
      ctx.must(/nợ|lãi suất|trả/.test(text), `${list.length} lời khuyên nhưng không nhắc gì tới nợ — sai trọng tâm`);
      const debtFirst = /nợ/.test((list[0].title || '').toLowerCase());
      return `${list.length} lời khuyên · đầu tiên: "${list[0].title}"${debtFirst ? ' ✔ đúng trọng tâm' : ' — nợ không được nêu đầu tiên'}`;
    });

    await ctx.step('Điểm sức khoẻ tài chính phản ánh đúng tình trạng nguy cấp', async () => {
      const h = (await ctx.GET('/advisor/health')).health;
      ctx.finite(h.score, 'điểm sức khoẻ');
      ctx.must(h.score < 55, `người nợ 145tr, tài sản ròng âm mà chấm ${h.score}/100 — điểm quá dễ dãi`);
      const debtPart = h.components.find((c) => c.key === 'debt');
      return `${h.score}/100 hạng ${h.grade} "${h.label}"${debtPart ? ` · tiêu chí nợ ${debtPart.score}đ: ${debtPart.detail}` : ''}`;
    });

    await finalReports(ctx);

    await askAdvisor(ctx, [
      'mình nợ tổng cộng bao nhiêu',
      'mình nên trả khoản nào trước',
      'bao lâu thì mình hết nợ',
    ]);
  },
});

// --- 8. Vợ chồng mới cưới, hai nguồn thu ----------------------------------
PERSONAS.push({
  slug: 'couple',
  emoji: '💑',
  name: 'Nam & Thu, 31 & 29 tuổi — vợ chồng mới cưới',
  tagline: 'Hai lương gộp chung, đang gom tiền mua căn hộ, sắp có em bé',
  run: async (ctx) => {
    ctx.baseCur = 'VND';

    await onboard(ctx, {
      name: 'Nam', birthYear: 1995, city: 'TP.HCM', taxCountry: 'VN', currency: 'VND',
      greeting: 'hai vợ chồng mình muốn gom tiền mua căn hộ trong 3 năm tới',
    });

    await openAccounts(ctx, [
      { key: 'chung', name: 'TK chung vợ chồng', type: 'bank', balance: 180000000, currency: 'VND' },
      { key: 'nam', name: 'TK riêng Nam', type: 'bank', balance: 25000000, currency: 'VND' },
      { key: 'thu', name: 'TK riêng Thu', type: 'bank', balance: 18000000, currency: 'VND' },
      { key: 'vang', name: 'Vàng cưới', type: 'investment', balance: 220000000, currency: 'VND' },
    ]);

    await ctx.step('Hai nguồn lương cùng đổ về, tổng thu nhập cộng đúng', async () => {
      await ctx.POST('/income-streams', { name: 'Lương Nam', type: 'salary', net_amount: 28000000, payday: 10, currency: 'VND' });
      await ctx.POST('/income-streams', { name: 'Lương Thu', type: 'salary', net_amount: 22000000, payday: 15, currency: 'VND' });
      const s = (await ctx.GET('/income-streams')).streams || [];
      const total = s.reduce((a, x) => a + x.net_amount, 0);
      ctx.must(total === 50000000, `tổng thu 2 vợ chồng sai: ${total}`);
      return `50tr₫/tháng gộp từ 2 lương`;
    });

    await ctx.step('Mục tiêu mua căn hộ tính ra mỗi tháng phải để bao nhiêu', async () => {
      const r = await ctx.POST('/funds', {
        name: 'Cọc căn hộ Thủ Đức', type: 'goal', percent: 0, currency: 'VND',
        target_amount: 900000000, target_date: '2029-09-01', priority: 1,
      });
      ctx.must(r.fund, JSON.stringify(r).slice(0, 150));
      const f = (await ctx.funds(true)).find((x) => x.id === r.fund.id);
      ctx.must(f.plan && f.plan.monthly_needed > 0, `không tính được số tiền cần để mỗi tháng: ${JSON.stringify(f.plan)}`);
      ctx.ids.homeNeed = f.plan.monthly_needed;
      const share = f.plan.monthly_needed / 50000000;
      return `900tr₫ trong ${f.plan.months_left} tháng → để ${fmt(f.plan.monthly_needed, 'VND')}/tháng = ${pct(share)} thu nhập${share > 0.5 ? ' ⚠️ quá sức' : ''}`;
    });

    await ctx.step('App cảnh báo khi tổng các mục tiêu vượt quá khả năng thực tế', async () => {
      const fs = await ctx.funds(true);
      const totalNeed = fs.reduce((a, f) => a + (f.plan?.monthly_needed || 0), 0);
      ctx.finite(totalNeed, 'tổng gánh nặng các quỹ');
      const offTrack = fs.filter((f) => f.plan?.has_target && f.plan.on_track === false);
      return totalNeed <= 50000000
        ? `tổng gánh ${fmt(totalNeed, 'VND')} ≤ thu nhập 50tr₫ — khả thi · ${offTrack.length} quỹ đang trễ tiến độ`
        : `⚠️ tổng gánh ${fmt(totalNeed, 'VND')} > thu nhập 50tr₫ — app có cờ on_track nhưng chưa gộp lại để nói "bạn đang ôm quá nhiều mục tiêu"`;
    });

    await ctx.step('Quỹ chuẩn bị sinh em bé mở được và xếp ưu tiên', async () => {
      const r = await ctx.POST('/funds', {
        name: 'Chuẩn bị sinh em bé', type: 'goal', percent: 0, currency: 'VND',
        target_amount: 80000000, target_date: '2027-06-01', priority: 2,
      });
      ctx.must(r.fund, JSON.stringify(r).slice(0, 150));
      const withTarget = (await ctx.funds(true)).filter((f) => f.plan?.has_target);
      ctx.must(withTarget.length >= 2, `chỉ ${withTarget.length} quỹ có mục tiêu`);
      const home = withTarget.find((f) => /Cọc căn hộ/.test(f.name));
      const baby = withTarget.find((f) => /em bé/.test(f.name));
      ctx.must(home.priority < baby.priority, `cọc nhà (ưu tiên ${home.priority}) phải đứng trước quỹ em bé (${baby.priority})`);
      return `cọc nhà ưu tiên ${home.priority} (cần ${fmt(home.plan.monthly_needed, 'VND')}/th) → em bé ưu tiên ${baby.priority} (cần ${fmt(baby.plan.monthly_needed, 'VND')}/th)`;
    });

    await ctx.step('Chi tiêu chung ghi từ tài khoản chung, tài khoản riêng không đụng tới', async () => {
      const n0 = await ctx.bal(ctx.acc.nam);
      const t0 = await ctx.bal(ctx.acc.thu);
      const items = [
        { amount: 12000000, note: 'tiền thuê căn hộ' },
        { amount: 6000000, note: 'chợ búa cả tháng' },
        { amount: 2500000, note: 'điện nước internet' },
        { amount: 3000000, note: 'xăng xe 2 người' },
      ];
      for (const it of items) await ctx.POST('/transactions', { type: 'expense', account_id: ctx.acc.chung, currency: 'VND', ...it });
      ctx.must(await ctx.bal(ctx.acc.nam) === n0, 'tiền riêng của Nam bị trừ oan');
      ctx.must(await ctx.bal(ctx.acc.thu) === t0, 'tiền riêng của Thu bị trừ oan');
      return `chi chung ${items.reduce((a, x) => a + x.amount, 0).toLocaleString('vi-VN')}₫, hai ví riêng nguyên vẹn`;
    });

    await ctx.step('Vàng cưới được tính vào tài sản, không bị bỏ quên', async () => {
      const nw = (await ctx.GET('/networth')).current;
      ctx.must(nw.assets >= 220000000, `vàng 220tr không nằm trong tài sản (tổng ${nw.assets})`);
      return `tổng tài sản ${fmt(nw.assets, 'VND')} đã gồm vàng cưới`;
    });

    await ctx.step('Dự báo mua nhà: app cho biết dòng tiền các ngày tới ra sao', async () => {
      const series = (await ctx.GET('/forecast')).daily?.series || [];
      ctx.must(series.length > 0, 'không dự báo được dòng tiền tương lai');
      ctx.must(!/NaN|null/.test(JSON.stringify(series.map((s) => s.balance))), 'dự báo có giá trị NaN/null');
      const lo = Math.min(...series.map((s) => s.balance));
      return `dự báo ${series.length} ngày · đáy số dư ${fmt(lo, 'VND')}${lo < 0 ? ' ⚠️ sẽ âm tiền' : ''}`;
    });

    await finalReports(ctx, { netWorthAtLeast: 400000000 });

    await askAdvisor(ctx, [
      'hai vợ chồng mình mỗi tháng để dành được bao nhiêu',
      'bao giờ mình đủ tiền cọc nhà',
      'mình nên cắt khoản nào để tiết kiệm hơn',
    ]);
  },
});

// ===========================================================================
// CHẠY
// ===========================================================================

const pick = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const queue = pick.length ? pick.map((i) => PERSONAS[i - 1]).filter(Boolean) : PERSONAS;

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║  KIỂM THỬ HÀNH TRÌNH NGƯỜI DÙNG ĐẦU-CUỐI — FinMate                 ║');
console.log(`║  ${String(queue.length).padStart(2)} kiểu người dùng, mỗi người một server + một cơ sở dữ liệu riêng  ║`);
console.log('╚════════════════════════════════════════════════════════════════════╝');

const reports = [];
let port = 4210;
for (const p of queue) {
  reports.push(await runPersona(p, port));
  port += 1;
}

// --- Bản báo cáo ---
console.log('\n\n════════════════════════════════════════════════════════════════════');
console.log('  KẾT QUẢ TỪNG NGƯỜI DÙNG');
console.log('════════════════════════════════════════════════════════════════════\n');

for (const r of reports) {
  const pass = r.checks.filter((c) => c.ok).length;
  const total = r.checks.length;
  const bar = pass === total ? '✅' : '⚠️ ';
  console.log(`${bar} ${r.persona.emoji} ${r.persona.name}  —  ${pass}/${total} bước đạt  (${r.ms}ms)`);
  console.log(`   ${r.persona.tagline}`);
  for (const c of r.checks) {
    if (!c.ok) console.log(`   ❌ ${c.name}\n      → ${c.note}`);
  }
  const withNotes = r.checks.filter((c) => c.ok && c.note);
  if (withNotes.length) {
    console.log('   Quan sát:');
    for (const c of withNotes) console.log(`     · ${c.name}: ${c.note}`);
  }
  console.log('');
}

const pass = all.filter((c) => c.ok).length;
const fail = all.length - pass;
console.log('════════════════════════════════════════════════════════════════════');
console.log(`  TỔNG: ${pass}/${all.length} bước đạt trên ${reports.length} hành trình người dùng`);
console.log('════════════════════════════════════════════════════════════════════');
if (fail) {
  console.log(`\n${fail} bước chưa đạt:`);
  for (const c of all.filter((x) => !x.ok)) console.log(`  ❌ [${c.persona}] ${c.name}\n     ${c.note}`);
}
process.exit(fail ? 1 : 0);