import React, { useEffect, useState } from 'react';
import { api, setKey } from '../lib/api.js';
import { Card, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { fmt, pct } from '../lib/format.js';

const RISK = { conservative: 'Thận trọng', balanced: 'Cân bằng', aggressive: 'Mạo hiểm' };

export default function Settings({ onRefresh }) {
  const [p, setP] = useState(null);
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [saved, setSaved] = useState(false);
  const [tax, setTax] = useState(null);
  const [gross, setGross] = useState('30000000');
  const [addRule, setAddRule] = useState(false);
  const [auth, setAuth] = useState(null);
  const [backups, setBackups] = useState([]);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');

  const loadRules = () => api.get('/rules').then((d) => setRules(d.rules));
  const loadAuth = () => api.get('/auth/status').then(setAuth).catch(() => setAuth({ pin_set: false }));
  const loadBackups = () => api.get('/backup/list').then((d) => setBackups(d.backups)).catch(() => setBackups([]));
  useEffect(() => {
    api.get('/profile').then((d) => setP(d.profile));
    api.get('/categories').then((d) => setCats(d.categories));
    loadRules();
    loadAuth();
    loadBackups();
  }, []);
  if (!p) return <Loading />;

  async function changePin() {
    try {
      const r = await api.post('/auth/change', { old_pin: oldPin, pin: newPin });
      setKey(r.key);
      setOldPin(''); setNewPin('');
      await loadAuth();
      alert('Đã cập nhật mã PIN.');
    } catch (e) { alert(e.message); }
  }
  async function disablePin() {
    const pin = prompt('Nhập mã PIN hiện tại để tắt khoá:');
    if (pin === null) return;
    try {
      await api.post('/auth/disable', { pin });
      setKey('');
      await loadAuth();
      alert('Đã tắt khoá. Dữ liệu không còn được bảo vệ bằng PIN.');
    } catch (e) { alert(e.message); }
  }
  async function runBackup() {
    try {
      const r = await api.post('/backup/run');
      await loadBackups();
      alert(`Đã sao lưu: ${r.backup.file} (${Math.round(r.backup.size / 1024)} KB)`);
    } catch (e) { alert(e.message); }
  }

  const set = (k, v) => setP({ ...p, [k]: v });
  async function save() {
    const body = { ...p };
    delete body.id; delete body.created_at; delete body.updated_at;
    await api.patch('/profile', body);
    setSaved(true); setTimeout(() => setSaved(false), 2000); onRefresh?.();
  }
  async function calcTax() {
    setTax(await api.post('/tax/pit', { gross: Number(gross), dependents: Number(p.dependents) || 0 }));
  }
  async function resetChat() {
    if (!confirm('Xoá toàn bộ lịch sử trò chuyện và bắt đầu lại từ đầu?')) return;
    await api.post('/chat/reset'); onRefresh?.();
    alert('Đã xoá. Mở tab Trò chuyện để bắt đầu lại.');
  }

  const N = ({ k, label, step = 1, suffix }) => (
    <label className="fld">
      <span>{label}</span>
      <div className="row" style={{ gap: 6 }}>
        <input className="inp" type="number" step={step} value={p[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />
        {suffix && <span className="mini" style={{ whiteSpace: 'nowrap' }}>{suffix}</span>}
      </div>
    </label>
  );

  return (
    <>
      <div className="page-h">
        <div><h1>Cài đặt</h1><p>Hồ sơ cá nhân quyết định mọi con số cố vấn đưa ra</p></div>
        <button className="btn primary" onClick={save}>{saved ? '✅ Đã lưu' : 'Lưu thay đổi'}</button>
      </div>

      <div className="grid g2">
        <Card title="Hồ sơ">
          <div className="form">
            <label className="fld full"><span>Tên gọi</span><input className="inp" value={p.name || ''} onChange={(e) => set('name', e.target.value)} /></label>
            <N k="birth_year" label="Năm sinh" />
            <label className="fld"><span>Thành phố</span><input className="inp" value={p.city || ''} onChange={(e) => set('city', e.target.value)} /></label>
            <N k="dependents" label="Số người phụ thuộc" />
            <label className="fld"><span>Tình trạng</span>
              <select className="inp" value={p.marital_status || ''} onChange={(e) => set('marital_status', e.target.value)}>
                <option value="">—</option><option value="single">Độc thân</option><option value="married">Đã kết hôn</option>
              </select>
            </label>
            <label className="fld full"><span>Phong cách sống / ưu tiên</span>
              <textarea className="inp" rows={2} value={p.lifestyle || ''} onChange={(e) => set('lifestyle', e.target.value)} placeholder="VD: thích du lịch 2 lần/năm, ăn ngoài nhiều, muốn nghỉ hưu sớm ở Đà Lạt..." />
            </label>
          </div>
        </Card>

        <Card title="Giả định tài chính">
          <div className="form">
            <label className="fld"><span>Khẩu vị rủi ro</span>
              <select className="inp" value={p.risk_profile || 'balanced'} onChange={(e) => set('risk_profile', e.target.value)}>
                {Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <N k="retire_age_target" label="Tuổi muốn tự do tài chính" />
            <N k="swr" label="Tỷ lệ rút an toàn" step={0.005} suffix={pct(p.swr)} />
            <N k="expected_return" label="Lợi suất kỳ vọng/năm" step={0.005} suffix={pct(p.expected_return)} />
            <N k="inflation" label="Lạm phát giả định" step={0.005} suffix={pct(p.inflation)} />
            <N k="savings_rate_target" label="Tỷ lệ tiết kiệm mục tiêu" step={0.05} suffix={pct(p.savings_rate_target)} />
            <N k="emergency_months_target" label="Quỹ khẩn cấp (tháng)" step={0.5} />
          </div>
          <div className="mini" style={{ marginTop: 8 }}>Đây là các tham số dùng để tính ngày tự do tài chính, số tiền cần tích luỹ và mức an toàn chi tiêu.</div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Tính thuế TNCN (lương → thực nhận)">
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" type="number" value={gross} onChange={(e) => setGross(e.target.value)} />
            <button className="btn" onClick={calcTax}>Tính</button>
          </div>
          {tax && (
            <>
              <div className="hr" />
              <div className="grid g2">
                <div><div className="mini">Lương gross</div><b>{fmt(tax.result.gross)}</b></div>
                <div><div className="mini">Thực nhận</div><b className="up">{fmt(tax.result.net)}</b></div>
                <div><div className="mini">Bảo hiểm (10.5%)</div><b className="down">{fmt(tax.result.insurance)}</b></div>
                <div><div className="mini">Thuế TNCN</div><b className="down">{fmt(tax.result.tax)}</b></div>
              </div>
              <div className="mini" style={{ marginTop: 8 }}>
                Giảm trừ bản thân {fmt(tax.config?.self_deduction)} + {p.dependents || 0} người phụ thuộc × {fmt(tax.config?.dependent_deduction)} = {fmt(tax.result.deduction)}.
                Thu nhập tính thuế {fmt(tax.result.taxable)} · thuế suất biên {pct(tax.result.marginal_rate, 0)} · thuế thực tế {pct(tax.result.effective_rate)} · cả năm {fmt(tax.result.annual_tax)}.
              </div>
            </>
          )}
        </Card>

        <Card title="Luật tự phân loại" right={<button className="btn sm" onClick={() => setAddRule(true)}>+ Thêm</button>}>
          <p className="mini">Khi nội dung giao dịch chứa từ khoá, FinMate sẽ tự gán đúng danh mục — không cần sửa tay lần sau.</p>
          <div className="list">
            {rules.map((r) => (
              <div key={r.id} className="item" style={{ padding: '8px 0' }}>
                <div className="ic">🔎</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">"{r.pattern}"</div>
                  <div className="s">→ {r.category_name || 'không đổi'} · ưu tiên {r.priority} · đã khớp {r.hits || 0} lần</div>
                </div>
                <button className="btn sm ghost" onClick={async () => { await api.del(`/rules/${r.id}`); loadRules(); }}>🗑</button>
              </div>
            ))}
            {!rules.length && <Empty>Chưa có luật nào.</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Bảo mật">
          <p className="mini">Mã PIN khoá toàn bộ dữ liệu tài chính. Bắt buộc nếu bạn mở app ra mạng LAN để dùng từ điện thoại.</p>
          <div className="hr" />
          {auth?.pin_set ? (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="pill ok">🔐 Đang bật</span>
                <span className="mini">App sẽ khoá lại khi bạn bấm "Khoá app" hoặc server khởi động lại.</span>
              </div>
              <div className="form" style={{ marginTop: 10 }}>
                <label className="fld"><span>Mã PIN hiện tại</span><input className="inp" type="password" value={oldPin} onChange={(e) => setOldPin(e.target.value)} /></label>
                <label className="fld"><span>Mã PIN mới</span><input className="inp" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} /></label>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={changePin} disabled={newPin.length < 4}>Đổi mã PIN</button>
                <button className="btn ghost" onClick={disablePin}>Tắt khoá</button>
              </div>
            </>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="pill warn">🔓 Chưa đặt</span>
                <span className="mini">Bất kỳ ai mở được máy này đều xem được toàn bộ số liệu.</span>
              </div>
              <div className="form" style={{ marginTop: 10 }}>
                <label className="fld"><span>Đặt mã PIN (≥ 4 ký tự)</span><input className="inp" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} /></label>
              </div>
              <button className="btn primary" style={{ marginTop: 10 }} onClick={changePin} disabled={newPin.length < 4}>Bật khoá</button>
            </>
          )}
        </Card>

        <Card title="Sao lưu dữ liệu" right={<button className="btn sm" onClick={runBackup}>Sao lưu ngay</button>}>
          <p className="mini">FinMate tự sao lưu mỗi ngày vào thư mục <code>server/data/backups</code> (giữ 14 bản gần nhất). Nên copy định kỳ sang ổ khác hoặc cloud.</p>
          <div className="row" style={{ gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => api.download('/backup/download', `finmate-${new Date().toISOString().slice(0, 10)}.db`)}>⬇ Tải file dữ liệu</button>
            <button className="btn ghost" onClick={() => api.download('/export', `finmate-${new Date().toISOString().slice(0, 10)}.json`)}>⬇ Xuất JSON</button>
          </div>
          <div className="list">
            {backups.slice(0, 5).map((b) => (
              <div key={b.file} className="item" style={{ padding: '6px 0' }}>
                <div className="ic">💾</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{b.file}</div>
                  <div className="s">{Math.round(b.size / 1024)} KB · {new Date(b.created_at).toLocaleString('vi-VN')}</div>
                </div>
              </div>
            ))}
            {!backups.length && <Empty>Chưa có bản sao lưu nào.</Empty>}
          </div>
        </Card>
      </div>

      <Card title="Vùng nguy hiểm">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={resetChat}>Xoá lịch sử trò chuyện</button>
          <button className="btn ghost" onClick={async () => { await api.post('/transactions/rebuild'); onRefresh?.(); alert('Đã tính lại số dư từ toàn bộ giao dịch.'); }}>Tính lại số dư tài khoản</button>
          <button className="btn ghost" onClick={async () => { await api.post('/networth/snapshot'); onRefresh?.(); alert('Đã lưu mốc tài sản ròng hôm nay.'); }}>Chốt tài sản ròng hôm nay</button>
        </div>
      </Card>

      {addRule && (
        <Modal title="Thêm luật phân loại" onClose={() => setAddRule(false)}>
          <Form
            fields={[
              { k: 'pattern', label: 'Từ khoá trong nội dung', ph: 'grabfood', full: true },
              { k: 'category_id', label: 'Gán danh mục', type: 'select', options: cats.map((c) => ({ value: String(c.id), label: `${c.icon || ''} ${c.name}` })) },
              { k: 'priority', label: 'Ưu tiên', type: 'number', def: 10 },
            ]}
            onSubmit={async (v) => {
              await api.post('/rules', { name: v.pattern, pattern: v.pattern, match_type: 'contains', match_field: 'text', category_id: Number(v.category_id), priority: Number(v.priority) || 10, active: 1 });
              setAddRule(false); loadRules();
            }}
            onCancel={() => setAddRule(false)}
          />
        </Modal>
      )}
    </>
  );
}
