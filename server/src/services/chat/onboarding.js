/** Luồng trò chuyện thiết lập ban đầu — hỏi như một cố vấn tài chính, tự dựng toàn bộ kế hoạch. */
import { all, get, run, insert, update } from '../../db.js';
import { today, monthKey, addMonths, toISO } from '../../util/date.js';
import { short, fmt } from '../../util/money.js';
import { norm, parseAmount, findAmounts, parsePercent } from '../../util/vi.js';
import { parseNamedAmounts, splitItems } from './nlu.js';
import { createTransaction } from '../ledger.js';
import { createRecurring } from '../recurring.js';
import { categoryByName, fundByName } from '../../bootstrap.js';
import { fireStats, emergencyStatus } from '../fire.js';
import { healthScore, nextActions } from '../advisor.js';
import { generateInsights } from '../insights.js';
import { snapshot } from '../networth.js';

const STEPS = ['welcome', 'income', 'accounts', 'other_income', 'fixed_costs', 'debts', 'goals', 'lifestyle', 'done'];

const SKIP = ['bo qua', 'khong', 'ko', 'chua co', 'skip', 'khong co', 'chua', 'k co', 'next', 'tiep'];
const isSkip = (t) => {
  const n = norm(t);
  return SKIP.some((s) => n === s || n.startsWith(s + ' ') || n === s + '.') || n.length < 2;
};

function profile() {
  return get('SELECT * FROM profile WHERE id = 1') || {};
}
function meta() {
  try {
    return JSON.parse(profile().meta || '{}');
  } catch {
    return {};
  }
}
function saveMeta(patch) {
  const m = { ...meta(), ...patch };
  update('profile', 1, { meta: JSON.stringify(m), updated_at: new Date().toISOString() });
  return m;
}

const BANK_KEYS = ['vietcombank', 'vcb', 'techcombank', 'tcb', 'mb', 'mbbank', 'acb', 'tpbank', 'vpbank', 'bidv', 'vietinbank', 'sacombank', 'agribank', 'timo', 'cake', 'ocb', 'hsbc', 'shinhan'];
const WALLET_KEYS = ['momo', 'zalopay', 'shopeepay', 'viettel money', 'vnpay', 'vi dien tu', 'vi '];

function guessAccountType(name) {
  const n = norm(name);
  if (/tiet kiem|so tk|ky han|cd |dinh ky/.test(n)) return 'savings';
  if (/tien mat|cash|vi tien|trong vi/.test(n)) return 'cash';
  if (/chung khoan|vps|ssi|vnd |tcbs|mirae|hsc|dnse|broker/.test(n)) return 'brokerage';
  if (/the tin dung|credit/.test(n)) return 'credit_card';
  if (WALLET_KEYS.some((w) => n.includes(w))) return 'ewallet';
  if (BANK_KEYS.some((w) => n.includes(w)) || /ngan hang|bank|tk /.test(n)) return 'bank';
  return 'bank';
}

function createAccount({ name, amount, type }) {
  const t = type || guessAccountType(name);
  const id = insert('accounts', {
    name: name.replace(/^tk\s+/i, '').replace(/\b(ngan hang|ngân hàng)\b/gi, '').trim() || 'Tài khoản',
    type: t,
    institution: BANK_KEYS.find((b) => norm(name).includes(b)) || null,
    balance: 0,
    opening_balance: 0,
    interest_rate: t === 'savings' ? 5.2 : t === 'bank' ? 0.2 : 0,
    interest_payout: t === 'savings' ? 'monthly' : 'monthly',
    opened_at: today(),
    auto_sync: t === 'cash' ? 'manual' : 'sms',
    icon: t === 'cash' ? '👛' : t === 'savings' ? '🏦' : t === 'brokerage' ? '📈' : t === 'ewallet' ? '📱' : '💳',
  });
  if (amount) {
    update('accounts', id, { balance: amount, opening_balance: amount });
  }
  return get('SELECT * FROM accounts WHERE id = ?', [id]);
}

// ---- các bước -------------------------------------------------------------

const stepHandlers = {
  welcome(text) {
    const name = extractName(text);
    const yearMatch = String(text).match(/\b(19|20)\d{2}\b/);
    const ageMatch = norm(text).match(/(\d{2})\s*(tuoi|t\b)/);
    const patch = {};
    if (name) patch.name = name;
    if (yearMatch) patch.birth_year = Number(yearMatch[0]);
    else if (ageMatch) patch.birth_year = new Date().getFullYear() - Number(ageMatch[1]);
    if (Object.keys(patch).length) update('profile', 1, patch);
    const who = patch.name || profile().name || 'bạn';
    return {
      reply: `Rất vui được đồng hành cùng ${who}! 🤝\n\nMình sẽ hỏi nhanh 7 câu để dựng bức tranh tài chính đầy đủ, sau đó app tự chạy — bạn gần như không phải nhập tay nữa.\n\n**Câu 1/7 — Thu nhập chính.** Bạn đang làm gì và thu nhập bao nhiêu, nhận ngày mấy hàng tháng?\n_Ví dụ: "Mình làm dev, lương 30 triệu, nhận ngày 5"_`,
      quick: ['Lương 20 triệu ngày 5', 'Lương 35 triệu ngày 10', 'Thu nhập không cố định'],
      next: 'income',
    };
  },

  income(text) {
    if (isSkip(text) || /khong co dinh|khong on dinh|tu do|freelance/.test(norm(text))) {
      const a = parseAmount(text);
      if (a) {
        insert('income_streams', { name: 'Thu nhập tự do', type: 'freelance', net_amount: a.value, frequency: 'irregular', stability: 3, active: 1 });
        saveMeta({ monthly_income: a.value });
      }
      return {
        reply: `Ghi nhận thu nhập linh hoạt${parseAmount(text) ? ` ~${short(parseAmount(text).value)}/tháng` : ''}. Với dòng tiền không đều, quỹ khẩn cấp nên dày hơn (9 tháng thay vì 6) — mình sẽ tính theo hướng đó.\n\n**Câu 2/7 — Tiền đang nằm ở đâu?** Liệt kê các tài khoản và số dư hiện tại.\n_Ví dụ: "VCB 50 triệu, Momo 2 triệu, tiết kiệm 300 triệu, tiền mặt 5 triệu"_`,
        quick: ['VCB 50 triệu, tiền mặt 3 triệu', 'Chưa có gì nhiều'],
        next: 'accounts',
        patch: { emergency_months_target: 9 },
      };
    }
    const a = parseAmount(text);
    const n = norm(text);
    const paydayM = n.match(/ngay (\d{1,2})|mung (\d{1,2})/);
    const payday = paydayM ? Number(paydayM[1] || paydayM[2]) : 5;
    const amount = a ? a.value : 0;
    const jobM = String(text).match(/(?:lam|làm|nghe|nghề|vi tri|vị trí)\s+([^,.]{2,30})/i);
    const job = jobM ? jobM[1].trim() : 'Công việc chính';

    if (amount) {
      const acc = get("SELECT * FROM accounts WHERE type IN ('bank') ORDER BY id LIMIT 1") || createAccount({ name: 'Tài khoản lương', amount: 0, type: 'bank' });
      const streamId = insert('income_streams', {
        name: `Lương - ${job}`, type: 'salary', employer: job, account_id: acc.id,
        net_amount: amount, gross_amount: amount, frequency: 'monthly', payday, stability: 5, active: 1, tax_mode: 'net',
      });
      createRecurring({
        name: `Lương ${job}`, type: 'income', amount, account_id: acc.id,
        category_id: categoryByName('Lương', 'income')?.id, income_stream_id: streamId,
        frequency: 'monthly', day_of_month: payday, start_date: today(), auto_post: 1,
      });
      saveMeta({ monthly_income: amount, job });
    }
    return {
      reply: `${amount ? `Đã ghi: **${short(amount)}/tháng**, nhận ngày ${payday}. Mỗi kỳ lương app sẽ **tự ghi nhận và tự chia vào các quỹ** — bạn không cần làm gì.` : 'Ghi nhận.'}\n\n**Câu 2/7 — Tiền đang nằm ở đâu?** Liệt kê tài khoản và số dư hiện tại.\n_Ví dụ: "VCB 50 triệu, Momo 2 triệu, tiết kiệm 300 triệu, tiền mặt 5 triệu"_`,
      quick: ['VCB 50 triệu, tiền mặt 3 triệu', 'Chưa có gì nhiều'],
      next: 'accounts',
    };
  },

  accounts(text) {
    if (isSkip(text)) {
      return { reply: nextQ3(''), quick: ['Không có', 'Lãi ngân hàng 500k/tháng', 'Cho thuê nhà 8 triệu/tháng'], next: 'other_income' };
    }
    const items = parseNamedAmounts(text);
    const created = [];
    for (const it of items) {
      const acc = createAccount({ name: it.name, amount: it.amount });
      created.push(acc);
    }
    const total = created.reduce((s, a) => s + a.balance, 0);
    saveMeta({ starting_assets: total });
    return {
      reply: `Đã tạo ${created.length} tài khoản, tổng **${short(total)}**:\n${created.map((a) => `• ${a.icon} ${a.name}: ${fmt(a.balance)}`).join('\n')}\n\n${nextQ3()}`,
      quick: ['Không có', 'Lãi ngân hàng 500k/tháng', 'Cho thuê nhà 8 triệu/tháng', 'Cổ tức cổ phiếu'],
      next: 'other_income',
    };
  },

  other_income(text) {
    if (!isSkip(text)) {
      const items = parseNamedAmounts(text);
      for (const it of items) {
        const n = norm(it.name);
        let type = 'other';
        let catName = 'Thu khác';
        if (/thue|tro|can ho|bat dong san|bds|nha/.test(n)) { type = 'rental'; catName = 'Cho thuê BĐS'; }
        else if (/lai|tiet kiem|ngan hang|gui/.test(n)) { type = 'interest'; catName = 'Lãi ngân hàng'; }
        else if (/co tuc|dividend/.test(n)) { type = 'dividend'; catName = 'Cổ tức'; }
        else if (/chung khoan|co phieu|dau tu/.test(n)) { type = 'capital_gain'; catName = 'Lãi vốn đầu tư'; }
        else if (/freelance|du an|ngoai|part time|ban hang|kinh doanh|shop/.test(n)) { type = 'freelance'; catName = 'Freelance / Dự án'; }
        const streamId = insert('income_streams', {
          name: it.name || 'Nguồn thu khác', type, net_amount: it.amount, frequency: 'monthly',
          stability: type === 'rental' || type === 'interest' ? 4 : 3, active: 1,
        });
        if (type === 'rental') {
          insert('properties', { name: it.name || 'Bất động sản cho thuê', monthly_rent: it.amount, occupancy: 1, current_value: it.amount * 200 });
        }
        createRecurring({
          name: it.name || 'Thu nhập khác', type: 'income', amount: it.amount,
          category_id: categoryByName(catName, 'income')?.id, income_stream_id: streamId,
          frequency: 'monthly', day_of_month: 10, start_date: today(), auto_post: type !== 'capital_gain',
        });
      }
      if (items.length) saveMeta({ passive_income: items.reduce((s, i) => s + i.amount, 0) });
    }
    return {
      reply: `${isSkip(text) ? 'Ok, sau này có thêm nguồn thu cứ nhắn mình.' : 'Tuyệt — nhiều nguồn thu là nền tảng của tự do tài chính. Đã theo dõi tự động.'}\n\n**Câu 4/7 — Chi phí cố định hàng tháng?** (tiền nhà, điện nước, internet, học phí, bảo hiểm, thuê bao...)\n_Ví dụ: "Tiền nhà 6 triệu, điện nước 800k, internet 250k, Netflix 260k"_`,
      quick: ['Tiền nhà 5 triệu, điện nước 1 triệu', 'Ở với gia đình, không tốn tiền nhà'],
      next: 'fixed_costs',
    };
  },

  fixed_costs(text) {
    const created = [];
    if (!isSkip(text)) {
      const items = parseNamedAmounts(text);
      for (const it of items) {
        const cat = guessExpenseCategory(it.name);
        const rec = createRecurring({
          name: it.name, type: 'expense', amount: it.amount, category_id: cat?.id,
          fund_id: fundByName('Thiết yếu')?.id, frequency: 'monthly', day_of_month: 5,
          start_date: today(), auto_post: 1, variable: /dien|nuoc|gas|xang/.test(norm(it.name)) ? 1 : 0,
        });
        created.push({ ...rec, category: cat?.name });
      }
      saveMeta({ fixed_costs: items.reduce((s, i) => s + i.amount, 0) });
    }
    return {
      reply: `${created.length ? `Đã thiết lập ${created.length} khoản cố định (${short(created.reduce((s, c) => s + c.amount, 0))}/tháng), app sẽ tự ghi sổ đúng ngày:\n${created.map((c) => `• ${c.name}: ${fmt(c.amount)}`).join('\n')}` : 'Ok.'}\n\n**Câu 5/7 — Đang có khoản nợ nào không?** (vay ngân hàng, trả góp, thẻ tín dụng, vay người thân)\n_Ví dụ: "Vay mua nhà 800 triệu lãi 9,5%, trả 12 triệu/tháng"_`,
      quick: ['Không nợ gì cả', 'Thẻ tín dụng 20 triệu', 'Vay mua xe 300 triệu lãi 10%'],
      next: 'debts',
    };
  },

  debts(text) {
    const created = [];
    if (!isSkip(text)) {
      for (const part of splitItems(text)) {
        const amounts = findAmounts(part).filter((a) => a.value >= 1_000_000);
        if (!amounts.length) continue;
        const balance = Math.max(...amounts.map((a) => a.value));
        const monthly = amounts.map((a) => a.value).filter((v) => v !== balance).sort((a, b) => a - b)[0] || 0;
        const rate = parsePercent(part) ? parsePercent(part) * 100 : /the tin dung|credit/.test(norm(part)) ? 24 : 11;
        const name = part.replace(/\d[\d.,]*\s*(trieu|triệu|ty|tỷ|k|nghin|nghìn|%)?/gi, '').replace(/\s+/g, ' ').trim() || 'Khoản vay';
        const id = insert('debts', {
          name, type: /nha|mua nha|the chap/.test(norm(part)) ? 'mortgage' : /xe|oto|o to/.test(norm(part)) ? 'auto' : /the tin dung/.test(norm(part)) ? 'credit_card' : 'personal',
          balance, principal: balance, interest_rate: rate, monthly_payment: monthly,
          min_payment: monthly || Math.round(balance * 0.03), start_date: today(), due_day: 10, status: 'active',
        });
        if (monthly) {
          createRecurring({
            name: `Trả nợ ${name}`, type: 'expense', amount: monthly, debt_id: id,
            category_id: categoryByName('Trả nợ & Lãi vay', 'expense')?.id, fund_id: fundByName('Thiết yếu')?.id,
            frequency: 'monthly', day_of_month: 10, start_date: today(), auto_post: 1,
          });
        }
        created.push({ name, balance, rate, monthly });
      }
    }
    return {
      reply: `${created.length ? `Đã ghi ${created.length} khoản nợ:\n${created.map((d) => `• ${d.name}: ${short(d.balance)} @ ${d.rate}%/năm${d.monthly ? `, trả ${short(d.monthly)}/tháng` : ''}`).join('\n')}\n\nMình sẽ tính giúp ngày hết nợ và chiến lược trả tối ưu.` : 'Không nợ — khởi đầu rất đẹp. 👍'}\n\n**Câu 6/7 — Mục tiêu tài chính lớn nhất của bạn?** (kèm số tiền và thời hạn nếu có)\n_Ví dụ: "Mua nhà 2 tỷ trong 5 năm", "Có 500 triệu để nghỉ việc đi du lịch 1 năm"_`,
      quick: ['Mua nhà 2 tỷ trong 5 năm', 'Tự do tài chính càng sớm càng tốt', 'Quỹ khẩn cấp 6 tháng'],
      next: 'goals',
    };
  },

  goals(text) {
    const created = [];
    if (!isSkip(text)) {
      for (const part of splitItems(text)) {
        const a = parseAmount(part);
        const n = norm(part);
        const my = n.match(/(\d{1,2})\s*nam/);
        const mm = n.match(/(\d{1,3})\s*thang/);
        const months = my ? Number(my[1]) * 12 : mm ? Number(mm[1]) : null;
        if (!a && !/tu do tai chinh|khan cap|nghi huu/.test(n)) continue;
        let name = part.replace(a ? a.raw : '', '').replace(/trong \d+\s*(nam|thang)/gi, '').replace(/\s+/g, ' ').trim();
        name = name.replace(/^(muon|muốn|minh muon|toi muon|du dinh|dat muc tieu)\s*/i, '').trim() || 'Mục tiêu';
        let type = 'save';
        if (/nha|can ho|dat/.test(n)) type = 'purchase';
        else if (/du lich|travel/.test(n)) type = 'travel';
        else if (/khan cap/.test(n)) type = 'emergency';
        else if (/tu do tai chinh|nghi huu|fire/.test(n)) type = 'retirement';
        const fundName = type === 'emergency' ? 'Quỹ khẩn cấp' : type === 'retirement' ? 'Tự do tài chính' : 'Mục tiêu lớn';
        const target = a ? a.value : 0;
        const deadline = months ? addMonths(today(), months) : null;
        if (!target && type !== 'retirement') continue;
        const id = insert('goals', {
          name: name.charAt(0).toUpperCase() + name.slice(1),
          type, target_amount: target || 0, deadline,
          monthly_contribution: target && months ? Math.round(target / months) : 0,
          fund_id: fundByName(fundName)?.id, priority: type === 'emergency' ? 1 : 2, auto_contribute: 1, status: 'active',
        });
        created.push(get('SELECT * FROM goals WHERE id = ?', [id]));
      }
    }
    return {
      reply: `${created.length ? `Đã đặt ${created.length} mục tiêu:\n${created.map((g) => `• 🎯 ${g.name}: ${short(g.target_amount)}${g.deadline ? ` trước ${g.deadline}` : ''}${g.monthly_contribution ? ` → cần ${short(g.monthly_contribution)}/tháng` : ''}`).join('\n')}` : 'Ok, mình sẽ gợi ý mục tiêu sau khi xem bức tranh tổng thể.'}\n\n**Câu 7/7 — Phong cách sống & khẩu vị rủi ro.** Bạn thuộc kiểu nào?\n1️⃣ **An toàn** — ngủ ngon quan trọng hơn lãi cao\n2️⃣ **Cân bằng** — chấp nhận biến động vừa phải\n3️⃣ **Tăng trưởng** — chịu được lỗ ngắn hạn để lãi dài hạn cao\n\nKèm mô tả ngắn về lối sống của bạn nếu muốn (hay đi cà phê, du lịch nhiều, thích đồ công nghệ...).`,
      quick: ['Cân bằng', 'Tăng trưởng, mình còn trẻ', 'An toàn thôi'],
      next: 'lifestyle',
    };
  },

  lifestyle(text) {
    const n = norm(text);
    let risk = 'balanced';
    if (/^1|an toan|conservative|bao thu|khong thich rui ro/.test(n)) risk = 'conservative';
    else if (/^3|tang truong|aggressive|manh|lieu|con tre/.test(n)) risk = 'aggressive';
    update('profile', 1, { risk_profile: risk, lifestyle: String(text).slice(0, 400), expected_return: risk === 'conservative' ? 0.07 : risk === 'aggressive' ? 0.11 : 0.09 });
    return { reply: null, next: 'done' };
  },
};

function extractName(text) {
  if (isSkip(text)) return null;
  const m = String(text).match(/(?:tên là|ten la|tôi là|toi la|mình là|minh la|gọi mình là|goi minh la|tên|ten)\s+([\p{L}\s]{2,30})/iu);
  if (m) {
    const picked = m[1].trim().split(/\s+/).slice(0, 4).join(' ');
    return isNotAName(picked) ? null : picked;
  }
  const single = String(text).trim();
  if (/^[\p{L}\s]{2,25}$/u.test(single) && single.split(/\s+/).length <= 4 && !isNotAName(single)) return single;
  return null;
}

/** Câu trả lời cho có ("bỏ qua bước này", "chưa biết") không được lưu thành tên người dùng. */
function isNotAName(s) {
  const n = norm(s);
  if (!n || n.includes('chao')) return true;
  return /^(bo qua|bo qua buoc nay|khong|chua|chua biet|khong biet|khong ro|tiep|tiep tuc|xong|xong roi|thoi|de sau|sau nhe|minh chua ro|giai thich giup|co|duoc|ok|okie|uh|u)\b/.test(n);
}

function guessExpenseCategory(name) {
  const n = norm(name);
  const map = [
    [/nha|tro|phong|chung cu|quan ly/, 'Nhà ở'],
    [/dien|nuoc|internet|wifi|gas|truyen hinh|cap/, 'Điện nước & Internet'],
    [/dien thoai|sim|cuoc/, 'Điện thoại'],
    [/bao hiem/, 'Bảo hiểm'],
    [/hoc phi|khoa hoc|hoc/, 'Giáo dục & Phát triển'],
    [/gym|yoga|the thao|pt/, 'Thể thao & Gym'],
    [/netflix|spotify|youtube|chatgpt|thue bao|subscription|icloud/, 'Giải trí'],
    [/an|com|cafe|do an/, 'Ăn uống'],
    [/xe|xang|grab|gui xe/, 'Di chuyển'],
    [/bo me|gia dinh|con|sua|bim/, 'Gia đình & Con cái'],
    [/no|vay|tra gop|the tin dung/, 'Trả nợ & Lãi vay'],
  ];
  for (const [re, cat] of map) if (re.test(n)) return categoryByName(cat, 'expense');
  return categoryByName('Chi khác', 'expense');
}

function nextQ3() {
  return `**Câu 3/7 — Nguồn thu nhập khác ngoài lương?** (lãi ngân hàng, cổ tức, cho thuê nhà, freelance, kinh doanh...)\n_Ví dụ: "Lãi tiết kiệm 1,2 triệu/tháng, cho thuê phòng 3 triệu"_`;
}

/** Bước cuối: dựng kế hoạch phân bổ + ngân sách + tóm tắt toàn cảnh. */
export function buildPlan() {
  const p = profile();
  const m = meta();
  const income = m.monthly_income || 0;
  const fixed = m.fixed_costs || 0;
  const debts = all("SELECT * FROM debts WHERE status='active'");
  const debtMonthly = debts.reduce((s, d) => s + (d.monthly_payment || d.min_payment || 0), 0);
  const highRate = debts.some((d) => d.interest_rate >= 15);
  const ef = emergencyStatus();

  // Điều chỉnh tỷ lệ quỹ theo hoàn cảnh thực tế
  const necessityNeed = income ? Math.min(0.7, Math.max(0.35, (fixed + debtMonthly) / income + 0.12)) : 0.5;
  let alloc = {
    'Thiết yếu': necessityNeed,
    'Quỹ khẩn cấp': ef.ok ? 0.03 : 0.12,
    'Tự do tài chính': 0.15,
    'Mục tiêu lớn': 0.1,
    'Phát triển bản thân': 0.05,
    'Hưởng thụ': 0.08,
    'Cho đi': 0.02,
  };
  if (highRate) {
    alloc['Tự do tài chính'] -= 0.05;
    alloc['Mục tiêu lớn'] -= 0.03;
    alloc['Thiết yếu'] += 0.08;
  }
  const sum = Object.values(alloc).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(alloc)) alloc[k] = Math.max(0, (alloc[k] / sum) * 100);
  const total = Object.values(alloc).reduce((s, v) => s + v, 0);
  const keys = Object.keys(alloc);
  alloc[keys[0]] += 100 - total;
  for (const [name, percent] of Object.entries(alloc)) {
    const f = fundByName(name);
    if (f) update('funds', f.id, { percent: Math.round(percent * 10) / 10 });
  }
  const efFund = fundByName('Quỹ khẩn cấp');
  if (efFund && ef.target_amount) update('funds', efFund.id, { target_amount: ef.target_amount, cap: Math.round(ef.target_amount * 1.1) });

  // Ngân sách gợi ý cho nhóm chi tuỳ ý
  const discretionary = income * (alloc['Hưởng thụ'] / 100);
  const budgetPlan = [
    { cat: 'Ăn uống', amount: income * 0.15 },
    { cat: 'Mua sắm', amount: discretionary * 0.4 },
    { cat: 'Giải trí', amount: discretionary * 0.35 },
    { cat: 'Di chuyển', amount: income * 0.05 },
  ];
  for (const b of budgetPlan) {
    const c = categoryByName(b.cat, 'expense');
    if (c && b.amount > 0 && !get('SELECT id FROM budgets WHERE category_id = ?', [c.id])) {
      insert('budgets', { category_id: c.id, amount: Math.round(b.amount / 100000) * 100000, period: 'monthly', alert_threshold: 0.8, active: 1 });
    }
  }

  // Mục tiêu quỹ khẩn cấp nếu chưa có
  if (!get("SELECT id FROM goals WHERE type='emergency'") && ef.target_amount > 0) {
    insert('goals', {
      name: `Quỹ khẩn cấp ${ef.target_months} tháng`, type: 'emergency', target_amount: ef.target_amount,
      current_amount: 0, fund_id: efFund?.id, priority: 1, monthly_contribution: Math.round(income * (alloc['Quỹ khẩn cấp'] / 100)), auto_contribute: 1,
    });
  }

  update('profile', 1, { onboarded: 1, onboarding_step: 'done' });
  snapshot();
  generateInsights();

  const fire = fireStats({ monthly_income: income || undefined, monthly_expense: fixed + debtMonthly + income * 0.25 || undefined });
  const health = healthScore();
  const actions = nextActions(4);
  const funds = all('SELECT * FROM funds ORDER BY priority');

  const lines = [];
  lines.push(`## 🎉 Kế hoạch tài chính của bạn đã sẵn sàng`);
  lines.push(`**Điểm sức khoẻ tài chính: ${health.score}/100 (${health.grade} — ${health.label})**`);
  lines.push('');
  lines.push(`### 💧 Dòng tiền tự động`);
  if (income) lines.push(`Mỗi khi lương ${short(income)} về, app tự chia ngay:`);
  lines.push(funds.filter((f) => f.percent > 0).map((f) => `• ${f.icon} **${f.name}** ${f.percent}% ≈ ${short((income * f.percent) / 100)}`).join('\n'));
  lines.push('');
  if (debts.length) {
    lines.push(`### 🏦 Nợ`);
    lines.push(`Tổng dư nợ ${short(debts.reduce((s, d) => s + d.balance, 0))}, trả ${short(debtMonthly)}/tháng.${highRate ? ' Có khoản lãi ≥15% — mình đã ưu tiên dồn tiền trả nợ trước khi đầu tư.' : ''}`);
    lines.push('');
  }
  lines.push(`### 🔥 Tự do tài chính`);
  lines.push(`Cần **${short(fire.fi_number)}** để sống bằng lợi nhuận (rút ${Math.round(fire.swr * 100)}%/năm).`);
  if (fire.fi_date) lines.push(`Với nhịp hiện tại: dự kiến đạt **${fire.fi_date}**${fire.fi_age ? ` — lúc bạn ${Math.round(fire.fi_age)} tuổi` : ''}.`);
  else lines.push(`Hiện chưa có dôi dư để tích luỹ — việc đầu tiên là tạo khoảng cách giữa thu và chi.`);
  lines.push('');
  lines.push(`### ✅ Việc nên làm tiếp theo`);
  lines.push(actions.map((a, i) => `${i + 1}. **${a.title}** — ${a.detail}`).join('\n'));
  lines.push('');
  lines.push(`### 🤖 Từ giờ bạn không cần nhập tay`);
  lines.push(`• Lương và hoá đơn cố định: tự ghi sổ đúng ngày\n• Lãi tiết kiệm: tự cộng vào mỗi kỳ\n• Giao dịch ngân hàng: bật **Tự động hoá → Webhook/SMS** để app đọc tin nhắn biến động số dư\n• Cần gì cứ nhắn: _"trưa nay ăn 60k"_, _"dư 50 triệu nên làm gì"_, _"bao giờ mình mua được nhà"_`);

  return { reply: lines.join('\n'), plan: { allocation: alloc, fire, health, actions } };
}

/** Điều phối 1 lượt hội thoại onboarding. */
export function handleOnboarding(text) {
  const p = profile();
  const step = p.onboarding_step || 'welcome';
  const handler = stepHandlers[step];
  if (!handler) {
    update('profile', 1, { onboarding_step: 'welcome' });
    return { reply: stepHandlers.welcome('').reply, quick: [], step: 'income' };
  }
  const res = handler(text);
  if (res.patch) update('profile', 1, res.patch);
  update('profile', 1, { onboarding_step: res.next });
  if (res.next === 'done') {
    const plan = buildPlan();
    return { reply: plan.reply, quick: ['Xem bảng điều khiển', 'Cách bật tự động hoá', 'Mình dư 50 triệu nên làm gì?'], step: 'done', data: plan.plan, onboarded: true };
  }
  return { reply: res.reply, quick: res.quick || [], step: res.next };
}

/** Câu hỏi của bước thiết lập đang dang dở, để nhắc lại sau khi trả lời câu hỏi xen ngang. */
const STEP_PROMPT = {
  welcome: 'bạn tên gì và sinh năm bao nhiêu?',
  income: 'thu nhập chính hằng tháng của bạn khoảng bao nhiêu?',
  accounts: 'bạn đang có những tài khoản, ví nào và số dư mỗi nơi bao nhiêu?',
  other_income: 'ngoài thu nhập chính, bạn còn nguồn thu nào khác không?',
  fixed_costs: 'mỗi tháng bạn có những khoản cố định nào (thuê nhà, điện nước, đăng ký...)?',
  debts: 'bạn có khoản nợ hay khoản vay nào đang trả không?',
  goals: 'bạn đang muốn đạt mục tiêu tiền bạc nào?',
  lifestyle: 'phong cách chi tiêu của bạn thế nào?',
};
export const currentOnboardingQuestion = () => STEP_PROMPT[profile()?.onboarding_step || 'welcome'] || null;

export function startOnboarding() {  update('profile', 1, { onboarding_step: 'welcome', onboarded: 0 });
  return {
    reply: `Chào bạn 👋 Mình là **FinMate** — cố vấn tài chính riêng của bạn.\n\nMình sẽ giúp bạn:\n• Theo dõi **mọi đồng tiền vào ra** mà không cần nhập tay\n• Tự chia tiền vào các quỹ ngay khi có thu nhập\n• Bám sát mọi nguồn thu: lương, chứng khoán, lãi ngân hàng, cho thuê nhà...\n• Dự đoán **ngày bạn đạt tự do tài chính** và cách rút ngắn nó\n\nĐể bắt đầu, cho mình biết **tên và năm sinh** của bạn nhé.\n_Ví dụ: "Mình tên Nam, sinh năm 1996"_`,
    quick: [],
    step: 'welcome',
  };
}

export { STEPS };
