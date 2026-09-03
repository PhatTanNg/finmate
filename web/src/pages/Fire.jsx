import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, Stat, Progress, Empty, Loading, LineChart } from '../components/ui.jsx';
import { fmt, short, pct, vnDate, monthLabel } from '../lib/format.js';

export default function Fire() {
  const [d, setD] = useState(null);
  const [fc, setFc] = useState(null);
  const [pv, setPv] = useState(null);

  useEffect(() => {
    api.get('/fire').then(setD);
    api.get('/forecast?days=90&months=12').then(setFc);
    api.get('/passive/roadmap').then((r) => setPv(r.roadmap)).catch(() => setPv(null));
  }, []);
  if (!d || !fc) return <Loading />;

  const f = d.fire || {};
  const ef = d.emergency || {};
  const daily = fc.daily || {};
  const monthly = fc.monthly || {};
  const sts = fc.safe_to_spend || {};

  return (
    <>
      <div className="page-h">
        <div><h1>Tự do tài chính & dự báo</h1><p>Khi nào tiền của bạn tự nuôi được bạn</p></div>
      </div>

      <div className="grid g4">
        <Stat label="Ngày tự do tài chính" value={f.fi_reached ? 'Đã đạt 🎉' : f.fi_date ? vnDate(f.fi_date) : '—'} sub={f.fi_reached ? (f.fi_reached_by === 'passive' ? 'Thu nhập thụ động đã phủ đủ chi phí sống' : 'Tài sản sinh lời đã vượt mốc cần có') : f.fi_age ? `Khi bạn ${f.fi_age} tuổi` : `${f.months_to_fi ?? '—'} tháng nữa`} tone="up" />
        <Stat label="Cần tích luỹ" value={short(f.fi_number)} sub={`Rút ${pct(f.swr)}/năm`} />
        <Stat label="Đang có" value={short(f.invested)} sub={`Đã đi ${pct(f.progress)}`} />
        <Stat label="Dôi dư mỗi tháng" value={short(f.monthly_surplus)} sub={`Tiết kiệm ${pct(f.savings_rate)}`} tone={f.monthly_surplus > 0 ? 'up' : 'down'} />
      </div>

      {f.data_months < 3 && (
        <div className="note-warn" style={{ marginTop: 12 }}>
          ⚠️ Dự báo này mới dựa trên <b>{f.data_months || 0} tháng</b> dữ liệu chi tiêu nên còn rất dễ lệch.
          Dùng app thêm vài tháng (hoặc nhập sao kê cũ ở tab <b>Tự động hoá</b>) thì ngày tự do tài chính mới đáng tin.
        </div>
      )}

      <Card title="Tiến độ tới tự do tài chính">
        <Progress value={f.progress} tone="ok" />
        <div className="between mini" style={{ marginTop: 6 }}>
          <span>{short(f.invested)}</span><span>{short(f.fi_number)}</span>
        </div>
        <div className="grid g4" style={{ marginTop: 14 }}>
          <div><div className="mini">Lean FIRE (sống tối giản)</div><b>{short(f.lean_number)}</b></div>
          <div><div className="mini">Fat FIRE (sống thoải mái)</div><b>{short(f.fat_number)}</b></div>
          <div><div className="mini">Coast FIRE</div><b>{short(f.coast_number)}</b><div className="mini">{f.coast_reached ? '✅ Đã đạt — có thể ngừng tích luỹ' : 'Chưa đạt'}</div></div>
          <div><div className="mini">Thu nhập thụ động phủ</div><b>{pct(f.passive_coverage)}</b><div className="mini">chi phí sống</div></div>
        </div>
      </Card>

      {pv && (
        <Card title="Lộ trình để tiền tự nuôi bạn">
          <div className="between" style={{ marginBottom: 8 }}>
            <div><div className="mini">Thu nhập thụ động</div><b style={{ fontSize: 19 }}>{short(pv.current_passive)}<span className="mini">/tháng</span></b></div>
            <div style={{ textAlign: 'right' }}><div className="mini">Chi phí sống</div><b style={{ fontSize: 19 }}>{short(pv.monthly_expense)}<span className="mini">/tháng</span></b></div>
          </div>
          <Progress value={(pv.coverage_pct || 0) / 100} tone={pv.coverage_pct >= 100 ? 'ok' : 'warn'} />
          <div className="mini" style={{ marginTop: 6 }}>Đang phủ <b>{pv.coverage_pct}%</b> chi phí sống của bạn.</div>

          {pv.blocked_by?.length > 0 && (
            <div className="note-warn" style={{ marginTop: 12 }}>
              ⚠️ <b>Chưa nên rót vốn vội.</b> Còn {pv.blocked_by.map((b) => (b.key === 'emergency' ? `quỹ khẩn cấp thiếu ${short(b.amount)}` : `nợ lãi cao ${short(b.amount)}`)).join(' và ')}.
              Dọn xong hai việc đó thì mỗi đồng đầu tư mới thực sự là lãi.
            </div>
          )}

          <div className="hr" />
          <div className="mini" style={{ marginBottom: 6 }}>VIỆC CẦN LÀM</div>
          <ol className="steps">
            {(pv.next_steps || []).slice(0, 4).map((s) => (
              <li key={s.key}><b>{s.title}</b><div className="mini">{s.body}</div></li>
            ))}
          </ol>

          <div className="hr" />
          <div className="scrollx">
            <table>
              <thead><tr><th>Mốc</th><th className="num">Cần/tháng</th><th className="num">Vốn cần</th><th className="num">Khi nào</th></tr></thead>
              <tbody>
                {(pv.milestones || []).map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num">{short(m.target)}</td>
                    <td className="num">{m.reached ? '—' : m.capital_needed === null ? '—' : short(m.capital_needed)}</td>
                    <td className="num">
                      {m.reached ? <span className="up">đã đạt ✅</span>
                        : m.months === null ? <span className="dim">chưa tới được</span>
                          : <span>{vnDate(m.date)} <span className="mini">({m.months} tháng)</span></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mini" style={{ marginTop: 6 }}>
            Tính theo khoản để dành <b>{short(pv.monthly_contribution)}/tháng</b> và lợi suất bình quân {pct(pv.blended_yield, 1)}/năm.
          </div>
        </Card>
      )}

      {f.projection?.length > 0 && (
        <Card title="Đường tích luỹ dự phóng">
          <LineChart series={f.projection.map((p) => p.invested)} labels={f.projection.map((p) => (p.year ? `${p.year}` : ''))} color="#2fd58a" />
          <div className="mini" style={{ marginTop: 6 }}>Giả định lợi suất thực {pct(f.real_return, 1)}/năm (đã trừ lạm phát {pct(f.inflation, 1)}).</div>
        </Card>
      )}

      {f.scenarios?.length > 0 && (
        <Card title="Nếu bạn thay đổi một chút...">
          <div className="scrollx">
            <table>
              <thead><tr><th>Kịch bản</th><th className="num">Dôi dư/tháng</th><th className="num">Ngày tự do</th><th className="num">Tuổi</th><th className="num">So với hiện tại</th></tr></thead>
              <tbody>
                {f.scenarios.map((s, i) => {
                  const base = f.scenarios.find((x) => x.key === 'base') || f.scenarios[0];
                  const saved = (base?.months ?? 0) - (s.months ?? 0);
                  return (
                    <tr key={s.key || i}>
                      <td>{s.label}</td>
                      <td className="num">{short(s.surplus)}</td>
                      <td className="num">{s.date ? vnDate(s.date) : '—'}</td>
                      <td className="num">{s.age ? s.age.toFixed(1) : '—'}</td>
                      <td className="num">{saved > 0 ? <span className="up">sớm hơn {saved} tháng</span> : saved < 0 ? <span className="down">muộn hơn {-saved} tháng</span> : <span className="dim">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid g2">
        <Card title="Quỹ khẩn cấp">
          <div className="between" style={{ marginBottom: 8 }}>
            <div><div className="mini">Đang có</div><b style={{ fontSize: 19 }}>{fmt(ef.current)}</b></div>
            <div style={{ textAlign: 'right' }}><div className="mini">Mục tiêu {ef.target_months} tháng</div><b style={{ fontSize: 19 }}>{short(ef.target_amount)}</b></div>
          </div>
          <Progress value={(ef.months_covered || 0) / (ef.target_months || 6)} tone={ef.ok ? 'ok' : 'warn'} />
          <div className="mini" style={{ marginTop: 6 }}>
            {ef.has_data === false
              ? 'Chưa có khoản chi nào được ghi nên app chưa biết bạn sống hết bao nhiêu mỗi tháng. Bật đọc tin nhắn ngân hàng hoặc nhắn cho cố vấn để app tính giúp.'
              : <>Đủ sống <b>{ef.months_covered}</b> tháng nếu mất thu nhập.{' '}
                {ef.ok ? '✅ An toàn.' : `Còn thiếu ${short(ef.gap)} — nên ưu tiên lấp đầy trước khi đầu tư mạo hiểm.`}</>}
          </div>
        </Card>

        <Card title="An toàn chi tiêu tháng này">
          <div className="grid g2">
            <div><div className="mini">Tiền lỏng</div><b>{short(sts.liquid)}</b></div>
            <div><div className="mini">Hoá đơn sắp tới</div><b className="down">{short(sts.upcoming_fixed)}</b></div>
            <div><div className="mini">Đã tiêu tháng này</div><b>{short(sts.spent_this_month)}</b></div>
            <div><div className="mini">Được tiêu tiếp</div><b className="up">{short(sts.available)}</b></div>
          </div>
          <div className="hr" />
          <div className="mini">
            Tương đương <b>{short(sts.per_day)}/ngày</b> trong {sts.days_left} ngày còn lại.
            {sts.budget_remaining < sts.cash_available
              ? ' Giới hạn bởi hạn mức chi tiêu bình thường của bạn (tiền mặt vẫn dư).'
              : ' Giới hạn bởi tiền mặt khả dụng sau khi trừ hoá đơn và đệm an toàn.'}
          </div>
        </Card>
      </div>

      <Card title="Dự báo số dư 90 ngày">
        <LineChart series={(daily.series || []).map((p) => p.balance)} labels={(daily.series || []).map((p) => p.date?.slice(8, 10))} color={daily.shortfall ? '#ff6b6b' : '#5b8cff'} />
        <div className="mini" style={{ marginTop: 6 }}>
          {daily.shortfall
            ? <span className="down">⚠️ Dự báo hụt tiền vào {vnDate(daily.shortfall.date)} (thiếu {short(Math.abs(daily.shortfall.balance))}). Nên chuyển bớt từ tiết kiệm hoặc giãn khoản chi lớn.</span>
            : <span className="up">✅ Không có nguy cơ hụt tiền. Thấp nhất còn {short(daily.min?.balance)} vào {daily.min?.date ? vnDate(daily.min.date) : '—'}.</span>}
        </div>
      </Card>

      <Card title="Dự báo 12 tháng tới">
        <div className="scrollx">
          <table>
            <thead><tr><th>Tháng</th><th className="num">Thu</th><th className="num">Chi</th><th className="num">Dôi dư</th><th className="num">Tích luỹ</th></tr></thead>
            <tbody>
              {(monthly.rows || []).map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num up">{short(r.income)}</td>
                  <td className="num down">{short(r.expense)}</td>
                  <td className="num"><b className={r.net >= 0 ? 'up' : 'down'}>{short(r.net)}</b></td>
                  <td className="num">{short(r.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!monthly.rows?.length && <Empty>Chưa đủ dữ liệu để dự báo.</Empty>}
      </Card>
    </>
  );
}
