import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, getKey, setKey, setLockHandler } from './lib/api.js';
import { short, setBaseCurrency } from './lib/format.js';
import { applyTheme, readTheme, watchSystemTheme, NEXT_THEME, THEME_ICON, THEME_LABEL } from './lib/theme.js';
import CommandPalette from './components/CommandPalette.jsx';
import { IconHome, IconChat, IconList, IconBell, IconGrid, IconSearch } from './components/icons.jsx';
import Lock from './pages/Lock.jsx';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Accounts from './pages/Accounts.jsx';
import Funds from './pages/Funds.jsx';
import Goals from './pages/Goals.jsx';
import Budgets from './pages/Budgets.jsx';
import Income from './pages/Income.jsx';
import Investments from './pages/Investments.jsx';
import Debts from './pages/Debts.jsx';
import Fire from './pages/Fire.jsx';
import Advisor from './pages/Advisor.jsx';
import AiLog from './pages/AiLog.jsx';
import Insights from './pages/Insights.jsx';
import Automation from './pages/Automation.jsx';
import Currency from './pages/Currency.jsx';
import Settings from './pages/Settings.jsx';
import More from './pages/More.jsx';

const NAV = [
  { g: 'Hằng ngày' },
  { k: 'dashboard', ico: '🏠', label: 'Trang chủ' },
  { k: 'chat', ico: '💬', label: 'Trò chuyện' },
  { k: 'transactions', ico: '🧾', label: 'Giao dịch' },
  { k: 'insights', ico: '🔔', label: 'Cảnh báo', badge: true },
  { g: 'Tiền của tôi' },
  { k: 'accounts', ico: '🏦', label: 'Tài khoản' },
  { k: 'funds', ico: '🧺', label: 'Quỹ & phân bổ' },
  { k: 'budgets', ico: '🎛', label: 'Ngân sách' },
  { k: 'goals', ico: '🎯', label: 'Mục tiêu' },
  { g: 'Tăng trưởng' },
  { k: 'income', ico: '💼', label: 'Nguồn thu' },
  { k: 'investments', ico: '📈', label: 'Đầu tư' },
  { k: 'debts', ico: '💳', label: 'Nợ vay' },
  { k: 'currency', ico: '💱', label: 'Tiền tệ & chuyển tiền' },
  { k: 'fire', ico: '🔥', label: 'Tự do tài chính' },
  { g: 'Cố vấn' },
  { k: 'advisor', ico: '🧭', label: 'Cố vấn' },
  { k: 'ailog', ico: '🧠', label: 'AI đã làm gì' },
  { k: 'automation', ico: '⚡', label: 'Tự động hoá' },
  { k: 'settings', ico: '⚙️', label: 'Cài đặt' },
];

const PAGES = NAV.filter((n) => n.k);
const TITLE = { ...Object.fromEntries(PAGES.map((n) => [n.k, n.label])), more: 'Thêm' };
// Thanh dưới trên điện thoại: 5 mục, Trò chuyện ở giữa.
const BOTTOM = [
  { k: 'dashboard', label: 'Trang chủ', Icon: IconHome },
  { k: 'transactions', label: 'Giao dịch', Icon: IconList },
  { k: 'chat', label: 'Trò chuyện', Icon: IconChat },
  { k: 'insights', label: 'Cảnh báo', Icon: IconBell, badge: true },
  { k: 'more', label: 'Thêm', Icon: IconGrid },
];
const MORE_PAGES = new Set(['accounts', 'funds', 'budgets', 'goals', 'income', 'investments', 'debts', 'currency', 'fire', 'advisor', 'ailog', 'automation', 'settings', 'more']);

export default function App() {
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'dashboard');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [cmd, setCmd] = useState(false);
  const [auth, setAuth] = useState(null); // null = đang kiểm tra
  const [curKey, setCurKey] = useState(0); // buộc vẽ lại khi đổi đồng tiền gốc
  const [theme, setTheme] = useState(readTheme);
  // Mất mạng: app vẫn chạy đủ (máy chủ nằm ngay trên máy/LAN), chỉ cố vấn AI
  // tạm nghỉ và bộ luật tiếng Việt trả lời thay. Báo cho người dùng biết rõ.
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => watchSystemTheme(() => setTheme((t) => t)), []);

  const refresh = useCallback(() => {
    api.get('/dashboard').then((r) => {
      if (setBaseCurrency(r.base_currency || r.profile?.currency)) setCurKey((k) => k + 1);
      setD(r);
    }).catch((e) => setErr(e.message));
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      // /health nói máy chủ chạy chế độ nào. Nhiều người dùng thì cửa vào là
      // tài khoản (sổ theo người, sang máy khác vẫn còn); một sổ thì cửa vào
      // là khoá PIN của chính máy này. Hai chuyện khác hẳn nhau.
      const h = await api.get('/health').catch(() => null);
      if (h?.multi_user) {
        setAuth({ multi: true, user: h.user || null, unlocked: Boolean(h.user), canMoi: Boolean(h.signup_code_required) });
        return;
      }
      const s = await api.get('/auth/status');
      setAuth({ pinSet: s.pin_set, unlocked: !s.pin_set || Boolean(getKey()) });
    } catch {
      setAuth({ pinSet: false, unlocked: true });
    }
  }, []);

  useEffect(() => {
    setLockHandler(() => setAuth((a) => ({ ...(a || { pinSet: true }), unlocked: false })));
    checkAuth();
  }, [checkAuth]);

  useEffect(() => { if (auth?.unlocked) refresh(); }, [auth?.unlocked, refresh]);

  useEffect(() => {
    location.hash = tab;
    document.querySelector('.main')?.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || 'dashboard');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((v) => !v); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Gắn nhãn cột cho từng ô bảng (data-label = chữ ở thead) để CSS điện thoại
  // xếp mỗi hàng thành thẻ dọc mà vẫn đọc được ô nào là gì. Làm ở đây một lần
  // cho mọi trang, không phải sửa từng bảng.
  useEffect(() => {
    const label = () => {
      for (const table of document.querySelectorAll('.main table')) {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        if (!heads.length) continue;
        for (const tr of table.querySelectorAll('tbody tr')) {
          [...tr.children].forEach((td, i) => { if (td.dataset.label !== (heads[i] || '')) td.dataset.label = heads[i] || ''; });
        }
      }
    };
    label();
    let t = null;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(label, 30); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!err) return undefined;
    const t = setTimeout(() => setErr(null), 6000);
    return () => clearTimeout(t);
  }, [err]);

  /** Chuyển trang; kèm `anchor` thì cuộn tới đúng thẻ đó sau khi trang vẽ xong. */
  const go = (t, anchor) => {
    setTab(t);
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };
  const alerts = d?.insights?.filter((i) => !i.read && (i.severity === 'danger' || i.severity === 'warn')).length || 0;
  const cycleTheme = () => setTheme((t) => NEXT_THEME[t] || 'light');
  const initial = (d?.profile?.name || 'B').trim().slice(0, 1).toUpperCase();

  const commands = useMemo(() => {
    let group = '';
    const out = [];
    for (const n of NAV) {
      if (n.g) { group = n.g; continue; }
      out.push({ id: `go:${n.k}`, ico: n.ico, label: n.label, group, run: () => setTab(n.k) });
    }
    out.push({ id: 'theme', ico: THEME_ICON[theme], label: `Đổi chủ đề (đang: ${THEME_LABEL[theme]})`, group: 'Giao diện', hint: 'theme sang toi dark light', run: cycleTheme });
    out.push({ id: 'reload', ico: '↻', label: 'Tải lại số liệu', group: 'Giao diện', hint: 'refresh cap nhat', run: refresh });
    return out;
  }, [theme, refresh]);

  const logout = async () => {
    try { await api.post('/account/logout', {}); } catch { /* token có thể đã hết hạn */ }
    setKey('');
    setAuth((a) => ({ ...a, user: null, unlocked: false }));
  };

  const lock = () => {
    api.post('/auth/logout').catch(() => {});
    setKey('');
    setAuth((a) => ({ ...a, unlocked: false }));
  };

  const page = () => {
    switch (tab) {
      case 'chat': return <Chat onRefresh={refresh} offline={offline} />;
      case 'dashboard': return d ? <Dashboard d={d} go={go} onRefresh={refresh} /> : null;
      case 'transactions': return <Transactions onRefresh={refresh} />;
      case 'currency': return <Currency onRefresh={refresh} />;
      case 'insights': return <Insights onRefresh={refresh} />;
      case 'accounts': return <Accounts onRefresh={refresh} />;
      case 'funds': return <Funds onRefresh={refresh} />;
      case 'budgets': return <Budgets onRefresh={refresh} />;
      case 'goals': return <Goals onRefresh={refresh} />;
      case 'income': return <Income onRefresh={refresh} />;
      case 'investments': return <Investments onRefresh={refresh} />;
      case 'debts': return <Debts onRefresh={refresh} />;
      case 'fire': return <Fire />;
      case 'advisor': return <Advisor />;
      case 'ailog': return <AiLog onRefresh={refresh} />;
      case 'automation': return <Automation onRefresh={refresh} />;
      case 'settings': return <Settings onRefresh={refresh} />;
      case 'more': return <More go={go} d={d} theme={theme} cycleTheme={cycleTheme} themeLabel={THEME_LABEL[theme]} themeIcon={THEME_ICON[theme]} canLock={auth?.pinSet} onLock={lock} user={auth?.user} onLogout={auth?.multi ? logout : null} alerts={alerts} />;
      default: return d ? <Dashboard d={d} go={go} onRefresh={refresh} /> : null;
    }
  };

  if (!auth) {
    return (
      <div className="lock">
        <div className="lock-box"><div className="lock-logo">F</div><p className="muted">Đang mở FinMate…</p></div>
      </div>
    );
  }
  if (!auth.unlocked) {
    return auth.multi
      ? <Login canMoi={auth.canMoi} onDone={(user) => setAuth({ ...auth, user, unlocked: true })} />
      : <Lock pinSet={auth.pinSet} onUnlock={() => setAuth({ ...auth, unlocked: true })} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="avatar" onClick={() => setTab('more')} aria-label="Hồ sơ và cài đặt" style={{ border: 0, cursor: 'pointer' }}>{initial}</button>
        <div className="tb-title">{TITLE[tab] || 'FinMate'}</div>
        {offline && <span className="tag warn" title="Không có internet. Mọi tính năng vẫn dùng được; cố vấn AI tạm nghỉ, bộ luật trả lời thay.">📴 Ngoại tuyến</span>}
        <button className="btn ghost icon" onClick={() => setCmd(true)} aria-label="Tìm nhanh"><IconSearch /></button>
        <button className="btn ghost icon" onClick={cycleTheme} aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]}>{THEME_ICON[theme]}</button>
      </header>

      <aside className="sidebar">
        <div className="brand">
          <span className="logo">F</span>
          <div>FinMate<small>Cố vấn tài chính của bạn</small></div>
        </div>

        <button className="navbtn" onClick={() => setCmd(true)} style={{ marginBottom: 4 }}>
          <span className="ico"><IconSearch width={18} height={18} /></span>
          <span>Tìm nhanh</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .8 }}><kbd>Ctrl</kbd> <kbd>K</kbd></span>
        </button>

        {NAV.map((n, i) => (n.g
          ? <div key={`g${i}`} className="sb-sep">{n.g}</div>
          : (
            <button key={n.k} className={`navbtn ${tab === n.k ? 'active' : ''}`} onClick={() => setTab(n.k)} aria-current={tab === n.k ? 'page' : undefined}>
              <span className="ico">{n.ico}</span>
              <span>{n.label}</span>
              {n.badge && alerts > 0 && <span className="badge">{alerts}</span>}
            </button>
          )))}

        <div className="sb-foot">
          <div className="card" style={{ padding: 14 }}>
            <div className="mini">Tài sản ròng</div>
            <div style={{ fontWeight: 750, fontSize: 18, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>{d ? short(d.net_worth?.net) : '—'}</div>
            <div className="row" style={{ marginTop: 10, gap: 6 }}>
              <button className="btn ghost sm" style={{ flex: 1 }} onClick={cycleTheme} title={THEME_LABEL[theme]}>{THEME_ICON[theme]} {THEME_LABEL[theme]}</button>
            </div>
            {auth.pinSet && <button className="btn ghost sm" style={{ marginTop: 4, width: '100%' }} onClick={lock}>🔒 Khoá app</button>}
          </div>
        </div>
      </aside>

      <main className="main">
        {offline && <div className="offline-bar">📴 Không có internet — mọi tính năng vẫn dùng được, cố vấn AI tạm nghỉ và bộ luật trả lời thay.</div>}
        {err && <div className="toast" onClick={() => setErr(null)} role="alert">⚠️ {err}</div>}
        <Fragment key={`${curKey}-${tab}`}><div className="page-fade">{page()}</div></Fragment>
      </main>

      <nav className="botnav">
        {BOTTOM.map(({ k, label, Icon, badge }) => {
          const active = tab === k || (k === 'more' && MORE_PAGES.has(tab));
          return (
            <button key={k} className={active ? 'active' : ''} onClick={() => setTab(k)} aria-label={label} aria-current={active ? 'page' : undefined}>
              <span className="ico"><Icon /></span>
              <span>{label}</span>
              {badge && alerts > 0 && <span className="dot">{alerts}</span>}
            </button>
          );
        })}
      </nav>

      {cmd && <CommandPalette items={commands} onClose={() => setCmd(false)} />}
    </div>
  );
}
