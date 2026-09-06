import React, { useEffect, useState } from 'react';
import { api, EMBEDDED } from '../lib/api.js';
import { Card } from './ui.jsx';

/**
 * Khoá API của RIÊNG bạn (bản dùng máy chủ).
 *
 * Máy chủ chung mà chỉ có một khoá trong biến môi trường thì chủ máy chủ trả
 * tiền cho tất cả mọi người, và không ai chọn được model cho mình. Khoá dán ở
 * đây nằm trong sổ riêng của bạn và được ưu tiên hơn khoá của máy chủ.
 *
 * Bản chạy thẳng trên máy có thẻ riêng (khoá nằm trong máy, không có máy chủ),
 * nên thẻ này không hiện ở đó.
 */
export default function AiKeyCard() {
  const [tt, setTt] = useState(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [modelVat, setModelVat] = useState('');
  const [url, setUrl] = useState('');
  const [ban, setBan] = useState(false);
  const [thu, setThu] = useState(null);
  const [tin, setTin] = useState(null);

  const nap = () => api.get('/ai/key').then((d) => {
    setTt(d);
    setModel(d.llm_model || '');
    setModelVat(d.llm_model_fast || '');
    setEffort(d.llm_effort || '');
    setUrl(d.llm_url || '');
  }).catch(() => setTt(null));
  useEffect(() => { if (!EMBEDDED) nap(); }, []);
  if (EMBEDDED || !tt) return null;

  const luu = async () => {
    setBan(true); setTin(null);
    try {
      await api.post('/ai/key', { ...(key ? { key } : {}), model, model_fast: modelVat, effort, url });
      setKey('');
      await nap();
      setTin('Đã lưu. Cố vấn AI dùng khoá này ngay từ câu tiếp theo.');
    } catch (e) { setTin(e.message); } finally { setBan(false); }
  };
  const go = async () => {
    if (!confirm('Gỡ khoá riêng của bạn?' + (tt.may_chu_co_key ? ' Sau đó bạn sẽ dùng khoá chung của máy chủ.' : ' Sau đó cố vấn sẽ chạy bằng bộ luật, không có AI.'))) return;
    setBan(true); setTin(null);
    try { await api.del('/ai/key'); setTin('Đã gỡ khoá riêng.'); }
    catch (e) { setTin(e.message); }
    finally { await nap(); setBan(false); }
  };
  const thuKetNoi = async () => {
    setBan(true); setThu(null);
    try { setThu((await api.post('/ai/test', { key, model, url })).ket_qua); }
    catch (e) { setThu({ ok: false, error: e.message }); }
    finally { setBan(false); }
  };

  const nguon = {
    cua_ban: <>Đang dùng <b>khoá riêng của bạn</b> (<code>{tt.key_che}</code>) · model <b>{tt.model}</b></>,
    cua_may_chu: <>Đang dùng <b>khoá chung của máy chủ</b> · model <b>{tt.model}</b>. Dán khoá riêng vào đây nếu bạn muốn tự chọn model và tự trả tiền.</>,
    chua_co: <>Chưa có khoá nào — cố vấn đang chạy bằng <b>bộ luật tiếng Việt</b>. Vẫn dùng được đủ, chỉ kém linh hoạt hơn.</>,
  }[tt.nguon];

  return (
    <Card title="Cố vấn AI — khoá của riêng bạn">
      <p className="mini" style={{ marginTop: 0 }}>{nguon}</p>
      <div className="form">
        <label className="fld full"><span>API key (Claude <code>sk-ant-…</code> hoặc OpenAI-compatible)</span>
          <input className="inp" type="text" name="finmate-llm-key" value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={tt.nguon === 'cua_ban' ? 'Để trống nếu giữ khoá đang dùng' : 'sk-ant-…'}
            autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
            style={{ fontFamily: 'ui-monospace, monospace' }} /></label>
        <label className="fld"><span>Model</span>
          <input className="inp" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-5" />
          <small className="mini">Cố vấn phải điều khiển 74 công cụ — <code>claude-sonnet-5</code> là mức nên dùng.</small></label>
        <label className="fld"><span>Độ sâu suy nghĩ</span>
          <select className="inp" value={effort} onChange={(e) => setEffort(e.target.value)}>
            <option value="">Mặc định</option><option value="low">low (nhanh, rẻ)</option><option value="medium">medium</option><option value="high">high</option>
          </select></label>
        <label className="fld"><span>Model cho việc vặt</span>
          <input className="inp" value={modelVat} onChange={(e) => setModelVat(e.target.value)} placeholder="claude-haiku-4-5" />
          <small className="mini">Phân loại câu chat và đoán danh mục cho tin nhắn ngân hàng — việc ngắn, làm nhiều lần mỗi ngày.
            Bỏ trống thì dùng chung model ở trên.</small></label>
        <label className="fld full"><span>URL API (bỏ trống nếu dùng Claude/OpenAI chính thức)</span>
          <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/v1/chat/completions" /></label>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={ban} onClick={luu}>Lưu</button>
        <button className="btn" disabled={ban} onClick={thuKetNoi}>Thử kết nối</button>
        {tt.nguon === 'cua_ban' && <button className="btn ghost" disabled={ban} onClick={go}>Gỡ khoá riêng</button>}
      </div>
      {tin && <p className="mini">{tin}</p>}
      {thu && (
        <div className={thu.ok ? 'note mini' : 'note-warn mini'} style={{ marginTop: 10 }}>
          {thu.ok
            ? <>✅ Gọi được <b>{thu.model}</b> ({thu.provider}) · {thu.ms}ms · model trả lời: “{thu.reply}”.</>
            : <>❌ Chưa gọi được{thu.model ? <> <b>{thu.model}</b></> : null}. <div style={{ marginTop: 4 }}><code>{thu.error}</code></div>
              {thu.goi_y && <div style={{ marginTop: 6 }}>👉 {thu.goi_y}</div>}</>}
        </div>
      )}
      {tt.dung && tt.dung.thang_nay.luot > 0 && (
        <div className="note mini" style={{ marginTop: 10 }}>
          <b>Tháng {tt.dung.thang}</b>: {tt.dung.thang_nay.luot.toLocaleString('vi-VN')} lượt gọi ·
          {' '}{Math.round(tt.dung.thang_nay.vao / 1000).toLocaleString('vi-VN')}k token vào ·
          {' '}{Math.round(tt.dung.thang_nay.ra / 1000).toLocaleString('vi-VN')}k token ra
          {tt.dung.thang_nay.cache_doc > 0 && <> · {Math.round(tt.dung.thang_nay.cache_doc / 1000).toLocaleString('vi-VN')}k đọc từ bộ đệm (rẻ gấp 10)</>}
          <div style={{ marginTop: 4 }}>
            {tt.dung.uoc_tinh_usd.thang_nay != null
              ? <>≈ <b>${tt.dung.uoc_tinh_usd.thang_nay.toFixed(2)}</b> tháng này (tổng từ trước tới nay ≈ ${tt.dung.uoc_tinh_usd.tong.toFixed(2)}) — ước tính theo bảng giá niêm yết, hoá đơn thật do nhà cung cấp tính.</>
              : <>Chưa quy ra tiền được: <code>{tt.dung.model}</code> không có trong bảng giá app biết. Số token ở trên vẫn là thật.</>}
          </div>
          {tt.gia_model && (
            <div className="muted" style={{ marginTop: 4 }}>
              Model đang dùng: ${tt.gia_model.vao}/triệu token vào · ${tt.gia_model.ra}/triệu token ra.
              {tt.bang_gia?.some((g) => g.vao < tt.gia_model.vao) && <> Rẻ hơn: {tt.bang_gia.filter((g) => g.vao < tt.gia_model.vao).map((g) => `${g.model} ($${g.vao}/$${g.ra})`).join(' · ')}.</>}
            </div>
          )}
        </div>
      )}
      <p className="mini muted" style={{ marginTop: 10 }}>
        Khoá nằm trong sổ riêng của bạn trên máy chủ, không ai khác đọc được, và không đi kèm bản xuất dữ liệu.
      </p>
    </Card>
  );
}
