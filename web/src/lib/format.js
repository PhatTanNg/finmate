export const fmt = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;

export function short(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  const d = (x, u) => `${s}${(a / x).toFixed(a / x >= 100 ? 0 : 1).replace(/\.0$/, '').replace('.', ',')} ${u}`;
  if (a >= 1e9) return d(1e9, 'tỷ');
  if (a >= 1e6) return d(1e6, 'tr');
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}k`;
  return `${v}`;
}

export const pct = (x, d = 0) => `${((Number(x) || 0) * 100).toFixed(d).replace('.', ',')}%`;

export function vnDate(s) {
  if (!s) return '—';
  const [y, m, dd] = String(s).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

export const monthLabel = (mk) => (mk ? `T${Number(mk.slice(5, 7))}/${mk.slice(0, 4)}` : '');

/** Markdown tối giản: **đậm**, _nghiêng_, `code`, danh sách, tiêu đề, xuống dòng. */
export function mdToHtml(text = '') {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,)!?]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
