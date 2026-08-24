/**
 * Chuyển tiền quốc tế (kiều hối) — dành cho người sống ở nước ngoài nhưng
 * vẫn giữ tài sản/đầu tư ở Việt Nam.
 *
 * Mỗi lần gửi tiền là một giao dịch `transfer` giữa hai tài khoản khác đồng
 * tiền. App đo giúp bạn: tỷ giá thực tế nhận được, mất bao nhiêu vào phí và
 * chênh lệch tỷ giá, và hiện có phải thời điểm tốt để gửi hay không.
 */
import { all, get } from '../db.js';
import { today, addMonths, monthKey, startOfMonth } from '../util/date.js';
import { getRate, baseCurrency, convert } from './fx.js';
import { toMajor, toMinor, currency as cur, fmtMoney } from '../util/currency.js';

/** Mọi giao dịch chuyển tiền có đổi đồng tiền. */
export function listRemittances({ from = null, to = null, limit = 200 } = {}) {
  const where = ["t.type = 'transfer'", 't.counter_currency IS NOT NULL', 't.counter_currency <> t.currency'];
  const params = [];
  if (from) { where.push('t.date >= ?'); params.push(from); }
  if (to) { where.push('t.date <= ?'); params.push(to); }
  params.push(limit);
  const rows = all(
    `SELECT t.*, a.name AS from_account, a2.name AS to_account
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.counter_account_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    params
  );
  return rows.map(decorate);
}

function decorate(t) {
  const sentMajor = toMajor(t.amount, t.currency);
  const gotMajor = toMajor(t.counter_amount || 0, t.counter_currency);
  const effective = sentMajor ? gotMajor / sentMajor : 0;
  const mid = getRate(t.currency, t.counter_currency, t.date);
  // Số tiền lẽ ra nhận được nếu đổi đúng tỷ giá giữa thị trường
  const idealGot = sentMajor * mid;
  const lostMajor = Math.max(0, idealGot - gotMajor) / (mid || 1); // quy về đồng tiền gửi
  return {
    ...t,
    sent: t.amount,
    sent_currency: t.currency,
    received: t.counter_amount,
    received_currency: t.counter_currency,
    effective_rate: effective,
    mid_rate: mid,
    spread_pct: mid ? (mid - effective) / mid : 0,
    cost: toMinor(lostMajor, t.currency),
    label: `${fmtMoney(t.amount, t.currency)} → ${fmtMoney(t.counter_amount || 0, t.counter_currency)}`,
  };
}

/** Thống kê tổng hợp trong khoảng thời gian (mặc định 12 tháng gần nhất). */
export function remittanceSummary({ months = 12, from = null, to = today() } = {}) {
  const start = from || startOfMonth(addMonths(to, -(months - 1)));
  const list = listRemittances({ from: start, to });
  if (!list.length) {
    return { count: 0, from: start, to, corridors: [], total_sent: 0, total_received: 0, total_cost: 0, by_month: [] };
  }

  const corridors = {};
  for (const r of list) {
    const key = `${r.sent_currency}->${r.received_currency}`;
    const c = (corridors[key] = corridors[key] || {
      pair: key,
      from_currency: r.sent_currency,
      to_currency: r.received_currency,
      count: 0,
      sent: 0,
      received: 0,
      cost: 0,
      fees: 0,
      best_rate: 0,
      worst_rate: Infinity,
    });
    c.count++;
    c.sent += r.sent;
    c.received += r.received || 0;
    c.cost += r.cost || 0;
    c.fees += r.fee || 0;
    if (r.effective_rate > c.best_rate) { c.best_rate = r.effective_rate; c.best_date = r.date; }
    if (r.effective_rate > 0 && r.effective_rate < c.worst_rate) { c.worst_rate = r.effective_rate; c.worst_date = r.date; }
  }

  const corridorList = Object.values(corridors).map((c) => {
    const sentMajor = toMajor(c.sent, c.from_currency);
    const gotMajor = toMajor(c.received, c.to_currency);
    return {
      ...c,
      worst_rate: c.worst_rate === Infinity ? 0 : c.worst_rate,
      avg_rate: sentMajor ? gotMajor / sentMajor : 0,
      current_rate: getRate(c.from_currency, c.to_currency, today()),
      cost_pct: c.sent ? c.cost / c.sent : 0,
    };
  });

  const byMonth = {};
  for (const r of list) {
    const mk = r.date.slice(0, 7);
    const m = (byMonth[mk] = byMonth[mk] || { month: mk, sent: 0, received: 0, count: 0, cost: 0 });
    m.sent += r.sent;
    m.received += r.received || 0;
    m.cost += r.cost || 0;
    m.count++;
  }

  const main = corridorList.sort((a, b) => b.sent - a.sent)[0];
  return {
    count: list.length,
    from: start,
    to,
    corridors: corridorList,
    main,
    total_sent: main ? main.sent : 0,
    total_received: main ? main.received : 0,
    total_cost: corridorList.reduce((s, c) => s + c.cost, 0),
    by_month: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
    recent: list.slice(0, 10),
  };
}

/**
 * Bây giờ có phải lúc tốt để gửi tiền không?
 * So tỷ giá hôm nay với trung bình/biên độ của N ngày gần nhất.
 */
export function timingAdvice(fromCurrency = baseCurrency(), toCurrency = 'VND', days = 90) {
  const f = cur(fromCurrency).code;
  const t = cur(toCurrency).code;
  const rows = all(
    `SELECT date, rate FROM fx_rates WHERE base = ? AND quote = ? AND date >= date('now', ?) ORDER BY date`,
    ['EUR', t === 'EUR' ? f : t, `-${days} days`]
  );
  const nowRate = getRate(f, t, today());

  // Chuỗi lịch sử quy về đúng cặp người dùng hỏi
  const series = rows
    .map((r) => ({ date: r.date, rate: f === 'EUR' ? r.rate : null }))
    .filter((r) => r.rate);

  if (series.length < 5) {
    return {
      pair: `${f}/${t}`,
      rate: nowRate,
      samples: series.length,
      verdict: 'unknown',
      message: `Chưa đủ dữ liệu lịch sử để so sánh (mới có ${series.length} ngày). Tỷ giá hiện tại: 1 ${f} = ${t === 'VND' ? Math.round(nowRate).toLocaleString('vi-VN') : nowRate.toFixed(4)} ${t}.`,
    };
  }

  const rates = series.map((s) => s.rate);
  const avg = rates.reduce((s, x) => s + x, 0) / rates.length;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const pctVsAvg = (nowRate - avg) / avg;
  const percentile = rates.filter((r) => r <= nowRate).length / rates.length;

  let verdict = 'neutral';
  if (percentile >= 0.8) verdict = 'good';
  else if (percentile <= 0.25) verdict = 'wait';

  const fmtRate = (x) => (t === 'VND' ? Math.round(x).toLocaleString('vi-VN') : x.toFixed(4));
  const msg = {
    good: `Tỷ giá đang **cao hơn ${Math.round(pctVsAvg * 1000) / 10}%** so với trung bình ${days} ngày và nằm trong nhóm ${Math.round(percentile * 100)}% cao nhất. Đây là thời điểm tốt để gửi tiền về.`,
    wait: `Tỷ giá đang **thấp hơn ${Math.round(-pctVsAvg * 1000) / 10}%** so với trung bình ${days} ngày. Nếu không gấp, chờ thêm có thể lợi hơn — nhưng đừng chờ quá lâu vì tỷ giá khó đoán.`,
    neutral: `Tỷ giá đang quanh mức trung bình ${days} ngày. Không có lợi thế rõ rệt, cứ gửi theo lịch đều đặn.`,
  }[verdict];

  return {
    pair: `${f}/${t}`,
    rate: nowRate,
    avg,
    min,
    max,
    samples: rates.length,
    pct_vs_avg: pctVsAvg,
    percentile,
    verdict,
    message: `${msg}\n\nHiện tại: 1 ${f} = **${fmtRate(nowRate)} ${t}** · Trung bình ${days} ngày: ${fmtRate(avg)} · Thấp/cao: ${fmtRate(min)} – ${fmtRate(max)}.`,
  };
}

/**
 * Ước tính một lần gửi tiền: nhận được bao nhiêu, mất bao nhiêu vào phí.
 * @param amount  số tiền gửi (minor units của `from`)
 */
export function quote({ amount, from = baseCurrency(), to = 'VND', feePct = 0.005, fixedFee = 0 } = {}) {
  const f = cur(from).code;
  const t = cur(to).code;
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  const fee = Math.round(amt * feePct) + Math.round(fixedFee);
  const net = Math.max(0, amt - fee);
  const mid = getRate(f, t, today());
  const received = convert(net, f, t, today());
  return {
    from: f,
    to: t,
    amount: amt,
    fee,
    net,
    mid_rate: mid,
    received,
    effective_rate: toMajor(amt, f) ? toMajor(received, t) / toMajor(amt, f) : 0,
    text: `Gửi ${fmtMoney(amt, f)} → nhận khoảng **${fmtMoney(received, t)}** (phí ${fmtMoney(fee, f)}, tỷ giá 1 ${f} = ${t === 'VND' ? Math.round(mid).toLocaleString('vi-VN') : mid.toFixed(4)} ${t}).`,
  };
}

/** Gợi ý cải thiện: đang mất bao nhiêu tiền vào phí chuyển và cách giảm. */
export function costInsight(months = 12) {
  const s = remittanceSummary({ months });
  if (!s.main || !s.main.count) return null;
  const c = s.main;
  const yearly = Math.round((c.cost / Math.max(1, s.by_month.length)) * 12);
  return {
    pair: c.pair,
    count: c.count,
    sent: c.sent,
    cost: c.cost,
    cost_pct: c.cost_pct,
    yearly_cost: yearly,
    message: [
      `Trong ${s.by_month.length} tháng bạn đã gửi **${fmtMoney(c.sent, c.from_currency)}** về ${c.to_currency === 'VND' ? 'Việt Nam' : c.to_currency} qua ${c.count} lần.`,
      `Tổng chi phí (phí + chênh lệch tỷ giá): **${fmtMoney(c.cost, c.from_currency)}** ≈ ${(c.cost_pct * 100).toFixed(2)}% số tiền gửi, tương đương **${fmtMoney(yearly, c.from_currency)}/năm**.`,
      c.cost_pct > 0.015
        ? '⚠️ Mức này cao. Dịch vụ tốt thường chỉ tốn 0,4–0,8%. Gộp nhiều lần nhỏ thành một lần lớn và so tỷ giá trước khi gửi sẽ tiết kiệm đáng kể.'
        : '✅ Mức chi phí này là hợp lý so với mặt bằng chung.',
      `Lần gửi được giá nhất: ${c.best_date || '—'} (1 ${c.from_currency} = ${Math.round(c.best_rate).toLocaleString('vi-VN')} ${c.to_currency}). Kém nhất: ${c.worst_date || '—'} (${Math.round(c.worst_rate).toLocaleString('vi-VN')}).`,
    ].join('\n\n'),
  };
}
