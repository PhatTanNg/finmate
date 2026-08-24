import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, short, vnDate, baseCurrency, toMinor } from '../lib/format.js';

const SAMPLES = {
  'AIB (Ireland)': 'AIB: Your Visa Debit card ending 4321 was used for EUR 45.20 at TESCO IRELAND on 24/08/2026. Available balance EUR 4,120.55',
  'Revolut': 'Revolut: You spent 12.50 EUR at Starbucks. Your new balance is 1,204.30 EUR',
  'Bank of Ireland': 'BOI365: Payment of EUR 1,450.00 to LANDLORD MURPHY from account ending 9876 on 01/08/2026',
  'Vietcombank': 'VCB: 23/08/2026 12:34 TK 0071000123456 -350,000VND. So du: 42,150,000VND. ND: THANH TOAN GRABFOOD',
};

/** Hướng dẫn dựng luồng tự động trên iPhone — nơi app không được phép tự đọc SMS. */
function IphoneGuide({ url, token, pinSet, onRotate }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const full = `${url}?token=${token || ''}`;
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1800); }
    catch { setCopied('lỗi'); }
  };

  return (
    <Card title="📱 Tự động ghi sổ trên iPhone">
      <p className="mini">
        iOS <b>không cho phép</b> bất kỳ app nào tự đọc SMS hay thông báo của app khác — kể cả FinMate.
        Cách chính thống duy nhất là để <b>Shortcuts</b> của Apple chuyển tiếp tin nhắn ngân hàng sang FinMate.
        Làm một lần, sau đó mọi giao dịch tự vào sổ.
      </p>

      <div className="hr" />
      <div className="mini" style={{ fontWeight: 700, marginBottom: 6 }}>Cách 1 — SMS ngân hàng vào thẳng sổ (tự động hoàn toàn)</div>
      <ol className="mini guide-steps">
        <li>Mở app <b>Shortcuts</b> → thẻ <b>Automation</b> → dấu <b>+</b> → <b>Message</b>.</li>
        <li>Ở ô <i>Sender</i> nhập tên/số gửi tin của ngân hàng (ví dụ <code>AIB</code>, <code>Revolut</code>, <code>VCB</code>). Chọn <b>Run Immediately</b> và tắt <i>Notify When Run</i>.</li>
        <li>Thêm hành động <b>Get Contents of URL</b>, dán địa chỉ bên dưới, đặt <i>Method</i> = <b>POST</b>.</li>
        <li>Mở <i>Headers</i>: thêm khoá <code>Content-Type</code> = <code>text/plain</code>.</li>
        <li>Ở <i>Request Body</i> chọn <b>File</b> rồi chèn biến <b>Shortcut Input</b> (chính là nội dung tin nhắn).</li>
        <li>Xong. Mỗi tin nhắn ngân hàng sẽ tự thành một dòng trong sổ, tự phân loại và tự chia vào quỹ.</li>
      </ol>

      <div className="mini" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Cách 2 — chia sẻ thủ công từ mọi nơi</div>
      <p className="mini">
        Tạo Shortcut nhận <i>Share Sheet</i> với cùng hành động trên. Sau đó ở bất kỳ email, thông báo hay
        màn hình giao dịch nào của Revolut/N26/AIB, chỉ cần <b>chọn chữ → Share → FinMate</b> là ghi được sổ.
        Dùng cho các ngân hàng chỉ gửi push notification chứ không gửi SMS.
      </p>

      <div className="note-warn mini">
        ⚠️ Push notification của Revolut/N26 <b>không</b> kích hoạt được Automation của iOS. Với các ngân hàng đó,
        hãy bật email thông báo giao dịch rồi dùng quy tắc chuyển tiếp email, hoặc dùng Cách 2.
      </div>

      <div className="hr" />
      <div className="mini">Địa chỉ POST</div>
      <code className="code-box">{url}</code>
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => copy(url, 'url')}>Chép địa chỉ</button>
        <button className="btn sm" onClick={() => copy(full, 'full')}>Chép kèm token</button>
        <button className="btn sm ghost" onClick={() => setShow((v) => !v)}>{show ? 'Ẩn' : 'Hiện'} token</button>
        <button className="btn sm ghost" onClick={onRotate}>Đổi token</button>
        {copied && <span className="mini up">Đã chép {copied === 'full' ? 'địa chỉ kèm token' : 'địa chỉ'} ✓</span>}
      </div>
      {show && <code className="code-box" style={{ marginTop: 8 }}>{token}</code>}
      <p className="mini" style={{ marginTop: 8 }}>
        {pinSet
          ? <>App đang khoá bằng PIN nên webhook <b>bắt buộc</b> có token. Dùng nút “Chép kèm token”, hoặc thêm header <code>x-finmate-token</code>.</>
          : <>Bạn chưa đặt mã PIN. Hãy đặt PIN trong <b>Cài đặt</b> trước khi mở app ra ngoài mạng nội bộ — khi đó webhook cũng sẽ được bảo vệ bằng token.</>}
      </p>
      <p className="mini">
        Nếu điện thoại ở ngoài mạng nhà, cần một địa chỉ truy cập được từ internet (Tailscale, Cloudflare Tunnel…)
        rồi thay phần <code>localhost</code> bằng địa chỉ đó.
      </p>
    </Card>
  );
}

export default function Automation({ onRefresh }) {
  const [d, setD] = useState(null);
  const [rec, setRec] = useState(null);
  const [sms, setSms] = useState(SAMPLES['AIB (Ireland)']);
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
    try { setSmsResult(await api.post(`/ingest?token=${encodeURIComponent(d.token || '')}`, { text: sms })); load(); onRefresh?.(); }
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

      <IphoneGuide
        url={d.webhook_url}
        token={d.token}
        pinSet={d.pin_set}
        onRotate={async () => { await api.post('/automation/rotate-token'); load(); }}
      />

      <Card title="Ngân hàng đọc được tự động">
        <p className="mini">
          <b>Ireland &amp; châu Âu:</b> AIB, Bank of Ireland, Revolut, N26, Permanent TSB, Wise, Monzo, Starling, An Post, PayPal.
        </p>
        <p className="mini">
          <b>Việt Nam:</b> Vietcombank, Techcombank, BIDV, ACB, MB, VPBank, TPBank, Sacombank, VietinBank, Agribank, MoMo, ZaloPay, ShopeePay, VNPay, Cake, Timo.
        </p>
        <p className="mini">
          Tin nhắn tiếng Anh lẫn tiếng Việt đều đọc được, tự nhận euro/đô/bảng/đồng và tự khớp đúng tài khoản theo đồng tiền.
          Ngân hàng khác vẫn hoạt động nếu tin nhắn có số tiền kèm ký hiệu tiền tệ.
        </p>
      </Card>

      <div className="grid g2">
        <Card title="Thử nhận diện tin nhắn">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.keys(SAMPLES).map((k) => (
              <button key={k} className="btn sm ghost" onClick={() => { setSms(SAMPLES[k]); setSmsResult(null); }}>{k}</button>
            ))}
          </div>
          <textarea className="inp" rows={4} value={sms} onChange={(e) => setSms(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={async () => setSmsResult(await api.post('/ingest/preview', { text: sms }))}>Xem trước</button>
            <button className="btn primary" onClick={testSms}>Ghi sổ thật</button>
          </div>
          {smsResult && (
            <pre className="mini code-box" style={{ marginTop: 10, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
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
                  <td className="acts"><button className="btn sm ghost" onClick={async () => { await api.del(`/recurring/${r.id}`); load(); }}>🗑</button></td>
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
