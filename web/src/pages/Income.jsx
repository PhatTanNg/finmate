import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal, Form, Donut, Progress } from '../components/ui.jsx';
import { fmt, short, pct } from '../lib/format.js';

const TYPES = [
  { value: 'salary', label: '💼 Lương' }, { value: 'freelance', label: '🧑‍💻 Freelance' }, { value: 'business', label: '🏪 Kinh doanh' },
  { value: 'rental', label: '🏡 Cho thuê BĐS' }, { value: 'interest', label: '🏦 Lãi ngân hàng' }, { value: 'dividend', label: '📈 Cổ tức' },
  { value: 'other', label: '✨ Khác' },
];
const PASSIVE = ['rental', 'interest', 'dividend'];

export default function Income({ onRefresh }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/income-streams').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;

  const streams = d.streams || [];
  const monthly = streams.filter((s) => s.active).reduce((t, s) => t + norm(s), 0);
  const passiveTotal = streams.filter((s) => s.active && PASSIVE.includes(s.type)).reduce((t, s) => t + norm(s), 0);

  function norm(s) {
    const f = { monthly: 1, weekly: 4.33, yearly: 1 / 12, quarterly: 1 / 3, daily: 30 }[s.frequency] || 1;
    return Math.round((s.net_amount || 0) * f);
  }

  async function save(v) {
    const body = { ...v, gross_amount: Number(v.gross_amount) || 0, net_amount: Number(v.net_amount) || 0, payday: Number(v.payday) || 5, active: 1 };
    if (edit) await api.patch(`/income-streams/${edit.id}`, body); else await api.post('/income-streams', body);
    setEdit(null); setAdding(false); load(); onRefresh?.();
  }

  const fields = [
    { k: 'name', label: 'Tên nguồn thu', ph: 'Lương công ty ABC', full: true },
    { k: 'type', label: 'Loại', type: 'select', options: TYPES, def: 'salary' },
    { k: 'frequency', label: 'Tần suất', type: 'select', options: [{ value: 'monthly', label: 'Hàng tháng' }, { value: 'weekly', label: 'Hàng tuần' }, { value: 'quarterly', label: 'Hàng quý' }, { value: 'yearly', label: 'Hàng năm' }], def: 'monthly' },
    { k: 'gross_amount', label: 'Gross (trước thuế)', type: 'number', def: 0 },
    { k: 'net_amount', label: 'Net (thực nhận)', type: 'number', def: 0 },
    { k: 'payday', label: 'Ngày nhận', type: 'number', def: 5 },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Nguồn thu nhập</h1><p>Mỗi nguồn được theo dõi và tự ghi sổ đúng ngày</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Nguồn thu</button>
      </div>

      <div className="grid g4">
        <Stat label="Thu nhập/tháng" value={short(monthly)} sub={`${streams.filter((s) => s.active).length} nguồn`} tone="up" />
        <Stat label="Thu nhập thụ động" value={short(passiveTotal)} sub={`${pct(passiveTotal / (monthly || 1))} tổng thu`} />
        <Stat label="Lãi ngân hàng dự kiến/năm" value={short(d.projected_interest)} />
        <Stat label="Thuế TNCN ước tính/năm" value={short(d.tax?.total)} tone="down" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Cơ cấu nguồn thu">
          <Donut items={streams.filter((s) => s.active).map((s) => ({ label: s.name, value: norm(s) }))} />
        </Card>
        <Card title="Chủ động vs thụ động">
          <div style={{ padding: '4px 0 12px' }}>
            <div className="between mini"><span>Thụ động (tiền tự sinh tiền)</span><b>{pct(passiveTotal / (monthly || 1))}</b></div>
            <Progress value={passiveTotal / (monthly || 1)} tone="ok" />
          </div>
          <p className="mini">
            Thu nhập thụ động là phần đưa bạn tới tự do tài chính. Khi khoản này phủ được chi phí sống hàng tháng,
            bạn không còn phụ thuộc vào công việc chính.
          </p>
          <div className="hr" />
          <div className="grid g3">
            <div><div className="mini">Lãi tiết kiệm</div><b>{short(d.passive?.interest)}</b></div>
            <div><div className="mini">Cổ tức</div><b>{short(d.passive?.dividend)}</b></div>
            <div><div className="mini">Cho thuê</div><b>{short(d.passive?.rent)}</b></div>
          </div>
        </Card>
      </div>

      <Card title="Danh sách nguồn thu">
        <div className="list">
          {streams.map((s) => (
            <div key={s.id} className="item" style={{ opacity: s.active ? 1 : 0.5 }}>
              <div className="ic">{(TYPES.find((t) => t.value === s.type)?.label || '✨').split(' ')[0]}</div>
              <div style={{ minWidth: 0 }}>
                <div className="t">{s.name} {PASSIVE.includes(s.type) && <span className="tag ok">thụ động</span>}</div>
                <div className="s">{s.employer || TYPES.find((t) => t.value === s.type)?.label} · ngày {s.payday || '—'} · {s.account_name || 'chưa gắn tài khoản'}</div>
              </div>
              <div className="amt" style={{ textAlign: 'right' }}>
                <div>{fmt(s.net_amount)}</div>
                <div className="mini">{s.gross_amount ? `gross ${short(s.gross_amount)}` : ''}</div>
              </div>
              <button className="btn sm ghost" onClick={() => setEdit(s)}>✎</button>
            </div>
          ))}
          {!streams.length && <Empty>Chưa khai báo nguồn thu nào.</Empty>}
        </div>
      </Card>

      {d.tax?.detail?.length > 0 && (
        <Card title="Ước tính thuế theo từng nguồn">
          <div className="scrollx">
            <table>
              <thead><tr><th>Nguồn</th><th>Cách tính</th><th className="num">Thuế/năm</th></tr></thead>
              <tbody>
                {d.tax.detail.map((t, i) => (
                  <tr key={i}><td>{t.name}</td><td className="mini">{t.mode}</td><td className="num">{fmt(t.tax)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mini" style={{ marginTop: 8 }}>Chỉ mang tính tham khảo — áp dụng biểu thuế luỹ tiến 7 bậc và giảm trừ gia cảnh hiện hành.</p>
        </Card>
      )}

      {(adding || edit) && (
        <Modal title={edit ? 'Sửa nguồn thu' : 'Thêm nguồn thu'} onClose={() => { setEdit(null); setAdding(false); }}>
          <Form fields={fields} initial={edit || {}} onSubmit={save} onCancel={() => { setEdit(null); setAdding(false); }} />
        </Modal>
      )}
    </>
  );
}
