/** Xử lý ngôn ngữ tiếng Việt: bỏ dấu, đọc số tiền, đọc ngày/khoảng thời gian. */
import { today, addDays, addMonths, monthKey, monthStart, monthEnd, startOfMonth, endOfMonth, toISO, parseISO } from './date.js';

export function stripDiacritics(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function norm(s = '') {
  return stripDiacritics(String(s).toLowerCase()).replace(/\s+/g, ' ').trim();
}

const UNITS = [
  { re: /^(ty|ti|tỷ|tỉ|b|bil)$/i, mul: 1e9 },
  { re: /^(tr|trieu|triệu|cu|củ|m|mil)$/i, mul: 1e6 },
  { re: /^(k|nghin|nghìn|ngan|ngàn|ng|lít|lit)$/i, mul: 1e3 },
];

function unitMul(u) {
  if (!u) return null;
  const n = norm(u);
  for (const { re, mul } of UNITS) if (re.test(n)) return mul;
  return null;
}

const NUM_RE = new RegExp(
  [
    '(\\d{1,3}(?:[.,\\s]\\d{3})+)', // 1.500.000 | 1,500,000
    '|(\\d+(?:[.,]\\d+)?)', // 50 | 1,5
  ].join(''),
  'g'
);

/**
 * Tìm mọi số tiền trong câu.
 * Hỗ trợ: 50k, 50 nghìn, 1tr2, 1 triệu rưỡi, 1.500.000, 2,5 triệu, 3 củ, 1 tỷ 2, 200 đồng.
 * @returns {{value:number, raw:string, index:number, confidence:number}[]}
 */
export function findAmounts(text = '') {
  const s = String(text);
  const out = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(s))) {
    const grouped = m[1];
    const plain = m[2];
    let base = grouped ? Number(grouped.replace(/[.,\s]/g, '')) : Number(String(plain).replace(',', '.'));
    if (!isFinite(base)) continue;
    let idx = m.index;
    let end = m.index + m[0].length;
    let confidence = 1;

    // đơn vị ngay sau số — không dùng \b vì chữ Việt có ký tự ngoài ASCII
    // ("tỷ", "tỉ", "củ" kết thúc bằng ký tự non-word nên \b không khớp),
    // và phải cho phép chữ số ngay sau đơn vị để đọc được "1tr5", "1ty2".
    const tail = s.slice(end);
    const um = tail.match(/^\s*(tỷ|tỉ|ty|ti|tr|triệu|trieu|củ|cu|nghìn|nghin|ngàn|ngan|k|m|b|lít|lit)(?![\p{L}])\.?/iu);
    let mul = null;
    if (um) {
      mul = unitMul(um[1]);
      end += um[0].length;
    }

    if (mul) {
      base *= mul;
      // "1tr2" -> 1.2tr ; "1tr rưỡi" -> 1.5tr
      const after = s.slice(end);
      const dm = after.match(/^\s*(\d{1,3})\b(?!\s*(tỷ|tỉ|tr|triệu|k|nghìn|ngàn))/i);
      const half = after.match(/^\s*(rưỡi|ruoi)\b/i);
      if (dm && mul >= 1e3) {
        base += Number(dm[1]) * (mul / Math.pow(10, dm[1].length));
        end += dm[0].length;
      } else if (half) {
        base += mul / 2;
        end += half[0].length;
      }
      // "1 triệu 500 nghìn"
      const chain = s.slice(end).match(/^\s*(\d{1,3})\s*(nghìn|nghin|ngàn|ngan|k)\b/i);
      if (chain && mul >= 1e6) {
        base += Number(chain[1]) * 1e3;
        end += chain[0].length;
      }
    } else {
      const currency = s.slice(end).match(/^\s*(đồng|dong|đ|d|vnd|vnđ)\b/i);
      if (currency) {
        end += currency[0].length;
      } else if (!grouped && base > 0 && base < 1000 && Number.isInteger(base)) {
        // "ăn trưa 50" -> 50 nghìn (thói quen nói tắt)
        base *= 1000;
        confidence = 0.75;
      }
    }
    out.push({ value: Math.round(base), raw: s.slice(idx, end).trim(), index: idx, confidence });
    NUM_RE.lastIndex = end;
  }
  return out;
}

/** Số tiền chính trong câu (số lớn nhất, ưu tiên có đơn vị) */
export function parseAmount(text) {
  const list = findAmounts(text).filter((a) => a.value > 0);
  if (!list.length) return null;
  list.sort((a, b) => b.value - a.value);
  return list[0];
}

export function parsePercent(text = '') {
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(',', '.')) / 100 : null;
}

const WEEKDAYS = { 'chu nhat': 0, cn: 0, 'thu 2': 1, 'thu hai': 1, 'thu 3': 2, 'thu ba': 2, 'thu 4': 3, 'thu tu': 3, 'thu 5': 4, 'thu nam': 4, 'thu 6': 5, 'thu sau': 5, 'thu 7': 6, 'thu bay': 6 };

/** Đọc 1 ngày cụ thể trong câu; mặc định hôm nay. */
export function parseDate(text = '', ref = today()) {
  const n = norm(text);
  if (/\bhom kia\b|\bhôm kia\b/.test(n)) return addDays(ref, -2);
  if (/\bhom qua\b/.test(n)) return addDays(ref, -1);
  if (/\bngay mai\b|\bmai\b/.test(n)) return addDays(ref, 1);
  if (/\bngay mot\b|\bmot\b(?!\s*so)/.test(n)) return addDays(ref, 2);
  if (/\bhom nay\b|\bnay\b/.test(n)) return ref;
  if (/\btuan truoc\b/.test(n)) return addDays(ref, -7);

  const dmy = String(text).match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = dmy[3] ? Number(dmy[3]) : Number(ref.slice(0, 4));
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return iso;
    }
  }
  const dayOnly = n.match(/\bngay (\d{1,2})\b/);
  if (dayOnly) {
    const d = Number(dayOnly[1]);
    if (d >= 1 && d <= 31) return `${ref.slice(0, 7)}-${String(d).padStart(2, '0')}`;
  }
  for (const [k, v] of Object.entries(WEEKDAYS)) {
    if (n.includes(k)) {
      const cur = parseISO(ref).getDay();
      let diff = v - cur;
      if (diff > 0) diff -= 7; // hiểu là thứ … vừa rồi
      return addDays(ref, diff);
    }
  }
  return ref;
}

/** Đọc khoảng thời gian: "tháng này", "tháng trước", "tuần này", "năm nay", "3 tháng qua" */
export function parseRange(text = '', ref = today()) {
  const n = norm(text);
  const mk = monthKey(ref);
  if (/thang truoc|thang roi|thang vua roi/.test(n)) {
    const k = monthKey(addMonths(startOfMonth(ref), -1));
    return { from: monthStart(k), to: monthEnd(k), label: `tháng ${k.slice(5)}/${k.slice(0, 4)}` };
  }
  if (/hom nay|ngay hom nay/.test(n)) return { from: ref, to: ref, label: 'hôm nay' };
  if (/hom qua/.test(n)) return { from: addDays(ref, -1), to: addDays(ref, -1), label: 'hôm qua' };
  if (/tuan nay/.test(n)) {
    const dow = (parseISO(ref).getDay() + 6) % 7;
    return { from: addDays(ref, -dow), to: addDays(ref, 6 - dow), label: 'tuần này' };
  }
  if (/tuan truoc/.test(n)) {
    const dow = (parseISO(ref).getDay() + 6) % 7;
    return { from: addDays(ref, -dow - 7), to: addDays(ref, -dow - 1), label: 'tuần trước' };
  }
  if (/nam nay|nam ni/.test(n)) return { from: `${ref.slice(0, 4)}-01-01`, to: `${ref.slice(0, 4)}-12-31`, label: `năm ${ref.slice(0, 4)}` };
  if (/nam ngoai|nam truoc/.test(n)) {
    const y = Number(ref.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `năm ${y}` };
  }
  const nMonths = n.match(/(\d{1,2})\s*thang\s*(qua|gan day|nay|truoc)/);
  if (nMonths) {
    const k = Number(nMonths[1]);
    return { from: startOfMonth(addMonths(ref, -(k - 1))), to: endOfMonth(ref), label: `${k} tháng qua` };
  }
  const mOnly = n.match(/thang (\d{1,2})\b/);
  if (mOnly) {
    const mo = Number(mOnly[1]);
    if (mo >= 1 && mo <= 12) {
      const k = `${ref.slice(0, 4)}-${String(mo).padStart(2, '0')}`;
      return { from: monthStart(k), to: monthEnd(k), label: `tháng ${mo}` };
    }
  }
  return { from: monthStart(mk), to: monthEnd(mk), label: 'tháng này' };
}

/** true nếu câu chứa bất kỳ từ khoá nào (so khớp không dấu) */
export function hasAny(text, words = []) {
  const n = norm(text);
  return words.some((w) => n.includes(norm(w)));
}

/** Đếm điểm khớp từ khoá */
export function scoreKeywords(text, keywords = []) {
  const n = norm(text);
  let score = 0;
  for (const kw of keywords) {
    const k = norm(kw);
    if (!k) continue;
    if (n.includes(k)) score += k.length >= 5 ? 2 : 1;
  }
  return score;
}
