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

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Chủ đề thực tế sau khi giải nghĩa 'auto' theo cài đặt hệ điều hành. Sáng là mặc định. */
export function resolveTheme(mode = readTheme()) {
  return mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

export function applyTheme(mode) {
  const real = resolveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', real);
  root.style.colorScheme = real;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', real === 'light' ? '#f4f5f7' : '#0a0a0c');
  try { localStorage.setItem(KEY, mode); } catch { /* chế độ riêng tư */ }
  return real;
}

/** Gọi lại khi người dùng đổi chủ đề hệ điều hành, chỉ có tác dụng ở chế độ 'auto'. */
export function watchSystemTheme(cb) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const h = () => { if (readTheme() === 'auto') cb(applyTheme('auto')); };
  mq.addEventListener?.('change', h);
  return () => mq.removeEventListener?.('change', h);
}

export const NEXT_THEME = { light: 'dark', dark: 'auto', auto: 'light' };
export const THEME_ICON = { dark: '🌙', light: '☀️', auto: '🌗' };
export const THEME_LABEL = { dark: 'Chủ đề tối', light: 'Chủ đề sáng', auto: 'Theo hệ thống' };
