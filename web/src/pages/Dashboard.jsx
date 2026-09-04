import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Progress, BarChart, Donut, Empty, Money } from '../components/ui.jsx';
import { short, pct, vnDate, monthLabel } from '../lib/format.js';

const ACC_ICON = { bank: '🏦', savings: '🔒', ewallet: '📱', cash: '💵', credit: '💳', credit_card: '💳', investment: '📈', brokerage: '📈', crypto: '🪙', real_estate: '🏠', loan: '🧾' };
const SEV_ICON = { danger: '🔴', warn: '🟠', info: '💡' };

/**
 * Trang chủ kiểu app ngân hàng: một con số lớn, thẻ tài khoản cuộn ngang, hàng
 * hành động nhanh, rồi tới phần cố vấn đang đề xuất gì và giao dịch gần đây.
 * Mọi thứ đều chạm được để đi tiếp — nhưng việc nào cố vấn làm được thì làm
 * ngay tại đây bằng nút Đồng ý.
 */
export default function Dashboard({ d, go, onRefresh }) {
  const [props, setProps] = useState([]);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});

  const loadProps = () => api.get('/ai/proposals').then((r) => setProps(r.proposals || [])).catch(() => setProps([]));
  useEffect(() => { loadProps(); }, []);

  if (!d) return null;
  const t = d.totals || {};
  const nw = d.net_worth || {};
  const sts = d.safe_to_spend || {};
  const fire = d.fire || {};
  const health = d.health || {};
  const hist = d.net_worth_history || [];
  const delta = hist.length > 1 ? nw.net - hist[Math.max(0, hist.length - 2)].net : null;
  const name = d.profile?.name || 'bạn';
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const spendPct = sts.budget_remaining + sts.spent_this_month > 0 ? sts.spent_this_month / (sts.budget_remaining + sts.spent_this_month) : 0;

  async function decide(p, yes) {
    setBusy(p.id);
    try {
      const r = await api.post(`/ai/proposals/${p.id}/${yes ? 'accept' : 'reject'}`);
      if (r.ok === false) throw new Error(r.error || 'Không làm được');
      setDone((x) => ({ ...x, [p.id]: yes ? 'done' : 'skip' }));
      if (yes) onRefresh?.();
      setTimeout(loadProps, 1200);
    } catch (e) {
      alert(e.message);
    } finally { setBusy(null); }
  }

  return (
    <>
      <div className="hello">
        <div className="avatar">{name.trim().slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>{greet}, {name}</h1>
          <p>{monthLabel(d.month)} · {d.accounts?.length || 0} tài khoản · sức khoẻ {health.score}/100</p>
        </div>
        <span className={`tag ${health.grade === 'A' || health.grade === 'B' ? 'ok' : health.grade === 'C' ? 'warn' : 'bad'}`}>{health.grade}</span>
      </div>

      <div className="hero">
        <div className="lab">Tài sản ròng</div>
        <div className="big">{short(nw.net)}</div>
        <div className="sub">
          {delta != null && <span className="pill">{delta >= 0 ? '▲' : '▼'} {short(Math.abs(delta))} so với tháng trước</span>}
          {delta == null && <span className="pill">Tài sản {short(nw.assets)} · nợ {short(nw.liabilities)}</span>}
        </div>
        <div className="grid2">
          <div className="cell"><div className="lab">Còn tiêu an toàn tháng này</div><b>{short(sts.available)}</b><div className="lab">{short(sts.per_day)}/ngày · {sts.days_left} ngày</div></div>
          <div className="cell"><div className="lab">Tháng này</div><b>{t.net >= 0 ? '+' : ''}{short(t.net)}</b><div className="lab">thu {short(t.income)} · chi {short(t.expense)}</div></div>
        </div>
      </div>

      <div className="actions">
        <button className="action primary" onClick={() => go('chat')}><span className="ic">💬</span>Nhắn cố vấn</button>
        <button className="action" onClick={() => go('chat')}><span className="ic">📷</span>Chụp hoá đơn</button>
        <button className="action" onClick={() => go('transactions')}><span className="ic">➕</span>Ghi giao dịch</button>
        <button className="action" onClick={() => go('funds')}><span className="ic">🧺</span>Quỹ</button>
        <button className="action" onClick={() => go('goals')}><span className="ic">🎯</span>Mục tiêu</button>
        <button className="action" onClick={() => go('fire')}><span className="ic">🔥</span>Tự do</button>
      </div>

      <div className="section-h"><h2>Tài khoản</h2><button onClick={() => go('accounts')}>Tất cả</button></div>
      <div className="carousel">
        {(d.accounts || []).slice(0, 8).map((a) => (
          <div key={a.id} className="acc-card" onClick={() => go('accounts')} role="button" tabIndex={0}>
            <div className="ic">{a.icon || ACC_ICON[a.type] || '🏦'}</div>
            <div className="n">{a.name}</div>
            <div className={`b ${a.balance < 0 ? 'down' : ''}`}>{short(a.balance, a.currency)}</div>
          </div>
        ))}
        <div className="acc-card add" onClick={() => go('accounts')} role="button" tabIndex={0}><span style={{ fontSize: 22 }}>＋</span>Thêm tài khoản</div>
      </div>
      <div className="acc-list card pad0">
        <div className="list">
          {(d.accounts || []).slice(0, 4).map((a) => (
            <div key={a.id} className="item tap" onClick={() => go('accounts')} role="button" tabIndex={0}>
              <div className="ic">{a.icon || ACC_ICON[a.type] || '🏦'}</div>
              <div style={{ minWidth: 0 }}><div className="t">{a.name}</div><div className="s">{a.institution || a.type}{a.currency && a.currency !== (d.base_currency || 'VND') ? ` · ${a.currency}` : ''}</div></div>
              <div className={`amt ${a.balance < 0 ? 'down' : ''}`}>{short(a.balance, a.currency)}</div>
            </div>
          ))}
          {(d.accounts || []).length > 4 && <div className="item tap" onClick={() => go('accounts')} role="button" tabIndex={0}><div className="ic">…</div><div className="t">Xem {(d.accounts || []).length - 4} tài khoản còn lại</div></div>}
          {!(d.accounts || []).length && <div className="item tap" onClick={() => go('accounts')} role="button" tabIndex={0}><div className="ic">＋</div><div className="t">Thêm tài khoản đầu tiên</div></div>}
        </div>
      </div>

      {props.length > 0 && (
        <>
          <div className="section-h"><h2>Cố vấn đề xuất</h2><button onClick={() => go('chat')}>Trò chuyện</button></div>
          <div className="grid" style={{ gap: 10 }}>
            {props.slice(0, 3).map((p) => (
              <div key={p.id} className={`prop ${done[p.id] ? 'done' : ''}`}>
                <div className="ic">{SEV_ICON[p.muc_do] || '💡'}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="t">{p.tieu_de}</div>
                  {p.noi_dung && <div className="s">{p.noi_dung.length > 220 ? `${p.noi_dung.slice(0, 220)}…` : p.noi_dung}</div>}
                  {done[p.id]
                    ? <div className="mini" style={{ marginTop: 8 }}>{done[p.id] === 'done' ? '✅ Đã làm — hoàn tác được ở trang AI đã làm gì' : 'Đã bỏ qua'}</div>
                    : (
                      <div className="btns">
                        <button className="btn primary sm" disabled={busy === p.id} onClick={() => decide(p, true)}>{busy === p.id ? 'Đang làm…' : 'Đồng ý'}</button>
                        <button className="btn sm" disabled={busy === p.id} onClick={() => decide(p, false)}>Bỏ qua</button>
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-h"><h2>Chi tiêu tháng này</h2><button onClick={() => go('budgets')}>Ngân sách</button></div>
      <Card>
        <div className="between">
          <div><div className="mini">Đã chi</div><div style={{ fontSize: 24, fontWeight: 750, letterSpacing: '-.02em' }}>{short(t.expense)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="mini">Mức thường tháng</div><div style={{ fontSize: 16, fontWeight: 650 }}>{short((sts.spent_this_month || 0) + (sts.budget_remaining || 0))}</div></div>
        </div>
        <div style={{ marginTop: 10 }}><Progress value={spendPct} tone={spendPct > 1 ? 'bad' : spendPct > 0.85 ? 'warn' : 'ok'} /></div>
        <div className="mini" style={{ marginTop: 8 }}>Tiết kiệm {pct(t.savings_rate)} thu nhập · {(d.categories || []).slice(0, 3).map((c) => `${c.icon || ''} ${c.name} ${short(c.amount ?? c.total)}`).join(' · ')}</div>
      </Card>

      <div className="section-h"><h2>Giao dịch gần đây</h2><button onClick={() => go('transactions')}>Tất cả</button></div>
      <div className="card pad0">
        <div className="list">
          {(d.recent || []).slice(0, 6).map((t2) => (
            <div key={t2.id} className="item tap" onClick={() => go('transactions')}>
              <div className="ic">{t2.category_icon || (t2.type === 'income' ? '💰' : t2.type === 'transfer' ? '🔁' : '💸')}</div>
              <div style={{ minWidth: 0 }}>
                <div className="t">{t2.merchant || t2.note || t2.category_name || 'Giao dịch'}</div>
                <div className="s">{t2.category_name || (t2.type === 'transfer' ? 'Chuyển khoản' : '—')} · {vnDate(t2.date)}</div>
              </div>
              <div className="amt"><Money v={t2.type === 'income' ? t2.amount : t2.type === 'transfer' ? 0 : -t2.amount} sign /></div>
            </div>
          ))}
          {!d.recent?.length && <Empty>Chưa có giao dịch. Nhắn cố vấn "trưa nay ăn 60k" để bắt đầu.</Empty>}
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Mục tiêu" right={<button className="btn sm ghost" onClick={() => go('goals')}>Tất cả</button>}>
          {!(d.goals || []).length && <Empty>Chưa có mục tiêu. Nhắn "mua xe 500 triệu trong 3 năm" là có ngay.</Empty>}
          {(d.goals || []).slice(0, 4).map((g) => {
            const p = g.target_amount ? Math.min(1, (g.current_amount || 0) / g.target_amount) : 0;
            return (
              <div key={g.id} style={{ padding: '7px 0' }}>
                <div className="between" style={{ fontSize: 14 }}>
                  <span style={{ fontWeight: 550 }}>{g.name}</span>
                  <span className="mini">{short(g.current_amount, g.currency)} / {short(g.target_amount, g.currency)}</span>
                </div>
                <div style={{ marginTop: 5 }}><Progress value={p} tone="ok" /></div>
              </div>
            );
          })}
        </Card>

        <Card title="Sắp tới hạn" right={<button className="btn sm ghost" onClick={() => go('automation')}>Định kỳ</button>}>
          <div className="list">
            {(d.upcoming || []).slice(0, 5).map((u, i) => (
              <div key={i} className="item" style={{ padding: '8px 0' }}>
                <div className="ic" style={{ width: 36, height: 36, flex: '0 0 36px', fontSize: 16 }}>{u.type === 'income' ? '💰' : '📅'}</div>
                <div style={{ minWidth: 0 }}><div className="t" style={{ fontSize: 14 }}>{u.name}</div><div className="s">{vnDate(u.date)}</div></div>
                <div className="amt"><Money v={u.type === 'income' ? u.amount : -u.amount} /></div>
              </div>
            ))}
            {!d.upcoming?.length && <Empty>Không có khoản nào trong 14 ngày tới.</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Tự do tài chính" right={<button className="btn sm ghost" onClick={() => go('fire')}>Chi tiết</button>}>
          <div className="between" style={{ marginBottom: 8 }}>
            <div>
              <div className="mini">{fire.fi_reached ? 'Trạng thái' : 'Ngày dự kiến'}</div>
              <div style={{ fontSize: 21, fontWeight: 750, letterSpacing: '-.02em' }}>{fire.fi_reached ? 'Đã đạt 🎉' : fire.fi_date ? vnDate(fire.fi_date) : 'Chưa xác định'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mini">Cần tích luỹ</div>
              <div style={{ fontSize: 17, fontWeight: 650 }}>{short(fire.fi_number)}</div>
            </div>
          </div>
          <Progress value={fire.progress} tone="ok" />
          <div className="mini" style={{ marginTop: 6 }}>Đã đi {pct(fire.progress)} · thụ động {short(fire.passive_income?.total)}/tháng phủ {pct(fire.passive_coverage)} chi phí</div>
        </Card>

        <Card title="Cảnh báo & phát hiện" right={<button className="btn sm ghost" onClick={() => go('insights')}>Tất cả</button>}>
          <div className="list">
            {(d.insights || []).slice(0, 4).map((i) => (
              <div key={i.id} className="item" style={{ padding: '8px 0' }}>
                <div className="ic" style={{ width: 36, height: 36, flex: '0 0 36px', fontSize: 15 }}>{i.severity === 'danger' ? '🔴' : i.severity === 'warn' ? '🟡' : i.severity === 'success' ? '🟢' : '🔵'}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontSize: 14, whiteSpace: 'normal' }}>{i.title}</div>
                  <div className="s" style={{ whiteSpace: 'normal' }}>{i.body}</div>
                </div>
              </div>
            ))}
            {!d.insights?.length && <Empty>Chưa có cảnh báo nào — mọi thứ đang ổn 👍</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14, marginBottom: 10 }}>
        <Card title="Thu · chi 6 tháng">
          <BarChart items={(d.trend || []).map((m) => ({ label: monthLabel(m.month), a: m.income, b: m.expense }))} />
        </Card>
        <Card title="Chi theo danh mục">
          <Donut items={(d.categories || []).map((c) => ({ label: `${c.icon || ''} ${c.name}`.trim(), value: c.amount ?? c.total }))} />
        </Card>
      </div>
    </>
  );
}
