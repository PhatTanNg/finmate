import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, getKey } from '../lib/api.js';
import { Md } from '../components/ui.jsx';

const DEFAULT_QUICK = [
  'Tình hình tài chính của mình',
  'Tháng này tiêu bao nhiêu?',
  'Bao giờ mình tự do tài chính?',
  'Mình dư tiền nên làm gì?',
];

/** Tên công cụ -> nhãn ngắn để người dùng thấy AI vừa làm gì trong app. */
const TOOL_LABEL = {
  ghi_giao_dich: '✍️ Đã ghi giao dịch',
  xoa_giao_dich: '🗑️ Đã xoá giao dịch',
  sua_giao_dich: '✏️ Đã sửa giao dịch',
  hoan_tac_gan_nhat: '↩️ Đã hoàn tác',
  hoan_tac: '↩️ Đã hoàn tác',
  tao_tai_khoan: '🏦 Đã thêm tài khoản',
  sua_tai_khoan: '🏦 Đã sửa tài khoản',
  xoa_tai_khoan: '🏦 Đã xoá tài khoản',
  capnhat_so_du: '💰 Đã cập nhật số dư',
  tao_muc_tieu: '🎯 Đã tạo mục tiêu',
  sua_muc_tieu: '🎯 Đã sửa mục tiêu',
  xoa_muc_tieu: '🎯 Đã xoá mục tiêu',
  gop_tien_muc_tieu: '🎯 Đã góp vào mục tiêu',
  dat_ngan_sach: '📊 Đã đặt ngân sách',
  xoa_ngan_sach: '📊 Đã xoá ngân sách',
  dat_phan_bo_quy: '🧺 Đã chia lại quỹ',
  can_bang_phan_bo: '🧺 Đã cân bằng quỹ về 100%',
  chuyen_quy: '🔁 Đã chuyển quỹ',
  tao_quy: '🧺 Đã mở/sửa quỹ',
  dat_muc_tieu_quy: '🧺 Đã đặt mục tiêu quỹ',
  dong_quy: '🧺 Đã đóng quỹ',
  mo_lai_quy: '🧺 Đã mở lại quỹ',
  xoa_quy: '🧺 Đã xoá quỹ',
  them_nguon_thu: '💼 Đã thêm nguồn thu',
  sua_nguon_thu: '💼 Đã sửa nguồn thu',
  xoa_nguon_thu: '💼 Đã xoá nguồn thu',
  them_no: '💳 Đã thêm khoản nợ',
  sua_no: '💳 Đã sửa khoản nợ',
  xoa_no: '💳 Đã xoá khoản nợ',
  tra_no: '💳 Đã ghi trả nợ',
  them_dau_tu: '📈 Đã thêm khoản đầu tư',
  xoa_dau_tu: '📈 Đã xoá khoản đầu tư',
  cap_nhat_gia: '📈 Đã cập nhật giá',
  tao_giao_dich_dinh_ky: '🔁 Đã đặt giao dịch định kỳ',
  sua_dinh_ky: '🔁 Đã sửa khoản định kỳ',
  xoa_dinh_ky: '🔁 Đã xoá khoản định kỳ',
  cap_nhat_ho_so: '👤 Đã cập nhật hồ sơ',
  hoan_tat_thiet_lap: '✅ Đã thiết lập xong',
  ghi_nho: '🧠 Đã ghi nhớ',
  quen_di: '🧠 Đã quên',
  don_trung_lap: '🧹 Đã dọn bản trùng',
  xoa_het_du_lieu: '🗑️ Đã xoá sạch dữ liệu',
};

/** Nhãn hiện lúc AI đang làm — khác thì hiện tên công cụ để người dùng vẫn biết chuyện gì đang xảy ra. */
const DOING = {
  ghi_giao_dich: 'Đang ghi giao dịch', capnhat_so_du: 'Đang cập nhật số dư', tao_tai_khoan: 'Đang mở tài khoản',
  tao_muc_tieu: 'Đang tạo mục tiêu', gop_tien_muc_tieu: 'Đang góp vào mục tiêu', dat_ngan_sach: 'Đang đặt ngân sách',
  dat_phan_bo_quy: 'Đang chia lại quỹ', can_bang_phan_bo: 'Đang cân bằng quỹ', chuyen_quy: 'Đang chuyển quỹ',
  tao_quy: 'Đang mở quỹ', dat_muc_tieu_quy: 'Đang đặt mục tiêu quỹ', dong_quy: 'Đang đóng quỹ',
  them_nguon_thu: 'Đang thêm nguồn thu', them_no: 'Đang thêm khoản nợ', tra_no: 'Đang ghi trả nợ',
  them_dau_tu: 'Đang thêm khoản đầu tư', cap_nhat_gia: 'Đang cập nhật giá', tao_giao_dich_dinh_ky: 'Đang đặt khoản định kỳ',
  cap_nhat_ho_so: 'Đang cập nhật hồ sơ', ghi_nho: 'Đang ghi nhớ', hoan_tac: 'Đang hoàn tác', don_trung_lap: 'Đang dọn bản trùng',
  xem_chi_tieu: 'Đang xem chi tiêu', xem_giao_dich: 'Đang tra giao dịch', xem_tai_san: 'Đang tính tài sản ròng',
  xem_tu_do_tai_chinh: 'Đang tính ngày tự do tài chính', xem_du_bao: 'Đang dự báo dòng tiền', xem_ngan_sach: 'Đang xem ngân sách',
  xem_no: 'Đang xem nợ', xem_dau_tu: 'Đang xem danh mục đầu tư', xem_suc_khoe: 'Đang chấm điểm sức khoẻ tài chính',
  xem_xu_huong: 'Đang xem xu hướng', tu_van_tien_du: 'Đang tính phương án cho tiền dư', xem_ty_gia: 'Đang tra tỷ giá',
  tinh_chuyen_tien: 'Đang tính phí chuyển tiền', tinh_thue: 'Đang tính thuế',
};
const doing = (name, args = {}) => {
  const base = DOING[name] || `Đang chạy ${name}`;
  const bits = [args.so_tien && `${args.so_tien}${args.dong_tien ? ` ${args.dong_tien}` : ''}`, args.mo_ta || args.ten || args.quy || args.muc_tieu || args.tai_khoan || args.danh_muc]
    .filter(Boolean);
  return bits.length ? `${base}: ${bits.join(' · ')}` : base;
};

const THINKING = ['Đang đọc dữ liệu của bạn…', 'Đang tra số liệu…', 'Đang tính toán…', 'Sắp xong rồi…'];

/** Thu nhỏ ảnh trước khi gửi: ảnh chụp điện thoại 4-8MB là thừa cho việc đọc số trên hoá đơn. */
function shrinkImage(file, max = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh này.')); };
    img.src = url;
  });
}

/**
 * Gửi một lượt chat qua luồng SSE, gọi onEvent cho từng bước; trả về payload
 * cuối cùng (y hệt POST /chat). Server cũ hoặc proxy không hỗ trợ luồng thì
 * ném lỗi để nơi gọi lùi về POST /chat thường.
 */
async function streamChat(body, onEvent) {
  const key = getKey();
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-finmate-key': key } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok || !/text\/event-stream/.test(res.headers.get('content-type') || '')) {
    const err = new Error(res.status === 401 ? 'locked' : `Không mở được luồng (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !raw) continue;
      let data = {};
      try { data = JSON.parse(raw); } catch { continue; }
      if (ev === 'done') done = data;
      else if (ev === 'error') throw new Error(data.error || 'Lỗi không rõ');
      else onEvent?.(ev, data);
    }
  }
  if (!done) throw new Error('Luồng kết thúc mà chưa có câu trả lời');
  return done;
}

export default function Chat({ onRefresh }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [steps, setSteps] = useState([]);   // các bước AI đang làm trong lượt hiện tại
  const [quick, setQuick] = useState(DEFAULT_QUICK);
  const [onboarding, setOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shot, setShot] = useState(null);   // ảnh chờ gửi (data URL)
  const [undone, setUndone] = useState({}); // batch -> true khi đã hoàn tác
  const endRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/chat/history').then((d) => {
      setMessages(d.messages || []);
      setOnboarding(!d.profile?.onboarded);
      const last = [...(d.messages || [])].reverse().find((m) => m.role === 'assistant');
      if (last?.data?.quick?.length) setQuick(last.data.quick);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, quick, steps]);

  // Đổi câu trạng thái theo thời gian chờ để người dùng biết AI vẫn đang làm việc.
  useEffect(() => {
    if (!busy) { setPhase(0); return undefined; }
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, THINKING.length - 1)), 2200);
    return () => clearInterval(t);
  }, [busy]);

  function grow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setShot(await shrinkImage(file));
      taRef.current?.focus();
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${err.message}`, id: `e${Date.now()}` }]);
    }
  }

  function onEvent(ev, data) {
    if (ev === 'tool') {
      setSteps((s) => [...s.map((x) => ({ ...x, on: false })), { key: `${data.name}-${Date.now()}`, name: data.name, label: doing(data.name, data.args), on: true }]);
    } else if (ev === 'tool_done') {
      setSteps((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, on: false, ok: data.ok, error: data.error } : x)));
    } else if (ev === 'thinking' && data.step > 0) {
      setSteps((s) => [...s.map((x) => ({ ...x, on: false })), { key: `think-${data.step}`, label: 'Đang soạn câu trả lời…', on: true, think: true }]);
    }
  }

  async function send(msg) {
    const content = (msg ?? text).trim();
    const image = msg == null ? shot : null;
    if ((!content && !image) || busy) return;
    setText('');
    setShot(null);
    if (taRef.current) taRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', content: content || 'Ghi giúp mình giao dịch trong ảnh này.', image, id: `u${Date.now()}` }]);
    setBusy(true);
    setSteps([]);
    try {
      const body = { message: content, ...(image ? { image } : {}) };
      let r;
      try {
        r = await streamChat(body, onEvent);
      } catch (e) {
        // Luồng không mở được (server cũ chưa có /chat/stream, proxy không cho
        // SSE, hay 401 do khoá phiên): dùng đường thường — api.post tự xử lý
        // khoá app khi 401. Còn lỗi phát ra GIỮA luồng là lỗi thật của lượt
        // chat (ảnh sai định dạng…), không gọi lại để khỏi ghi sổ hai lần.
        if (!e.status) throw e;
        r = await api.post('/chat', body);
      }
      setMessages((m) => [...m, {
        role: 'assistant', content: r.reply, id: `a${Date.now()}`,
        data: { tools: r.tools, quick: r.quick, batch: r.batch, mutated: r.refresh, fallback: r.fallback },
      }]);
      setQuick(r.quick?.length ? r.quick : DEFAULT_QUICK);
      setOnboarding(Boolean(r.onboarding));
      if (r.refresh || r.onboarded || r.intent === 'onboarding') onRefresh?.();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Không gửi được: ${e.message}`, id: `e${Date.now()}` }]);
    } finally {
      setBusy(false);
      setSteps([]);
      taRef.current?.focus();
    }
  }

  async function undoBatch(batch) {
    if (!batch || undone[batch]) return;
    if (!window.confirm('Trả lại toàn bộ dữ liệu về trước lượt này? (số dư, quỹ, mục tiêu đều được khôi phục)')) return;
    setUndone((u) => ({ ...u, [batch]: 'busy' }));
    try {
      const r = await api.post('/ai/undo', { batch });
      if (r.ok === false) throw new Error(r.error || 'Không hoàn tác được');
      setUndone((u) => ({ ...u, [batch]: true }));
      setMessages((m) => [...m, { role: 'assistant', content: `↩️ Đã hoàn tác ${r.so_thao_tac_hoan_tac} thao tác của lượt đó. Dữ liệu đã về như trước.`, id: `a${Date.now()}` }]);
      onRefresh?.();
    } catch (e) {
      setUndone((u) => ({ ...u, [batch]: false }));
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, id: `e${Date.now()}` }]);
    }
  }

  async function restart() {
    if (!window.confirm('Bắt đầu lại cuộc trò chuyện? (dữ liệu tài chính vẫn giữ nguyên)')) return;
    await api.post('/chat/reset', { keep_data: true });
    const d = await api.get('/chat/history');
    setMessages(d.messages || []);
    setQuick(DEFAULT_QUICK);
    setOnboarding(!d.profile?.onboarded);
  }

  const hint = useMemo(
    () => (onboarding
      ? 'Đang làm quen — cứ trả lời tự nhiên như nhắn tin nhé.'
      : 'Nhắn tự nhiên: ghi chi tiêu, hỏi số liệu, đặt mục tiêu, xin lời khuyên. Hoặc chụp hoá đơn 📷.'),
    [onboarding],
  );

  return (
    <div className="chat">
      <div className="page-h chat-h">
        <div>
          <h1>Cố vấn tài chính</h1>
          <p>{hint}</p>
        </div>
        <button className="btn sm ghost" onClick={restart} title="Bắt đầu lại cuộc trò chuyện">↻</button>
      </div>

      <div className="chat-scroll">
        {loaded && messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-ic">💬</div>
            <b>Chào bạn!</b>
            <p>Mình là cố vấn tài chính riêng của bạn. Kể mình nghe bạn đang tiêu gì, kiếm được bao nhiêu, hay đang lo điều gì về tiền bạc.</p>
          </div>
        )}

        {messages.map((m) => {
          const acts = (m.data?.tools || []).map((t) => TOOL_LABEL[t]).filter(Boolean);
          const batch = m.data?.batch;
          const canUndo = m.role === 'assistant' && m.data?.mutated && batch;
          const fb = m.data?.fallback;
          return (
            <div key={m.id ?? `${m.role}${m.created_at}${m.content?.slice(0, 8)}`} className={`msg ${m.role}`}>
              <div className="av">{m.role === 'user' ? '🙋' : '🤖'}</div>
              <div className="bub-wrap">
                <div className="bub">
                  {m.image && <img className="shot" src={m.image} alt="ảnh đã gửi" />}
                  <Md text={m.content} />
                </div>
                {(acts.length > 0 || canUndo || fb) && (
                  <div className="acts-done">
                    {[...new Set(acts)].map((a) => <span key={a} className="act-chip">{a}</span>)}
                    {canUndo && (undone[batch] === true
                      ? <span className="act-chip dim">↩️ Đã hoàn tác lượt này</span>
                      : <button className="act-chip undo" disabled={undone[batch] === 'busy'} onClick={() => undoBatch(batch)} title="Trả dữ liệu về trước lượt này">↩️ Hoàn tác lượt này</button>)}
                    {fb && <span className="act-chip warn" title={fb.ly_do || ''}>📐 Bộ luật trả lời — AI không phản hồi được{fb.ly_do ? `: ${String(fb.ly_do).slice(0, 80)}` : ''}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="msg assistant">
            <div className="av">🤖</div>
            <div className="bub-wrap">
              <div className="bub typing"><span /><span /><span /></div>
              {steps.length > 0
                ? (
                  <div className="steps-live">
                    {steps.map((s) => (
                      <div key={s.key} className={`step ${s.on ? 'on' : ''} ${s.ok === false ? 'bad' : ''}`}>
                        {s.on ? '⏳' : s.ok === false ? '⚠️' : s.think ? '💬' : '✅'} {s.label}{s.ok === false && s.error ? ` — ${s.error}` : ''}
                      </div>
                    ))}
                  </div>
                )
                : <div className="think">{THINKING[phase]}</div>}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-foot">
        {!busy && quick?.length > 0 && (
          <div className="quick">
            {quick.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {shot && (
          <div className="pending-shot">
            <img src={shot} alt="ảnh sắp gửi" />
            <span>Ảnh sẽ gửi kèm — nhắn thêm gì đó hoặc bấm gửi luôn.</span>
            <button onClick={() => setShot(null)} aria-label="Bỏ ảnh">✕</button>
          </div>
        )}
        <div className="chat-in">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickImage} />
          <button className={`attach ${shot ? 'on' : ''}`} onClick={() => fileRef.current?.click()} disabled={busy} title="Chụp hoá đơn / ảnh sao kê" aria-label="Gửi ảnh">📷</button>
          <textarea
            ref={taRef}
            className="inp"
            rows={1}
            enterKeyHint="send"
            placeholder={shot ? 'Ghi chú thêm cho ảnh (không bắt buộc)…' : 'Nhắn cho cố vấn của bạn…'}
            value={text}
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send" onClick={() => send()} disabled={busy || (!text.trim() && !shot)} aria-label="Gửi">
            {busy ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
