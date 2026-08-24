import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Empty, Loading, Modal, Form, Donut, Money } from '../components/ui.jsx';
import { fmt, short, pct, vnDate, baseCurrency, toMinor, toMajor, CURRENCIES } from '../lib/format.js';

export default function Investments({ onRefresh }) {
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState(false);
  const [price, setPrice] = useState(null);
  const [trade, setTrade] = useState(false);
  const [prop, setProp] = useState(false);

  const load = () => api.get('/investments').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;

  const p = d.portfolio || {};
  const re = d.real_estate || {};
  const holdings = p.holdings || [];

  return (
    <>
      <div className="page-h">
        <div><h1>Đầu tư & tài sản</h1><p>Cổ phiếu, quỹ, vàng và bất động sản cho thuê</p></div>
        <div className="row">
          <button className="btn" onClick={() => setProp(true)}>+ Bất động sản</button>
          <button className="btn" onClick={() => setTrade(true)}>Ghi lệnh mua/bán</button>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Mã mới</button>
        </div>
      </div>

      <div className="grid g4">
        <Stat label="Giá trị danh mục" value={short(p.total_value)} sub={`Vốn ${short(p.total_cost)}`} />
        <Stat label="Lãi/lỗ chưa thực hiện" value={short(p.unrealized_pnl)} sub={pct(p.unrealized_pct, 1)} tone={p.unrealized_pnl >= 0 ? 'up' : 'down'} />
        <Stat label="Cổ tức dự kiến/năm" value={short(p.projected_dividend)} />
        <Stat label="BĐS cho thuê" value={short(re.total_value)} sub={`${short(re.net_monthly)}/tháng ròng`} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Phân bổ tài sản">
          <Donut items={Object.entries(p.allocation || {}).map(([k, v]) => ({ label: { stock: 'Cổ phiếu', fund: 'Quỹ/ETF', gold: 'Vàng', crypto: 'Crypto', bond: 'Trái phiếu' }[k] || k, value: v }))} />
        </Card>
        <Card title="Nguyên tắc phân bổ">
          <p className="mini">
            Không bỏ tất cả trứng vào một giỏ. Với người Việt, một cơ cấu cân bằng thường gồm: quỹ ETF/chỉ số làm nền,
            tiết kiệm kỳ hạn cho phần an toàn, cổ phiếu cơ bản tốt cho tăng trưởng, vàng làm lớp phòng thủ.
          </p>
          <div className="hr" />
          <div className="grid g3">
            <div><div className="mini">Tiền mặt chờ</div><b>{short(p.cash)}</b></div>
            <div><div className="mini">Đã chốt lời năm nay</div><b className={p.realized_ytd >= 0 ? 'up' : 'down'}>{short(p.realized_ytd)}</b></div>
            <div><div className="mini">Cổ tức đã nhận</div><b>{short(p.dividend_ytd)}</b></div>
          </div>
        </Card>
      </div>

      <Card title="Danh mục nắm giữ">
        <div className="scrollx">
          <table>
            <thead><tr><th>Mã</th><th className="num">SL</th><th className="num">Giá vốn</th><th className="num">Giá hiện tại</th><th className="num">Giá trị</th><th className="num">Lãi/lỗ</th><th></th></tr></thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td><b>{h.symbol}</b> <span className="mini">{h.name !== h.symbol ? h.name : ''}</span></td>
                  <td className="num">{Number(h.quantity).toLocaleString('vi-VN')}</td>
                  <td className="num">{short(h.avg_cost, h.currency)}</td>
                  <td className="num">{short(h.last_price, h.currency)}</td>
                  <td className="num">{fmt(h.value, h.currency)}</td>
                  <td className="num"><span className={h.pnl >= 0 ? 'up' : 'down'}>{h.pnl >= 0 ? '▲' : '▼'} {short(Math.abs(h.pnl), h.currency)} ({pct(h.pnl_pct, 1)})</span></td>
                  <td className="num"><button className="btn sm ghost" onClick={() => setPrice(h)}>Giá</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!holdings.length && <Empty>Chưa có mã nào. Thử chat: _"mình có 1000 cổ phiếu HPG giá vốn 25"_</Empty>}
      </Card>

      {re.properties?.length > 0 && (
        <Card title="Bất động sản">
          <div className="list">
            {re.properties.map((r) => (
              <div key={r.id} className="item">
                <div className="ic">🏡</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{r.name}</div>
                  <div className="s">{r.address || '—'} · thuê {short(r.monthly_rent, r.currency)}/tháng · lấp đầy {pct(r.occupancy)}</div>
                </div>
                <div className="amt" style={{ textAlign: 'right' }}>
                  <div>{fmt(r.current_value, r.currency)}</div>
                  {r.currency && r.currency !== baseCurrency() && <div className="mini">≈ {short(r.value_base)}</div>}
                  <div className="mini">yield {pct(r.yield ?? r.yield_net ?? ((r.monthly_rent * 12) / (r.current_value || 1)), 1)}/năm</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {d.trades?.length > 0 && (
        <Card title="Lệnh gần đây">
          <div className="list">
            {d.trades.slice(0, 10).map((t) => (
              <div key={t.id} className="item">
                <div className="ic">{t.side === 'buy' ? '🟢' : t.side === 'sell' ? '🔴' : '💵'}</div>
                <div><div className="t">{t.side === 'buy' ? 'Mua' : t.side === 'sell' ? 'Bán' : 'Cổ tức'} {t.symbol}</div><div className="s">{vnDate(t.date)} · {Number(t.quantity).toLocaleString('vi-VN')} × {short(t.price, t.currency)}</div></div>
                <div className="amt">{fmt(t.quantity * t.price)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {adding && (
        <Modal title="Thêm mã nắm giữ" onClose={() => setAdding(false)}>
          <Form
            fields={[
              { k: 'symbol', label: 'Mã', ph: 'HPG' },
              { k: 'name', label: 'Tên' },
              { k: 'asset_class', label: 'Loại', type: 'select', options: [{ value: 'stock', label: 'Cổ phiếu' }, { value: 'fund', label: 'Quỹ/ETF' }, { value: 'gold', label: 'Vàng' }, { value: 'bond', label: 'Trái phiếu' }, { value: 'crypto', label: 'Crypto' }], def: 'stock' },
              { k: 'quantity', label: 'Số lượng', type: 'number' },
              { k: 'currency', label: 'Đồng tiền', type: 'select', options: Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` })), def: baseCurrency() },
              { k: 'avg_cost', label: 'Giá vốn/đơn vị', type: 'number' },
              { k: 'last_price', label: 'Giá hiện tại', type: 'number' },
            ]}
            onSubmit={async (v) => {
              const code = v.currency || baseCurrency();
              await api.post('/investments/holdings', { ...v, currency: code, quantity: Number(v.quantity), avg_cost: toMinor(v.avg_cost, code), last_price: toMinor(v.last_price || v.avg_cost, code) });
              setAdding(false); load(); onRefresh?.();
            }}
            onCancel={() => setAdding(false)}
          />
        </Modal>
      )}

      {price && (
        <Modal title={`Cập nhật giá ${price.symbol}`} onClose={() => setPrice(null)}>
          <Form
            fields={[{ k: 'price', label: `Giá hiện tại (${price.currency || baseCurrency()}/đơn vị)`, type: 'number', def: toMajor(price.last_price, price.currency) }]}
            submit="Cập nhật"
            onSubmit={async (v) => { await api.post('/investments/price', { symbol: price.symbol, price: toMinor(v.price, price.currency || baseCurrency()) }); setPrice(null); load(); onRefresh?.(); }}
            onCancel={() => setPrice(null)}
          />
        </Modal>
      )}

      {trade && (
        <Modal title="Ghi lệnh" onClose={() => setTrade(false)}>
          <Form
            fields={[
              { k: 'symbol', label: 'Mã' },
              { k: 'side', label: 'Lệnh', type: 'select', options: [{ value: 'buy', label: 'Mua' }, { value: 'sell', label: 'Bán' }, { value: 'dividend', label: 'Nhận cổ tức' }], def: 'buy' },
              { k: 'quantity', label: 'Số lượng', type: 'number' },
              { k: 'price', label: 'Giá', type: 'number' },
              { k: 'fee', label: 'Phí', type: 'number', def: 0 },
              { k: 'currency', label: 'Đồng tiền', type: 'select', options: Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` })), def: baseCurrency() },
              { k: 'date', label: 'Ngày', type: 'date', def: new Date().toISOString().slice(0, 10) },
            ]}
            onSubmit={async (v) => {
              const code = v.currency || baseCurrency();
              await api.post('/investments/trade', { ...v, currency: code, quantity: Number(v.quantity), price: toMinor(v.price, code), fee: toMinor(v.fee, code) });
              setTrade(false); load(); onRefresh?.();
            }}
            onCancel={() => setTrade(false)}
          />
        </Modal>
      )}

      {prop && (
        <Modal title="Thêm bất động sản" onClose={() => setProp(false)}>
          <Form
            fields={[
              { k: 'name', label: 'Tên', ph: 'Căn hộ Bình Thạnh', full: true },
              { k: 'address', label: 'Địa chỉ', full: true },
              { k: 'current_value', label: 'Giá trị hiện tại', type: 'number' },
              { k: 'purchase_price', label: 'Giá mua', type: 'number' },
              { k: 'monthly_rent', label: 'Tiền thuê/tháng', type: 'number', def: 0 },
              { k: 'monthly_cost', label: 'Chi phí/tháng', type: 'number', def: 0 },
              { k: 'currency', label: 'Đồng tiền', type: 'select', options: Object.values(CURRENCIES).map((c) => ({ value: c.code, label: `${c.flag} ${c.code}` })), def: 'VND' },
            ]}
            onSubmit={async (v) => {
              const code = v.currency || 'VND';
              await api.post('/properties', {
                ...v, currency: code,
                current_value: toMinor(v.current_value, code),
                purchase_price: toMinor(v.purchase_price, code),
                monthly_rent: toMinor(v.monthly_rent, code),
                monthly_cost: toMinor(v.monthly_cost, code),
                occupancy: 1,
              });
              setProp(false); load(); onRefresh?.();
            }}
            onCancel={() => setProp(false)}
          />
        </Modal>
      )}
    </>
  );
}
