/** Xử lý ngôn ngữ tiếng Việt: bỏ dấu, đọc số tiền, đọc ngày/khoảng thời gian. */
import { today, addDays, addMonths, monthKey, monthStart, monthEnd, startOfMonth, endOfMonth, toISO, parseISO } from './date.js';
import { parseNumberFor, toMinor, normalizeCurrency, DEFAULT_CURRENCY } from './currency.js';
import { displayCurrency } from './money.js';

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

/**
 * Đơn vị nhân. `viet: true` = từ thuần Việt ("tỷ", "triệu", "củ") — khi người
 * dùng viết vậy mà không kèm ký hiệu tiền nào thì gần như chắc chắn đang nói
 * về VND, kể cả khi đồng tiền chính của họ là EUR.
 */
const UNITS = [
  { words: ['tỷ', 'tỉ'], mul: 1e9, viet: true },
  { words: ['ty', 'ti'], mul: 1e9, viet: true },
  { words: ['bil', 'b'], mul: 1e9, viet: false },
  { words: ['triệu', 'trieu', 'củ', 'cu', 'tr'], mul: 1e6, viet: true },
  { words: ['mil', 'm'], mul: 1e6, viet: false },
  { words: ['nghìn', 'nghin', 'ngàn', 'ngan', 'lít', 'lit', 'k', 'ng'], mul: 1e3, viet: false },
];

const UNIT_ALT = UNITS.flatMap((u) => u.words)
  .sort((a, b) => b.length - a.length)
  .join('|');

function unitInfo(word) {
  const n = norm(word);
  for (const u of UNITS) if (u.words.some((w) => norm(w) === n)) return u;
  return null;
}

/** Ký hiệu/tên đồng tiền đứng sau số */
const CUR_SUFFIX = /^\s*(€|euros?|eur|₫|vnđ|vnd|đồng|dong|đ|\$|usd|đô la|do la|đô|£|gbp|bảng|bang)(?![\p{L}])\.?/iu;
/** Ký hiệu đứng trước số */
const CUR_PREFIX = /(€|\$|£)\s*$/;

// Số: dạng có phân tách nghìn (kèm phần lẻ tuỳ chọn) hoặc số thường
const NUM_RE = /(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)/gu;

/**
 * Tìm mọi số tiền trong câu.
 * VND:  50k, 50 nghìn, 1tr2, 1 triệu rưỡi, 1.500.000, 2,5 triệu, 3 củ, 1 tỷ 2
 * EUR:  €1,200 · 1200 euro · 12.50€ · 45k · €1.500,75
 * @returns {{value:number, currency:string, major:number, raw:string, index:number, confidence:number}[]}
 *          `value` là **đơn vị nhỏ nhất** của `currency` (VND: đồng, EUR: cent)
 */
export function findAmounts(text = '', opts = {}) {
  const s = String(text);
  const fallback = normalizeCurrency(opts.currency, null) || displayCurrency() || DEFAULT_CURRENCY;
  const out = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(s))) {
    const token = m[1];
    const idx = m.index;
    let end = idx + token.length;
    let confidence = 1;
    const grouped = /[.,\s]\d{3}/.test(token);

    // Đơn vị ngay sau số — không dùng \b vì "tỷ", "củ" kết thúc bằng ký tự
    // ngoài ASCII; và phải cho phép chữ số ngay sau để đọc được "1tr5".
    const um = s.slice(end).match(new RegExp(`^\\s*(${UNIT_ALT})(?![\\p{L}])\\.?`, 'iu'));
    const unit = um ? unitInfo(um[1]) : null;
    if (unit) end += um[0].length;

    // Đồng tiền: ưu tiên ký hiệu viết rõ, sau đó suy từ đơn vị thuần Việt.
    //
    // Phải dò ở CẢ hai vị trí. Với "3k6 euro", chữ số đuôi của đơn vị ("6")
    // mãi khối dưới mới đọc, nên ngay sau "k" con trỏ còn đứng ở "6" và
    // "euro" trượt — lương 3.600 EUR bị ghi thành 3.600 ĐỒNG, sai gần mười
    // nghìn lần mà không một cảnh báo nào. Ở đây chỉ NHÌN TRƯỚC, việc dời
    // con trỏ để sau khi đã đọc xong chữ số đuôi.
    let explicit = null;
    let curEnd = 0;
    const probes = [end];
    if (unit) {
      const tail = s.slice(end).match(/^\s*\d{1,3}(?![\d])/);
      if (tail) probes.push(end + tail[0].length);
    }
    for (const p of probes) {
      const sufM = s.slice(p).match(CUR_SUFFIX);
      if (!sufM) continue;
      const c = normalizeCurrency(sufM[1].trim());
      if (c) { explicit = c; curEnd = p + sufM[0].length; break; }
    }
    if (!explicit) {
      const preM = s.slice(0, idx).match(CUR_PREFIX);
      if (preM) explicit = normalizeCurrency(preM[1]);
    }
    const ccy = explicit || (unit && unit.viet ? 'VND' : fallback);

    let base = parseNumberFor(token, ccy);
    if (base == null) continue;

    if (unit) {
      base *= unit.mul;
      const after = s.slice(end);
      // "1tr2" -> 1,2tr ; "1tr rưỡi" -> 1,5tr
      const dm = after.match(new RegExp(`^\\s*(\\d{1,3})(?![\\d])(?!\\s*(${UNIT_ALT})(?![\\p{L}]))`, 'iu'));
      const half = after.match(/^\s*(rưỡi|ruoi)\b/i);
      if (dm && unit.mul >= 1e3) {
        base += Number(dm[1]) * (unit.mul / Math.pow(10, dm[1].length));
        end += dm[0].length;
      } else if (half) {
        base += unit.mul / 2;
        end += half[0].length;
      }
      // "1 triệu 500 nghìn"
      const chain = s.slice(end).match(/^\s*(\d{1,3})\s*(nghìn|nghin|ngàn|ngan|k)\b/i);
      if (chain && unit.mul >= 1e6) {
        base += Number(chain[1]) * 1e3;
        end += chain[0].length;
      }
      // Giờ mới nuốt phần ký hiệu tiền tệ đã nhìn thấy từ trước.
      if (curEnd > end) end = curEnd;
    } else if (curEnd > end) {
      end = curEnd;
    }
    if (!unit && !explicit && ccy === 'VND' && !grouped && base > 0 && base < 1000 && Number.isInteger(base)) {
      // "ăn trưa 50" -> 50 nghìn (thói quen nói tắt của người Việt).
      // Chỉ áp dụng cho VND; với EUR thì "ăn trưa 12" đúng là 12 €.
      base *= 1000;
      confidence = 0.75;
    }

    out.push({
      value: toMinor(base, ccy),
      major: base,
      currency: ccy,
      explicit_currency: !!explicit,
      raw: s.slice(idx, end).trim(),
      index: idx,
      confidence,
    });
    NUM_RE.lastIndex = end;
  }
  return out;
}

/** Số tiền chính trong câu (số lớn nhất, ưu tiên có đơn vị) */
export function parseAmount(text, opts = {}) {
  const list = findAmounts(text, opts).filter((a) => a.value > 0);
  if (!list.length) return null;
  list.sort((a, b) => b.major - a.major);
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
  // "tối qua", "đêm qua", "chiều qua"... cũng là hôm qua — phải bắt trước
  // nhánh \bnay\b bên dưới, nếu không "tối qua" sẽ bị ghi thành hôm nay.
  if (/\b(hom|toi|dem|chieu|sang|trua|khuya) qua\b/.test(n)) return addDays(ref, -1);
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
