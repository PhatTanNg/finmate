import React, { Fragment, useCallback, useEffect, useState } from 'react';
import { api, getKey, setKey, setLockHandler } from './lib/api.js';
import { short, setBaseCurrency } from './lib/format.js';
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

export default function App() {
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'chat');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState(null); // null = đang kiểm tra
  const [curKey, setCurKey] = useState(0); // buộc vẽ lại khi đổi đồng tiền gốc

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
    setOpen(false);
    document.querySelector('.main')?.scrollTo(0, 0);
  }, [tab]);

  const go = (t) => setTab(t);
  const alerts = d?.insights?.filter((i) => !i.read && (i.severity === 'danger' || i.severity === 'warn')).length || 0;

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

  if (!auth) return <div className="lock"><div className="lock-box"><div className="lock-logo">🪙</div><p className="muted">Đang mở FinMate…</p></div></div>;
  if (!auth.unlocked) return <Lock pinSet={auth.pinSet} onUnlock={() => setAuth({ ...auth, unlocked: true })} />;

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span style={{ fontSize: 22 }}>🪙</span>
          <div>FinMate<small>Cố vấn tài chính của bạn</small></div>
        </div>
        {NAV.map((n, i) => n.g
          ? <div key={`g${i}`} className="sb-sep">{n.g}</div>
          : (
            <button key={n.k} className={`navbtn ${tab === n.k ? 'active' : ''}`} onClick={() => setTab(n.k)}>
              <span className="ico">{n.ico}</span>
              <span>{n.label}</span>
              {n.badge && alerts > 0 && <span className="badge">{alerts}</span>}
            </button>
          ))}
        <div style={{ marginTop: 'auto', padding: '14px 12px 4px' }}>
          <div className="mini">Tài sản ròng</div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{d ? short(d.net_worth?.net) : '—'}</div>
          {auth.pinSet && (
            <button
              className="btn ghost sm"
              style={{ marginTop: 8, width: '100%' }}
              onClick={() => { api.post('/auth/logout').catch(() => {}); setKey(''); setAuth({ ...auth, unlocked: false }); }}
            >
              🔒 Khoá app
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {err && <div className="toast err" onClick={() => setErr(null)}>{err}</div>}
        <Fragment key={curKey}>{page()}</Fragment>
      </main>
    </div>
  );
}
