import React, { useEffect, useState } from 'react';
import { api, setKey } from '../lib/api.js';

/**
 * Màn đặt mật khẩu mới, mở từ đường dẫn trong thư (#reset=<vé>).
 *
 * Hỏi máy chủ trước xem vé còn dùng được không: bắt người dùng gõ xong hai ô
 * mật khẩu rồi mới báo "đường dẫn hết hạn" là kiểu hành người dùng không cần
 * thiết, nhất là khi họ đang gõ trên điện thoại.
 */
export default function Reset({ token, onDone, onHuy }) {
  const [trangThai, setTrangThai] = useState('dang-kiem');  // dang-kiem | ok | hong
  const [email, setEmail] = useState(null);
  const [m1, setM1] = useState('');
  const [m2, setM2] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let bo = false;
    api.get(`/account/reset?token=${encodeURIComponent(token)}`)
      .then((r) => { if (bo) return; setTrangThai(r.valid ? 'ok' : 'hong'); setEmail(r.email); })
      .catch(() => { if (!bo) setTrangThai('hong'); });
    return () => { bo = true; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (m1 !== m2) return setErr('Hai lần nhập chưa khớp');
    setBusy(true);
    try {
      const r = await api.post('/account/reset', { token, password: m1 });
      setKey(r.token);
      onDone(r.user);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const oInput = { letterSpacing: 0, fontSize: 16, textAlign: 'left' };

  if (trangThai === 'dang-kiem') {
    return (
      <div className="lock">
        <div className="lock-box"><div className="lock-logo">F</div><p className="muted">Đang kiểm tra đường dẫn…</p></div>
      </div>
    );
  }

  if (trangThai === 'hong') {
    return (
      <div className="lock">
        <div className="lock-box">
          <div className="lock-logo">F</div>
          <h1>Đường dẫn không còn dùng được</h1>
          <p className="muted">
            Đường dẫn đặt lại mật khẩu chỉ dùng được một lần và hết hạn sau một giờ.
            Hãy quay lại và bấm “Quên mật khẩu?” để xin đường dẫn mới.
          </p>
          <button className="btn primary" onClick={onHuy}>Quay lại đăng nhập</button>
        </div>
      </div>
    );
  }

  return (
    <div className="lock">
      <form className="lock-box" onSubmit={submit}>
        <div className="lock-logo">F</div>
        <h1>Đặt mật khẩu mới</h1>
        <p className="muted">Cho tài khoản <b>{email}</b>. Sổ sách của bạn không mất gì cả.</p>
        <input
          className="lock-input" style={oInput} type="password" autoFocus
          placeholder="Mật khẩu mới (ít nhất 8 ký tự)" value={m1} onChange={(e) => setM1(e.target.value)}
          autoComplete="new-password" enterKeyHint="next" required
        />
        <input
          className="lock-input" style={oInput} type="password"
          placeholder="Nhập lại mật khẩu mới" value={m2} onChange={(e) => setM2(e.target.value)}
          autoComplete="new-password" enterKeyHint="go" required
        />
        {err && <p className="lock-err">{err}</p>}
        <button className="btn primary" disabled={busy || m1.length < 8 || !m2}>
          {busy ? 'Đang đặt lại…' : 'Đặt mật khẩu mới và vào app'}
        </button>
        <p className="mini muted">Đặt lại xong, FinMate trên mọi thiết bị khác sẽ phải đăng nhập lại.</p>
        <button type="button" className="btn ghost" onClick={onHuy}>Thôi, quay lại đăng nhập</button>
      </form>
    </div>
  );
}
