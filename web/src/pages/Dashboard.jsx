import React from 'react';
import { Card, Stat, Progress, LineChart, BarChart, Donut, Empty, Money } from '../components/ui.jsx';
import { fmt, short, pct, vnDate, monthLabel } from '../lib/format.js';

const TONE = { ok: 'ok', warn: 'warn', fast: 'warn', over: 'bad' };

export default function Dashboard({ d, go }) {
  if (!d) return null;
  const t = d.totals || {};
  const nw = d.net_worth || {};
  const sts = d.safe_to_spend || {};
  const fire = d.fire || {};
  const health = d.health || {};

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Tổng quan</h1>
          <p>Tháng {monthLabel(d.month)} · cập nhật tự động từ mọi nguồn tiền của bạn</p>
        </div>
        <span className={`tag ${health.grade === 'A' || health.grade === 'B' ? 'ok' : health.grade === 'C' ? 'warn' : 'bad'}`}>
          Sức khoẻ {health.score}/100 · {health.grade}
        </span>
      </div>

      <div className="grid g4">
        <Stat label="Tài sản ròng" value={short(nw.net)} sub={`Tài sản ${short(nw.assets)} − Nợ ${short(nw.liabilities)}`} />
        <Stat label="Thu tháng này" value={short(t.income)} sub={`Tiết kiệm ${pct(t.savings_rate)}`} tone="up" />
        <Stat label="Chi tháng này" value={short(t.expense)} sub={`Dôi dư ${short(t.net)}`} tone={t.net >= 0 ? '' : 'down'} />
        <Stat label="An toàn tiêu" value={short(sts.available)} sub={`${short(sts.per_day)}/ngày · còn ${sts.days_left} ngày`} tone={sts.available > 0 ? '' : 'down'} />
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Tài sản ròng theo tháng">
          <LineChart series={(d.net_worth_history || []).map((h) => h.net)} labels={(d.net_worth_history || []).map((h) => monthLabel(h.date?.slice(0, 7)))} />
          <div className="mini" style={{ marginTop: 6 }}>
            {d.net_worth_history?.length > 1 && (() => {
              const a = d.net_worth_history[0].net, b = d.net_worth_history.at(-1).net;
              return <>Từ {short(a)} → {short(b)} · <span className={b >= a ? 'up' : 'down'}>{b >= a ? '▲' : '▼'} {short(Math.abs(b - a))}</span></>;
            })()}
          </div>
        </Card>
        <Card title="Thu · chi 6 tháng">
          <BarChart items={(d.trend || []).map((m) => ({ label: monthLabel(m.month), a: m.income, b: m.expense }))} />
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Chi tiêu theo danh mục">
          <Donut items={(d.categories || []).map((c) => ({ label: `${c.icon || ''} ${c.name}`.trim(), value: c.total }))} />
        </Card>
        <Card title="Phân bổ quỹ" right={<button className="btn sm ghost" onClick={() => go('funds')}>Chi tiết →</button>}>
          <div className="list">
            {(d.funds?.funds || []).slice(0, 7).map((f) => (
              <div key={f.id} style={{ padding: '7px 0' }}>
                <div className="between" style={{ fontSize: 13.5 }}>
                  <span>{f.icon} {f.name} <span className="mini">· {f.percent}%</span></span>
                  <b className={f.balance < 0 ? 'down' : ''}>{short(f.balance)}</b>
                </div>
                <Progress value={Math.min(1, (f.balance || 0) / Math.max(1, f.target || f.month_in || f.balance || 1))} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Cảnh báo & phát hiện" right={<button className="btn sm ghost" onClick={() => go('insights')}>Tất cả →</button>}>
          <div className="list">
            {(d.insights || []).slice(0, 6).map((i) => (
              <div key={i.id} className="item" style={{ padding: '9px 0' }}>
                <div className="ic">{i.severity === 'high' ? '🔴' : i.severity === 'medium' ? '🟡' : '🔵'}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontSize: 13.5 }}>{i.title}</div>
                  <div className="s">{i.body}</div>
                </div>
              </div>
            ))}
            {!d.insights?.length && <Empty>Chưa có cảnh báo nào — mọi thứ đang ổn 👍</Empty>}
          </div>
        </Card>

        <Card title="Việc nên làm tiếp theo" right={<button className="btn sm ghost" onClick={() => go('advisor')}>Cố vấn →</button>}>
          <div className="list">
            {(d.actions || []).map((a, i) => (
              <div key={i} className="item" style={{ padding: '9px 0' }}>
                <div className="ic">{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontSize: 13.5 }}>{a.title}</div>
                  <div className="s">{a.detail}</div>
                </div>
              </div>
            ))}
            {!d.actions?.length && <Empty>Không có việc gấp nào.</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Tự do tài chính" right={<button className="btn sm ghost" onClick={() => go('fire')}>Chi tiết →</button>}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div>
              <div className="mini">Ngày dự kiến</div>
              <div style={{ fontSize: 21, fontWeight: 700 }}>{fire.fi_date ? vnDate(fire.fi_date) : 'Chưa xác định'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mini">Cần tích luỹ</div>
              <div style={{ fontSize: 19, fontWeight: 700 }}>{short(fire.fi_number)}</div>
            </div>
          </div>
          <Progress value={fire.progress} tone="ok" />
          <div className="mini" style={{ marginTop: 6 }}>
            Đã đi {pct(fire.progress)} · thu nhập thụ động {short(fire.passive_income?.total)}/tháng phủ {pct(fire.passive_coverage)} chi phí
          </div>
        </Card>

        <Card title="Sắp phải trả" right={<button className="btn sm ghost" onClick={() => go('automation')}>Định kỳ →</button>}>
          <div className="list">
            {(d.upcoming || []).slice(0, 6).map((u, i) => (
              <div key={i} className="item" style={{ padding: '8px 0' }}>
                <div className="ic">{u.type === 'income' ? '💰' : '📅'}</div>
                <div><div className="t" style={{ fontSize: 13.5 }}>{u.name}</div><div className="s">{vnDate(u.date)}</div></div>
                <div className="amt"><Money v={u.type === 'income' ? u.amount : -u.amount} /></div>
              </div>
            ))}
            {!d.upcoming?.length && <Empty>Không có khoản nào trong 14 ngày tới.</Empty>}
          </div>
        </Card>
      </div>

      <div className="card pad0" style={{ marginTop: 14 }}>
        <div style={{ padding: '14px 16px 0' }}><h3 style={{ margin: 0 }}>Giao dịch gần đây</h3></div>
        <div className="list" style={{ marginTop: 8 }}>
          {(d.recent || []).map((t2) => (
            <div key={t2.id} className="item">
              <div className="ic">{t2.category_icon || (t2.type === 'income' ? '💰' : '💸')}</div>
              <div style={{ minWidth: 0 }}>
                <div className="t">{t2.merchant || t2.note || t2.category_name || 'Giao dịch'}</div>
                <div className="s">{vnDate(t2.date)} · {t2.account_name || '—'} · {t2.source}</div>
              </div>
              <div className="amt"><Money v={t2.type === 'income' ? t2.amount : -t2.amount} sign /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
