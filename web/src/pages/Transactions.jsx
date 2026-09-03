import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Empty, Loading, Money, Modal, Form } from '../components/ui.jsx';
import { vnDate, short, baseCurrency, toMinor, toMajor, CURRENCIES } from '../lib/format.js';

const KINDS = [['', 'Tất cả'], ['expense', 'Chi'], ['income', 'Thu'], ['transfer', 'Chuyển']];

function dayLabel(iso) {
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === today) return 'Hôm nay';
  if (iso === y) return 'Hôm qua';
  return vnDate(iso);
}

/** Danh sách kiểu app ngân hàng: nhóm theo ngày, chạm vào hàng để sửa. */
export default function Transactions({ onRefresh }) {
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [review, setReview] = useState(false);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => {
    const p = new URLSearchParams({ limit: '300' });
    if (q) p.set('search', q);
    if (kind) p.set('type', kind);
    api.get(`/transactions?${p}`).then((d) => setData(d.transactions));
  };
  useEffect(load, [q, kind]);
  useEffect(() => {
    api.get('/categories').then((d) => setCats(d.categories));
    api.get('/accounts').then((d) => setAccounts(d.accounts));
  }, []);

  const rows = useMemo(() => (data || []).filter((t) => !review || t.needs_review), [data, review]);
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const t of rows) {
      if (!cur || cur.date !== t.date) { cur = { date: t.date, items: [], sum: 0 }; out.push(cur); }
      cur.items.push(t);
      if (t.type === 'expense') cur.sum -= (t.base_amount ?? t.amount);
      if (t.type === 'income') cur.sum += (t.base_amount ?? t.amount);
    }
    return out;
  }, [rows]);

  if (!data) return <Loading />;

  const catOptions = [{ value: '', label: '— Chưa phân loại —' }, ...cats.map((c) => ({ value: String(c.id), label: `${c.icon || ''} ${c.name} (${c.kind === 'income' ? 'thu' : 'chi'})` }))];
  const accOptions = [{ value: '', label: '— Không —' }, ...accounts.map((a) => ({ value: String(a.id), label: a.name }))];

  async function save(v) {
    const code = v.currency || accounts.find((a) => String(a.id) === String(v.account_id))?.currency || baseCurrency();
    const body = { ...v, currency: code, amount: toMinor(v.amount, code), category_id: v.category_id ? Number(v.category_id) : null, account_id: v.account_id ? Number(v.account_id) : null };
    if (v.type === 'transfer') {
      if (!v.counter_account_id) { alert('Chuyển khoản cần chọn tài khoản nhận, nếu không số tiền sẽ bị trừ mà không vào đâu cả.'); return; }
      if (String(v.counter_account_id) === String(v.account_id)) { alert('Tài khoản gửi và nhận không được trùng nhau.'); return; }
      body.counter_account_id = Number(v.counter_account_id);
    } else {
      delete body.counter_account_id;
    }
    if (edit) await api.patch(`/transactions/${edit.id}`, body);
    else await api.post('/transactions', body);
    setEdit(null); setAdding(false); load(); onRefresh?.();
  }
  async function del(id) {
    if (!confirm('Xoá giao dịch này?')) return;
    await api.del(`/transactions/${id}`); setEdit(null); load(); onRefresh?.();
  }

  const fields = [
    { k: 'type', label: 'Loại', type: 'select', options: [{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }, { value: 'transfer', label: 'Chuyển khoản' }], def: 'expense' },
    { k: 'amount', label: 'Số tiền', type: 'number' },
    { k: 'currency', label: 'Đồng tiền', type: 'select', options: Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` })), def: edit?.currency || baseCurrency() },
    { k: 'date', label: 'Ngày', type: 'date', def: new Date().toISOString().slice(0, 10) },
    { k: 'account_id', label: 'Tài khoản', type: 'select', options: accOptions },
    { k: 'counter_account_id', label: 'Chuyển đến tài khoản', type: 'select', options: [{ value: '', label: '— Chọn tài khoản nhận —' }, ...accounts.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` }))], when: (v) => v.type === 'transfer' },
    { k: 'category_id', label: 'Danh mục', type: 'select', options: catOptions, when: (v) => v.type !== 'transfer' },
    { k: 'merchant', label: 'Nơi chi/nguồn thu' },
    { k: 'note', label: 'Ghi chú', full: true },
  ];

  const needReview = data.filter((t) => t.needs_review).length;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Giao dịch</h1>
          <p>{data.length} giao dịch{needReview ? ` · ${needReview} cần xem lại` : ''} — phần lớn ghi tự động từ ngân hàng hoặc qua chat</p>
        </div>
        <button className="btn primary hide-m" onClick={() => setAdding(true)}>+ Thêm</button>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        <input className="inp" style={{ flex: '1 1 200px', maxWidth: 360 }} placeholder="Tìm nơi chi, ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {KINDS.map(([v, l]) => <button key={v} className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}</button>)}
        </div>
        {needReview > 0 && <button className={`chip ${review ? 'on' : ''}`} onClick={() => setReview(!review)}>Cần xem lại · {needReview}</button>}
      </div>

      <div className="card pad0">
        {groups.map((g) => (
          <div key={g.date}>
            <div className="day-h"><span>{dayLabel(g.date)}</span><span className={g.sum > 0 ? 'up' : g.sum < 0 ? '' : 'dim'}>{g.sum ? short(g.sum) : ''}</span></div>
            <div className="list">
              {g.items.map((t) => (
                <div key={t.id} className="item tap" onClick={() => setEdit(t)} role="button" tabIndex={0}>
                  <div className="ic">{t.category_icon || (t.type === 'income' ? '💰' : t.type === 'transfer' ? '🔁' : '💸')}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{t.merchant || t.note || t.category_name || 'Giao dịch'}{t.needs_review ? <span className="tag warn" style={{ marginLeft: 6 }}>cần xem</span> : null}</div>
                    <div className="s">{t.category_name || (t.type === 'transfer' ? 'Chuyển khoản' : 'Chưa phân loại')}{t.account_name ? ` · ${t.account_name}` : ''}{t.source && t.source !== 'manual' ? ` · ${t.source}` : ''}</div>
                  </div>
                  <div className="amt">
                    <Money v={t.type === 'income' ? t.amount : t.type === 'transfer' ? 0 : -t.amount} sign />
                    {t.currency && t.currency !== baseCurrency() && <div className="s">{t.currency}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!rows.length && <Empty>Không có giao dịch nào khớp.</Empty>}
      </div>

      <button className="fab" onClick={() => setAdding(true)} aria-label="Thêm giao dịch">＋</button>

      {(adding || edit) && (
        <Modal title={edit ? 'Sửa giao dịch' : 'Thêm giao dịch'} onClose={() => { setEdit(null); setAdding(false); }}>
          <Form
            fields={fields}
            initial={edit ? { ...edit, amount: toMajor(edit.amount, edit.currency), category_id: edit.category_id ? String(edit.category_id) : '', account_id: edit.account_id ? String(edit.account_id) : '' } : {}}
            onSubmit={save}
            onCancel={() => { setEdit(null); setAdding(false); }}
          />
          {edit && (
            <div className="between" style={{ marginTop: 12 }}>
              <p className="mini" style={{ margin: 0 }}>💡 Sửa danh mục thì FinMate tự học cho lần sau.</p>
              <button className="btn sm danger" onClick={() => del(edit.id)}>Xoá</button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
