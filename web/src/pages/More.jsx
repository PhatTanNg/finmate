import React from 'react';
import { IconChevron } from '../components/icons.jsx';
import { short } from '../lib/format.js';

/**
 * Trang "Thêm": mọi mục còn lại xếp thành nhóm — thay cho ngăn kéo trượt. Trên
 * điện thoại người ta quen tìm thứ hiếm dùng ở đây (Revolut gọi là Hub).
 */
const GROUPS = [
  { title: 'Tiền của tôi', items: [
    { k: 'accounts', ico: '🏦', label: 'Tài khoản & ví', s: 'Số dư từng nơi, đồng bộ từ ngân hàng' },
    { k: 'funds', ico: '🧺', label: 'Quỹ & phân bổ', s: 'Chia lương vào các hũ, mục tiêu quỹ' },
    { k: 'budgets', ico: '🎛', label: 'Ngân sách', s: 'Hạn mức theo danh mục' },
    { k: 'goals', ico: '🎯', label: 'Mục tiêu', s: 'Tiến độ và số cần để dành mỗi tháng' },
  ] },
  { title: 'Tăng trưởng', items: [
    { k: 'income', ico: '💼', label: 'Nguồn thu', s: 'Lương, freelance, thu nhập thụ động' },
    { k: 'investments', ico: '📈', label: 'Đầu tư', s: 'Cổ phiếu, ETF, vàng, crypto, bất động sản' },
    { k: 'debts', ico: '💳', label: 'Nợ vay', s: 'Kế hoạch trả nợ, ngày sạch nợ' },
    { k: 'currency', ico: '💱', label: 'Tiền tệ & chuyển tiền', s: 'Tỷ giá, kiều hối, đồng tiền gốc' },
    { k: 'fire', ico: '🔥', label: 'Tự do tài chính', s: 'Ngày FIRE, dự báo, lộ trình thụ động' },
  ] },
  { title: 'Cố vấn', items: [
    { k: 'advisor', ico: '🧭', label: 'Cố vấn', s: 'Điểm sức khoẻ, việc nên làm' },
    { k: 'insights', ico: '🔔', label: 'Cảnh báo & phát hiện', s: 'Bất thường, rủi ro, tin tốt' },
    { k: 'ailog', ico: '🧠', label: 'AI đã làm gì', s: 'Nhật ký, hoàn tác, trí nhớ, đề xuất' },
    { k: 'automation', ico: '⚡', label: 'Tự động hoá', s: 'Webhook ngân hàng, định kỳ, import CSV' },
    { k: 'settings', ico: '⚙️', label: 'Cài đặt', s: 'Hồ sơ, bảo mật, sao lưu, AI' },
  ] },
];

export default function More({ go, d, theme, cycleTheme, themeLabel, themeIcon, canLock, onLock, alerts = 0 }) {
  return (
    <>
      <div className="page-h"><div><h1>Thêm</h1><p>Mọi thứ khác của FinMate</p></div></div>

      {d && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="avatar">{(d.profile?.name || 'B').slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{d.profile?.name || 'Bạn'}</div>
            <div className="mini">Tài sản ròng <b>{short(d.net_worth?.net)}</b> · sức khoẻ {d.health?.score}/100</div>
          </div>
          <button className="btn sm" onClick={cycleTheme} title={themeLabel}>{themeIcon}</button>
        </div>
      )}

      {GROUPS.map((g) => (
        <div key={g.title} className="hub-group">
          <h3>{g.title}</h3>
          <div className="card pad0">
            {g.items.map((it) => (
              <button key={it.k} className="hub-item" onClick={() => go(it.k)}>
                <span className="ic">{it.ico}</span>
                <span style={{ minWidth: 0 }}>
                  <div>{it.label}{it.k === 'insights' && alerts > 0 && <span className="tag bad" style={{ marginLeft: 8 }}>{alerts}</span>}</div>
                  <div className="s">{it.s}</div>
                </span>
                <span className="chev"><IconChevron /></span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {canLock && (
        <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={onLock}>🔒 Khoá app</button>
      )}
      <p className="mini" style={{ textAlign: 'center', marginTop: 16 }}>FinMate · dữ liệu nằm trên máy bạn · <kbd>Ctrl</kbd> <kbd>K</kbd> tìm nhanh</p>
    </>
  );
}
