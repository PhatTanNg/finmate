import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api, getKey, setKey, setLockHandler } from './lib/api.js';
import { short, setBaseCurrency } from './lib/format.js';
import { applyTheme, readTheme, watchSystemTheme, NEXT_THEME, THEME_ICON, THEME_LABEL } from './lib/theme.js';
import CommandPalette from './components/CommandPalette.jsx';
import Lock from './pages/Lock.jsx';
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
import Insights from './pages/Insights.jsx';
import Automation from './pages/Automation.jsx';
import Currency from './pages/Currency.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { g: 'Hằng ngày' },
  { k: 'chat', ico: '💬', label: 'Trò chuyện' },
  { k: 'dashboard', ico: '📊', label: 'Tổng quan' },
  { k: 'transactions', ico: '🧾', label: 'Giao dịch' },
  { k: 'insights', ico: '🔔', label: 'Cảnh báo', badge: true },
  { g: 'Tiền của tôi' },
  { k: 'accounts', ico: '🏦', label: 'Tài khoản' },
  { k: 'funds', ico: '🧺', label: 'Quỹ & ví' },
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
  { k: 'automation', ico: '⚡', label: 'Tự động hoá' },
  { k: 'settings', ico: '⚙️', label: 'Cài đặt' },
];

const PAGES = NAV.filter((n) => n.k);
const TITLE = Object.fromEntries(PAGES.map((n) => [n.k, n.label]));
// Năm mục hay dùng nhất cho thanh dưới trên điện thoại.
const BOTTOM = ['chat', 'dashboard', 'transactions', 'accounts'];

export default function App() {
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'chat');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [cmd, setCmd] = useState(false);
  const [auth, setAuth] = useState(null); // null = đang kiểm tra
  const [curKey, setCurKey] = useState(0); // buộc vẽ lại khi đổi đồng tiền gốc
  const [theme, setTheme] = useState(readTheme);

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
    setDrawer(false);
    document.querySelector('.main')?.scrollTo(0, 0);
  }, [tab]);

  // Nút back của trình duyệt phải quay lại trang trước, không thoát app.
  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || 'chat');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Phím tắt toàn cục: Ctrl/⌘+K mở bảng lệnh, Esc đóng ngăn kéo.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((v) => !v); return; }
      if (e.key === 'Escape') setDrawer(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!err) return undefined;
    const t = setTimeout(() => setErr(null), 6000);
    return () => clearTimeout(t);
  }, [err]);

  const go = (t) => setTab(t);
  const alerts = d?.insights?.filter((i) => !i.read && (i.severity === 'danger' || i.severity === 'warn')).length || 0;
  const cycleTheme = () => setTheme((t) => NEXT_THEME[t] || 'dark');

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

  const page = () => {
    switch (tab) {
      case 'chat': return <Chat onRefresh={refresh} />;
      case 'dashboard': return d ? <Dashboard d={d} go={go} /> : null;
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
      case 'automation': return <Automation onRefresh={refresh} />;
      case 'settings': return <Settings onRefresh={refresh} />;
      default: return <Chat onRefresh={refresh} />;
    }
  };

  if (!auth) {
    return (
      <div className="lock">
        <div className="lock-box"><div className="lock-logo">🪙</div><p className="muted">Đang mở FinMate…</p></div>
      </div>
    );
  }
  if (!auth.unlocked) return <Lock pinSet={auth.pinSet} onUnlock={() => setAuth({ ...auth, unlocked: true })} />;

  const lock = () => {
    api.post('/auth/logout').catch(() => {});
    setKey('');
    setAuth({ ...auth, unlocked: false });
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost icon" onClick={() => setDrawer(true)} aria-label="Mở menu">☰</button>
        <div className="tb-title">{TITLE[tab] || 'FinMate'}</div>
        <button className="btn ghost icon" onClick={() => setCmd(true)} aria-label="Tìm nhanh">🔍</button>
        <button className="btn ghost icon" onClick={cycleTheme} aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]}>{THEME_ICON[theme]}</button>
      </header>

      {drawer && <button className="scrim" onClick={() => setDrawer(false)} aria-label="Đóng menu" />}

      <aside className={`sidebar ${drawer ? 'open' : ''}`}>
        <div className="brand">
          <span style={{ fontSize: 22 }}>🪙</span>
          <div>FinMate<small>Cố vấn tài chính của bạn</small></div>
        </div>

        <button className="navbtn" onClick={() => setCmd(true)} style={{ marginBottom: 4 }}>
          <span className="ico">🔍</span>
          <span>Tìm nhanh</span>
          <span className="grp" style={{ marginLeft: 'auto', fontSize: 11, opacity: .8 }}><kbd>Ctrl</kbd> <kbd>K</kbd></span>
        </button>

        {NAV.map((n, i) => (n.g
          ? <div key={`g${i}`} className="sb-sep">{n.g}</div>
          : (
            <button
              key={n.k}
              className={`navbtn ${tab === n.k ? 'active' : ''}`}
              onClick={() => setTab(n.k)}
              aria-current={tab === n.k ? 'page' : undefined}
            >
              <span className="ico">{n.ico}</span>
              <span>{n.label}</span>
              {n.badge && alerts > 0 && <span className="badge">{alerts}</span>}
            </button>
          )))}

        <div className="sb-foot">
          <div className="mini">Tài sản ròng</div>
          <div style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{d ? short(d.net_worth?.net) : '—'}</div>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <button className="btn ghost sm" style={{ flex: 1 }} onClick={cycleTheme} title={THEME_LABEL[theme]}>
              {THEME_ICON[theme]} {THEME_LABEL[theme]}
            </button>
          </div>
          {auth.pinSet && (
            <button className="btn ghost sm" style={{ marginTop: 6, width: '100%' }} onClick={lock}>🔒 Khoá app</button>
          )}
        </div>
      </aside>

      <main className="main">
        {err && <div className="toast err" onClick={() => setErr(null)} role="alert">⚠️ {err}</div>}
        <Fragment key={`${curKey}-${tab}`}><div className="page-fade">{page()}</div></Fragment>
      </main>

      <nav className="botnav">
        {BOTTOM.map((k) => {
          const n = PAGES.find((p) => p.k === k);
          return (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} aria-label={n.label}>
              <span className="ico">{n.ico}</span>
              <span>{n.label}</span>
            </button>
          );
        })}
        <button className={BOTTOM.includes(tab) ? '' : 'active'} onClick={() => setDrawer(true)} aria-label="Tất cả mục">
          <span className="ico">☰</span>
          <span>Thêm</span>
          {alerts > 0 && <span className="dot">{alerts}</span>}
        </button>
      </nav>

      {cmd && <CommandPalette items={commands} onClose={() => setCmd(false)} />}
    </div>
  );
}
