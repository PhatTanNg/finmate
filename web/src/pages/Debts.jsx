import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, short, pct, vnDate, baseCurrency, toMinor } from '../lib/format.js';

export default function Debts({ onRefresh }) {
  const [d, setD] = useState(null);
  const [extra, setExtra] = useState(0);
  const [strategy, setStrategy] = useState('avalanche');
  const [adding, setAdding] = useState(false);

  const load = (ex = extra) => api.get(`/debts?extra=${ex || 0}`).then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;

  const s = d.summary || {};
  const plan = strategy === 'avalanche' ? d.avalanche : d.snowball;

  return (
    <>
      <div className="page-h">
        <div><h1>Nợ & trả nợ</h1><p>Kế hoạch sạch nợ tối ưu theo lãi suất</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Khoản nợ</button>
      </div>

      <div className="grid g4">
        <Stat label="Tổng dư nợ" value={short(s.total_balance)} tone={s.total_balance ? 'down' : 'up'} sub={`${s.debts?.length || 0} khoản`} />
        <Stat label="Trả mỗi tháng" value={short(s.monthly_payment)} sub={s.dti == null ? 'chưa biết thu nhập' : `DTI ${pct(s.dti)} thu nhập`} tone={s.dti > 0.4 ? 'down' : ''} />
        <Stat label="Lãi suất bình quân" value={`${(s.avg_rate || 0).toFixed(1)}%`} />
        <Stat label="Ngày sạch nợ" value={s.debt_free_date ? vnDate(s.debt_free_date) : '—'} sub={`Còn phải trả lãi ${short(s.total_interest_remaining)}`} />
      </div>

      {s.high_interest?.length > 0 && (() => {
        const items = s.high_interest
          .map((h) => (typeof h === 'string' ? (s.debts || []).find((x) => x.name === h) : h))
          .filter(Boolean);
        if (!items.length) return null;
        return (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--bad)' }}>
            <b className="down">🔥 Nợ lãi cao cần xử lý trước</b>
            <div className="mini" style={{ marginTop: 6 }}>
              {items.map((h) => `${h.name} (${h.interest_rate}%/năm — ${short(h.balance)})`).join(' · ')}
            </div>
            <div className="mini" style={{ marginTop: 6 }}>
              Trả sớm khoản này tương đương một khoản đầu tư sinh lời {Math.max(...items.map((h) => h.interest_rate))}%/năm không rủi ro — cao hơn mọi kênh an toàn.
            </div>
          </div>
        );
      })()}

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Danh sách khoản nợ">
          <div className="list">
            {(s.debts || []).map((x) => (
              <div key={x.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="between">
                  <div><b>{x.name}</b><div className="mini">{x.lender || ''} · {x.interest_rate}%/năm · trả {short(x.monthly_payment || x.min_payment)}/tháng</div></div>
                  <div style={{ textAlign: 'right' }}><b className="down">{fmt(x.balance)}</b><div className="mini">gốc {short(x.principal)}</div></div>
                </div>
                <div style={{ marginTop: 6 }}><Progress value={1 - x.balance / (x.principal || x.balance || 1)} tone="ok" /></div>
                <div className="mini" style={{ marginTop: 3 }}>Đã trả {pct(1 - x.balance / (x.principal || x.balance || 1))}{x.months_left ? ` · còn ${x.months_left} kỳ` : ''}</div>
              </div>
            ))}
            {!s.debts?.length && <Empty>🎉 Bạn không có khoản nợ nào!</Empty>}
          </div>
        </Card>

        <Card title="Kế hoạch trả nợ">
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <select className="inp" style={{ maxWidth: 220 }} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="avalanche">Lãi cao trước (tiết kiệm nhất)</option>
              <option value="snowball">Nợ nhỏ trước (tạo động lực)</option>
            </select>
            <input className="inp" style={{ maxWidth: 170 }} type="number" placeholder="Trả thêm/tháng" value={extra || ''} onChange={(e) => setExtra(Number(e.target.value) || 0)} />
            <button className="btn" onClick={() => load(extra)}>Tính lại</button>
          </div>
          {!plan || !plan.order?.length ? <Empty>Không đủ dữ liệu để lập kế hoạch.</Empty> : (
            <>
              <div className="grid g3" style={{ marginBottom: 10 }}>
                <div><div className="mini">Sạch nợ sau</div><b>{plan.months} tháng</b></div>
                <div><div className="mini">Ngày dự kiến</div><b>{vnDate(plan.payoff_date)}</b></div>
                <div><div className="mini">Tổng lãi phải trả</div><b className="down">{short(plan.total_interest)}</b></div>
              </div>
              <div className="list">
                {(plan.order || []).map((o, i) => (
                  <div key={i} className="item" style={{ padding: '8px 0' }}>
                    <div className="ic">{i + 1}</div>
                    <div><div className="t">{o.name}</div><div className="s">{o.interest_rate}%/năm · {o.cleared_at ? `xong ${vnDate(o.cleared_at)}` : 'chưa dứt trong 50 năm'}</div></div>
                    <div className="amt">{short(o.balance)}</div>
                  </div>
                ))}
              </div>
              {extra > 0 && d.avalanche && (
                <p className="mini" style={{ marginTop: 8 }}>
                  💡 Trả thêm {short(extra)}/tháng giúp bạn sạch nợ sớm hơn và tiết kiệm tiền lãi đáng kể.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {adding && (
        <Modal title="Thêm khoản nợ" onClose={() => setAdding(false)}>
          <Form
            fields={[
              { k: 'name', label: 'Tên khoản nợ', ph: 'Vay mua xe', full: true },
              { k: 'type', label: 'Loại', type: 'select', options: [{ value: 'mortgage', label: 'Vay mua nhà' }, { value: 'auto', label: 'Vay mua xe' }, { value: 'personal', label: 'Vay tiêu dùng' }, { value: 'credit_card', label: 'Thẻ tín dụng' }, { value: 'student', label: 'Vay học' }, { value: 'other', label: 'Khác' }], def: 'personal' },
              { k: 'lender', label: 'Bên cho vay' },
              { k: 'balance', label: `Dư nợ hiện tại (${baseCurrency()})`, type: 'number' },
              { k: 'interest_rate', label: 'Lãi suất %/năm', type: 'number' },
              { k: 'monthly_payment', label: `Trả mỗi tháng (${baseCurrency()})`, type: 'number' },
              { k: 'due_day', label: 'Ngày đến hạn', type: 'number', def: 10 },
            ]}
            onSubmit={async (v) => {
              const bal = toMinor(v.balance);
              const pay = toMinor(v.monthly_payment);
              await api.post('/debts', { ...v, balance: bal, principal: bal, currency: baseCurrency(), interest_rate: Number(v.interest_rate) || 0, monthly_payment: pay, min_payment: pay, due_day: Number(v.due_day) || 10, status: 'active' });
              setAdding(false); load(); onRefresh?.();
            }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
    </>
  );
}
