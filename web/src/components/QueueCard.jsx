import React, { useEffect, useState } from 'react';
import { EMBEDDED, guiHangChoNgay } from '../lib/api.js';
import { danhSach, theoDoi, boViec, boHet, nhan, chu } from '../lib/queue.js';
import { Card } from './ui.jsx';

const gio = (s) => (s ? new Date(s).toLocaleString('vi-VN') : '');
const tomTat = (v) => {
  const b = v.body || {};
  const phan = [b.name, b.note, b.merchant, b.amount != null ? Number(b.amount).toLocaleString('vi-VN') : null]
    .filter(Boolean).join(' · ');
  return phan.slice(0, 70);
};

/**
 * Những việc ghi lúc mất mạng, đang nằm chờ trong máy.
 *
 * Chỉ hiện khi thật sự có việc chờ — người dùng không cần biết cơ chế này tồn
 * tại cho tới lúc nó có ích. Nhưng khi có thì phải thấy ĐỦ: chờ cái gì, vì sao
 * chưa gửi được, và bỏ đi bằng cách nào.
 */
export default function QueueCard() {
  const [ds, setDs] = useState(() => (EMBEDDED ? [] : danhSach()));
  const [ban, setBan] = useState(false);
  const [tin, setTin] = useState(null);

  useEffect(() => theoDoi(setDs), []);
  if (EMBEDDED || !ds.length) return null;

  const guiLai = async () => {
    setBan(true); setTin(null);
    try {
      const r = await guiHangChoNgay();
      setTin(r.gui ? `Đã gửi ${r.gui} việc.` : 'Vẫn chưa gửi được — có vẻ máy chủ chưa với tới được.');
    } catch (e) { setTin(e.message); }
    finally { setBan(false); setDs(danhSach()); }
  };

  const hong = ds.filter((v) => v.loi);
  const cuaNguoiKhac = ds.filter((v) => (v.chu || 'local') !== chu());
  return (
    <Card title={`Việc chờ gửi (${ds.length})`}>
      <p className="mini" style={{ marginTop: 0 }}>
        Những thứ bạn ghi lúc mất mạng đang nằm trong máy này. App tự gửi khi có mạng lại; mỗi việc mang một mã riêng
        nên gửi lại cũng không thành hai lần ghi.
      </p>
      <div className="col" style={{ gap: 6 }}>
        {ds.map((v) => (
          <div key={v.id} className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <div>
              <div><b>{nhan(v)}</b>{tomTat(v) ? <span className="muted"> — {tomTat(v)}</span> : null}</div>
              <div className="mini muted">{gio(v.at)}{v.loi ? ` · máy chủ từ chối: ${v.loi}` : ''}</div>
            </div>
            <button className="btn sm ghost" onClick={() => { if (confirm(`Bỏ việc “${nhan(v)}”? Việc này sẽ không được ghi vào sổ.`)) boViec(v.id); }}>Bỏ</button>
          </div>
        ))}
      </div>
      {cuaNguoiKhac.length > 0 && (
        <p className="mini muted">
          {cuaNguoiKhac.length} việc thuộc tài khoản khác từng đăng nhập trên máy này — chỉ gửi được khi chính người đó đăng nhập lại.
        </p>
      )}
      {hong.length > 0 && (
        <p className="mini" style={{ color: 'var(--bad, #dc2626)' }}>
          {hong.length} việc bị máy chủ từ chối — gửi lại bao nhiêu lần cũng vậy. Xem lý do ở trên rồi bỏ đi và làm lại cho đúng.
        </p>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn primary" disabled={ban} onClick={guiLai}>{ban ? 'Đang gửi…' : 'Thử gửi ngay'}</button>
        <button className="btn ghost" onClick={() => { if (confirm(`Bỏ hết ${ds.length} việc đang chờ? Sẽ không có việc nào được ghi vào sổ.`)) boHet(); }}>Bỏ hết</button>
      </div>
      {tin && <p className="mini">{tin}</p>}
    </Card>
  );
}
