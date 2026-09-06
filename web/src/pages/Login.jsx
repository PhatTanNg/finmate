import React, { useState } from 'react';
import { api, setKey } from '../lib/api.js';

/**
 * Đăng nhập / tạo tài khoản / quên mật khẩu (máy chủ chạy chế độ nhiều người dùng).
 *
 * Khác hẳn màn khoá PIN: PIN chỉ khoá app trên MỘT máy, còn tài khoản là để
 * sổ của bạn theo bạn sang máy khác. Bản chạy thẳng trên điện thoại không có
 * máy chủ nên không bao giờ thấy màn này.
 */
export default function Login({ onDone, canMoi = false, coEmail = false }) {
  const [che, setChe] = useState('vao');       // vao | moi | quen
  const [email, setEmail] = useState('');
  const [matKhau, setMatKhau] = useState('');
  const [ten, setTen] = useState('');
  const [maMoi, setMaMoi] = useState('');
  const [err, setErr] = useState(null);
  const [xong, setXong] = useState(null);
  const [busy, setBusy] = useState(false);

  const doiChe = (c) => { setChe(c); setErr(null); setXong(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (che === 'quen') {
        await api.post('/account/forgot', { email });
        // Câu trả lời cố ý không nói email có tài khoản hay không — nói ra là
        // biếu không cho người lạ cách dò xem ai đang dùng app.
        setXong('Nếu email này có tài khoản, thư hướng dẫn đặt lại mật khẩu vừa được gửi tới. Nhớ xem cả hộp thư rác. Đường dẫn trong thư dùng được một lần.');
        return;
      }
      const r = che === 'moi'
        ? await api.post('/account/register', { email, password: matKhau, name: ten, ...(canMoi ? { code: maMoi } : {}) })
        : await api.post('/account/login', { email, password: matKhau });
      setKey(r.token);
      onDone(r.user);
    } catch (e2) {
      setErr(e2.message);
      setMatKhau('');
    } finally {
      setBusy(false);
    }
  };

  const oInput = { letterSpacing: 0, fontSize: 16, textAlign: 'left' };
  const tieuDe = che === 'moi' ? 'Tạo tài khoản FinMate' : che === 'quen' ? 'Quên mật khẩu' : 'Đăng nhập FinMate';
  const dan = che === 'moi'
    ? 'Sổ của bạn sẽ theo bạn sang mọi thiết bị — điện thoại, máy tính, máy mới.'
    : che === 'quen'
      ? 'Nhập email của bạn. Chúng tôi gửi một đường dẫn để bạn tự đặt mật khẩu mới.'
      : 'Đăng nhập để mở đúng sổ của bạn trên máy này.';

  return (
    <div className="lock">
      <form className="lock-box" onSubmit={submit}>
        <div className="lock-logo">F</div>
        <h1>{tieuDe}</h1>
        <p className="muted">{dan}</p>

        {che === 'moi' && (
          <input
            className="lock-input" style={oInput}
            placeholder="Tên bạn muốn được gọi" value={ten} onChange={(e) => setTen(e.target.value)}
            autoComplete="name" enterKeyHint="next"
          />
        )}
        <input
          className="lock-input" style={oInput}
          type="email" inputMode="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          enterKeyHint="next" required
        />
        {che !== 'quen' && (
          <input
            className="lock-input" style={oInput}
            type="password" placeholder={che === 'moi' ? 'Mật khẩu (ít nhất 8 ký tự)' : 'Mật khẩu'}
            value={matKhau} onChange={(e) => setMatKhau(e.target.value)}
            autoComplete={che === 'moi' ? 'new-password' : 'current-password'}
            enterKeyHint="go" required
          />
        )}

        {che === 'moi' && canMoi && (
          <input
            className="lock-input" style={oInput}
            placeholder="Mã mời" value={maMoi} onChange={(e) => setMaMoi(e.target.value)}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            enterKeyHint="go" required
          />
        )}

        {/* Máy chủ chưa gắn dịch vụ gửi thư thì nói thẳng, đừng để người dùng
            ngồi chờ một lá thư không bao giờ tới. */}
        {che === 'quen' && !coEmail && (
          <p className="lock-err" style={{ textAlign: 'left' }}>
            Máy chủ này <b>chưa gắn dịch vụ gửi email</b> nên không tự gửi được đường dẫn.
            Nhờ người dựng máy chủ chạy lệnh <code>npm run reset-password -w server -- --email {email || 'email-cua-ban'}</code> rồi
            gửi cho bạn đường dẫn hiện ra.
          </p>
        )}

        {err && <p className="lock-err">{err}</p>}
        {xong && <p className="mini" style={{ color: 'var(--ok, #16a34a)' }}>{xong}</p>}

        {!(che === 'quen' && (xong || !coEmail)) && (
          <button className="btn primary" disabled={busy || !email || (che !== 'quen' && !matKhau) || (che === 'moi' && canMoi && !maMoi)}>
            {busy ? 'Đang xử lý…' : che === 'moi' ? 'Tạo tài khoản' : che === 'quen' ? 'Gửi đường dẫn đặt lại' : 'Đăng nhập'}
          </button>
        )}

        {che === 'vao' && (
          <>
            <button type="button" className="btn ghost" onClick={() => doiChe('moi')}>Chưa có tài khoản? Tạo mới</button>
            <button type="button" className="btn ghost" onClick={() => doiChe('quen')}>Quên mật khẩu?</button>
          </>
        )}
        {che !== 'vao' && (
          <button type="button" className="btn ghost" onClick={() => doiChe('vao')}>
            {che === 'moi' ? 'Mình đã có tài khoản — đăng nhập' : 'Quay lại đăng nhập'}
          </button>
        )}

        {che === 'moi' && (
          <p className="mini muted" style={{ marginTop: 4 }}>
            {coEmail
              ? 'Quên mật khẩu vẫn lấy lại được qua email này, nên hãy dùng email bạn thật sự đọc được.'
              : 'Máy chủ này chưa gắn dịch vụ gửi email, nên quên mật khẩu phải nhờ người dựng máy chủ đặt lại giúp.'}{' '}
            Vẫn nên thỉnh thoảng <b>Xuất file dữ liệu</b> trong Cài đặt để giữ một bản của riêng bạn.
          </p>
        )}
      </form>
    </div>
  );
}
