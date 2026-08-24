import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Empty, Loading, Money, Modal, Form } from '../components/ui.jsx';
import { vnDate, short, fmt, baseCurrency, toMinor, toMajor, CURRENCIES } from '../lib/format.js';

export default function Transactions({ onRefresh }) {
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => {
    const p = new URLSearchParams({ limit: '200' });
    if (q) p.set('search', q);
    if (kind) p.set('type', kind);
    api.get(`/transactions?${p}`).then((d) => setData(d.transactions));
  };
  useEffect(load, [q, kind]);
  useEffect(() => {
    api.get('/categories').then((d) => setCats(d.categories));
    api.get('/accounts').then((d) => setAccounts(d.accounts));
  }, []);

  if (!data) return <Loading />;

  const catOptions = [{ value: '', label: '— Chưa phân loại —' }, ...cats.map((c) => ({ value: String(c.id), label: `${c.icon || ''} ${c.name} (${c.kind === 'income' ? 'thu' : 'chi'})` }))];
  const accOptions = [{ value: '', label: '— Không —' }, ...accounts.map((a) => ({ value: String(a.id), label: a.name }))];

  async function save(v) {
    const code = v.currency || accounts.find((a) => String(a.id) === String(v.account_id))?.currency || baseCurrency();
    const body = { ...v, currency: code, amount: toMinor(v.amount, code), category_id: v.category_id ? Number(v.category_id) : null, account_id: v.account_id ? Number(v.account_id) : null };
    if (edit) await api.patch(`/transactions/${edit.id}`, body);
    else await api.post('/transactions', body);
    setEdit(null); setAdding(false); load(); onRefresh?.();
  }
  async function del(id) {
    if (!confirm('Xoá giao dịch này?')) return;
    await api.del(`/transactions/${id}`); load(); onRefresh?.();
  }

  const fields = [
    { k: 'type', label: 'Loại', type: 'select', options: [{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }, { value: 'transfer', label: 'Chuyển khoản' }], def: 'expense' },
    { k: 'amount', label: 'Số tiền', type: 'number' },
    { k: 'currency', label: 'Đồng tiền', type: 'select', options: Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` })), def: edit?.currency || baseCurrency() },
    { k: 'date', label: 'Ngày', type: 'date', def: new Date().toISOString().slice(0, 10) },
    { k: 'account_id', label: 'Tài khoản', type: 'select', options: accOptions },
    { k: 'category_id', label: 'Danh mục', type: 'select', options: catOptions },
    { k: 'merchant', label: 'Nơi chi/nguồn thu' },
    { k: 'note', label: 'Ghi chú', full: true },
  ];

  const needReview = data.filter((t) => t.needs_review).length;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Giao dịch</h1>
          <p>{data.length} giao dịch{needReview ? ` · ${needReview} cần xem lại` : ''} — phần lớn được ghi tự động từ SMS/ứng dụng ngân hàng</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Thêm</button>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        <input className="inp" style={{ maxWidth: 280 }} placeholder="Tìm theo nội dung, nơi chi..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" style={{ maxWidth: 160 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tất cả</option><option value="expense">Chi</option><option value="income">Thu</option><option value="transfer">Chuyển khoản</option>
        </select>
      </div>

      <div className="card pad0 scrollx">
        <table>
          <thead><tr><th>Ngày</th><th>Nội dung</th><th>Danh mục</th><th>Tài khoản</th><th>Nguồn</th><th className="num">Số tiền</th><th></th></tr></thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <td className="mini">{vnDate(t.date)}</td>
                <td>
                  {t.merchant || t.note || '—'}
                  {t.needs_review ? <span className="tag warn" style={{ marginLeft: 6 }}>cần xem</span> : null}
                </td>
                <td className="mini">{t.category_icon || ''} {t.category_name || '—'}</td>
                <td className="mini">{t.account_name || '—'}</td>
                <td><span className="tag">{t.source}</span></td>
                <td className="num"><Money v={t.type === 'income' ? t.amount : t.type === 'transfer' ? 0 : -t.amount} sign /></td>
                <td className="acts">
                  <button className="btn sm ghost" onClick={() => setEdit(t)} aria-label="Sửa giao dịch">✎</button>
                  <button className="btn sm ghost" onClick={() => del(t.id)} aria-label="Xoá giao dịch">🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <Empty>Không có giao dịch nào khớp.</Empty>}
      </div>

      {(adding || edit) && (
        <Modal title={edit ? 'Sửa giao dịch' : 'Thêm giao dịch'} onClose={() => { setEdit(null); setAdding(false); }}>
          <Form
            fields={fields}
            initial={edit ? { ...edit, amount: toMajor(edit.amount, edit.currency), category_id: edit.category_id ? String(edit.category_id) : '', account_id: edit.account_id ? String(edit.account_id) : '' } : {}}
            onSubmit={save}
            onCancel={() => { setEdit(null); setAdding(false); }}
          />
          {edit && <p className="mini" style={{ marginTop: 12 }}>💡 Khi bạn sửa danh mục, FinMate sẽ tự học và áp dụng cho các giao dịch tương tự sau này.</p>}
        </Modal>
      )}
    </>
  );
}
