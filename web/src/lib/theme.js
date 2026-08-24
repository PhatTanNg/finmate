const KEY = 'finmate.theme';

/** Chủ đề đang áp dụng: 'dark' | 'light' | 'auto'. */
export function readTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function systemPrefersLight() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
}

/** Chủ đề thực tế sau khi giải nghĩa 'auto' theo cài đặt hệ điều hành. */
export function resolveTheme(mode = readTheme()) {
  return mode === 'auto' ? (systemPrefersLight() ? 'light' : 'dark') : mode;
}

export function applyTheme(mode) {
  const real = resolveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', real);
  root.style.colorScheme = real;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', real === 'light' ? '#eef1f8' : '#0b1020');
  try { localStorage.setItem(KEY, mode); } catch { /* chế độ riêng tư */ }
  return real;
}

/** Gọi lại khi người dùng đổi chủ đề hệ điều hành, chỉ có tác dụng ở chế độ 'auto'. */
export function watchSystemTheme(cb) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const h = () => { if (readTheme() === 'auto') cb(applyTheme('auto')); };
  mq.addEventListener?.('change', h);
  return () => mq.removeEventListener?.('change', h);
}

export const NEXT_THEME = { dark: 'light', light: 'auto', auto: 'dark' };
export const THEME_ICON = { dark: '🌙', light: '☀️', auto: '🌗' };
export const THEME_LABEL = { dark: 'Chủ đề tối', light: 'Chủ đề sáng', auto: 'Theo hệ thống' };
