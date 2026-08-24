import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, short, pct, monthLabel, baseCurrency, toMinor } from '../lib/format.js';

const TONE = { ok: 'ok', warn: 'warn', fast: 'warn', over: 'bad' };
const LABEL = { ok: 'Đúng nhịp', warn: 'Sát ngưỡng', fast: 'Tiêu nhanh', over: 'Vượt hạn mức' };

export default function Budgets({ onRefresh }) {
  const [d, setD] = useState(null);
  const [cats, setCats] = useState([]);
  const [sug, setSug] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/budgets').then(setD);
  useEffect(() => {
    load();
    api.get('/categories').then((r) => setCats(r.categories.filter((c) => c.kind === 'expense')));
    api.get('/budgets/suggest?months=3').then((r) => setSug(r.suggestions || []));
  }, []);
  if (!d) return <Loading />;

  const items = d.items || [];
  const limit = items.reduce((s, b) => s + b.limit, 0);
  const spent = items.reduce((s, b) => s + b.spent, 0);

  async function add(v) {
    await api.post('/budgets', { category_id: Number(v.category_id), amount: toMinor(v.amount), currency: baseCurrency(), period: 'monthly', rollover: v.rollover === 'yes' ? 1 : 0 });
    setAdding(false); load(); onRefresh?.();
  }
  async function applyAll() {
    for (const s of sug) await api.post('/budgets', { category_id: s.category_id, amount: s.amount, period: 'monthly' });
    load(); onRefresh?.();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Ngân sách</h1><p>Tháng {monthLabel(d.month)} · đã qua {pct(items[0]?.pace || 0)} thời gian</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Ngân sách</button>
      </div>

      <div className="grid g4">
        <Stat label="Tổng hạn mức" value={short(limit)} sub={`${items.length} danh mục`} />
        <Stat label="Đã tiêu" value={short(spent)} sub={pct(spent / (limit || 1))} tone={spent > limit ? 'down' : ''} />
        <Stat label="Còn lại" value={short(limit - spent)} tone={limit - spent < 0 ? 'down' : 'up'} />
        <Stat label="Vượt hạn mức" value={d.over || 0} tone={d.over ? 'down' : 'up'} sub="danh mục" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        {items.map((b) => (
          <div className="card" key={b.id}>
            <div className="between">
              <div><b>{b.icon} {b.name}</b><div className="mini">Dự phóng cuối tháng: {short(b.projected)}</div></div>
              <span className={`tag ${TONE[b.status] || ''}`}>{LABEL[b.status] || b.status}</span>
            </div>
            <div style={{ margin: '10px 0 5px' }}><Progress value={b.pct} tone={TONE[b.status]} /></div>
            <div className="between mini">
              <span>{fmt(b.spent)} / {fmt(b.limit)}</span>
              <span>{b.remaining >= 0 ? `còn ${short(b.remaining)} · ${short(b.daily_left)}/ngày` : <span className="down">vượt {short(-b.remaining)}</span>}</span>
            </div>
          </div>
        ))}
        {!items.length && <Empty>Chưa đặt ngân sách nào.</Empty>}
      </div>

      {sug.length > 0 && (
        <Card title="Gợi ý từ thói quen chi 3 tháng qua" right={<button className="btn sm" onClick={applyAll}>Áp dụng tất cả</button>}>
          <div className="list">
            {sug.map((s) => (
              <div key={s.category_id} className="item" style={{ padding: '8px 0' }}>
                <div className="ic">{s.icon || '📊'}</div>
                <div><div className="t">{s.name}</div><div className="s">Trung bình {short(s.average)}/tháng</div></div>
                <div className="amt">{short(s.amount)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {adding && (
        <Modal title="Đặt ngân sách" onClose={() => setAdding(false)}>
          <Form
            fields={[
              { k: 'category_id', label: 'Danh mục', type: 'select', options: cats.map((c) => ({ value: String(c.id), label: `${c.icon || ''} ${c.name}` })) },
              { k: 'amount', label: `Hạn mức mỗi tháng (${baseCurrency()})`, type: 'number' },
              { k: 'rollover', label: 'Dồn phần chưa tiêu sang tháng sau?', type: 'select', options: [{ value: 'no', label: 'Không' }, { value: 'yes', label: 'Có' }], def: 'no' },
            ]}
            onSubmit={add}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
    </>
  );
}
