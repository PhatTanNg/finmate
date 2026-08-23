import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Modal, Form, Donut } from '../components/ui.jsx';
import { fmt, short, vnDate } from '../lib/format.js';

export default function Funds({ onRefresh }) {
  const [d, setD] = useState(null);
  const [move, setMove] = useState(false);
  const [edit, setEdit] = useState(null);
  const [alloc, setAlloc] = useState(false);
  const [ledger, setLedger] = useState([]);

  const load = () => {
    api.get('/funds').then(setD);
    api.get('/funds/ledger?limit=40').then((r) => setLedger(r.entries));
  };
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;

  const funds = d.funds || [];
  const totalPct = funds.reduce((s, f) => s + (f.percent || 0), 0);
  const total = funds.reduce((s, f) => s + (f.balance || 0), 0);
  const opts = funds.map((f) => ({ value: String(f.id), label: `${f.icon} ${f.name}` }));

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Quỹ & phong bì</h1>
          <p>Mỗi khi có thu nhập, tiền được chia tự động theo tỷ lệ bên dưới</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setMove(true)}>⇄ Chuyển quỹ</button>
          <button className="btn primary" onClick={() => setAlloc(true)}>Phân bổ tiền</button>
        </div>
      </div>

      <div className="grid g3">
        <Stat label="Tổng trong các quỹ" value={short(total)} sub={`${funds.length} quỹ`} />
        <Stat label="Tổng tỷ lệ phân bổ" value={`${totalPct}%`} tone={totalPct === 100 ? 'up' : 'warn'} sub={totalPct === 100 ? 'Cân bằng' : 'Nên chỉnh về 100%'} />
        <Stat label="Quỹ có thể tiêu" value={short(funds.filter((f) => f.spendable).reduce((s, f) => s + f.balance, 0))} sub="Không tính quỹ khẩn cấp & đầu tư" />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Cơ cấu quỹ">
          <Donut items={funds.filter((f) => f.balance > 0).map((f) => ({ label: f.name, value: f.balance, color: f.color }))} />
        </Card>
        <Card title="Tỷ lệ chia thu nhập">
          {funds.map((f) => (
            <div key={f.id} style={{ padding: '6px 0' }}>
              <div className="between" style={{ fontSize: 13.5 }}>
                <span>{f.icon} {f.name}</span>
                <span className="row" style={{ gap: 8 }}>
                  <b>{f.percent}%</b>
                  <button className="btn sm ghost" onClick={() => setEdit(f)}>✎</button>
                </span>
              </div>
              <Progress value={(f.percent || 0) / 100} />
            </div>
          ))}
          <p className="mini" style={{ marginTop: 10 }}>💬 Có thể chỉnh nhanh bằng chat: _"chia quỹ thiết yếu 45%, tự do tài chính 20%"_</p>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        {funds.map((f) => (
          <div className="card" key={f.id}>
            <div className="between">
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{f.icon} {f.name}</div>
                <div className="mini">{f.note}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 19, fontWeight: 700 }} className={f.balance < 0 ? 'down' : ''}>{fmt(f.balance)}</div>
                <div className="mini">{f.percent}% thu nhập</div>
              </div>
            </div>
            {f.goals?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {f.goals.map((g) => (
                  <div key={g.id} style={{ marginBottom: 6 }}>
                    <div className="between mini"><span>🎯 {g.name}</span><span>{short(g.current_amount)} / {short(g.target_amount)}</span></div>
                    <Progress value={g.current_amount / (g.target_amount || 1)} tone="ok" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Card title="Lịch sử phân bổ">
        <div className="scrollx">
          <table>
            <thead><tr><th>Ngày</th><th>Quỹ</th><th>Diễn giải</th><th className="num">Số tiền</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="mini">{vnDate(e.date)}</td>
                  <td>{e.fund_name}</td>
                  <td className="mini">{e.note || e.kind}</td>
                  <td className="num"><span className={e.amount >= 0 ? 'up' : 'down'}>{e.amount >= 0 ? '+' : ''}{fmt(e.amount)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ledger.length && <Empty>Chưa có bút toán quỹ nào.</Empty>}
      </Card>

      {edit && (
        <Modal title={`Chỉnh quỹ ${edit.name}`} onClose={() => setEdit(null)}>
          <Form
            fields={[
              { k: 'name', label: 'Tên quỹ' },
              { k: 'percent', label: '% thu nhập', type: 'number' },
              { k: 'cap', label: 'Trần tối đa (0 = không giới hạn)', type: 'number' },
              { k: 'note', label: 'Ghi chú', full: true },
            ]}
            initial={edit}
            onSubmit={async (v) => { await api.patch(`/funds/${edit.id}`, { ...v, percent: Number(v.percent), cap: Number(v.cap) }); setEdit(null); load(); onRefresh?.(); }}
            onCancel={() => setEdit(null)}
          />
        </Modal>
      )}

      {move && (
        <Modal title="Chuyển tiền giữa các quỹ" onClose={() => setMove(false)}>
          <Form
            fields={[
              { k: 'from_fund_id', label: 'Từ quỹ', type: 'select', options: opts },
              { k: 'to_fund_id', label: 'Sang quỹ', type: 'select', options: opts },
              { k: 'amount', label: 'Số tiền', type: 'number' },
              { k: 'note', label: 'Lý do', full: true },
            ]}
            onSubmit={async (v) => { await api.post('/funds/move', { ...v, from_fund_id: Number(v.from_fund_id), to_fund_id: Number(v.to_fund_id), amount: Number(v.amount) }); setMove(false); load(); onRefresh?.(); }}
            onCancel={() => setMove(false)}
          />
        </Modal>
      )}

      {alloc && (
        <Modal title="Phân bổ một khoản tiền" onClose={() => setAlloc(false)}>
          <p className="mini">Chia số tiền này vào các quỹ theo đúng tỷ lệ đã cấu hình.</p>
          <Form
            fields={[{ k: 'amount', label: 'Số tiền (VND)', type: 'number' }, { k: 'note', label: 'Ghi chú', full: true }]}
            submit="Chia ngay"
            onSubmit={async (v) => { await api.post('/funds/allocate', { amount: Number(v.amount), note: v.note }); setAlloc(false); load(); onRefresh?.(); }}
            onCancel={() => setAlloc(false)}
          />
        </Modal>
      )}
    </>
  );
}
