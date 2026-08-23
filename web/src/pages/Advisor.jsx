import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, Donut, Md } from '../components/ui.jsx';
import { fmt, short, pct } from '../lib/format.js';

export default function Advisor() {
  const [health, setHealth] = useState(null);
  const [actions, setActions] = useState([]);
  const [surplus, setSurplus] = useState(null);
  const [amount, setAmount] = useState('');

  const loadSurplus = (amt) => api.get(`/advisor/surplus${amt ? `?amount=${amt}` : ''}`).then(setSurplus);
  useEffect(() => {
    api.get('/advisor/health').then((d) => setHealth(d.health));
    api.get('/advisor/actions?limit=8').then((d) => setActions(d.actions || []));
    loadSurplus();
  }, []);
  if (!health) return <Loading />;

  const tone = (s) => (s >= 75 ? 'ok' : s >= 50 ? 'warn' : 'bad');

  return (
    <>
      <div className="page-h">
        <div><h1>Cố vấn</h1><p>Chẩn đoán sức khoẻ tài chính và thứ tự ưu tiên cho từng đồng tiền</p></div>
      </div>

      <div className="grid g4">
        <Stat label="Điểm sức khoẻ" value={`${health.score}/100`} sub={`${health.grade} — ${health.label}`} tone={health.score >= 70 ? 'up' : health.score >= 50 ? 'warn' : 'down'} />
        {health.components.slice(0, 3).map((c) => (
          <Stat key={c.key} label={c.label} value={`${c.score}`} sub={c.detail} tone={c.score >= 75 ? 'up' : c.score >= 50 ? '' : 'down'} />
        ))}
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Chẩn đoán chi tiết">
          {health.components.map((c) => (
            <div key={c.key} style={{ padding: '7px 0' }}>
              <div className="between" style={{ fontSize: 13.5 }}>
                <span>{c.label} <span className="mini">· trọng số {c.weight}%</span></span>
                <b>{c.score}/100</b>
              </div>
              <Progress value={c.score / 100} tone={tone(c.score)} />
              <div className="mini" style={{ marginTop: 2 }}>{c.detail}</div>
            </div>
          ))}
        </Card>

        <Card title="Việc nên làm, theo thứ tự">
          <div className="list">
            {actions.map((a, i) => (
              <div key={i} className="item" style={{ padding: '10px 0' }}>
                <div className="ic">{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{a.title}</div>
                  <div className="s">{a.detail}</div>
                </div>
                {a.tab && <span className="tag info">{a.tab}</span>}
              </div>
            ))}
            {!actions.length && <Empty>Không có việc gấp — bạn đang đi đúng hướng 👍</Empty>}
          </div>
        </Card>
      </div>

      <Card
        title="Tiền dư nên dùng thế nào?"
        right={
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" style={{ width: 150 }} type="number" placeholder="Số tiền dư" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn sm" onClick={() => loadSurplus(Number(amount) || 0)}>Tính</button>
          </div>
        }
      >
        {!surplus ? <Empty>Đang tính...</Empty> : (
          <>
            <div className="mini" style={{ marginBottom: 10 }}>
              Thác nước ưu tiên cho <b>{fmt(surplus.plan?.amount)}</b> — mỗi đồng được đặt vào nơi tạo giá trị cao nhất trước.
            </div>
            <div className="list">
              {(surplus.plan?.steps || []).map((s, i) => (
                <div key={i} className="item" style={{ padding: '10px 0' }}>
                  <div className="ic">{i + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{s.label}</div>
                    <div className="s">{s.why}</div>
                  </div>
                  <div className="amt">{short(s.amount)}</div>
                </div>
              ))}
            </div>
            {surplus.plan?.left > 0 && <div className="mini" style={{ marginTop: 8 }}>Còn dư {fmt(surplus.plan.left)} — có thể để dành cho cơ hội hoặc nâng chất lượng sống.</div>}
            <div className="hr" />
            <h3 style={{ margin: '0 0 10px' }}>Phân bổ đầu tư gợi ý</h3>
            <Donut items={(surplus.split || []).map((s) => ({ label: s.label, value: s.amount }))} />
            <p className="mini" style={{ marginTop: 10 }}>
              ⚠️ Đây là gợi ý phân bổ theo khẩu vị rủi ro, không phải khuyến nghị mua bán mã cụ thể.
              Luôn giữ quỹ khẩn cấp đầy trước khi tăng tỷ trọng tài sản rủi ro.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
