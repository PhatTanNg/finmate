import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, short, vnDate, pct } from '../lib/format.js';

const TYPES = [
  { value: 'emergency', label: 'Quỹ khẩn cấp' }, { value: 'house', label: 'Mua nhà' }, { value: 'car', label: 'Mua xe' },
  { value: 'travel', label: 'Du lịch' }, { value: 'education', label: 'Học tập' }, { value: 'wedding', label: 'Cưới hỏi' },
  { value: 'fire', label: 'Tự do tài chính' }, { value: 'purchase', label: 'Mua sắm lớn' }, { value: 'other', label: 'Khác' },
];

export default function Goals({ onRefresh }) {
  const [goals, setGoals] = useState(null);
  const [funds, setFunds] = useState([]);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  const [contrib, setContrib] = useState(null);

  const load = () => api.get('/goals').then((d) => setGoals(d.goals));
  useEffect(() => { load(); api.get('/funds').then((d) => setFunds(d.funds || [])); }, []);
  if (!goals) return <Loading />;

  const active = goals.filter((g) => g.status === 'active');
  const totalTarget = active.reduce((s, g) => s + g.target_amount, 0);
  const totalNow = active.reduce((s, g) => s + g.current_amount, 0);

  const fields = [
    { k: 'name', label: 'Tên mục tiêu', ph: 'Mua nhà quận 7', full: true },
    { k: 'type', label: 'Loại', type: 'select', options: TYPES, def: 'other' },
    { k: 'target_amount', label: 'Cần bao nhiêu (VND)', type: 'number' },
    { k: 'current_amount', label: 'Đã có (VND)', type: 'number', def: 0 },
    { k: 'deadline', label: 'Hạn hoàn thành', type: 'date' },
    { k: 'monthly_contribution', label: 'Để dành mỗi tháng', type: 'number', def: 0 },
    { k: 'fund_id', label: 'Lấy tiền từ quỹ', type: 'select', options: [{ value: '', label: '— Không gắn —' }, ...funds.map((f) => ({ value: String(f.id), label: `${f.icon} ${f.name}` }))] },
    { k: 'priority', label: 'Ưu tiên (1 cao nhất)', type: 'number', def: 3 },
  ];

  async function save(v) {
    const body = { ...v, target_amount: Number(v.target_amount), current_amount: Number(v.current_amount) || 0, monthly_contribution: Number(v.monthly_contribution) || 0, priority: Number(v.priority) || 3, fund_id: v.fund_id ? Number(v.fund_id) : null, status: 'active' };
    if (edit) await api.patch(`/goals/${edit.id}`, body); else await api.post('/goals', body);
    setEdit(null); setAdding(false); load(); onRefresh?.();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Mục tiêu</h1><p>Mỗi mục tiêu được nạp tiền tự động từ quỹ tương ứng</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Mục tiêu mới</button>
      </div>

      <div className="grid g3">
        <Stat label="Đang theo đuổi" value={active.length} sub={`${goals.length - active.length} đã hoàn thành`} />
        <Stat label="Tổng cần" value={short(totalTarget)} />
        <Stat label="Đã tích luỹ" value={short(totalNow)} sub={pct(totalNow / (totalTarget || 1))} tone="up" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        {goals.map((g) => {
          const p = g.current_amount / (g.target_amount || 1);
          const monthsLeft = g.deadline ? Math.max(0, Math.round((new Date(g.deadline) - new Date()) / 2592000000)) : null;
          const need = monthsLeft ? Math.max(0, (g.target_amount - g.current_amount) / monthsLeft) : 0;
          const risky = need > (g.monthly_contribution || 0) * 1.15;
          return (
            <div className="card" key={g.id}>
              <div className="between">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{g.name}</div>
                  <div className="mini">{TYPES.find((t) => t.value === g.type)?.label || g.type} · hạn {vnDate(g.deadline)}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm ghost" onClick={() => setContrib(g)}>＋ Nạp</button>
                  <button className="btn sm ghost" onClick={() => setEdit(g)}>✎</button>
                </div>
              </div>
              <div style={{ margin: '10px 0 5px' }}><Progress value={p} tone={p >= 1 ? 'ok' : risky ? 'warn' : ''} /></div>
              <div className="between mini">
                <span>{fmt(g.current_amount)} / {fmt(g.target_amount)}</span>
                <b>{pct(p)}</b>
              </div>
              <div className="hr" />
              <div className="mini">
                {p >= 1 ? '🎉 Đã hoàn thành!' : monthsLeft ? (
                  <>Còn {monthsLeft} tháng · cần <b>{short(need)}/tháng</b>
                    {g.monthly_contribution ? ` (đang để dành ${short(g.monthly_contribution)})` : ''}
                    {risky ? <span className="warn"> — đang chậm tiến độ</span> : <span className="up"> — đúng lộ trình</span>}
                  </>
                ) : 'Chưa đặt hạn'}
              </div>
            </div>
          );
        })}
        {!goals.length && <Empty>Chưa có mục tiêu nào. Thử chat: _"tạo mục tiêu mua nhà 2 tỷ trong 5 năm"_</Empty>}
      </div>

      {(adding || edit) && (
        <Modal title={edit ? 'Sửa mục tiêu' : 'Mục tiêu mới'} onClose={() => { setEdit(null); setAdding(false); }}>
          <Form fields={fields} initial={edit ? { ...edit, fund_id: edit.fund_id ? String(edit.fund_id) : '' } : {}} onSubmit={save} onCancel={() => { setEdit(null); setAdding(false); }} />
        </Modal>
      )}

      {contrib && (
        <Modal title={`Nạp tiền vào "${contrib.name}"`} onClose={() => setContrib(null)}>
          <Form
            fields={[{ k: 'amount', label: 'Số tiền (VND)', type: 'number' }]}
            submit="Nạp"
            onSubmit={async (v) => { await api.post(`/goals/${contrib.id}/contribute`, { amount: Number(v.amount) }); setContrib(null); load(); onRefresh?.(); }}
            onCancel={() => setContrib(null)}
          />
        </Modal>
      )}
    </>
  );
}
