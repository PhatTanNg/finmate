import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, short, vnDate, baseCurrency, toMinor } from '../lib/format.js';

const SAMPLE = 'VCB: 23/08/2026 12:34 TK 0071000123456 -350,000VND. So du: 42,150,000VND. ND: THANH TOAN GRABFOOD';

export default function Automation({ onRefresh }) {
  const [d, setD] = useState(null);
  const [rec, setRec] = useState(null);
  const [sms, setSms] = useState(SAMPLE);
  const [smsResult, setSmsResult] = useState(null);
  const [csv, setCsv] = useState('');
  const [csvResult, setCsvResult] = useState(null);
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/recurring').then((r) => setRec(r));
    api.get('/automation/status').then(setD);
  };
  useEffect(() => {
    load();
    api.get('/categories').then((r) => setCats(r.categories));
    api.get('/accounts').then((r) => setAccounts(r.accounts));
  }, []);
  if (!d || !rec) return <Loading />;

  async function runNow() {
    setBusy(true);
    await api.post('/automation/run');
    load(); onRefresh?.(); setBusy(false);
  }
  async function testSms() {
    try { setSmsResult(await api.post('/ingest', { text: sms })); load(); onRefresh?.(); }
    catch (e) { setSmsResult({ error: e.message }); }
  }
  async function importCsv(dry) {
    try { setCsvResult(await api.post('/ingest/csv', { csv, dry_run: dry })); if (!dry) onRefresh?.(); }
    catch (e) { setCsvResult({ error: e.message }); }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Tự động hoá</h1><p>Để app tự ghi sổ — bạn không phải nhập tay</p></div>
        <button className="btn primary" onClick={runNow} disabled={busy}>{busy ? 'Đang chạy...' : '▶ Chạy engine ngay'}</button>
      </div>

      <div className="grid g3">
        <Stat label="Khoản định kỳ" value={rec.recurring?.length || 0} sub={`${rec.recurring?.filter((r) => r.auto_post).length || 0} tự động ghi sổ`} />
        <Stat label="Chi phí cố định/tháng" value={short(rec.monthly_fixed?.expense)} sub={`Thu định kỳ ${short(rec.monthly_fixed?.income)}`} />
        <Stat label="Lần chạy gần nhất" value={d.last_run ? new Date(d.last_run).toLocaleTimeString('vi-VN') : '—'} sub={d.last_run ? vnDate(d.last_run.slice(0, 10)) : 'Chưa chạy'} />
      </div>

      <Card title="Kết nối tự động — không cần nhập tay">
        <p className="mini">
          FinMate nhận giao dịch qua webhook. Dùng <b>iOS Shortcuts</b> (Automation → Message Received),
          <b> MacroDroid/Tasker</b> (Android) hoặc bộ lọc email để forward SMS/thông báo ngân hàng tới địa chỉ dưới đây.
          App sẽ tự đọc số tiền, ngày, nội dung, tự phân loại và tự chia vào quỹ.
        </p>
        <div className="hr" />
        <div className="mini">Endpoint POST</div>
        <code style={{ display: 'block', padding: 10, marginTop: 6, background: 'rgba(0,0,0,.35)', borderRadius: 8, wordBreak: 'break-all' }}>{d.webhook_url}</code>
        <div className="mini" style={{ marginTop: 8 }}>Body: <code>{'{ "text": "<nội dung SMS>" }'}</code> hoặc gửi thẳng text/plain. Hỗ trợ VCB, Techcombank, BIDV, ACB, MB, VPBank, TPBank, Sacombank, VIB, HDBank, SHB, Agribank, MoMo, ZaloPay, ShopeePay, VNPay.</div>
      </Card>

      <div className="grid g2">
        <Card title="Thử nhận diện SMS">
          <textarea className="inp" rows={4} value={sms} onChange={(e) => setSms(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={async () => setSmsResult(await api.post('/ingest/preview', { text: sms }))}>Xem trước</button>
            <button className="btn primary" onClick={testSms}>Ghi sổ thật</button>
          </div>
          {smsResult && (
            <pre className="mini" style={{ marginTop: 10, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.3)', padding: 10, borderRadius: 8, maxHeight: 220, overflow: 'auto' }}>
              {JSON.stringify(smsResult.parsed ?? smsResult, null, 1)}
            </pre>
          )}
        </Card>

        <Card title="Nhập sao kê CSV">
          <p className="mini">Dán nội dung file CSV sao kê ngân hàng. FinMate tự dò cột ngày / nội dung / số tiền và bỏ qua giao dịch trùng.</p>
          <textarea className="inp" rows={5} placeholder={'Ngay,Noi dung,So tien\n01/03/2026,Mua sam Shopee,-450000'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => importCsv(true)}>Xem trước</button>
            <button className="btn primary" onClick={() => importCsv(false)} disabled={!csv.trim()}>Nhập</button>
          </div>
          {csvResult && (
            <div className="mini" style={{ marginTop: 10 }}>
              {csvResult.error ? <span className="down">{csvResult.error}</span> : (
                <>Đọc được <b>{csvResult.items?.length || 0}</b> dòng · đã nhập <b>{csvResult.imported}</b> · trùng {csvResult.duplicates} · lỗi {csvResult.errors?.length || 0}</>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Khoản định kỳ (tự ghi sổ đúng ngày)" right={<button className="btn sm" onClick={() => setAdding(true)}>+ Thêm</button>}>
        <div className="scrollx">
          <table>
            <thead><tr><th>Tên</th><th>Loại</th><th>Chu kỳ</th><th>Lần kế tiếp</th><th className="num">Số tiền</th><th>Tự động</th><th></th></tr></thead>
            <tbody>
              {(rec.recurring || []).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td><span className={`tag ${r.type === 'income' ? 'ok' : ''}`}>{r.type === 'income' ? 'Thu' : 'Chi'}</span></td>
                  <td className="mini">{{ monthly: 'Hàng tháng', weekly: 'Hàng tuần', daily: 'Hàng ngày', yearly: 'Hàng năm', quarterly: 'Hàng quý' }[r.frequency] || r.frequency}</td>
                  <td className="mini">{vnDate(r.next_date)}</td>
                  <td className="num">{fmt(r.amount)}</td>
                  <td>{r.auto_post ? '✅' : '—'}</td>
                  <td className="num"><button className="btn sm ghost" onClick={async () => { await api.del(`/recurring/${r.id}`); load(); }}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rec.recurring?.length && <Empty>Chưa có khoản định kỳ nào.</Empty>}
      </Card>

      <Card title="Nhật ký nhận dữ liệu">
        <div className="list">
          {(d.log || []).map((l) => (
            <div key={l.id} className="item" style={{ padding: '8px 0' }}>
              <div className="ic">{l.status === 'created' ? '✅' : l.status === 'duplicate' ? '♻️' : '⚠️'}</div>
              <div style={{ minWidth: 0 }}>
                <div className="t" style={{ fontSize: 13 }}>{l.message}</div>
                <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.payload}</div>
              </div>
              <span className="tag">{l.channel}</span>
            </div>
          ))}
          {!d.log?.length && <Empty>Chưa nhận tin nhắn nào. Thử dán một SMS ở khung bên trên.</Empty>}
        </div>
      </Card>

      {adding && (
        <Modal title="Thêm khoản định kỳ" onClose={() => setAdding(false)}>
          <Form
            fields={[
              { k: 'name', label: 'Tên', ph: 'Tiền thuê nhà', full: true },
              { k: 'type', label: 'Loại', type: 'select', options: [{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }], def: 'expense' },
              { k: 'amount', label: `Số tiền (${baseCurrency()})`, type: 'number' },
              { k: 'frequency', label: 'Chu kỳ', type: 'select', options: [{ value: 'monthly', label: 'Hàng tháng' }, { value: 'weekly', label: 'Hàng tuần' }, { value: 'daily', label: 'Hàng ngày' }, { value: 'quarterly', label: 'Hàng quý' }, { value: 'yearly', label: 'Hàng năm' }], def: 'monthly' },
              { k: 'day_of_month', label: 'Ngày trong tháng', type: 'number', def: 1 },
              { k: 'account_id', label: 'Tài khoản', type: 'select', options: [{ value: '', label: '— Mặc định —' }, ...accounts.map((a) => ({ value: String(a.id), label: a.name }))] },
              { k: 'category_id', label: 'Danh mục', type: 'select', options: [{ value: '', label: '— Tự phân loại —' }, ...cats.map((c) => ({ value: String(c.id), label: `${c.icon || ''} ${c.name}` }))] },
            ]}
            onSubmit={async (v) => {
              await api.post('/recurring', { ...v, amount: toMinor(v.amount), currency: baseCurrency(), day_of_month: Number(v.day_of_month) || 1, account_id: v.account_id ? Number(v.account_id) : null, category_id: v.category_id ? Number(v.category_id) : null, auto_post: 1, active: 1, start_date: new Date().toISOString().slice(0, 10) });
              setAdding(false); load(); onRefresh?.();
            }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}
    </>
  );
}
