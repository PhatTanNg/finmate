import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card } from './ui.jsx';
import * as sync from '../lib/sync.js';

const gio = (s) => (s ? new Date(s).toLocaleString('vi-VN') : '—');

/**
 * Đồng bộ sổ trên máy này với một tài khoản trên máy chủ (chỉ có ở bản chạy
 * thẳng trên máy).
 *
 * Nguyên tắc hiện lên mặt giao diện: máy này và máy chủ cùng đổi thì app DỪNG
 * lại và hỏi, chứ không tự chọn hộ. Bên nào bị ghi đè cũng được sao lưu trước,
 * nên chọn xong vẫn quay lại được.
 */
export default function SyncCard() {
  const [c, setC] = useState(() => sync.cauHinh());
  const [may, setMay] = useState(null);          // trạng thái máy chủ
  const [ban, setBan] = useState(null);          // đang bận làm gì
  const [err, setErr] = useState(null);
  const [tin, setTin] = useState(null);
  const [lech, setLech] = useState(null);        // { sync, rev } khi hai bên cùng đổi
  const [form, setForm] = useState({ url: '', email: '', password: '' });

  const noi = sync.daNoi();
  const lamMoi = async () => {
    setC(sync.cauHinh());
    if (!sync.daNoi()) return;
    try { setMay(await sync.trangThaiMayChu()); setErr(null); }
    catch (e) { setMay(null); setErr(e.status === 401 ? 'Phiên đăng nhập hết hạn — hãy nối lại.' : e.message); }
  };
  useEffect(() => { lamMoi(); }, []);

  const engine = async () => (await import('../native/boot.js')).embedded();
  /** Giữ lại bản trên máy này trước khi thay bằng bản của máy chủ. */
  const saoLuuTaiCho = () => api.post('/backup/run').catch(() => null);

  const chay = async (ten, fn) => {
    setBan(ten); setErr(null); setTin(null);
    try { await fn(); } catch (e) {
      if (e.conflict) { setLech({ sync: e.sync, rev: sync.cauHinh().rev }); setErr(null); }
      else setErr(e.message);
    } finally { setBan(null); await lamMoi(); }
  };

  const dongBo = () => chay('dong-bo', async () => {
    const m = await engine();
    const kq = await sync.dongBoMotLuot({
      layBytes: () => m.exportDb(),
      thaySo: (b) => m.importDb(b),
      saoLuu: saoLuuTaiCho,
    });
    if (kq.viec === 'lech') { setLech({ sync: kq.sync, rev: kq.rev }); return; }
    if (kq.viec === 'tai-ve') { alert('Đã tải sổ từ máy chủ về. App sẽ tải lại.'); location.reload(); return; }
    setTin(kq.viec === 'gui-len' ? `Đã gửi sổ lên máy chủ (bản ${kq.rev}).` : 'Hai bên đã giống nhau, không có gì để gửi.');
  });

  const guiDe = () => chay('gui-de', async () => {
    const m = await engine();
    const d = await sync.guiLen({ bytes: m.exportDb(), force: true });
    setLech(null);
    setTin(`Đã ghi đè sổ trên máy chủ bằng bản của máy này (bản ${d.rev}). Bản cũ trên máy chủ đã được sao lưu.`);
  });

  const taiDe = () => chay('tai-de', async () => {
    const m = await engine();
    const { bytes, rev } = await sync.taiVe();
    await saoLuuTaiCho();
    await m.importDb(bytes);
    sync.luuCauHinh({ rev, at: new Date().toISOString(), doi: 0 });
    setLech(null);
    alert('Đã lấy sổ từ máy chủ về máy này. Bản cũ trên máy đã được sao lưu. App sẽ tải lại.');
    location.reload();
  });

  const noiVao = (e) => {
    e.preventDefault();
    return chay('noi', async () => {
      const kq = await sync.dangNhap(form);
      setForm({ url: form.url, email: form.email, password: '' });
      setTin(kq.trong
        ? 'Đã nối. Tài khoản này còn trắng — bấm “Đồng bộ ngay” là sổ trên máy này lên đó.'
        : `Đã nối. Tài khoản này đã có sổ riêng (${kq.transactions ?? '?'} giao dịch), nên lần đồng bộ đầu sẽ hỏi bạn giữ bản nào.`);
    });
  };

  if (!noi) {
    return (
      <Card title="Đồng bộ với tài khoản trên máy chủ">
        <p className="mini" style={{ marginTop: 0 }}>
          Sổ đang nằm gọn trong máy này. Nối vào một máy chủ FinMate có bật tài khoản thì sổ sẽ theo bạn
          sang máy khác — vẫn dùng offline bình thường, có mạng mới gửi đi.
        </p>
        <form onSubmit={noiVao} className="col" style={{ gap: 8 }}>
          <input className="in" placeholder="https://finmate-cua-ban.fly.dev" value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" required />
          <input className="in" type="email" placeholder="Email tài khoản" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <input className="in" type="password" placeholder="Mật khẩu" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <button className="btn primary" disabled={ban === 'noi'}>{ban === 'noi' ? 'Đang nối…' : 'Nối vào máy chủ'}</button>
        </form>
        {err && <p className="mini" style={{ color: 'var(--bad, #dc2626)' }}>{err}</p>}
        {tin && <p className="mini">{tin}</p>}
        <p className="mini muted" style={{ marginTop: 10 }}>
          Chưa có máy chủ? Xem mục “Máy chủ thật” trong README — dựng trên Fly.io mất chừng 10 phút.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Đồng bộ với tài khoản trên máy chủ">
      <p className="mini" style={{ marginTop: 0 }}>
        Đang nối với <b>{c.email}</b> tại <code>{c.url}</code>.
      </p>
      <div className="mini muted">
        Lần đồng bộ gần nhất: {gio(c.at)} · bản {c.rev}
        {may && may.rev !== c.rev && <> · máy chủ đang ở bản {may.rev}</>}
        {sync.coThayDoi() ? ' · máy này có thay đổi chưa gửi' : ' · máy này chưa có gì mới'}
      </div>

      {lech && (
        <div className="lock-err" style={{ textAlign: 'left', marginTop: 10 }}>
          <b>Hai bên cùng đổi.</b> Máy chủ đã sang bản {lech.sync?.rev} (lúc {gio(lech.sync?.at)}), còn máy này cũng có
          thay đổi chưa gửi. Trộn tự động sẽ làm hỏng sổ tiền, nên bạn chọn:
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn" disabled={Boolean(ban)} onClick={taiDe}>Lấy bản máy chủ về (bản trên máy này được sao lưu)</button>
            <button className="btn" disabled={Boolean(ban)} onClick={guiDe}>Đẩy bản máy này lên (bản trên máy chủ được sao lưu)</button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn primary" disabled={Boolean(ban)} onClick={dongBo}>{ban === 'dong-bo' ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}</button>
        <button className="btn" disabled={Boolean(ban)} onClick={() => confirm('Ghi đè sổ trên máy chủ bằng sổ của máy này?') && guiDe()}>Gửi lên</button>
        <button className="btn" disabled={Boolean(ban)} onClick={() => confirm('Thay sổ trên máy này bằng sổ trên máy chủ? Bản hiện tại sẽ được sao lưu trước.') && taiDe()}>Tải về</button>
        <button className="btn ghost" disabled={Boolean(ban)} onClick={() => { if (confirm('Ngắt kết nối? Sổ trên máy này vẫn còn nguyên.')) { sync.ngatKetNoi(); setC(sync.cauHinh()); setMay(null); } }}>Ngắt kết nối</button>
      </div>

      {err && <p className="mini" style={{ color: 'var(--bad, #dc2626)' }}>{err}</p>}
      {tin && <p className="mini">{tin}</p>}
      <p className="mini muted" style={{ marginTop: 10 }}>
        Máy chủ chỉ giữ hộ cuốn sổ: tự động hoá (giao dịch định kỳ, tính lãi) vẫn chạy trên chính máy này mỗi lần mở app.
      </p>
    </Card>
  );
}
