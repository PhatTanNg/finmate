import React, { useEffect, useState } from 'react';
import { api, setLedger } from '../lib/api.js';
import { Card, Empty } from './ui.jsx';

const TEN_VAI = {
  owner: 'Chủ sổ',
  adult: 'Người lớn',
  child: 'Con',
  viewer: 'Chỉ xem',
  guardian: 'Bạn giám hộ',
};

const TA_VAI = {
  adult: 'Đọc, ghi, xoá mọi thứ trong sổ chung — ngang quyền với bạn.',
  child: 'Giữ sổ RIÊNG của mình, không thấy gì trong sổ chung. Bạn xem được sổ đó và cấp tiền tiêu vặt vào đấy.',
  viewer: 'Chỉ xem sổ chung, không ghi gì.',
};

const tien = (n) => `${Number(n || 0).toLocaleString('vi-VN')}₫`;

/**
 * Sổ chung của một nhà: tạo, mời người vào, đổi vai, và chuyển qua lại giữa
 * sổ riêng với sổ chung.
 *
 * Một điều được nói thẳng trên mặt giao diện chứ không giấu trong tài liệu:
 * sổ riêng KHÔNG biến mất và không bị gộp vào đâu cả. Người ta chỉ giao phần
 * tiền chung của gia đình cho app khi biết chắc phần riêng vẫn còn nguyên.
 */
export default function FamilyCard() {
  const [ds, setDs] = useState(null);        // các sổ mở được
  const [hienTai, setHienTai] = useState(null);
  const [vai, setVai] = useState(null);
  const [tv, setTv] = useState(null);        // thành viên của sổ chung đang mở
  const [toi, setToi] = useState(null);
  const [ban, setBan] = useState(null);
  const [err, setErr] = useState(null);
  const [ma, setMa] = useState(null);        // mã mời vừa tạo (chỉ hiện một lần)
  const [nhapMa, setNhapMa] = useState('');
  const [tenMoi, setTenMoi] = useState('');
  const [con, setCon] = useState([]);          // con mình giám hộ
  const [giamHo, setGiamHo] = useState([]);    // ai đang giám hộ MÌNH
  const [capTien, setCapTien] = useState({});  // ô nhập số tiền cấp ngay, theo id con

  const laChung = String(hienTai || '').startsWith('g');
  // Sổ đang mở là sổ của con (mình đang giám hộ): khoá cũng bắt đầu bằng 'u'
  // như sổ riêng, nên phải tra danh sách chứ không đoán từ khoá.
  const dangXemSoCon = (ds || []).find((l) => l.key === hienTai)?.kind === 'child';
  const laRieng = !laChung && !dangXemSoCon;

  async function lamMoi() {
    try {
      const d = await api.get('/account/ledgers');
      setDs(d.ledgers); setHienTai(d.current); setVai(d.role); setErr(null);
      if (String(d.current || '').startsWith('g')) {
        const m = await api.get('/account/families/members');
        setTv(m.members); setToi(m.me);
      } else { setTv(null); }
      const c = await api.get('/account/children').catch(() => null);
      setCon(c?.children || []);
      setGiamHo(c?.guardians_of_me || []);
    } catch (e) { setErr(e.message); setDs([]); }
  }
  useEffect(() => { lamMoi(); }, []);

  const chay = async (ten, fn) => {
    setBan(ten); setErr(null);
    try { await fn(); await lamMoi(); } catch (e) { setErr(e.message); } finally { setBan(null); }
  };

  // Đổi sổ là đổi toàn bộ dữ liệu mọi trang đang hiện, nên tải lại cả app thay
  // vì đi vá từng chỗ — vừa chắc chắn vừa khỏi có trang nào quên làm mới.
  const doiSo = (key) => chay('doi', async () => {
    await api.post('/account/switch', { key });
    // Đặt sổ ở phía máy TRƯỚC khi tải lại: từ đây trở đi mọi request mang
    // header sổ mới, và kho đệm đọc đúng ngăn của sổ mới. Chỉ đổi ở máy chủ
    // thì lần mất mạng đầu tiên sau đó sẽ đọc nhầm ngăn.
    setLedger(key);
    location.reload();
  });

  const taoSo = () => chay('tao', async () => {
    if (!tenMoi.trim()) throw new Error('Đặt cho sổ chung một cái tên đã.');
    const d = await api.post('/account/ledgers', { name: tenMoi.trim() });
    setTenMoi('');
    await api.post('/account/switch', { key: d.ledger.key });
    setLedger(d.ledger.key);
    location.reload();
  });

  const moi = (role) => chay('moi', async () => {
    const d = await api.post('/account/families/invite', { role });
    setMa(d.invite);
  });

  const vao = () => chay('vao', async () => {
    if (!nhapMa.trim()) throw new Error('Dán mã mời vào đã.');
    const d = await api.post('/account/families/join', { code: nhapMa.trim() });
    setNhapMa('');
    await api.post('/account/switch', { key: d.ledger.key });
    setLedger(d.ledger.key);
    location.reload();
  });

  if (ds === null) return <Card title="Gia đình"><Empty>Đang xem…</Empty></Card>;

  return (
    <Card title="Gia đình">
      <p className="dim" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        Sổ chung để cả nhà cùng ghi và cùng nhìn một bức tranh tiền bạc.
        <b> Sổ riêng của bạn vẫn còn nguyên</b> và không ai trong nhà thấy được — bạn chuyển
        qua lại bất cứ lúc nào.
      </p>

      <div className="ledger-list">
        {ds.map((l) => (
          <button
            key={l.key}
            className={`ledger-row ${l.key === hienTai ? 'on' : ''}`}
            onClick={() => l.key !== hienTai && doiSo(l.key)}
            disabled={Boolean(ban)}
          >
            <span className="ic">{l.kind === 'family' ? '👨‍👩‍👧' : l.kind === 'child' ? '🧒' : '🔒'}</span>
            <span className="nd">
              <b>{l.name}</b>
              <small>
                {l.kind === 'family' ? `${l.members} người · bạn là ${TEN_VAI[l.role] || l.role}`
                  : l.kind === 'child' ? 'Bạn xem và cấp tiền, không xoá được gì'
                    : 'Chỉ mình bạn thấy'}
              </small>
            </span>
            {l.key === hienTai && <span className="tick">Đang mở</span>}
          </button>
        ))}
      </div>

      {laRieng && (
        <>
          <div className="row" style={{ marginTop: 14 }}>
            <input
              className="inp-line"
              placeholder="Tên sổ chung, ví dụ: Nhà mình"
              value={tenMoi}
              maxLength={60}
              onChange={(e) => setTenMoi(e.target.value)}
            />
            <button className="btn" onClick={taoSo} disabled={ban === 'tao'}>Tạo sổ chung</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="inp-line"
              placeholder="Hoặc dán mã mời của người nhà"
              value={nhapMa}
              onChange={(e) => setNhapMa(e.target.value)}
            />
            <button className="btn ghost" onClick={vao} disabled={ban === 'vao'}>Vào sổ</button>
          </div>
        </>
      )}

      {laChung && tv && (
        <>
          <h4 style={{ margin: '16px 0 8px', fontSize: 13.5 }}>Thành viên</h4>
          <div className="member-list">
            {tv.map((m) => (
              <div className="member" key={m.id}>
                <span className="nd">
                  <b>{m.name || m.email}{m.id === toi ? ' (bạn)' : ''}</b>
                  <small>{TEN_VAI[m.role] || m.role}</small>
                </span>
                {vai === 'owner' && m.role !== 'owner' && (
                  <button
                    className="btn ghost sm"
                    onClick={() => chay('go', () => api.post('/account/families/remove', { user_id: m.id }))}
                    disabled={Boolean(ban)}
                  >Gỡ</button>
                )}
              </div>
            ))}
          </div>

          {vai === 'owner' && (
            <>
              <h4 style={{ margin: '16px 0 6px', fontSize: 13.5 }}>Mời thêm người</h4>
              <div className="row wrap">
                {['adult', 'child', 'viewer'].map((r) => (
                  <button key={r} className="btn ghost sm" onClick={() => moi(r)} disabled={Boolean(ban)}>
                    Mời làm {TEN_VAI[r].toLowerCase()}
                  </button>
                ))}
              </div>
              <p className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>{TA_VAI.child}</p>
              {ma && (
                <div className="invite-code">
                  <b>{ma.code}</b>
                  <p>
                    Gửi mã này cho người bạn muốn mời — họ dán vào ô “Vào sổ”.
                    Dùng được <b>một lần</b>, và <b>chỉ hiện đúng lần này</b>: đóng đi là không xem lại được,
                    phải tạo mã mới.
                  </p>
                </div>
              )}
            </>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn ghost sm"
              onClick={() => {
                if (!confirm('Rời khỏi sổ chung này? Những gì bạn đã ghi vẫn ở lại trong sổ.')) return;
                chay('roi', async () => { await api.post('/account/families/leave'); location.reload(); });
              }}
              disabled={Boolean(ban) || vai === 'owner'}
            >Rời sổ này</button>
          </div>
          {vai === 'owner' && (
            <p className="dim" style={{ fontSize: 12 }}>
              Bạn là chủ sổ nên không rời được — hãy chuyển vai chủ hoặc xoá sổ nếu muốn dừng hẳn.
            </p>
          )}

          <div className="note-warn" style={{ marginTop: 14 }}>
            <b>Mất mạng vẫn ghi được.</b> Khoản bạn nhập lúc không có sóng được giữ lại trong
            máy và tự gửi vào đúng sổ này khi có mạng — kể cả khi lúc đó bạn đã chuyển sang
            sổ khác. Cái không làm được là <b>gửi cả cuốn sổ lên đè</b>: làm vậy sẽ xoá mất
            những gì người nhà vừa ghi, nên đường đó bị khoá riêng cho sổ chung.
          </div>
        </>
      )}

      {/* ── Con cái ─────────────────────────────────────────────────────
          Đặt sau phần sổ chung vì nó là chuyện khác hẳn: con KHÔNG ở trong sổ
          chung. Nói rõ điều đó ra, không thì người ta tìm tên con trong danh
          sách thành viên rồi tưởng lời mời hỏng. */}
      {(laChung || con.length > 0) && (
        <>
          <h4 style={{ margin: '18px 0 6px', fontSize: 13.5 }}>Con cái</h4>
          <p className="dim" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 0 }}>
            Con <b>giữ sổ riêng của mình</b> và không thấy gì trong sổ chung — không có lương,
            nợ hay tài sản của bố mẹ. Bạn xem được sổ đó và cấp tiền tiêu vặt vào đấy.
          </p>

          {con.length === 0 && laChung && vai === 'owner' && (
            <p className="dim" style={{ fontSize: 12.5 }}>
              Chưa có con nào. Bấm <b>Mời làm con</b> ở trên rồi đưa mã cho con.
            </p>
          )}

          <div className="member-list">
            {con.map((c) => {
              const th = c.thang_nay || {};
              return (
                <div className="child" key={c.id}>
                  <div className="between">
                    <span className="nd">
                      <b>{c.name || c.email}</b>
                      <small>
                        {c.tieu_vat
                          ? `Tiêu vặt ${tien(c.tieu_vat.amount)}/tháng, ngày ${c.tieu_vat.day_of_month}`
                          : 'Chưa đặt tiền tiêu vặt định kỳ'}
                      </small>
                    </span>
                    <button className="btn ghost sm" onClick={() => doiSo(c.key)} disabled={Boolean(ban)}>Mở sổ</button>
                  </div>
                  {th.nhan != null && (
                    <div className="child-num">
                      <span>Tháng này nhận <b>{tien(th.nhan)}</b></span>
                      <span>đã tiêu <b>{tien(th.tieu)}</b></span>
                      <span>còn <b>{tien(th.con_lai)}</b></span>
                    </div>
                  )}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <input
                      className="inp-line"
                      inputMode="numeric"
                      placeholder="Cấp ngay bao nhiêu?"
                      value={capTien[c.id] || ''}
                      onChange={(e) => setCapTien((o) => ({ ...o, [c.id]: e.target.value.replace(/[^\d]/g, '') }))}
                    />
                    <button
                      className="btn sm"
                      disabled={Boolean(ban) || !capTien[c.id]}
                      onClick={() => chay('cap', async () => {
                        await api.post('/account/children/pay', { child_id: c.id, amount: Number(capTien[c.id]) });
                        setCapTien((o) => ({ ...o, [c.id]: '' }));
                      })}
                    >Cấp</button>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <input
                      className="inp-line"
                      inputMode="numeric"
                      placeholder="Hằng tháng bao nhiêu?"
                      defaultValue={c.tieu_vat?.amount || ''}
                      onBlur={(e) => {
                        const v = Number(String(e.target.value).replace(/[^\d]/g, ''));
                        if (!v || v === c.tieu_vat?.amount) return;
                        chay('lich', () => api.post('/account/children/allowance', { child_id: c.id, amount: v, day_of_month: c.tieu_vat?.day_of_month || 1 }));
                      }}
                    />
                    {c.tieu_vat && (
                      <button
                        className="btn ghost sm"
                        onClick={() => chay('bolich', () => api.del(`/account/children/allowance/${c.tieu_vat.id}`))}
                        disabled={Boolean(ban)}
                      >Bỏ lịch</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Con nhìn thấy phần này: ai đang xem được sổ của mình. Không nói ra là
          không tử tế — đứa trẻ có quyền biết. */}
      {giamHo.length > 0 && (
        <div className="note-warn" style={{ marginTop: 14 }}>
          <b>{giamHo.map((g) => g.name || g.email).join(' và ')}</b> xem được sổ này và cấp tiền tiêu vặt vào đây.
          Sổ vẫn là của bạn — họ không xoá được gì trong đó.
        </div>
      )}

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
    </Card>
  );
}
