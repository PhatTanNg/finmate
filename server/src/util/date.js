/** Tiện ích ngày tháng — mọi ngày trong hệ thống là chuỗi YYYY-MM-DD (giờ địa phương). */

export function toISO(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today() {
  return toISO(new Date());
}

export function nowISO() {
  return new Date().toISOString();
}

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return toISO(d);
}

export function addYears(s, n) {
  return addMonths(s, n * 12);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function startOfMonth(s = today()) {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s = today()) {
  const [y, m] = s.split('-').map(Number);
  return `${s.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function monthKey(s = today()) {
  return s.slice(0, 7);
}

export function monthStart(key) {
  return `${key}-01`;
}

export function monthEnd(key) {
  return endOfMonth(`${key}-01`);
}

export function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** Số tháng (có thể lẻ) giữa 2 ngày */
export function monthsBetween(a, b) {
  const d1 = parseISO(a);
  const d2 = parseISO(b);
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() - d1.getDate()) / 30;
}

/** Danh sách n tháng gần nhất (cũ -> mới), gồm cả tháng hiện tại */
export function lastMonths(n, from = today()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(startOfMonth(from), -i)));
  return out;
}

export function addPeriod(dateStr, frequency, interval = 1) {
  switch (frequency) {
    case 'daily':
      return addDays(dateStr, interval);
    case 'weekly':
      return addDays(dateStr, 7 * interval);
    case 'biweekly':
      return addDays(dateStr, 14 * interval);
    case 'quarterly':
      return addMonths(dateStr, 3 * interval);
    case 'yearly':
      return addMonths(dateStr, 12 * interval);
    case 'monthly':
    default:
      return addMonths(dateStr, interval);
  }
}

export function periodsPerYear(frequency) {
  return { daily: 365, weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 }[frequency] ?? 12;
}

export function vnDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function age(birthYear) {
  if (!birthYear) return null;
  return new Date().getFullYear() - Number(birthYear);
}
