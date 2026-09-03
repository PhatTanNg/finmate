import React, { useState } from 'react';
import { api, setKey } from '../lib/api.js';

/** Màn hình khoá: đặt PIN lần đầu hoặc mở khoá. */
export default function Lock({ pinSet, onUnlock }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!pinSet && pin !== pin2) return setErr('Hai lần nhập chưa khớp');
    setBusy(true);
    try {
      const r = pinSet ? await api.post('/auth/login', { pin }) : await api.post('/auth/setup', { pin });
      setKey(r.key);
      onUnlock();
    } catch (e2) {
      setErr(e2.message);
      setPin('');
      setPin2('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <form className="lock-box" onSubmit={submit}>
        <div className="lock-logo">F</div>
        <h1>FinMate</h1>
        <p className="muted">
          {pinSet ? 'Nhập mã PIN để mở khoá dữ liệu tài chính của bạn.' : 'Đặt mã PIN để bảo vệ dữ liệu tài chính. Chỉ lưu trên máy này.'}
        </p>
        <input
          className="lock-input"
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Mã PIN (tối thiểu 4 ký tự)"
        />
        {!pinSet && (
          <input
            className="lock-input"
            type="password"
            inputMode="numeric"
            value={pin2}
            onChange={(e) => setPin2(e.target.value)}
            placeholder="Nhập lại mã PIN"
          />
        )}
        {err && <div className="lock-err">{err}</div>}
        <button className="btn primary lock-btn" disabled={busy || pin.length < 4}>
          {busy ? 'Đang xử lý…' : pinSet ? 'Mở khoá' : 'Đặt mã PIN'}
        </button>
        {!pinSet && <div className="muted sm">Quên PIN sẽ không lấy lại được — hãy nhớ kỹ hoặc tắt khoá trong Cài đặt.</div>}
      </form>
    </div>
  );
}
