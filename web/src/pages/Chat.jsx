import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
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
  hoan_tac_gan_nhat: '↩️ Đã hoàn tác',
  tao_tai_khoan: '🏦 Đã thêm tài khoản',
  capnhat_so_du: '💰 Đã cập nhật số dư',
  tao_muc_tieu: '🎯 Đã tạo mục tiêu',
  gop_tien_muc_tieu: '🎯 Đã góp vào mục tiêu',
  dat_ngan_sach: '📊 Đã đặt ngân sách',
  dat_phan_bo_quy: '🧺 Đã chia lại quỹ',
  chuyen_quy: '🔁 Đã chuyển quỹ',
  them_nguon_thu: '💼 Đã thêm nguồn thu',
  them_no: '💳 Đã thêm khoản nợ',
  tra_no: '💳 Đã ghi trả nợ',
  them_dau_tu: '📈 Đã thêm khoản đầu tư',
  cap_nhat_gia: '📈 Đã cập nhật giá',
  tao_giao_dich_dinh_ky: '🔁 Đã đặt giao dịch định kỳ',
  cap_nhat_ho_so: '👤 Đã cập nhật hồ sơ',
  hoan_tat_thiet_lap: '✅ Đã thiết lập xong',
};

const THINKING = ['Đang đọc dữ liệu của bạn…', 'Đang tra số liệu…', 'Đang tính toán…', 'Sắp xong rồi…'];

export default function Chat({ onRefresh }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [quick, setQuick] = useState(DEFAULT_QUICK);
  const [onboarding, setOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    api.get('/chat/history').then((d) => {
      setMessages(d.messages || []);
      setOnboarding(!d.profile?.onboarded);
      const last = [...(d.messages || [])].reverse().find((m) => m.role === 'assistant');
      if (last?.data?.quick?.length) setQuick(last.data.quick);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, quick]);

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

  async function send(msg) {
    const content = (msg ?? text).trim();
    if (!content || busy) return;
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', content, id: `u${Date.now()}` }]);
    setBusy(true);
    try {
      const r = await api.post('/chat', { message: content });
      setMessages((m) => [...m, {
        role: 'assistant', content: r.reply, id: `a${Date.now()}`,
        data: { tools: r.tools, quick: r.quick },
      }]);
      setQuick(r.quick?.length ? r.quick : DEFAULT_QUICK);
      setOnboarding(Boolean(r.onboarding));
      if (r.refresh || r.onboarded || r.intent === 'onboarding') onRefresh?.();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Không gửi được: ${e.message}`, id: `e${Date.now()}` }]);
    } finally {
      setBusy(false);
      taRef.current?.focus();
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
      : 'Nhắn tự nhiên: ghi chi tiêu, hỏi số liệu, đặt mục tiêu, xin lời khuyên.'),
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
          return (
            <div key={m.id ?? `${m.role}${m.created_at}${m.content?.slice(0, 8)}`} className={`msg ${m.role}`}>
              <div className="av">{m.role === 'user' ? '🙋' : '🤖'}</div>
              <div className="bub-wrap">
                <div className="bub"><Md text={m.content} /></div>
                {acts.length > 0 && (
                  <div className="acts-done">
                    {[...new Set(acts)].map((a) => <span key={a} className="act-chip">{a}</span>)}
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
              <div className="think">{THINKING[phase]}</div>
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
        <div className="chat-in">
          <textarea
            ref={taRef}
            className="inp"
            rows={1}
            enterKeyHint="send"
            placeholder="Nhắn cho cố vấn của bạn…"
            value={text}
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Gửi">
            {busy ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
