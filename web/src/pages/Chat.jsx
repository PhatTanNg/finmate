import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Md } from '../components/ui.jsx';

const DEFAULT_QUICK = [
  'Tình hình tài chính của mình',
  'Tháng này tiêu bao nhiêu?',
  'Bao giờ mình tự do tài chính?',
  'Mình dư tiền nên làm gì?',
];

export default function Chat({ onRefresh }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(DEFAULT_QUICK);
  const [onboarding, setOnboarding] = useState(false);
  const endRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    api.get('/chat/history').then((d) => {
      setMessages(d.messages || []);
      setOnboarding(!d.profile?.onboarded);
      const last = [...(d.messages || [])].reverse().find((m) => m.role === 'assistant');
      if (last?.data?.quick?.length) setQuick(last.data.quick);
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(msg) {
    const content = (msg ?? text).trim();
    if (!content || busy) return;
    setText('');
    setMessages((m) => [...m, { role: 'user', content, id: `u${Date.now()}` }]);
    setBusy(true);
    try {
      const r = await api.post('/chat', { message: content });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, id: `a${Date.now()}` }]);
      setQuick(r.quick?.length ? r.quick : DEFAULT_QUICK);
      setOnboarding(Boolean(r.onboarding));
      if (r.refresh || r.onboarded || r.intent === 'onboarding') onRefresh?.();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Lỗi: ${e.message}`, id: `e${Date.now()}` }]);
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  async function restart() {
    if (!confirm('Bắt đầu lại cuộc trò chuyện? (dữ liệu tài chính vẫn giữ nguyên)')) return;
    await api.post('/chat/reset', { keep_data: true });
    const d = await api.get('/chat/history');
    setMessages(d.messages || []);
    setQuick(DEFAULT_QUICK);
  }

  return (
    <div className="chat">
      <div className="page-h">
        <div>
          <h1>Cố vấn tài chính</h1>
          <p>{onboarding ? 'Đang thiết lập hồ sơ — trả lời tự nhiên như nhắn tin nhé.' : 'Nhắn tự nhiên: ghi chi tiêu, hỏi số liệu, đặt mục tiêu, xin lời khuyên.'}</p>
        </div>
        <button className="btn sm ghost" onClick={restart}>↻ Trò chuyện mới</button>
      </div>

      <div className="chat-scroll">
        {messages.map((m) => (
          <div key={m.id ?? `${m.role}${m.created_at}${m.content?.slice(0, 8)}`} className={`msg ${m.role}`}>
            <div className="av">{m.role === 'user' ? '🙋' : '🤖'}</div>
            <div className="bub"><Md text={m.content} /></div>
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="av">🤖</div>
            <div className="bub typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

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
          placeholder='Ví dụ: "trưa nay ăn 65k", "nhận lương 30 triệu", "bao giờ mình mua được nhà?"'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn primary" onClick={() => send()} disabled={busy || !text.trim()}>Gửi</button>
      </div>
    </div>
  );
}
