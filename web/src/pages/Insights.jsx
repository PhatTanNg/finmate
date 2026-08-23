import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Empty, Loading } from '../components/ui.jsx';
import { vnDate } from '../lib/format.js';

const SEV = {
  danger: { i: '🔴', l: 'Cần xử lý ngay' },
  warn: { i: '🟡', l: 'Nên chú ý' },
  info: { i: '🔵', l: 'Thông tin' },
  success: { i: '🟢', l: 'Tin tốt' },
};
const ORDER = ['danger', 'warn', 'info', 'success'];

export default function Insights({ onRefresh }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/insights').then((d) => {
    setList(d.insights);
    const unread = d.insights.filter((i) => !i.read);
    if (unread.length) {
      Promise.all(unread.map((i) => api.patch(`/insights/${i.id}`, { read: 1 }))).then(() => onRefresh?.());
    }
  });
  useEffect(() => { load(); }, []);
  if (!list) return <Loading />;

  async function regen() {
    setBusy(true);
    await api.post('/insights/generate');
    await load(); onRefresh?.(); setBusy(false);
  }
  async function dismiss(id) {
    await api.patch(`/insights/${id}`, { dismissed: 1 });
    load(); onRefresh?.();
  }

  const groups = ORDER.map((s) => ({ sev: s, items: list.filter((i) => i.severity === s) })).filter((g) => g.items.length);
  const other = list.filter((i) => !ORDER.includes(i.severity));
  if (other.length) groups.push({ sev: 'info', items: other });

  return (
    <>
      <div className="page-h">
        <div><h1>Cảnh báo & phát hiện</h1><p>FinMate quét dữ liệu của bạn liên tục và báo khi có điều bất thường</p></div>
        <button className="btn" onClick={regen} disabled={busy}>{busy ? 'Đang quét...' : '↻ Quét lại ngay'}</button>
      </div>

      {!list.length && <Empty>Không có cảnh báo nào — mọi thứ đang ổn 👍</Empty>}

      {groups.map((g, gi) => (
        <Card key={`${g.sev}-${gi}`} title={`${SEV[g.sev].i} ${SEV[g.sev].l} (${g.items.length})`}>
          <div className="list">
            {g.items.map((i) => (
              <div key={i.id} className="item" style={{ padding: '11px 0', alignItems: 'flex-start' }}>
                <div className="ic">{SEV[i.severity]?.i || '🔵'}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="t">{i.title}</div>
                  <div className="s" style={{ whiteSpace: 'pre-wrap' }}>{i.body}</div>
                  {i.action && <div className="mini" style={{ marginTop: 4 }}>👉 {i.action}</div>}
                  <div className="mini" style={{ marginTop: 3, opacity: .6 }}>{vnDate(i.created_at)}</div>
                </div>
                <button className="btn sm ghost" onClick={() => dismiss(i.id)}>Bỏ qua</button>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
