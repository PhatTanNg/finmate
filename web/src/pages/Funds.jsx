import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Modal, Form, Donut } from '../components/ui.jsx';
import { fmt, short, vnDate, baseCurrency, toMinor, toMajor } from '../lib/format.js';

export default function Funds({ onRefresh }) {
  const [d, setD] = useState(null);
  const [move, setMove] = useState(false);
  const [edit, setEdit] = useState(null);
  const [alloc, setAlloc] = useState(false);
  const [closing, setClosing] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [ledger, setLedger] = useState([]);

  const load = () => {
    api.get('/funds?all=1').then(setD);
    api.get('/funds/ledger?limit=40').then((r) => setLedger(r.entries));
  };
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;

  const allFunds = d.funds || [];
  const funds = allFunds.filter((f) => !f.archived);
  const closed = allFunds.filter((f) => f.archived);
  const shown = showClosed ? allFunds : funds;
  const totalPct = funds.reduce((s, f) => s + (f.percent || 0), 0);
  const total = d.total_balance || 0;
  const monthly = d.monthly_load?.total || 0;
  const opts = funds.map((f) => ({ value: String(f.id), label: `${f.icon || '•'} ${f.name}` }));

  const PLAN_TONE = { overdue: 'down', urgent: 'warn', done: 'up' };
  const PLAN_TEXT = {
    overdue: 'Quá hạn',
    urgent: 'Sắp tới hạn',
    done: 'Đã đạt mục tiêu 🎉',
    on_track: 'Đúng tiến độ',
    no_deadline: 'Chưa đặt hạn',
  };

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
        <Stat label="Tổng trong các quỹ" value={short(total)} sub={`${funds.length} quỹ đang mở`} />
        <Stat label="Tổng tỷ lệ phân bổ" value={`${totalPct}%`} tone={totalPct === 100 ? 'up' : 'warn'} sub={totalPct === 100 ? 'Cân bằng' : 'Nên chỉnh về 100%'} />
        {totalPct !== 100 && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <div className="mini">Tổng đang {totalPct}%, tiền chia theo tỉ lệ chứ không đúng con số hiển thị.</div>
            <button className="btn primary sm" onClick={async () => { await api.post('/funds/rebalance', {}); load(); onRefresh?.(); }}>Cân bằng về 100%</button>
          </div>
        )}
        <Stat label="Cần bỏ vào quỹ mỗi tháng" value={short(monthly)} sub={monthly ? `${d.monthly_load.items.length} quỹ có hạn hoàn thành` : 'Chưa quỹ nào đặt hạn'} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Cơ cấu quỹ">
          <Donut items={funds.filter((f) => f.balance_base > 0).map((f) => ({ label: f.name, value: f.balance_base, color: f.color }))} />
        </Card>
        <Card title="Tỷ lệ chia thu nhập">
          {funds.map((f) => (
            <div key={f.id} style={{ padding: '6px 0' }}>
              <div className="between" style={{ fontSize: 13.5 }}>
                <span>{f.icon} {f.name}</span>
                <span className="row" style={{ gap: 8 }}>
                  <b>{f.percent}%</b>
                  <button className="btn sm ghost" onClick={() => setEdit(f)} aria-label={`Chỉnh quỹ ${f.name}`}>✎</button>
                </span>
              </div>
              <Progress value={(f.percent || 0) / 100} />
            </div>
          ))}
          <p className="mini" style={{ marginTop: 10 }}>💬 Có thể chỉnh nhanh bằng chat: _"chia quỹ thiết yếu 45%, tự do tài chính 20%"_</p>
        </Card>
      </div>

      {closed.length > 0 && (
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ẩn' : 'Hiện'} {closed.length} quỹ đã đóng
          </button>
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 14 }}>
        {shown.map((f) => {
          const p = f.plan || {};
          return (
            <div className={`card${f.archived ? ' muted-card' : ''}`} key={f.id}>
              <div className="between">
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {f.icon} {f.name}
                    {f.archived && <span className="tag" style={{ marginLeft: 6 }}>đã đóng</span>}
                  </div>
                  <div className="mini">{f.note}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 19, fontWeight: 700 }} className={f.balance < 0 ? 'down' : ''}>{fmt(f.balance, f.currency)}</div>
                  {f.currency !== d.base_currency && <div className="mini">≈ {short(f.balance_base, d.base_currency)}</div>}
                  <div className="mini">{f.percent}% thu nhập · ưu tiên {f.priority}</div>
                </div>
              </div>

              {p.has_target && (
                <div style={{ marginTop: 10 }}>
                  <div className="between mini">
                    <span>🎯 {short(f.balance, f.currency)} / {short(p.target_amount, f.currency)}</span>
                    <span className={PLAN_TONE[p.status] || ''}>{PLAN_TEXT[p.status] || ''}</span>
                  </div>
                  <Progress value={p.progress || 0} tone={PLAN_TONE[p.status] === 'down' ? 'warn' : 'ok'} />
                  {p.monthly_needed > 0 && (
                    <div className="mini" style={{ marginTop: 6 }}>
                      Cần bỏ <b>{fmt(p.monthly_needed, f.currency)}</b>/tháng
                      {p.months_left != null && <> · còn <b>{p.months_left}</b> tháng</>}
                      {f.target_date && <> · hạn {vnDate(f.target_date)}</>}
                    </div>
                  )}
                </div>
              )}

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

              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button className="btn sm ghost" onClick={() => setEdit(f)}>Chỉnh</button>
                {f.archived ? (
                  <>
                    <button className="btn sm" onClick={async () => { await api.post(`/funds/${f.id}/reopen`, {}); load(); onRefresh?.(); }}>Mở lại</button>
                    {f.balance === 0 && <button className="btn sm ghost" onClick={async () => { if (!confirm(`Xoá hẳn quỹ "${f.name}"?`)) return; await api.del(`/funds/${f.id}`); load(); onRefresh?.(); }}>Xoá hẳn</button>}
                  </>
                ) : (
                  <button className="btn sm ghost" onClick={() => setClosing(f)}>Đóng quỹ</button>
                )}
              </div>
            </div>
          );
        })}
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
              { k: 'target_amount', label: `Mục tiêu cần đạt (${edit.currency || baseCurrency()})`, type: 'number' },
              { k: 'target_date', label: 'Hạn hoàn thành', type: 'date' },
              { k: 'priority', label: 'Ưu tiên (1 = cao nhất)', type: 'number' },
              { k: 'cap', label: `Trần tối đa (0 = không giới hạn)`, type: 'number' },
              { k: 'note', label: 'Ghi chú', full: true },
            ]}
            initial={{ ...edit, cap: toMajor(edit.cap, edit.currency), target_amount: toMajor(edit.target_amount, edit.currency) }}
            onSubmit={async (v) => {
              await api.patch(`/funds/${edit.id}`, {
                name: v.name,
                note: v.note,
                percent: Number(v.percent) || 0,
                priority: Number(v.priority) || 100,
                cap: toMinor(v.cap, edit.currency),
                target_amount: toMinor(v.target_amount, edit.currency),
                target_date: v.target_date || null,
              });
              setEdit(null); load(); onRefresh?.();
            }}
            onCancel={() => setEdit(null)}
          />
          <p className="mini" style={{ marginTop: 10 }}>
            Đặt mục tiêu kèm hạn hoàn thành để app tự tính số tiền cần bỏ vào mỗi tháng.
          </p>
        </Modal>
      )}

      {closing && (
        <Modal title={`Đóng quỹ ${closing.name}`} onClose={() => setClosing(null)}>
          <p className="mini">
            Quỹ sẽ ngừng nhận phân bổ tự động nhưng vẫn giữ nguyên lịch sử.
            {closing.balance !== 0 && <> Số dư <b>{fmt(closing.balance, closing.currency)}</b> cần được chuyển sang quỹ khác.</>}
          </p>
          <Form
            fields={closing.balance !== 0
              ? [{ k: 'to_fund_id', label: 'Chuyển số dư sang quỹ', type: 'select', options: opts.filter((o) => o.value !== String(closing.id)) }]
              : []}
            submit="Đóng quỹ"
            onSubmit={async (v) => {
              await api.post(`/funds/${closing.id}/archive`, v.to_fund_id ? { to_fund_id: Number(v.to_fund_id) } : {});
              setClosing(null); load(); onRefresh?.();
            }}
            onCancel={() => setClosing(null)}
          />
        </Modal>
      )}

      {move && (
        <Modal title="Chuyển tiền giữa các quỹ" onClose={() => setMove(false)}>
          <Form
            fields={[
              { k: 'from_fund_id', label: 'Từ quỹ', type: 'select', options: opts },
              { k: 'to_fund_id', label: 'Sang quỹ', type: 'select', options: opts },
              { k: 'amount', label: `Số tiền (${baseCurrency()})`, type: 'number' },
              { k: 'note', label: 'Lý do', full: true },
            ]}
            onSubmit={async (v) => { await api.post('/funds/move', { ...v, from_fund_id: Number(v.from_fund_id), to_fund_id: Number(v.to_fund_id), amount: toMinor(v.amount) }); setMove(false); load(); onRefresh?.(); }}
            onCancel={() => setMove(false)}
          />
        </Modal>
      )}

      {alloc && (
        <Modal title="Phân bổ một khoản tiền" onClose={() => setAlloc(false)}>
          <p className="mini">Chia số tiền này vào các quỹ theo đúng tỷ lệ đã cấu hình.</p>
          <Form
            fields={[{ k: 'amount', label: `Số tiền (${baseCurrency()})`, type: 'number' }, { k: 'note', label: 'Ghi chú', full: true }]}
            submit="Chia ngay"
            onSubmit={async (v) => { await api.post('/funds/allocate', { amount: toMinor(v.amount), note: v.note }); setAlloc(false); load(); onRefresh?.(); }}
            onCancel={() => setAlloc(false)}
          />
        </Modal>
      )}
    </>
  );
}
