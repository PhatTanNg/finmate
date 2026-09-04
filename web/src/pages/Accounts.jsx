import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal, Form, Donut } from '../components/ui.jsx';
import { fmt, short, vnDate, baseCurrency, toMajor, toMinor, CURRENCIES } from '../lib/format.js';

const TYPES = [
  { value: 'bank', label: 'Ngân hàng' }, { value: 'savings', label: 'Tiết kiệm' }, { value: 'ewallet', label: 'Ví điện tử' },
  { value: 'cash', label: 'Tiền mặt' }, { value: 'credit', label: 'Thẻ tín dụng' }, { value: 'investment', label: 'Chứng khoán' },
];
const CUR_OPTIONS = Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code} — ${c.name}` }));
const ICON = { bank: '🏦', savings: '🔒', ewallet: '📱', cash: '💵', credit: '💳', investment: '📈' };

export default function Accounts({ onRefresh }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  const [rec, setRec] = useState(null);

  const load = () => api.get('/accounts').then((d) => setList(d.accounts));
  useEffect(() => { load(); }, []);
  if (!list) return <Loading />;

  const active = list.filter((a) => a.is_active);
  // Cộng gộp phải dùng số đã quy về đồng tiền gốc, không cộng thẳng số dư gốc
  // của nhiều đồng tiền khác nhau.
  const bal = (a) => (a.base_balance ?? a.balance);
  const assets = active.filter((a) => bal(a) >= 0).reduce((s, a) => s + bal(a), 0);
  const debt = active.filter((a) => bal(a) < 0).reduce((s, a) => s + Math.abs(bal(a)), 0);

  async function save(v) {
    const code = v.currency || edit?.currency || baseCurrency();
    const body = { ...v, currency: code, balance: toMinor(v.balance, code), interest_rate: Number(v.interest_rate) || 0 };
    if (edit) await api.patch(`/accounts/${edit.id}`, body);
    else await api.post('/accounts', body);
    setEdit(null); setAdding(false); load(); onRefresh?.();
  }

  const fields = [
    { k: 'name', label: 'Tên tài khoản', ph: 'VCB Thanh toán' },
    { k: 'type', label: 'Loại', type: 'select', options: TYPES, def: 'bank' },
    { k: 'institution', label: 'Ngân hàng / tổ chức', ph: 'Vietcombank' },
    { k: 'currency', label: 'Đồng tiền', type: 'select', options: CUR_OPTIONS, def: edit?.currency || baseCurrency() },
    { k: 'balance', label: `Số dư (${edit?.currency || baseCurrency()})`, type: 'number', def: 0 },
    { k: 'account_no', label: 'Số tài khoản (để khớp SMS)', ph: '0071000123456' },
    { k: 'interest_rate', label: 'Lãi suất %/năm', type: 'number', def: 0 },
  ];

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Tài khoản & ví</h1>
          <p>Số dư được đồng bộ tự động khi có SMS/thông báo ngân hàng</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Thêm tài khoản</button>
      </div>

      <div className="grid g3">
        <Stat label="Tổng tiền có" value={short(assets)} sub={`${active.length} tài khoản đang dùng`} />
        <Stat label="Dư nợ thẻ" value={short(debt)} tone={debt ? 'down' : ''} sub="Thẻ tín dụng / thấu chi" />
        <Stat label="Ròng" value={short(assets - debt)} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Phân bổ theo tài khoản">
          <Donut items={active.filter((a) => bal(a) > 0).map((a) => ({ label: a.name, value: bal(a) }))} />
        </Card>
        <Card title="Danh sách">
          <div className="list">
            {list.map((a) => (
              <div key={a.id} className="item" style={{ opacity: a.is_active ? 1 : 0.5 }}>
                <div className="ic">{ICON[a.type] || '🏦'}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{a.name}</div>
                  <div className="s">
                    {a.institution || TYPES.find((t) => t.value === a.type)?.label}
                    {a.interest_rate ? ` · ${a.interest_rate}%/năm` : ''}
                    {a.last_synced_at ? ` · đồng bộ ${vnDate(a.last_synced_at)}` : ''}
                  </div>
                </div>
                <div className="amt" style={{ textAlign: 'right' }}>
                  <div className={a.balance < 0 ? 'down' : ''}>{fmt(a.balance, a.currency)}</div>
                  {a.currency && a.currency !== baseCurrency() && (
                    <div className="mini">≈ {short(a.base_balance ?? a.balance)}</div>
                  )}
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn sm ghost" onClick={() => setEdit(a)} aria-label="Sửa tài khoản">✎</button>
                    <button className="btn sm ghost" title="Đối soát số dư" onClick={() => setRec(a)}>⚖</button>
                    <button className="btn sm ghost" title={a.is_active ? 'Đóng tài khoản (giữ lịch sử)' : 'Mở lại'} onClick={async () => { await api.patch(`/accounts/${a.id}`, { is_active: a.is_active ? 0 : 1 }); load(); onRefresh?.(); }}>{a.is_active ? '⏸' : '▶'}</button>
                    {!a.is_active && <button className="btn sm ghost" title="Xoá hẳn" onClick={async () => { if (!confirm(`Xoá hẳn tài khoản "${a.name}"? Giao dịch cũ sẽ mất liên kết tài khoản.`)) return; await api.del(`/accounts/${a.id}`); load(); onRefresh?.(); }}>🗑</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {(adding || edit) && (
        <Modal title={edit ? `Sửa ${edit.name}` : 'Thêm tài khoản'} onClose={() => { setEdit(null); setAdding(false); }}>
          <Form fields={fields} initial={edit ? { ...edit, balance: toMajor(edit.balance, edit.currency) } : {}} onSubmit={save} onCancel={() => { setEdit(null); setAdding(false); }} />
        </Modal>
      )}

      {rec && (
        <Modal title={`Đối soát ${rec.name}`} onClose={() => setRec(null)}>
          <p className="mini">Nhập số dư thực tế trên app ngân hàng. FinMate sẽ tự tạo bút toán điều chỉnh cho phần chênh lệch.</p>
          <Form
            fields={[{ k: 'balance', label: `Số dư thực tế (${rec.currency || baseCurrency()})`, type: 'number', def: toMajor(rec.balance, rec.currency) }]}
            submit="Đối soát"
            onSubmit={async (v) => { await api.post(`/accounts/${rec.id}/reconcile`, { balance: toMinor(v.balance, rec.currency || baseCurrency()) }); setRec(null); load(); onRefresh?.(); }}
            onCancel={() => setRec(null)}
          />
        </Modal>
      )}
    </>
  );
}
