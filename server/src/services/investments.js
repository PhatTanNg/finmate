/** Danh mục đầu tư: cổ phiếu, quỹ, vàng, crypto — định giá, lãi/lỗ, cổ tức. */
import { all, get, run, insert, update } from '../db.js';
import { today } from '../util/date.js';
import { createTransaction } from './ledger.js';
import { categoryByName } from '../bootstrap.js';
import { convert, baseCurrency } from './fx.js';
import { currency as cur, fmtMoney } from '../util/currency.js';

export function listHoldings() {
  return all(`SELECT h.*, a.name AS account_name FROM holdings h LEFT JOIN accounts a ON a.id = h.account_id ORDER BY h.asset_class, h.symbol`);
}

/**
 * Giá trị nắm giữ, tính bằng **đơn vị nhỏ nhất của đồng tiền nắm giữ**.
 * (avg_cost / last_price cũng lưu theo đơn vị nhỏ nhất: 250,35 € -> 25035)
 */
export function holdingValue(h) {
  const price = h.last_price || h.avg_cost;
  return Math.round(h.quantity * price);
}

/** Người dùng thường nhập "2" nghĩa là 2%/năm — chuẩn hoá về dạng thập phân. */
export function yieldOf(h) {
  const y = Number(h?.dividend_yield) || 0;
  return y > 1 ? y / 100 : y;
}

export function portfolio() {
  const base = baseCurrency();
  const d = today();
  const holdings = listHoldings().map((h) => {
    const hc = cur(h.currency || base).code;
    const value = holdingValue(h);
    const cost = Math.round(h.quantity * h.avg_cost);
    return {
      ...h,
      currency: hc,
      value,
      cost,
      pnl: value - cost,
      pnl_pct: cost ? (value - cost) / cost : 0,
      // Quy đổi về đồng tiền gốc để cộng dồn với phần còn lại của tài sản
      value_base: convert(value, hc, base, d),
      cost_base: convert(cost, hc, base, d),
    };
  });
  const value = holdings.reduce((s, h) => s + h.value_base, 0);
  const cost = holdings.reduce((s, h) => s + h.cost_base, 0);
  const byClass = {};
  for (const h of holdings) byClass[h.asset_class] = (byClass[h.asset_class] || 0) + h.value_base;
  const byCurrency = {};
  for (const h of holdings) byCurrency[h.currency] = (byCurrency[h.currency] || 0) + h.value_base;

  const cash = all("SELECT * FROM accounts WHERE type IN ('investment','brokerage') AND is_active = 1")
    .reduce((s, a) => s + convert(a.balance, cur(a.currency || base).code, base, d), 0);

  const tradeSum = (side, extra = '', params = []) =>
    all(
      `SELECT tr.amount, h.currency FROM trades tr LEFT JOIN holdings h ON h.id = tr.holding_id
       WHERE tr.side = ? ${extra}`,
      [side, ...params]
    ).reduce((s, t) => s + convert(t.amount || 0, cur(t.currency || base).code, base, d), 0);

  const realized = tradeSum('sell');
  const dividendYear = tradeSum('dividend', 'AND tr.date >= ?', [`${today().slice(0, 4)}-01-01`]);

  return {
    holdings,
    base_currency: base,
    total_value: value,
    total_cost: cost,
    cash,
    unrealized_pnl: value - cost,
    unrealized_pct: cost ? (value - cost) / cost : 0,
    realized_ytd: realized,
    dividend_ytd: dividendYear,
    projected_dividend: Math.round(holdings.reduce((s, h) => s + h.value_base * yieldOf(h), 0)),
    allocation: Object.entries(byClass).map(([k, v]) => ({ asset_class: k, value: v, weight: value ? v / value : 0 })),
    by_currency: Object.entries(byCurrency).map(([k, v]) => ({ currency: k, value: v, weight: value ? v / value : 0 })),
  };
}

export function upsertHolding(data) {
  const existing = data.id
    ? get('SELECT * FROM holdings WHERE id = ?', [data.id])
    : get('SELECT * FROM holdings WHERE symbol = ? AND account_id IS ?', [data.symbol, data.account_id ?? null]);
  if (existing) {
    update('holdings', existing.id, data);
    return get('SELECT * FROM holdings WHERE id = ?', [existing.id]);
  }
  const id = insert('holdings', { ...data, symbol: String(data.symbol || '').toUpperCase() });
  return get('SELECT * FROM holdings WHERE id = ?', [id]);
}

/** Mã ngoài sàn Việt Nam hay gặp — 3 ký tự nhưng KHÔNG phải cổ phiếu VN. */
const NON_VN_TICKERS = new Set([
  'SPY', 'QQQ', 'VOO', 'VTI', 'IVV', 'DIA', 'EFA', 'IWM', 'GLD', 'SLV', 'BND', 'AGG',
  'VUG', 'VTV', 'VEA', 'VWO', 'VXUS', 'VUSA', 'VUAA', 'VWCE', 'IWDA', 'EIMI', 'CSPX',
  'SXR8', 'EUNL', 'AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'GOOG', 'GOOGL',
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOT', 'AVAX', 'CRH', 'RYA', 'KRZ', 'KRX',
]);

/**
 * Đoán đồng tiền của một mã. Ưu tiên mã đã có trong danh mục; nếu chưa có thì
 * dựa vào quy ước sàn Việt Nam (mã đúng 3 chữ cái, ví dụ FPT/HPG/VNM) — quan
 * trọng với người ở nước ngoài vẫn giữ cổ phiếu Việt Nam.
 */
export function guessSymbolCurrency(symbol, fallback = null) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return fallback || baseCurrency();
  const h = get('SELECT currency FROM holdings WHERE upper(symbol) = upper(?) AND currency IS NOT NULL', [sym]);
  if (h?.currency) return cur(h.currency).code;
  if (/^[A-Z]{3}$/.test(sym) && !NON_VN_TICKERS.has(sym)) return 'VND';
  return fallback || baseCurrency();
}

export function setPrice(symbol, price, date = today()) {
  const changes = run('UPDATE holdings SET last_price = ?, last_price_at = ? WHERE upper(symbol) = upper(?)', [Number(price), date, symbol]).changes;
  return changes;
}

/** Ghi nhận lệnh mua/bán/cổ tức và tự cập nhật tiền + giá vốn. */
export function recordTrade({ holding_id, symbol, side = 'buy', quantity = 0, price = 0, fee = 0, tax = 0, date = today(), account_id = null, note = '' }) {
  let h = holding_id ? get('SELECT * FROM holdings WHERE id = ?', [holding_id]) : get('SELECT * FROM holdings WHERE upper(symbol) = upper(?)', [symbol]);
  if (!h) {
    h = upsertHolding({ symbol: symbol || 'N/A', name: symbol, account_id, quantity: 0, avg_cost: 0, last_price: price });
  }
  const cashAccount = account_id || h.account_id;
  const hc = cur(h.currency || baseCurrency()).code;
  const priceLabel = (x) => fmtMoney(x, hc);
  const q = Number(quantity) || 0;
  const p = Number(price) || 0;
  const gross = Math.round(q * p);

  if (side === 'buy') {
    const newQty = h.quantity + q;
    const newCost = newQty ? (h.quantity * h.avg_cost + gross + fee) / newQty : 0;
    update('holdings', h.id, { quantity: newQty, avg_cost: newCost, last_price: p || h.last_price, last_price_at: date });
    createTransaction({
      type: 'transfer', amount: gross + fee, currency: hc, date, account_id: cashAccount, holding_id: h.id, excluded: 1,
      note: note || `Mua ${q} ${h.symbol} @ ${priceLabel(p)}`, source: 'system',
    });
  } else if (side === 'sell') {
    const newQty = Math.max(0, h.quantity - q);
    update('holdings', h.id, { quantity: newQty, last_price: p || h.last_price, last_price_at: date });
    const proceeds = gross - fee - tax;
    createTransaction({
      type: 'transfer', amount: proceeds, currency: hc, date, counter_account_id: cashAccount, holding_id: h.id, excluded: 1,
      note: note || `Bán ${q} ${h.symbol} @ ${priceLabel(p)}`, source: 'system',
    });
    const gain = Math.round(proceeds - q * h.avg_cost);
    if (gain > 0) {
      const cat = categoryByName('Lãi vốn đầu tư', 'income');
      createTransaction({
        type: 'income', amount: gain, currency: hc, date, account_id: cashAccount, category_id: cat?.id, excluded: 1,
        note: `Lãi vốn ${h.symbol}`, source: 'system',
      }, { allocate: false });
    }
  } else if (side === 'dividend') {
    const amount = Math.round(Number(price) ? q * p : quantity);
    const cat = categoryByName('Cổ tức', 'income');
    createTransaction({
      type: 'income', amount, currency: hc, date, account_id: cashAccount, category_id: cat?.id, holding_id: h.id,
      note: note || `Cổ tức ${h.symbol}`, source: 'system',
    });
  }

  insert('trades', { holding_id: h.id, side, quantity: q, price: p, fee, tax, amount: side === 'sell' ? gross - fee - tax : gross, date, note });
  return get('SELECT * FROM holdings WHERE id = ?', [h.id]);
}

/** Giá trị bất động sản + dòng tiền cho thuê (quy đổi về đồng tiền gốc) */
export function realEstate() {
  const base = baseCurrency();
  const d = today();
  const props = all('SELECT * FROM properties').map((p) => {
    const pc = cur(p.currency || base).code;
    const debtBalance = get('SELECT balance FROM debts WHERE id = ?', [p.debt_id])?.balance || 0;
    const netMonthly = Math.round(p.monthly_rent * (p.occupancy ?? 1) - p.monthly_cost);
    return {
      ...p,
      currency: pc,
      equity: p.current_value - debtBalance,
      net_monthly: netMonthly,
      value_base: convert(p.current_value, pc, base, d),
      net_monthly_base: convert(netMonthly, pc, base, d),
      yield: p.current_value ? (p.monthly_rent * 12 * (p.occupancy ?? 1) - p.monthly_cost * 12) / p.current_value : 0,
    };
  });
  return {
    properties: props,
    total_value: props.reduce((s, p) => s + p.value_base, 0),
    net_monthly: props.reduce((s, p) => s + p.net_monthly_base, 0),
  };
}
