import React, { useState } from 'react';
import { api, setKey } from '../lib/api.js';

/**
 * Đăng nhập / tạo tài khoản (máy chủ chạy chế độ nhiều người dùng).
 *
 * Khác hẳn màn khoá PIN: PIN chỉ khoá app trên MỘT máy, còn tài khoản là để
 * sổ của bạn theo bạn sang máy khác. Bản chạy thẳng trên điện thoại không có
 * máy chủ nên không bao giờ thấy màn này.
 */
export default function Login({ onDone, canMoi = false }) {
  const [dangKy, setDangKy] = useState(false);
  const [email, setEmail] = useState('');
  const [matKhau, setMatKhau] = useState('');
  const [ten, setTen] = useState('');
  const [maMoi, setMaMoi] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = dangKy
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

  return (
    <div className="lock">
      <form className="lock-box" onSubmit={submit}>
        <div className="lock-logo">F</div>
        <h1>{dangKy ? 'Tạo tài khoản FinMate' : 'Đăng nhập FinMate'}</h1>
        <p className="muted">
          {dangKy
            ? 'Sổ của bạn sẽ theo bạn sang mọi thiết bị — điện thoại, máy tính, máy mới.'
            : 'Đăng nhập để mở đúng sổ của bạn trên máy này.'}
        </p>

        {dangKy && (
          <input
            className="lock-input" style={{ letterSpacing: 0, fontSize: 16, textAlign: 'left' }}
            placeholder="Tên bạn muốn được gọi" value={ten} onChange={(e) => setTen(e.target.value)}
            autoComplete="name" enterKeyHint="next"
          />
        )}
        <input
          className="lock-input" style={{ letterSpacing: 0, fontSize: 16, textAlign: 'left' }}
          type="email" inputMode="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          enterKeyHint="next" required
        />
        <input
          className="lock-input" style={{ letterSpacing: 0, fontSize: 16, textAlign: 'left' }}
          type="password" placeholder={dangKy ? 'Mật khẩu (ít nhất 8 ký tự)' : 'Mật khẩu'}
          value={matKhau} onChange={(e) => setMatKhau(e.target.value)}
          autoComplete={dangKy ? 'new-password' : 'current-password'}
          enterKeyHint="go" required
        />

        {dangKy && canMoi && (
          <input
            className="lock-input" style={{ letterSpacing: 0, fontSize: 16, textAlign: 'left' }}
            placeholder="Mã mời" value={maMoi} onChange={(e) => setMaMoi(e.target.value)}
            autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            enterKeyHint="go" required
          />
        )}

        {err && <p className="lock-err">{err}</p>}
        <button className="btn primary" disabled={busy || !email || !matKhau || (dangKy && canMoi && !maMoi)}>
          {busy ? 'Đang xử lý…' : dangKy ? 'Tạo tài khoản' : 'Đăng nhập'}
        </button>
        <button
          type="button" className="btn ghost"
          onClick={() => { setDangKy((v) => !v); setErr(null); }}
        >
          {dangKy ? 'Mình đã có tài khoản — đăng nhập' : 'Chưa có tài khoản? Tạo mới'}
        </button>
        {dangKy && (
          <p className="mini muted" style={{ marginTop: 4 }}>
            Nhớ kỹ mật khẩu nhé — hiện <b>chưa có chức năng đặt lại qua email</b>.
            Vẫn nên thỉnh thoảng <b>Xuất file dữ liệu</b> trong Cài đặt để giữ một bản của riêng bạn.
          </p>
        )}
      </form>
    </div>
  );
}
