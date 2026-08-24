import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading } from '../components/ui.jsx';
import { fmt, short, pct, vnDate, CURRENCIES, toMinor, setBaseCurrency } from '../lib/format.js';

const VERDICT = {
  good: { ico: '🟢', label: 'Thời điểm tốt để gửi', tone: 'up' },
  wait: { ico: '🟡', label: 'Nên chờ thêm', tone: 'warn' },
  neutral: { ico: '⚪', label: 'Bình thường', tone: '' },
  unknown: { ico: '⚪', label: 'Chưa đủ dữ liệu', tone: '' },
};

const rateStr = (r, code) => Number(r || 0).toLocaleString('vi-VN', { maximumFractionDigits: code === 'VND' ? 0 : 4 });

export default function Currency({ onRefresh }) {
  const [fx, setFx] = useState(null);
  const [rem, setRem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('EUR');
  const [to, setTo] = useState('VND');
  const [feePct, setFeePct] = useState('0,5');
  const [quote, setQuote] = useState(null);

  const load = async () => {
    const f = await api.get('/fx/rates');
    setBaseCurrency(f.base);
    setFx(f);
    setFrom(f.base === 'VND' ? 'EUR' : f.base);
    api.get('/remittance').then(setRem).catch(() => {});
  };
  useEffect(() => { load().catch(() => setFx({ base: 'VND', rates: [], status: {} })); }, []);
  if (!fx) return <Loading />;

  async function refreshRates() {
    setBusy(true);
    try {
      const r = await api.post('/fx/refresh', {});
      await load();
      alert(r.updated ? `Đã cập nhật ${r.updated} tỷ giá.` : 'Tỷ giá đã là mới nhất.');
    } catch (e) {
      alert(`Không lấy được tỷ giá online: ${e.message}\nBạn có thể bấm ✎ để nhập tay.`);
    }
    setBusy(false);
  }

  async function getQuote() {
    try {
      const val = Number(String(amount).replace(/\./g, '').replace(',', '.')) || 0;
      const r = await api.post('/remittance/quote', {
        amount: toMinor(val, from), from, to,
        fee_pct: (Number(String(feePct).replace(',', '.')) || 0) / 100,
      });
      setQuote(r.quote);
    } catch (e) { alert(e.message); }
  }

  async function setManualRate(code) {
    const v = prompt(`1 ${fx.base} = ? ${code}`, '');
    if (!v) return;
    try {
      await api.post('/fx/rate', { base: fx.base, quote: code, rate: Number(String(v).replace(/\./g, '').replace(',', '.')) });
      await load();
    } catch (e) { alert(e.message); }
  }

  async function changeBase(code) {
    if (!confirm(`Đổi đồng tiền chính sang ${code}?\nMọi báo cáo tổng hợp sẽ được tính lại theo ${code}. Số dư từng tài khoản không đổi.`)) return;
    setBusy(true);
    try {
      const r = await api.post('/currency/base', { currency: code });
      setBaseCurrency(code);
      await load();
      onRefresh?.();
      alert(`Đã đổi sang ${code}. Tính lại ${r.recomputed} giao dịch.`);
    } catch (e) { alert(e.message); }
    setBusy(false);
  }

  const st = fx.status || {};
  const timing = rem?.timing;
  const v = VERDICT[timing?.verdict] || VERDICT.unknown;
  const sum = rem?.summary;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Tiền tệ & chuyển tiền</h1>
          <p>Tỷ giá, quy đổi, và theo dõi tiền gửi về Việt Nam</p>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={refreshRates}>{busy ? '…' : '↻ Làm mới tỷ giá'}</button>
        </div>
      </div>

      <div className="grid g3">
        <Stat label="Đồng tiền chính" value={`${CURRENCIES[fx.base]?.flag || ''} ${fx.base}`} sub={CURRENCIES[fx.base]?.name} />
        <Stat label="Cập nhật tỷ giá" value={st.last_ok ? vnDate(st.last_ok) : '—'} sub={st.source || 'chưa tải'} />
        <Stat
          label="Gửi về VN (12 tháng)"
          value={sum?.count ? short(sum.total_sent, fx.base) : '—'}
          sub={sum?.count ? `${sum.count} lần · nhận ${short(sum.total_received, 'VND')}` : 'Chưa có giao dịch nào'}
        />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="💱 Tỷ giá hiện tại">
          {(fx.rates || []).length ? (fx.rates || []).map((r) => (
            <div key={r.code} className="between" style={{ padding: '8px 0' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.flag} 1 {fx.base} = {rateStr(r.rate, r.code)} {r.code}</div>
                <div className="mini">1 {r.code} = {Number(r.inverse).toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {fx.base}</div>
              </div>
              <button className="btn sm ghost" onClick={() => setManualRate(r.code)}>✎</button>
            </div>
          )) : <Empty>Chưa có tỷ giá. Bấm "Làm mới tỷ giá".</Empty>}
          <p className="mini" style={{ marginTop: 10 }}>💬 Hỏi nhanh trong chat: _"tỷ giá euro hôm nay"_</p>
        </Card>

        <Card title="🌍 Gửi tiền về Việt Nam">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="inp" style={{ flex: '1 1 110px' }} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="Số tiền" />
            <select className="inp" style={{ flex: '0 0 100px' }} value={from} onChange={(e) => setFrom(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
            </select>
            <span style={{ alignSelf: 'center' }}>→</span>
            <select className="inp" style={{ flex: '0 0 100px' }} value={to} onChange={(e) => setTo(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
            </select>
            <input className="inp" style={{ flex: '0 0 82px' }} value={feePct} inputMode="decimal" onChange={(e) => setFeePct(e.target.value)} title="Phí dịch vụ (%)" />
            <button className="btn primary" onClick={getQuote}>Tính</button>
          </div>

          {quote && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(quote.received, to)}</div>
              <div className="mini">
                Gửi {fmt(quote.amount, from)} · phí {fmt(quote.fee, from)} · 1 {from} = {rateStr(quote.mid_rate, to)} {to}
              </div>
            </div>
          )}

          {timing && (
            <p className="mini" style={{ marginTop: 12 }}>
              <b>{v.ico} {v.label}</b> — {timing.message}
            </p>
          )}
          {rem?.cost?.cost > 0 && (
            <p className="mini" style={{ marginTop: 6 }}>
              💸 12 tháng qua tốn {fmt(rem.cost.cost, fx.base)} phí + chênh tỷ giá ({pct(rem.cost.cost_pct, 2)} số tiền gửi).
            </p>
          )}
        </Card>
      </div>

      {sum?.count > 0 && (
        <div className="grid" style={{ marginTop: 14 }}>
          <Card title="📊 Lịch sử chuyển tiền">
            {(rem.list || []).slice(0, 15).map((t) => (
              <div key={t.id} className="between" style={{ padding: '8px 0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{vnDate(t.date)} · {t.from_account || '—'} → {t.to_account || '—'}</div>
                  <div className="mini">1 {t.sent_currency || t.currency} = {rateStr(t.effective_rate, t.received_currency || t.counter_currency)} {t.received_currency || t.counter_currency}{t.fee ? ` · phí ${fmt(t.fee, t.currency)}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(t.sent ?? t.amount, t.sent_currency || t.currency)} → {fmt(t.received ?? t.counter_amount, t.received_currency || t.counter_currency)}</div>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className="grid" style={{ marginTop: 14 }}>
        <Card title="⚙️ Đồng tiền chính">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {Object.values(CURRENCIES).map((c) => (
              <button
                key={c.code}
                className={`btn ${c.code === fx.base ? 'primary' : ''}`}
                disabled={busy || c.code === fx.base}
                onClick={() => changeBase(c.code)}
              >
                {c.flag} {c.code} — {c.name}
              </button>
            ))}
          </div>
          <p className="mini" style={{ marginTop: 10 }}>
            Số dư từng tài khoản vẫn giữ đồng tiền riêng (ví dụ Revolut EUR, sổ tiết kiệm VND).
            Đồng tiền chính chỉ dùng để cộng gộp tài sản, ngân sách và báo cáo.
          </p>
        </Card>
      </div>
    </>
  );
}
