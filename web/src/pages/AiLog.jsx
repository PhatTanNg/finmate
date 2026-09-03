import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal } from '../components/ui.jsx';
import { vnDate } from '../lib/format.js';

const TOOL_VI = {
  ghi_giao_dich: 'Ghi giao dịch', xoa_giao_dich: 'Xoá giao dịch', capnhat_so_du: 'Cập nhật số dư',
  tao_tai_khoan: 'Mở tài khoản', tao_quy: 'Mở quỹ', dong_quy: 'Đóng quỹ', mo_lai_quy: 'Mở lại quỹ',
  xoa_quy: 'Xoá quỹ', chuyen_quy: 'Chuyển tiền giữa quỹ', dat_phan_bo_quy: 'Đặt phân bổ quỹ',
  can_bang_phan_bo: 'Cân bằng phân bổ', dat_muc_tieu_quy: 'Đặt mục tiêu quỹ', tao_muc_tieu: 'Tạo mục tiêu',
  gop_tien_muc_tieu: 'Góp tiền mục tiêu', dat_ngan_sach: 'Đặt ngân sách', them_nguon_thu: 'Thêm nguồn thu',
  them_no: 'Thêm khoản nợ', tra_no: 'Trả nợ', them_dau_tu: 'Thêm khoản đầu tư', cap_nhat_gia: 'Cập nhật giá',
  tao_giao_dich_dinh_ky: 'Tạo khoản định kỳ', cap_nhat_ho_so: 'Cập nhật hồ sơ', ghi_nho: 'Ghi nhớ',
  quen_di: 'Quên đi', hoan_tac: 'Hoàn tác', hoan_tac_gan_nhat: 'Hoàn tác giao dịch vừa ghi', hoan_tat_thiet_lap: 'Hoàn tất thiết lập',
  sua_muc_tieu: 'Sửa mục tiêu', xoa_muc_tieu: 'Xoá mục tiêu', sua_nguon_thu: 'Sửa nguồn thu', xoa_nguon_thu: 'Xoá nguồn thu',
  sua_no: 'Sửa khoản nợ', xoa_no: 'Xoá khoản nợ', xoa_dau_tu: 'Xoá khoản đầu tư', xoa_ngan_sach: 'Xoá ngân sách',
  sua_dinh_ky: 'Sửa khoản định kỳ', xoa_dinh_ky: 'Xoá khoản định kỳ', sua_tai_khoan: 'Sửa tài khoản', xoa_tai_khoan: 'Xoá tài khoản',
  sua_giao_dich: 'Sửa giao dịch', don_trung_lap: 'Dọn bản trùng', xoa_het_du_lieu: 'Xoá sạch dữ liệu',
  liet_ke_tai_khoan: 'Xem tài khoản', liet_ke_quy: 'Xem quỹ', liet_ke_danh_muc: 'Xem danh mục', liet_ke_muc_tieu: 'Xem mục tiêu',
  liet_ke_nguon_thu: 'Xem nguồn thu', liet_ke_no: 'Xem nợ', liet_ke_dau_tu: 'Xem đầu tư', liet_ke_ngan_sach: 'Xem ngân sách',
  liet_ke_dinh_ky: 'Xem khoản định kỳ', liet_ke_bat_dong_san: 'Xem bất động sản',
  xem_chi_tieu: 'Xem chi tiêu', xem_giao_dich: 'Xem giao dịch', xem_tai_san: 'Xem tài sản', xem_tu_do_tai_chinh: 'Xem FIRE',
  xem_du_bao: 'Xem dự báo', xem_ngan_sach: 'Xem ngân sách', xem_no: 'Xem nợ', xem_dau_tu: 'Xem đầu tư', xem_suc_khoe: 'Xem sức khoẻ tài chính',
  xem_xu_huong: 'Xem xu hướng', tu_van_tien_du: 'Tư vấn tiền dư', xem_ty_gia: 'Xem tỷ giá', tinh_chuyen_tien: 'Tính chuyển tiền',
  tinh_thue: 'Tính thuế', xem_ghi_nho: 'Xem ghi nhớ', xem_nhat_ky_thao_tac: 'Xem nhật ký',
};
const KIND_ICO = { fact: '📌', preference: '💚', constraint: '🚧', decision: '✅', plan: '🗺️' };
const label = (t) => TOOL_VI[t] || t;
const when = (s) => (s ? `${vnDate(s.slice(0, 10))} ${s.slice(11, 16)}` : '');

function Detail({ id, onClose, onUndone }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/ai/actions/${id}`).then(setD).catch(() => setD(false)); }, [id]);

  const undo = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/ai/actions/${id}/undo`, {});
      if (r.ok === false) alert(r.error || 'Không hoàn tác được.');
      else { onUndone(); onClose(); }
    } finally { setBusy(false); }
  };

  if (d === false) return <Modal title="Chi tiết" onClose={onClose}><Empty>Không tìm thấy.</Empty></Modal>;
  if (!d) return <Modal title="Chi tiết" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal title={label(d.cong_cu)} onClose={onClose}>
      <p className="mini">{when(d.luc)} · nguồn: {d.nguon === 'review' ? 'AI tự rà soát' : 'bạn nhờ trong chat'}</p>
      {d.ly_do && <p className="mini" style={{ fontStyle: 'italic' }}>Vì: {d.ly_do}</p>}

      {!!d.thay_doi?.length && (
        <>
          <h4 style={{ margin: '12px 0 6px' }}>Đã đụng vào {d.thay_doi.length} dòng dữ liệu</h4>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {d.thay_doi.map((c, i) => (
              <div key={i} className="mini" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <b>{c.bang}</b> #{c.hang} · {c.thao_tac === 'insert' ? 'thêm mới' : c.thao_tac === 'delete' ? 'xoá' : 'sửa'}
                {c.thao_tac === 'update' && c.truoc && c.sau && (
                  <div style={{ marginTop: 3 }}>
                    {Object.keys(c.sau).filter((k) => JSON.stringify(c.truoc[k]) !== JSON.stringify(c.sau[k])).map((k) => (
                      <div key={k}>{k}: <s>{String(c.truoc[k])}</s> → <b>{String(c.sau[k])}</b></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {d.da_hoan_tac
        ? <p className="mini" style={{ marginTop: 12 }}>Đã hoàn tác rồi.</p>
        : d.thay_doi_du_lieu
          ? <button className="btn danger" style={{ marginTop: 12 }} disabled={busy} onClick={undo}>
              {busy ? 'Đang trả lại…' : 'Hoàn tác việc này'}
            </button>
          : <p className="mini" style={{ marginTop: 12 }}>Thao tác này chỉ đọc dữ liệu, không có gì để hoàn tác.</p>}
    </Modal>
  );
}

export default function AiLog({ onRefresh }) {
  const [data, setData] = useState(null);
  const [mem, setMem] = useState([]);
  const [rev, setRev] = useState(null);
  const [open, setOpen] = useState(null);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [busy, setBusy] = useState('');

  const load = async () => {
    const [a, m, r] = await Promise.all([
      api.get(`/ai/actions?limit=60${onlyChanges ? '&mutating=1' : ''}`),
      api.get('/ai/memory'),
      api.get('/ai/review'),
    ]);
    setData(a); setMem(m.memory || []); setRev(r);
  };
  useEffect(() => { load().catch(() => setData(false)); }, [onlyChanges]);

  const undoLast = async () => {
    if (!confirm('Trả lại thay đổi gần nhất mà AI đã làm?')) return;
    setBusy('undo');
    try { await api.post('/ai/undo', { n: 1 }); await load(); onRefresh?.(); } finally { setBusy(''); }
  };
  const runReview = async () => {
    setBusy('review');
    try {
      const r = await api.post('/ai/review/run', {});
      if (r.ok === false) alert(r.error);
      await load();
    } finally { setBusy(''); }
  };
  const setMode = async (che_do) => { await api.put('/ai/review', { che_do }); await load(); };
  const forgetOne = async (id) => { await api.del(`/ai/memory/${id}`); await load(); };

  if (data === false) return <Empty>Không tải được nhật ký.</Empty>;
  if (!data) return <Loading />;

  const s = data.stats || {};
  const cfg = rev?.config || {};

  return (
    <>
      <div className="grid g4">
        <Stat label="Việc AI đã làm" value={s.tong || 0} sub="tổng cộng" />
        <Stat label="Có đổi dữ liệu" value={s.thay_doi_du_lieu || 0} sub="số còn lại chỉ là tra cứu" />
        <Stat label="Bạn đã hoàn tác" value={s.da_hoan_tac || 0} tone={s.da_hoan_tac ? 'warn' : undefined} />
        <Stat label="Đang nhớ về bạn" value={mem.length} sub="điều quan trọng" />
      </div>

      <Card
        title="🔍 AI tự rà soát định kỳ"
        right={<button className="btn ghost" disabled={busy === 'review'} onClick={runReview}>{busy === 'review' ? 'Đang xem…' : 'Rà soát ngay'}</button>}
      >
        <p className="mini">
          Cố vấn không chỉ ngồi chờ bạn hỏi. Bật chế độ này thì mỗi {cfg.moi_bao_nhieu_gio || 24} giờ AI tự mở hồ sơ
          của bạn ra xem và nhắn lại nếu thấy điều đáng chú ý.
        </p>
        <div className="chips" style={{ marginTop: 10 }}>
          {[
            ['off', 'Tắt', 'Không tự rà soát'],
            ['suggest', 'Chỉ gợi ý', 'Xem và nhắn, không đụng vào tiền'],
            ['act', 'Được phép chỉnh', 'Tự sửa những thứ hoàn tác được'],
          ].map(([k, t, hint]) => (
            <button key={k} className={`chip ${cfg.che_do === k ? 'on' : ''}`} title={hint} onClick={() => setMode(k)}>{t}</button>
          ))}
        </div>
        {cfg.lan_cuoi && <p className="mini" style={{ marginTop: 8 }}>Lần gần nhất: {when(cfg.lan_cuoi.replace('T', ' '))}</p>}
        {rev?.last && (
          <div className="note" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{rev.last.noi_dung}</div>
        )}
      </Card>

      <Card title="🧠 AI đang nhớ gì về bạn">
        {!mem.length && <Empty>Chưa nhớ gì. Cứ kể trong chat, những điều quan trọng sẽ được ghi lại.</Empty>}
        {mem.map((m) => (
          <div key={m.id} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 18, marginRight: 8 }}>{KIND_ICO[m.loai] || '📌'}</span>
            <div style={{ flex: 1 }}>
              <b>{String(m.muc || '').replace(/_/g, ' ')}</b>
              <div className="mini">{m.noi_dung}</div>
              <div className="mini" style={{ opacity: 0.7 }}>{m.loai_vi} · mức {m.do_quan_trong}/5{m.het_han ? ` · tới ${vnDate(m.het_han)}` : ''}</div>
            </div>
            <button className="btn ghost sm" onClick={() => forgetOne(m.id)}>Quên</button>
          </div>
        ))}
      </Card>

      <Card
        title="📋 Nhật ký thao tác"
        right={
          <>
            <button className={`chip ${onlyChanges ? 'on' : ''}`} onClick={() => setOnlyChanges(!onlyChanges)}>Chỉ việc đổi dữ liệu</button>
            <button className="btn ghost" disabled={busy === 'undo'} onClick={undoLast} style={{ marginLeft: 6 }}>Hoàn tác gần nhất</button>
          </>
        }
      >
        {!data.actions?.length && <Empty>AI chưa làm gì cả.</Empty>}
        {data.actions?.map((a) => (
          <button
            key={a.id}
            className="row listbtn"
            onClick={() => setOpen(a.id)}
            style={{ width: '100%', textAlign: 'left', padding: '9px 0', borderBottom: '1px solid var(--line)', opacity: a.da_hoan_tac ? 0.5 : 1 }}
          >
            <div style={{ flex: 1 }}>
              <b style={{ textDecoration: a.da_hoan_tac ? 'line-through' : 'none' }}>{label(a.cong_cu)}</b>
              {a.nguon === 'review' && <span className="tag" style={{ marginLeft: 6 }}>tự rà soát</span>}
              {!a.thanh_cong && <span className="tag warn" style={{ marginLeft: 6 }}>lỗi</span>}
              <div className="mini">{when(a.luc)}{a.so_hang_doi ? ` · ${a.so_hang_doi} dòng dữ liệu` : ''}</div>
            </div>
            <span className="mini">›</span>
          </button>
        ))}
      </Card>

      {open && <Detail id={open} onClose={() => setOpen(null)} onUndone={() => { load(); onRefresh?.(); }} />}
    </>
  );
}
