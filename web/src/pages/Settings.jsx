import React, { useEffect, useState } from 'react';
import { api, setKey, EMBEDDED, saveBlob } from '../lib/api.js';
import { Card, Empty, Loading, Modal, Form } from '../components/ui.jsx';
import { InstallCard } from '../components/Install.jsx';
import SyncCard from '../components/SyncCard.jsx';
import QueueCard from '../components/QueueCard.jsx';
import { fmt, pct, toMinor, baseCurrency } from '../lib/format.js';

/** Che key nhưng vẫn cho thấy đuôi, để biết đang cầm đúng key nào. */
const maskKey = (k) => (k.length > 8 ? `${'•'.repeat(Math.min(k.length - 4, 28))}${k.slice(-4)}` : k);

const RISK = { conservative: 'Thận trọng', balanced: 'Cân bằng', aggressive: 'Mạo hiểm' };
/** Lương gộp/tháng mặc định để thử tính thuế, theo từng nước. */
const DEFAULT_GROSS = { VN: '30000000', IE: '4500' };

export default function Settings({ onRefresh }) {
  const [p, setP] = useState(null);
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [saved, setSaved] = useState(false);
  const [tax, setTax] = useState(null);
  const [gross, setGross] = useState('');
  const [addRule, setAddRule] = useState(false);
  const [auth, setAuth] = useState(null);
  const [backups, setBackups] = useState([]);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [llm, setLlm] = useState(null);
  const [auto, setAuto] = useState(null);
  const [dedupe, setDedupe] = useState(null);   // kết quả xem trước gộp trùng
  const [wipe, setWipe] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [addCat, setAddCat] = useState(false);
  const [env, setEnv] = useState(null);      // bản điện thoại: cấu hình AI lưu trên máy
  const [aiTest, setAiTest] = useState(null); // kết quả bấm "Thử kết nối"
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const fileRef = React.useRef(null);
  const [editCat, setEditCat] = useState(null);
  const loadCats = () => api.get('/categories').then((d) => setCats(d.categories));
  const loadAuto = () => api.get('/ai/autopilot').then(setAuto).catch(() => setAuto(null));
  const setMode = async (che_do) => { setAuto(await api.put('/ai/autopilot', { che_do })); };

  const loadRules = () => api.get('/rules').then((d) => setRules(d.rules));
  const loadAuth = () => api.get('/auth/status').then(setAuth).catch(() => setAuth({ pin_set: false }));
  const loadBackups = () => api.get('/backup/list').then((d) => setBackups(d.backups)).catch(() => setBackups([]));
  useEffect(() => {
    api.get('/profile').then((d) => {
      setP(d.profile);
      const c = (d.profile?.tax_country || d.profile?.country || 'VN').toUpperCase();
      setGross(DEFAULT_GROSS[c] || DEFAULT_GROSS.VN);
    });
    api.get('/categories').then((d) => setCats(d.categories));
    loadRules();
    loadAuth();
    loadBackups();
    api.get('/health').then((d) => setLlm(d.llm)).catch(() => setLlm(null));
    loadAuto();
    if (EMBEDDED) import('../native/boot.js').then((m) => setEnv(m.readEnv()));
  }, []);

  /**
   * Thử một lượt gọi thật tới nhà cung cấp.
   *
   * Cấu hình AI chỉ có hiệu lực sau khi lưu và tải lại (module đọc biến môi
   * trường một lần lúc khởi động). Nên nếu ô nhập đã sửa mà chưa lưu thì phải
   * nói ra — không thì nó thử key CŨ rồi báo "OK", người dùng tưởng key mới
   * chạy được.
   */
  async function testAi() {
    setTesting(true); setAiTest(null);
    // Gửi ĐÚNG thứ đang hiện trên màn hình, không dựa vào cấu hình đã nạp:
    // như vậy khỏi phải lưu và tải lại mới thử được, và kết quả luôn khớp
    // với cái người dùng đang nhìn.
    const body = {
      key: env?.FINMATE_LLM_KEY || '',
      model: env?.FINMATE_LLM_MODEL || '',
      url: env?.FINMATE_LLM_URL || '',
    };
    try { setAiTest((await api.post('/ai/test', body)).ket_qua); }
    catch (e) { setAiTest({ ok: false, error: e.message }); }
    finally { setTesting(false); }
  }

  async function saveEnv() {
    const m = await import('../native/boot.js');
    const clean = Object.fromEntries(Object.entries(env || {}).filter(([, v]) => String(v || '').trim() !== ''));
    const luuDuoc = m.writeEnv(clean);
    // writeEnv đã áp dụng ngay vào tiến trình, nên cấu hình có tác dụng lập
    // tức. Vẫn tải lại để mọi màn hình đọc lại từ đầu — nhưng nếu bộ nhớ
    // trình duyệt không ghi được (chế độ riêng tư, hết dung lượng) thì phải
    // nói thẳng, chứ tải lại là mất sạch key vừa dán.
    if (!luuDuoc) {
      alert('⚠️ Không ghi được vào bộ nhớ trình duyệt (chế độ riêng tư?). Key đang có tác dụng cho phiên này, nhưng đóng app là mất.');
      setAiTest(null);
      return;
    }
    location.reload();
  }
  async function exportDb() {
    const m = await import('../native/boot.js');
    const bytes = m.embedded().exportDb();
    await saveBlob(new Blob([bytes], { type: 'application/x-sqlite3' }), `finmate-${new Date().toISOString().slice(0, 10)}.db`);
  }
  async function importDb(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm(`Thay toàn bộ dữ liệu hiện tại bằng file "${f.name}"? Dữ liệu đang có sẽ mất (nên xuất ra trước).`)) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 6)) !== 'SQLite') { alert('File này không phải cơ sở dữ liệu FinMate (.db).'); return; }
    const m = await import('../native/boot.js');
    await m.embedded().importDb(bytes);
    alert('Đã nhập. App sẽ tải lại.');
    location.reload();
  }
  if (!p) return <Loading />;

  const taxCountry = (p.tax_country || p.country || 'VN').toUpperCase();
  const taxCur = tax?.config?.currency || (taxCountry === 'IE' ? 'EUR' : 'VND');

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
    const code = (p.tax_country || p.country || 'VN').toUpperCase() === 'IE' ? 'EUR' : 'VND';
    setTax(await api.post('/tax/pit', { gross: toMinor(gross, code), dependents: Number(p.dependents) || 0 }));
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

      <div id="cai-app"><InstallCard /></div>

      {EMBEDDED && env && (
        <Card title="Cố vấn AI (bản trên điện thoại)">
          <p className="mini" style={{ marginTop: 0 }}>
            Không có mạng hay không có key thì app vẫn chạy đủ bằng bộ luật. Dán key vào đây để cố vấn AI hiểu câu hỏi tự do, đọc ảnh hoá đơn và tự thao tác.
            Key chỉ lưu trên máy này và gọi thẳng tới nhà cung cấp — không qua máy chủ trung gian nào.
          </p>
          <div className="form">
            <label className="fld full">
              <span>
                API key (Claude <code>sk-ant-…</code> hoặc OpenAI-compatible)
                <button type="button" className="btn sm ghost" style={{ float: 'right', marginTop: -4 }}
                  onClick={() => setShowKey((v) => !v)}>{showKey ? 'Ẩn' : 'Hiện'}</button>
              </span>
              {/* KHÔNG dùng type="password": Safari trên iPhone tự điền mật khẩu
                  đã lưu vào ô đó mà không bắn onChange — người dùng thấy ô đầy
                  dấu chấm còn app thì không có gì trong tay, rồi "Thử kết nối"
                  báo "chưa có API key" một cách khó hiểu. */}
              <input
                className="inp" type="text" inputMode="text" name="finmate-llm-key"
                value={showKey ? (env.FINMATE_LLM_KEY || '') : maskKey(env.FINMATE_LLM_KEY || '')}
                onChange={(e) => setEnv({ ...env, FINMATE_LLM_KEY: e.target.value })}
                onFocus={() => setShowKey(true)}
                placeholder="sk-ant-…"
                autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                style={{ fontFamily: showKey ? 'ui-monospace, monospace' : 'inherit' }}
              /></label>
            <label className="fld"><span>Model</span>
              <input className="inp" value={env.FINMATE_LLM_MODEL || ''} onChange={(e) => setEnv({ ...env, FINMATE_LLM_MODEL: e.target.value })} placeholder="claude-opus-5 / claude-sonnet-5" />
              <small className="mini">Cố vấn phải điều khiển 74 công cụ — <code>claude-sonnet-5</code> là mức nên dùng; <code>claude-haiku-4-5</code> rẻ nhất nhưng hay bỏ bước.</small></label>
            <label className="fld"><span>Độ sâu suy nghĩ (Claude 4.6+; Haiku bỏ qua)</span>
              <select className="inp" value={env.FINMATE_LLM_EFFORT || ''} onChange={(e) => setEnv({ ...env, FINMATE_LLM_EFFORT: e.target.value })}>
                <option value="">Mặc định</option><option value="low">low (nhanh, rẻ)</option><option value="medium">medium</option><option value="high">high</option>
              </select></label>
            <label className="fld full"><span>URL API (bỏ trống nếu dùng Claude/OpenAI chính thức)</span>
              <input className="inp" value={env.FINMATE_LLM_URL || ''} onChange={(e) => setEnv({ ...env, FINMATE_LLM_URL: e.target.value })} placeholder="https://…/v1/chat/completions" /></label>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={saveEnv}>Lưu và tải lại</button>
            <button className="btn" disabled={testing} onClick={testAi}>{testing ? 'Đang thử…' : 'Thử kết nối'}</button>
            {env.FINMATE_LLM_KEY && <button className="btn ghost" onClick={() => { setEnv({ ...env, FINMATE_LLM_KEY: '' }); }}>Gỡ key</button>}
          </div>
          {aiTest && (
            <div className={aiTest.ok ? 'note mini' : 'note-warn mini'} style={{ marginTop: 10 }}>
              {aiTest.ok
                ? (aiTest.dang_dung
                  ? <>✅ Gọi được <b>{aiTest.model}</b> ({aiTest.provider}) · {aiTest.ms}ms · model trả lời: “{aiTest.reply}”. Đây đúng là cấu hình đang chạy — cố vấn AI sẵn sàng.</>
                  : <>
                    ✅ Gọi được <b>{aiTest.model}</b> ({aiTest.provider}) · {aiTest.ms}ms.
                    <div className="note-warn" style={{ marginTop: 8 }}>
                      ⚠️ <b>Nhưng cấu hình này chưa được lưu</b> — Trò chuyện vẫn đang dùng bộ luật.
                      Bấm <b>Lưu và tải lại</b> thì cố vấn AI mới thật sự chạy.
                      <div style={{ marginTop: 8 }}><button className="btn sm primary" onClick={saveEnv}>Lưu và tải lại ngay</button></div>
                    </div>
                  </>)
                : <>❌ Chưa gọi được <b>{aiTest.model || 'model'}</b>{aiTest.provider ? ` (${aiTest.provider})` : ''}.
                  {aiTest.da_luu === false && <div style={{ marginTop: 4 }}>Hiện <b>chưa có key nào được lưu</b> trên máy này.</div>}
                  <div style={{ marginTop: 4 }}><code>{aiTest.error}</code></div>
                  {aiTest.goi_y && <div style={{ marginTop: 6 }}>👉 {aiTest.goi_y}</div>}</>}
            </div>
          )}
        </Card>
      )}

      <QueueCard />

      {EMBEDDED && <SyncCard />}

      {EMBEDDED && (
        <Card title="Dữ liệu trên máy này">
          <p className="mini" style={{ marginTop: 0 }}>
            Toàn bộ sổ sách nằm trong bộ nhớ của trình duyệt/app trên điện thoại này, không gửi đi đâu. Đổi máy hay cài lại thì mang file <code>.db</code> theo.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={exportDb}>Xuất file dữ liệu (.db)</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Nhập file dữ liệu</button>
            <input ref={fileRef} type="file" accept=".db,application/x-sqlite3,application/octet-stream" hidden onChange={importDb} />
          </div>
          <p className="mini" style={{ marginTop: 10 }}>
            ⚠️ Xoá dữ liệu trình duyệt / gỡ app là mất sổ. Hãy xuất file định kỳ vào iCloud Drive / Google Drive.
          </p>
        </Card>
      )}

      {auto && (
        <Card title="Cố vấn tự lái">
          <p className="mini" style={{ marginTop: 0 }}>
            Cố vấn tự nhìn sổ sách mỗi giờ và biến việc cần làm thành đề xuất cụ thể (cân bằng quỹ, đặt khoản định kỳ cho tiền nhà đã lặp ba tháng,
            giãn hạn mục tiêu không kịp, xác nhận danh mục…). Bạn chỉ cần gật trong chat hoặc ở Trang chủ.
          </p>
          <div className="chips" style={{ marginTop: 10 }}>
            {[
              ['off', 'Tắt', 'Chỉ cảnh báo, không đề xuất'],
              ['propose', 'Đề xuất rồi chờ gật', 'Mặc định: hỏi trước mọi việc'],
              ['act', 'Tự làm việc an toàn', 'Việc hoàn tác được thì làm luôn rồi báo; việc còn lại vẫn hỏi'],
            ].map(([k, t, hint]) => (
              <button key={k} className={`chip ${auto.che_do === k ? 'on' : ''}`} title={hint} onClick={() => setMode(k)}>{t}</button>
            ))}
          </div>
          <div className="mini" style={{ marginTop: 8 }}>
            {auto.dang_cho ? `${auto.dang_cho} đề xuất đang chờ bạn.` : 'Không có đề xuất nào đang chờ.'}
            {auto.ban_tin_cuoi ? ` Bản tin sáng gần nhất: ${auto.ban_tin_cuoi}.` : ''}
          </div>
        </Card>
      )}

      {llm && (
        <Card title="Cố vấn AI">
          <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div>
              <b style={{ fontSize: 17 }}>{llm.enabled ? '🧠 Đang chạy AI thật' : '📐 Đang chạy bộ luật tiếng Việt'}</b>
              <div className="mini" style={{ marginTop: 4 }}>
                {llm.enabled
                  ? <>Model <code>{llm.model}</code>. Cố vấn hiểu được câu hỏi tự do, tự gọi công cụ trong app và tự sửa khi gọi sai.</>
                  : <>Mọi tính năng vẫn chạy đủ: ghi chi tiêu, hỏi số liệu, tạo mục tiêu, phân bổ quỹ. Chỉ khác ở chỗ câu hỏi đi lệch khỏi khuôn mẫu thì cố vấn sẽ nói "chưa hiểu ý bạn".</>}
              </div>
            </div>
            <span className={`tag ${llm.enabled ? 'ok' : ''}`}>{llm.enabled ? 'Bật' : 'Tắt'}</span>
          </div>
          {!llm.enabled && (
            <>
              <div className="hr" />
              <div className="mini">
                Muốn bật: chép <code>.env.example</code> thành <code>.env</code>, điền <code>FINMATE_LLM_KEY</code> rồi khởi động lại.
                Dán key Claude (<code>sk-ant-…</code>) là app tự nhận; dùng được cả OpenAI, Groq, OpenRouter — hoặc Ollama chạy ngay trên máy bạn thì <b>miễn phí và số liệu tài chính không rời khỏi máy</b>.
              </div>
            </>
          )}
          {llm.enabled && llm.trang_thai && (() => {
            const t = llm.trang_thai;
            const tk = t.token || {};
            const tongVao = (tk.vao || 0) + (tk.cache_doc || 0) + (tk.cache_ghi || 0);
            const cacheRate = tongVao ? Math.round(((tk.cache_doc || 0) / tongVao) * 100) : 0;
            const fmtK = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
            return (
              <>
                <div className="hr" />
                <div className="grid g4">
                  <div><div className="mini">Nhà cung cấp</div><b>{t.nha_cung_cap === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI-compatible'}</b>
                    {t.nha_cung_cap === 'anthropic' && <div className="mini">suy nghĩ: {t.do_sau_suy_nghi || 'mặc định'}</div>}</div>
                  <div><div className="mini">Lượt gọi từ lúc khởi động</div><b>{t.lan_goi}</b>
                    <div className="mini">{t.lan_loi ? `${t.lan_loi} lỗi · ${t.lan_thu_lai} lần thử lại` : 'không lỗi'}</div></div>
                  <div><div className="mini">Token vào / ra</div><b>{fmtK(tongVao)} / {fmtK(tk.ra)}</b>
                    <div className="mini">{tk.luot || 0} lượt có thống kê</div></div>
                  <div><div className="mini">Bộ đệm prompt trúng</div><b>{cacheRate}%</b>
                    <div className="mini">{tk.cache_doc ? `${fmtK(tk.cache_doc)} token đọc từ đệm` : 'chưa có lượt nào trúng'}</div></div>
                </div>
                {t.loi_gan_nhat && (
                  <div className="note-warn" style={{ marginTop: 10 }}>
                    ⚠️ Lỗi gần nhất{t.loi_luc ? ` (${t.loi_luc.slice(0, 16).replace('T', ' ')})` : ''}: <code>{t.loi_gan_nhat}</code>
                    {t.gan_nhat_ok ? <div className="mini">Lượt mới nhất đã chạy tốt trở lại.</div> : <div className="mini">Lượt mới nhất vẫn lỗi — app đang trả lời bằng bộ luật. Kiểm tra key, tên model hoặc hạn mức.</div>}
                  </div>
                )}
              </>
            );
          })()}
        </Card>
      )}

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
        <Card title={taxCountry === 'IE' ? 'Tính thuế Ireland (gross năm → thực nhận)' : 'Tính thuế TNCN (lương → thực nhận)'}>
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" type="number" value={gross} onChange={(e) => setGross(e.target.value)} />
            <button className="btn" onClick={calcTax}>Tính</button>
          </div>
          <div className="mini" style={{ marginTop: 4 }}>
            {taxCountry === 'IE' ? 'Nhập lương gộp mỗi tháng (EUR) — hệ thống quy ra cả năm theo biểu thuế Ireland.' : 'Nhập lương gộp mỗi tháng (VND).'}
          </div>
          {tax && (
            <>
              <div className="hr" />
              {tax.result.country === 'IE' ? (
                <>
                  <div className="grid g2">
                    <div><div className="mini">Gross/năm</div><b>{fmt(tax.result.gross, taxCur)}</b></div>
                    <div><div className="mini">Thực nhận/năm</div><b className="up">{fmt(tax.result.net, taxCur)}</b></div>
                    <div><div className="mini">Income Tax (PAYE)</div><b className="down">{fmt(tax.result.income_tax, taxCur)}</b></div>
                    <div><div className="mini">USC</div><b className="down">{fmt(tax.result.usc, taxCur)}</b></div>
                    <div><div className="mini">PRSI (4,2%)</div><b className="down">{fmt(tax.result.prsi, taxCur)}</b></div>
                    <div><div className="mini">Thực nhận/tháng</div><b className="up">{fmt(tax.result.monthly_net, taxCur)}</b></div>
                  </div>
                  <div className="mini" style={{ marginTop: 8 }}>
                    Ngưỡng 20% (SRCOP) {fmt(tax.config?.srcop, taxCur)} · tín dụng thuế {fmt(tax.config?.credits, taxCur)}.
                    Thuế suất biên {pct(tax.result.marginal_rate, 0)} · thuế thực tế {pct(tax.result.effective_rate)} · tổng thuế {fmt(tax.result.total_tax, taxCur)}/năm.
                  </div>
                </>
              ) : (
                <>
                  <div className="grid g2">
                    <div><div className="mini">Lương gross</div><b>{fmt(tax.result.gross, taxCur)}</b></div>
                    <div><div className="mini">Thực nhận</div><b className="up">{fmt(tax.result.net, taxCur)}</b></div>
                    <div><div className="mini">Bảo hiểm (10.5%)</div><b className="down">{fmt(tax.result.insurance, taxCur)}</b></div>
                    <div><div className="mini">Thuế TNCN</div><b className="down">{fmt(tax.result.tax, taxCur)}</b></div>
                  </div>
                  <div className="mini" style={{ marginTop: 8 }}>
                    Giảm trừ bản thân {fmt(tax.config?.self_deduction, taxCur)} + {p.dependents || 0} người phụ thuộc × {fmt(tax.config?.dependent_deduction, taxCur)} = {fmt(tax.result.deduction, taxCur)}.
                    Thu nhập tính thuế {fmt(tax.result.taxable, taxCur)} · thuế suất biên {pct(tax.result.marginal_rate, 0)} · thuế thực tế {pct(tax.result.effective_rate)} · cả năm {fmt(tax.result.annual_tax, taxCur)}.
                  </div>
                </>
              )}
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

      <Card title="Danh mục thu chi" right={<button className="btn sm" onClick={() => setAddCat(true)}>+ Danh mục</button>}>
        <p className="mini" style={{ marginTop: 0 }}>Danh mục dùng để phân loại giao dịch và đặt ngân sách. Chạm để đổi tên hoặc icon.</p>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} className="chip" onClick={() => setEditCat(c)} title={c.kind === 'income' ? 'Thu' : 'Chi'}>{c.icon || ''} {c.name}</button>
          ))}
        </div>
      </Card>

      <Card title="Dọn dẹp">
        <p className="mini" style={{ marginTop: 0 }}>Những việc cố vấn AI hay làm giúp — làm tay cũng được, không cần mạng.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {[['muc_tieu', 'mục tiêu'], ['nguon_thu', 'nguồn thu'], ['no', 'khoản nợ'], ['tai_khoan', 'tài khoản'], ['dinh_ky', 'khoản định kỳ']].map(([k, l]) => (
            <button key={k} className="btn ghost sm" onClick={async () => { const r = await api.post('/admin/dedupe', { loai: k, dry_run: true }); setDedupe({ loai: k, label: l, ...r }); }}>Gộp {l} trùng</button>
          ))}
          <button className="btn ghost sm" onClick={async () => { await api.post('/transactions/rebuild'); onRefresh?.(); alert('Đã tính lại số dư từ toàn bộ giao dịch.'); }}>Tính lại số dư tài khoản</button>
          <button className="btn ghost sm" onClick={async () => { await api.post('/networth/snapshot'); onRefresh?.(); alert('Đã lưu mốc tài sản ròng hôm nay.'); }}>Chốt tài sản ròng hôm nay</button>
        </div>
        {dedupe && (
          <div className="note" style={{ marginTop: 10 }}>
            {dedupe.tong_xoa
              ? <>Tìm thấy <b>{dedupe.tong_xoa}</b> bản trùng: {dedupe.ke_hoach.map((k) => `"${k.ten}" ×${k.se_xoa.length + 1}`).join(', ')}. Giữ bản cũ nhất, xoá phần còn lại.
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button className="btn primary sm" onClick={async () => { await api.post('/admin/dedupe', { loai: dedupe.loai, dry_run: false }); setDedupe(null); onRefresh?.(); alert('Đã gộp xong.'); }}>Gộp thật</button>
                    <button className="btn sm" onClick={() => setDedupe(null)}>Thôi</button>
                  </div></>
              : <>Không có {dedupe.label} nào trùng tên. <button className="btn sm ghost" onClick={() => setDedupe(null)}>Đóng</button></>}
          </div>
        )}
      </Card>

      <Card title="Vùng nguy hiểm">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={resetChat}>Xoá lịch sử trò chuyện</button>
          <button className="btn danger" onClick={() => { setWipe(true); setWipeText(''); }}>Xoá sạch dữ liệu, làm lại từ đầu</button>
        </div>
      </Card>

      {wipe && (
        <Modal title="Xoá sạch dữ liệu" onClose={() => setWipe(false)}>
          <p>Việc này <b>không hoàn tác được</b>: mọi giao dịch, tài khoản, quỹ, mục tiêu, nợ, đầu tư, lịch sử chat sẽ bị xoá. App tự chụp một bản sao lưu vào thư mục backups trước khi xoá.</p>
          <p className="mini">Gõ đúng <code>XOA HET</code> để xác nhận:</p>
          <input className="inp" value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder="XOA HET" autoFocus />
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setWipe(false)}>Huỷ</button>
            <button className="btn danger" disabled={wipeText.trim().toUpperCase() !== 'XOA HET'} onClick={async () => {
              try {
                const r = await api.post('/admin/wipe', { confirm: wipeText.trim().toUpperCase(), keep_profile: true });
                setWipe(false); onRefresh?.();
                alert(`Đã xoá sạch. Bản sao lưu: ${r.ban_sao || r.backup || 'đã tạo'}.`);
                location.hash = 'chat'; location.reload();
              } catch (e) { alert(e.message); }
            }}>Xoá sạch</button>
          </div>
        </Modal>
      )}

      {(addCat || editCat) && (
        <Modal title={editCat ? `Sửa danh mục ${editCat.name}` : 'Danh mục mới'} onClose={() => { setAddCat(false); setEditCat(null); }}>
          <Form
            fields={[
              { k: 'name', label: 'Tên', full: true },
              { k: 'icon', label: 'Icon (emoji)' },
              { k: 'kind', label: 'Loại', type: 'select', options: [{ value: 'expense', label: 'Chi' }, { value: 'income', label: 'Thu' }], def: 'expense' },
              { k: 'essential', label: 'Thiết yếu?', type: 'select', options: [{ value: '0', label: 'Không' }, { value: '1', label: 'Có' }], def: '0' },
            ]}
            initial={editCat ? { ...editCat, essential: String(editCat.essential ?? 0) } : {}}
            onSubmit={async (v) => {
              const body = { name: v.name, icon: v.icon, kind: v.kind, essential: Number(v.essential) };
              if (editCat) await api.patch(`/categories/${editCat.id}`, body); else await api.post('/categories', body);
              setAddCat(false); setEditCat(null); loadCats(); onRefresh?.();
            }}
            onCancel={() => { setAddCat(false); setEditCat(null); }}
          />
        </Modal>
      )}

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
