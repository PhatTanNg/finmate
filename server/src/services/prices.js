/**
 * Giá thị trường tự động: cổ phiếu, ETF, quỹ, vàng, crypto.
 *
 * Nguồn miễn phí, không cần key — mỗi loại tài sản một nguồn chính và một
 * nguồn dự phòng; nguồn nào hỏng thì mã đó giữ giá cũ và ghi rõ vì sao:
 *   vàng VN     PNJ (JSON, có dòng vàng miếng SJC) → SJC (XML) → DOJI (XML) → giá thế giới × (1 + premium)
 *   vàng TG     gold-api.com (USD/oz)                            → PAX Gold trên CoinGecko
 *   crypto      CoinGecko simple/price                            (theo đúng đồng tiền nắm giữ)
 *   cổ phiếu VN VNDirect finfo (nghìn đồng)                       → VPS datafeed
 *   quốc tế     Yahoo Finance chart (theo đồng tiền niêm yết)     → Stooq CSV
 *
 * Đơn vị giữ nguyên quy ước của app: giá lưu bằng ĐƠN VỊ NHỎ NHẤT của đồng
 * tiền nắm giữ (VND: đồng, EUR/USD: cent); vàng VN tính theo CHỈ (1/10 lượng).
 *
 * Bản chạy trên điện thoại gọi thẳng từ trình duyệt: CoinGecko và gold-api cho
 * phép CORS, còn Yahoo/VNDirect có thể bị chặn — khi đó mã đó báo "bị chặn" và
 * người dùng vẫn nhập tay được, hoặc đặt FINMATE_PRICE_PROXY để đi qua proxy.
 */
import { all, get, run, setting } from '../db.js';
import { today } from '../util/date.js';
import { currency as cur } from '../util/currency.js';
import { convert, baseCurrency } from './fx.js';

const OFF = () => /^(1|true|yes)$/i.test(String(process.env.FINMATE_FX_OFFLINE || '')) || /^(off|0|false)$/i.test(String(process.env.FINMATE_PRICES || ''));
/**
 * Proxy CORS cho bản chạy trên điện thoại. Đặt được từ TRONG app (Cài đặt →
 * Đầu tư) chứ không chỉ bằng biến môi trường: người cài app lên máy không có
 * chỗ nào để đặt biến môi trường cả, mà họ mới đúng là người cần cái này.
 * Biến môi trường vẫn được tôn trọng, dùng làm mặc định cho bản máy chủ.
 */
const PROXY = () => String(setting('price_proxy') || process.env.FINMATE_PRICE_PROXY || '').trim();
const MIN_GAP_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

/** Mã crypto phổ biến -> id CoinGecko. Mã lạ thì tra qua /search một lần và nhớ lại. */
const COINS = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token', LTC: 'litecoin',
  AVAX: 'avalanche-2', LINK: 'chainlink', TRX: 'tron', ATOM: 'cosmos', XLM: 'stellar', TON: 'the-open-network', PAXG: 'pax-gold',
};
const GOLD_RE = /^(SJC|XAU|GOLD|VANG|VÀNG|DOJI|PNJ|9999|24K|18K|GLD|IAU)$|VANG|VÀNG|GOLD/i;
const OZ_PER_CHI = 0.120565;   // 1 lượng = 37,5 g = 1,20565 oz; 1 chỉ = 1/10 lượng
const GRAMS_PER_OZ = 31.1035;

/** Mỗi mã thuộc kênh nào. */
export function classify(h) {
  const sym = String(h.symbol || '').trim().toUpperCase();
  const cls = String(h.asset_class || '').toLowerCase();
  const code = cur(h.currency || baseCurrency()).code;
  // Từ nguyên vẹn, không phải chuỗi con: "Vanguard" không phải "vàng".
  if (cls === 'gold' || GOLD_RE.test(sym) || /(^|[^\p{L}])(vàng|vang|gold)([^\p{L}]|$)/iu.test(h.name || '')) return { kind: 'gold', unit: code === 'VND' || /chỉ|chi\b|luong|lượng/i.test(h.name || '') ? 'chi' : 'oz' };
  if (cls === 'crypto' || COINS[sym]) return { kind: 'crypto' };
  if (code === 'VND' && /^[A-Z0-9]{3}$/.test(sym)) return { kind: 'vn' };
  return { kind: 'intl' };
}

async function getJson(url, fetchImpl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(PROXY() ? PROXY() + encodeURIComponent(url) : url, { signal: ctrl.signal, headers: { accept: 'application/json, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('quá hạn chờ');
    if (/fetch failed|Failed to fetch|NetworkError|CORS/i.test(String(e?.message))) throw new Error(typeof window !== 'undefined' ? 'không gọi được (mất mạng hoặc bị chặn CORS)' : 'không gọi được (mất mạng)');
    throw e;
  } finally { clearTimeout(t); }
}

/* ------------------------------------------------------------------ *
 *  Từng nguồn                                                         *
 * ------------------------------------------------------------------ */

/** CoinGecko: một lượt cho nhiều mã, giá theo đúng đồng tiền nắm giữ. */
export async function fetchCrypto(items, fetchImpl) {
  const out = new Map();
  const ids = [...new Set(items.map((h) => COINS[h.symbol.toUpperCase()] || h.symbol.toLowerCase()))];
  const vs = [...new Set(items.map((h) => cur(h.currency || baseCurrency()).code.toLowerCase()))];
  const data = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${vs.join(',')}`, fetchImpl);
  if (typeof data !== 'object') throw new Error('CoinGecko trả về không phải JSON');
  for (const h of items) {
    const id = COINS[h.symbol.toUpperCase()] || h.symbol.toLowerCase();
    const code = cur(h.currency || baseCurrency()).code;
    const major = Number(data?.[id]?.[code.toLowerCase()]);
    if (Number.isFinite(major) && major > 0) out.set(h.symbol, { major, currency: code, source: 'coingecko' });
    else out.set(h.symbol, { error: `CoinGecko không có "${id}" theo ${code}` });
  }
  return out;
}

/** Giá vàng thế giới USD/oz: gold-api.com, dự phòng PAX Gold (CoinGecko). */
export async function fetchGoldWorld(fetchImpl) {
  try {
    const d = await getJson('https://api.gold-api.com/price/XAU', fetchImpl);
    const p = Number(d?.price);
    if (Number.isFinite(p) && p > 0) return { usdPerOz: p, source: 'gold-api' };
    throw new Error('gold-api không có giá');
  } catch (e1) {
    const d = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd', fetchImpl).catch((e2) => { throw new Error(`${e1.message}; ${e2.message}`); });
    const p = Number(d?.['pax-gold']?.usd);
    if (Number.isFinite(p) && p > 0) return { usdPerOz: p, source: 'paxg' };
    throw new Error(e1.message);
  }
}

/** SJC: XML chính thức, giá theo nghìn đồng một lượng. Trả về giá bán/mua vàng miếng SJC. */
export async function fetchGoldSjc(fetchImpl) {
  const xml = await getJson(process.env.FINMATE_GOLD_URL || 'https://sjc.com.vn/xml/tygiavang.xml', fetchImpl);
  if (typeof xml !== 'string') throw new Error('SJC trả về không phải XML');
  // <item buy="118,500" sell="120,500" type="Vàng SJC 1L, 10L, 1KG"/>
  const items = [...xml.matchAll(/<item\s+([^>]*)\/?>/gi)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1].toLowerCase(), a[2]]));
    return attrs;
  });
  const pick = items.find((a) => /SJC\s*1L|1L,\s*10L|Vàng SJC/i.test(a.type || '')) || items[0];
  if (!pick) throw new Error('SJC: không tìm thấy dòng giá');
  const num = (s) => Number(String(s || '').replace(/[.,\s]/g, ''));
  const sell = num(pick.sell); const buy = num(pick.buy);
  if (!Number.isFinite(sell) || sell <= 0) throw new Error('SJC: giá bán không hợp lệ');
  // Số trong XML là nghìn đồng / lượng, ví dụ 120,500 -> 120.500.000đ/lượng.
  return { sellPerLuong: sell * 1000, buyPerLuong: buy * 1000, type: pick.type || 'Vàng SJC', source: 'sjc' };
}

/** PNJ: JSON mở, có dòng "Vàng miếng SJC 999.9", giá theo nghìn đồng một CHỈ. */
export async function fetchGoldPnj(fetchImpl) {
  const d = await getJson('https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00', fetchImpl);
  const rows = Array.isArray(d?.data) ? d.data : [];
  const pick = rows.find((r) => /^SJC$/i.test(r.masp || '') || /miếng SJC|mieng SJC/i.test(r.tensp || '')) || rows.find((r) => /999\.9|9999/.test(r.tensp || ''));
  if (!pick) throw new Error('PNJ: không có dòng vàng SJC');
  const sell = Number(String(pick.giaban).replace(/[^\d.]/g, '')); const buy = Number(String(pick.giamua).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(sell) || sell <= 0) throw new Error('PNJ: giá bán không hợp lệ');
  return { sellPerLuong: sell * 1000 * 10, buyPerLuong: buy * 1000 * 10, type: pick.tensp || 'Vàng miếng SJC', source: 'pnj' };
}

/** DOJI: XML, giá theo nghìn đồng một LƯỢNG; lấy dòng SJC nếu có, không thì DOJI HCM lẻ. */
export async function fetchGoldDoji(fetchImpl) {
  const xml = await getJson('http://giavang.doji.vn/api/giavang/?api_key=258fbd2a72ce8481089d88c678e9fe4f', fetchImpl);
  if (typeof xml !== 'string') throw new Error('DOJI trả về không phải XML');
  const rows = [...xml.matchAll(/<Row\s+([^>]*)\/?>/gi)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)='([^']*)'/g)].map((a) => [a[1].toLowerCase(), a[2]])));
  const pick = rows.find((r) => /SJC/i.test(r.name || '')) || rows.find((r) => /HCM lẻ|HN lẻ/i.test(r.name || '')) || rows[0];
  if (!pick) throw new Error('DOJI: không có dòng giá');
  const num = (x) => Number(String(x || '').replace(/[.,\s]/g, ''));
  const sell = num(pick.sell); const buy = num(pick.buy);
  if (!Number.isFinite(sell) || sell <= 0) throw new Error('DOJI: giá bán không hợp lệ');
  return { sellPerLuong: sell * 1000, buyPerLuong: buy * 1000, type: pick.name || 'DOJI', source: 'doji' };
}

/** Vàng VN: thử lần lượt PNJ → SJC → DOJI; nguồn nào sống thì dùng. */
export async function fetchGoldVn(fetchImpl) {
  const errors = [];
  for (const fn of [fetchGoldPnj, fetchGoldSjc, fetchGoldDoji]) {
    try { return await fn(fetchImpl); } catch (e) { errors.push(`${fn.name.replace('fetchGold', '')}: ${e.message}`); }
  }
  throw new Error(errors.join('; '));
}

/** VNDirect finfo: giá đóng cửa gần nhất theo nghìn đồng. */
export async function fetchVnDirect(symbols, fetchImpl) {
  const q = symbols.map((s) => s.toUpperCase()).join(',');
  const d = await getJson(`https://finfo-api.vndirect.com.vn/v4/stock_prices?sort=date&q=code:${q}~date:gte:${addDaysIso(-10)}&size=${symbols.length * 10}`, fetchImpl);
  const rows = Array.isArray(d?.data) ? d.data : [];
  const out = new Map();
  for (const r of rows) {
    const code = String(r.code || '').toUpperCase();
    if (out.has(code)) continue;      // đã sort theo ngày giảm dần -> dòng đầu là mới nhất
    const px = Number(r.close ?? r.adClose ?? r.basicPrice);
    if (Number.isFinite(px) && px > 0) out.set(code, { major: px * 1000, currency: 'VND', source: 'vndirect', date: r.date });
  }
  return out;
}

/** VPS datafeed: giá khớp gần nhất theo nghìn đồng. */
export async function fetchVps(symbols, fetchImpl) {
  const d = await getJson(`https://bgapidatafeed.vps.com.vn/getliststockdata/${symbols.map((s) => s.toUpperCase()).join(',')}`, fetchImpl);
  const rows = Array.isArray(d) ? d : [];
  const out = new Map();
  for (const r of rows) {
    const code = String(r.sym || r.symbol || '').toUpperCase();
    const px = Number(r.lastPrice ?? r.r ?? r.c);
    if (code && Number.isFinite(px) && px > 0) out.set(code, { major: px * 1000, currency: 'VND', source: 'vps' });
  }
  return out;
}

/** Yahoo Finance: một mã một lượt, kèm đồng tiền niêm yết. */
export async function fetchYahoo(symbol, fetchImpl) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, fetchImpl);
  const meta = d?.chart?.result?.[0]?.meta;
  const px = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  if (!meta || !Number.isFinite(px) || px <= 0) throw new Error(d?.chart?.error?.description || 'Yahoo không có giá');
  return { major: px, currency: String(meta.currency || 'USD').toUpperCase(), source: 'yahoo' };
}

/** Stooq: CSV, mã kiểu voo.us / vwce.de. */
export async function fetchStooq(symbol, fetchImpl) {
  const s = /\./.test(symbol) ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
  const csv = await getJson(`https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`, fetchImpl);
  const lines = String(csv).trim().split(/\r?\n/);
  const cols = (lines[1] || '').split(',');
  const px = Number(cols[6]);
  if (!Number.isFinite(px) || px <= 0) throw new Error('Stooq không có giá');
  return { major: px, currency: s.endsWith('.us') ? 'USD' : s.endsWith('.de') || s.endsWith('.nl') || s.endsWith('.fr') ? 'EUR' : s.endsWith('.uk') ? 'GBP' : 'USD', source: 'stooq' };
}

function addDaysIso(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

/* ------------------------------------------------------------------ *
 *  Ghép lại                                                           *
 * ------------------------------------------------------------------ */

const toMinor = (major, code) => Math.round(major * Math.pow(10, cur(code).decimals));

/** Giá vàng theo đơn vị của mã nắm giữ, quy về đồng tiền nắm giữ. */
async function goldPrice(h, unit, cache, fetchImpl) {
  const code = cur(h.currency || baseCurrency()).code;
  if (code === 'VND' && unit === 'chi') {
    try {
      cache.sjc ||= await fetchGoldVn(fetchImpl);
      return { major: cache.sjc.sellPerLuong / 10, currency: 'VND', source: cache.sjc.source, note: cache.sjc.type };
    } catch (e) {
      cache.sjcError = e.message;
    }
  }
  cache.world ||= await fetchGoldWorld(fetchImpl);
  const premium = code === 'VND' ? (Number(setting('gold_premium_pct')) || 0) / 100 : 0;
  const usdPerUnit = cache.world.usdPerOz * (unit === 'chi' ? OZ_PER_CHI : unit === 'g' ? 1 / GRAMS_PER_OZ : 1) * (1 + premium);
  const minorInHolding = convert(toMinor(usdPerUnit, 'USD'), 'USD', code);
  return { major: minorInHolding / Math.pow(10, cur(code).decimals), currency: code, source: cache.world.source + (cache.sjcError ? ' (SJC lỗi: ' + cache.sjcError + ')' : ''), world: true };
}

/**
 * Cập nhật giá cho toàn bộ (hoặc một số) mã đang nắm giữ.
 * @returns {{ok:boolean, updated:number, results:Array, at:string, skipped?:boolean}}
 */
export async function refreshPrices({ force = false, symbols = null, fetchImpl = globalThis.fetch } = {}) {
  const at = new Date().toISOString();
  if (OFF()) return { ok: false, updated: 0, offline: true, results: [], at, error: 'Đang tắt cập nhật giá (FINMATE_PRICES=off hoặc chế độ offline)' };
  const last = setting('prices_last_refresh');
  if (!force && last && Date.now() - Date.parse(last) < MIN_GAP_MS) return { ok: true, updated: 0, skipped: true, results: JSON.parse(setting('prices_status') || '[]'), at: last };
  if (typeof fetchImpl !== 'function') return { ok: false, updated: 0, results: [], at, error: 'Không có fetch' };

  let holdings = all('SELECT * FROM holdings WHERE quantity > 0 OR last_price > 0');
  if (symbols?.length) { const want = new Set(symbols.map((s) => String(s).toUpperCase())); holdings = holdings.filter((h) => want.has(String(h.symbol).toUpperCase())); }
  if (!holdings.length) { setting('prices_last_refresh', at); setting('prices_status', '[]'); return { ok: true, updated: 0, results: [], at }; }

  const results = [];
  const groups = { gold: [], crypto: [], vn: [], intl: [] };
  for (const h of holdings) { const c = classify(h); groups[c.kind].push({ h, unit: c.unit }); }
  const done = (h, r) => {
    const code = cur(h.currency || baseCurrency()).code;
    if (r?.error || !r) { results.push({ symbol: h.symbol, ok: false, error: r?.error || 'không có giá' }); return; }
    let major = r.major;
    let srcCode = r.currency || code;
    if (srcCode !== code) {
      // Niêm yết bằng đồng khác đồng tiền nắm giữ (CSPX trên LSE tính USD, ví EUR): quy đổi.
      const minor = convert(toMinor(major, srcCode), srcCode, code);
      major = minor / Math.pow(10, cur(code).decimals);
    }
    const price = toMinor(major, code);
    if (!Number.isFinite(price) || price <= 0) { results.push({ symbol: h.symbol, ok: false, error: 'giá không hợp lệ' }); return; }
    const prev = Number(h.last_price) || 0;
    run('UPDATE holdings SET last_price = ?, last_price_at = ?, price_source = ? WHERE id = ?', [price, today(), r.source, h.id]);
    run('INSERT INTO price_history (symbol, date, price, currency, source) VALUES (?,?,?,?,?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price, source = excluded.source', [String(h.symbol).toUpperCase(), today(), price, code, r.source]);
    results.push({ symbol: h.symbol, ok: true, price, prev, change_pct: prev ? (price - prev) / prev : null, currency: code, source: r.source, note: r.note || null });
  };

  if (groups.crypto.length) {
    try { const m = await fetchCrypto(groups.crypto.map((x) => x.h), fetchImpl); for (const { h } of groups.crypto) done(h, m.get(h.symbol)); }
    catch (e) { for (const { h } of groups.crypto) done(h, { error: e.message }); }
  }
  if (groups.gold.length) {
    const cache = {};
    for (const { h, unit } of groups.gold) { try { done(h, await goldPrice(h, unit, cache, fetchImpl)); } catch (e) { done(h, { error: e.message }); } }
  }
  if (groups.vn.length) {
    const syms = groups.vn.map((x) => String(x.h.symbol).toUpperCase());
    let m = new Map(); let err = null;
    try { m = await fetchVnDirect(syms, fetchImpl); } catch (e) { err = e.message; }
    const missing = syms.filter((s) => !m.has(s));
    if (missing.length) { try { const m2 = await fetchVps(missing, fetchImpl); for (const [k, v] of m2) m.set(k, v); } catch (e) { err = err ? `${err}; ${e.message}` : e.message; } }
    for (const { h } of groups.vn) done(h, m.get(String(h.symbol).toUpperCase()) || { error: err || 'không có mã này ở VNDirect/VPS' });
  }
  for (const { h } of groups.intl) {
    // Không có hậu tố sàn thì thử thêm hậu tố hợp với đồng tiền ví (VWCE -> VWCE.DE, CSPX -> CSPX.L).
    const code = cur(h.currency || baseCurrency()).code;
    const sym = String(h.symbol).toUpperCase();
    const tries = /\./.test(sym) ? [sym] : [sym, ...(code === 'EUR' ? [`${sym}.DE`, `${sym}.AS`, `${sym}.MI`] : code === 'GBP' ? [`${sym}.L`] : code === 'USD' ? [`${sym}.L`] : [])];
    let got = null; const errs = [];
    for (const t of tries) { try { got = await fetchYahoo(t, fetchImpl); got.note = t !== sym ? `niêm yết ${t}` : null; break; } catch (e) { errs.push(`${t}: ${e.message}`); } }
    if (!got) { try { got = await fetchStooq(sym, fetchImpl); } catch (e) { errs.push(`stooq: ${e.message}`); } }
    done(h, got || { error: errs.join('; ') });
  }

  const updated = results.filter((r) => r.ok).length;
  setting('prices_last_refresh', at);
  setting('prices_status', JSON.stringify(results).slice(0, 8000));
  if (updated) setting('prices_last_ok', at);
  return { ok: updated > 0 || !results.length, updated, results, at };
}

export function priceStatus() {
  let results = [];
  try { results = JSON.parse(setting('prices_status') || '[]'); } catch { results = []; }
  return {
    enabled: !OFF(),
    last: setting('prices_last_refresh') || null,
    last_ok: setting('prices_last_ok') || null,
    next_auto: setting('prices_last_refresh') ? new Date(Date.parse(setting('prices_last_refresh')) + MIN_GAP_MS).toISOString() : null,
    gold_premium_pct: Number(setting('gold_premium_pct')) || 0,
    proxy: PROXY(),
    proxy_from_env: !setting('price_proxy') && !!process.env.FINMATE_PRICE_PROXY,
    results,
  };
}

export function priceHistory(symbol, days = 90) {
  return all('SELECT date, price, currency, source FROM price_history WHERE symbol = ? AND date >= ? ORDER BY date', [String(symbol).toUpperCase(), addDaysIso(-days)]);
}

/** Bảng giá vàng cho chat: SJC (nếu lấy được) và thế giới, quy về đồng tiền gốc. */
export async function goldQuote({ fetchImpl = globalThis.fetch } = {}) {
  if (OFF()) throw new Error('Đang tắt cập nhật giá / chế độ offline');
  const out = { at: new Date().toISOString() };
  try { const s = await fetchGoldVn(fetchImpl); out.sjc = { sell_per_luong: s.sellPerLuong, buy_per_luong: s.buyPerLuong, sell_per_chi: s.sellPerLuong / 10, type: s.type, source: s.source }; } catch (e) { out.sjc_error = e.message; }
  try {
    const w = await fetchGoldWorld(fetchImpl);
    const base = baseCurrency();
    out.world = { usd_per_oz: w.usdPerOz, source: w.source, per_chi_base: convert(toMinor(w.usdPerOz * OZ_PER_CHI, 'USD'), 'USD', base), per_oz_base: convert(toMinor(w.usdPerOz, 'USD'), 'USD', base), base_currency: base };
    if (out.sjc) out.premium_pct = Math.round(((out.sjc.sell_per_chi / convert(toMinor(w.usdPerOz * OZ_PER_CHI, 'USD'), 'USD', 'VND')) - 1) * 1000) / 10;
  } catch (e) { out.world_error = e.message; }
  if (!out.sjc && !out.world) throw new Error(`Không lấy được giá vàng: ${out.sjc_error}; ${out.world_error}`);
  return out;
}

export const _internals = { COINS, OZ_PER_CHI, toMinor };
