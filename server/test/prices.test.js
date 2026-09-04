/** Giá thị trường: từng nguồn parse đúng, đơn vị đúng, lỗi từng mã không kéo cả lượt. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('./.tmp-prices.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);
process.env.FINMATE_DB = DB;
process.env.FINMATE_FX_OFFLINE = '';
process.env.FINMATE_PRICES = 'on';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { all, get, run, insert, setting } = await import('../src/db.js');
const { setRate } = await import('../src/services/fx.js');
const { refreshPrices, fetchGoldSjc, fetchGoldPnj, fetchGoldDoji, fetchGoldVn, fetchVnDirect, fetchYahoo, fetchCrypto, classify, goldQuote, priceStatus, priceHistory } = await import('../src/services/prices.js');

setRate('EUR', 'VND', 28000, undefined, 'test');
setRate('EUR', 'USD', 1.1, undefined, 'test');

const acc = insert('accounts', { name: 'CK', type: 'investment', balance: 0, currency: 'VND' });
insert('holdings', { account_id: acc, symbol: 'HPG', name: 'Hoà Phát', asset_class: 'stock', quantity: 100, avg_cost: 25_000, last_price: 26_000, currency: 'VND' });
insert('holdings', { account_id: acc, symbol: 'SJC', name: 'Vàng SJC (chỉ)', asset_class: 'gold', quantity: 2, avg_cost: 7_000_000, last_price: 7_500_000, currency: 'VND' });
insert('holdings', { account_id: acc, symbol: 'BTC', name: 'Bitcoin', asset_class: 'crypto', quantity: 0.01, avg_cost: 1_500_000_000, last_price: 1_600_000_000, currency: 'VND' });
insert('holdings', { account_id: acc, symbol: 'CSPX', name: 'iShares S&P 500', asset_class: 'etf', quantity: 3, avg_cost: 50_000, last_price: 51_000, currency: 'EUR' });
insert('holdings', { account_id: acc, symbol: 'XYZ', name: 'Mã lạ', asset_class: 'stock', quantity: 10, avg_cost: 10_000, last_price: 10_000, currency: 'VND' });

/** fetch giả: trả theo URL, ghi lại URL đã gọi. */
const calls = [];
const mockFetch = (map) => async (url) => {
  calls.push(url);
  for (const [re, body] of map) {
    if (re.test(url)) {
      if (body instanceof Error) throw body;
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    }
  }
  return { ok: false, status: 404, text: async () => 'nf', json: async () => ({}) };
};
const SJC_XML = `<?xml version="1.0"?><root><ratelist updated="03/09/2026 09:00"><city name="Hồ Chí Minh"><item buy="118,500" sell="120,500" type="Vàng SJC 1L, 10L, 1KG"/><item buy="117,000" sell="119,000" type="Vàng nhẫn SJC 99,99 1 chỉ, 2 chỉ, 5 chỉ"/></city></ratelist></root>`;
const PNJ = { data: [{ masp: 'SJC', tensp: 'Vàng miếng SJC 999.9', giaban: 14910, giamua: 14610 }, { masp: 'N24K', tensp: 'Nhẫn Trơn PNJ 999.9', giaban: 14900, giamua: 14550 }] };
const DOJI_XML = `<?xml version='1.0'?><GoldList><DGPlist><Row Name='DOJI HN lẻ' Key='x' Sell='148,500' Buy='145,500' /><Row Name='SJC HCM' Key='y' Sell='149,000' Buy='146,000' /></DGPlist></GoldList>`;
const SOURCES = [
  [/edge-api\.pnj\.io/, new Error('HTTP 403')],
  [/giavang\.doji\.vn/, DOJI_XML],
  [/sjc\.com\.vn/, SJC_XML],
  [/coingecko.*simple\/price.*bitcoin/, { bitcoin: { vnd: 1_750_000_000 } }],
  [/finfo-api\.vndirect/, { data: [{ code: 'HPG', date: '2026-09-03', close: 28.55 }, { code: 'HPG', date: '2026-09-02', close: 28.1 }] }],
  [/bgapidatafeed\.vps/, [{ sym: 'XYZ', lastPrice: 12.3 }]],
  [/query1\.finance\.yahoo\.com.*CSPX/, { chart: { result: [{ meta: { regularMarketPrice: 560.25, currency: 'USD' } }] } }],
  [/gold-api\.com/, { price: 2650.5 }],
];

test('phân loại kênh theo mã, đồng tiền và loại tài sản', () => {
  assert.equal(classify({ symbol: 'HPG', currency: 'VND', asset_class: 'stock' }).kind, 'vn');
  assert.equal(classify({ symbol: 'SJC', currency: 'VND', asset_class: 'gold' }).unit, 'chi');
  assert.equal(classify({ symbol: 'BTC', currency: 'VND' }).kind, 'crypto');
  assert.equal(classify({ symbol: 'CSPX', currency: 'EUR', asset_class: 'etf' }).kind, 'intl');
  assert.equal(classify({ symbol: 'GLD', currency: 'USD', asset_class: 'etf' }).kind, 'gold');
  assert.equal(classify({ symbol: 'VWCE', name: 'Vanguard All-World', currency: 'EUR', asset_class: 'etf' }).kind, 'intl', '"Vanguard" không phải vàng');
  assert.equal(classify({ symbol: 'XYZ', name: 'Vàng nhẫn 9999', currency: 'VND', asset_class: 'other' }).kind, 'gold');
});

test('SJC XML: nghìn đồng/lượng -> đồng/lượng, chọn đúng dòng vàng miếng', async () => {
  const g = await fetchGoldSjc(mockFetch(SOURCES));
  assert.equal(g.sellPerLuong, 120_500_000);
  assert.equal(g.buyPerLuong, 118_500_000);
  assert.match(g.type, /1L/);
});

test('PNJ: nghìn đồng/chỉ -> đồng/lượng, chọn dòng vàng miếng SJC', async () => {
  const g = await fetchGoldPnj(mockFetch([[/pnj/, PNJ]]));
  assert.equal(g.sellPerLuong, 149_100_000); assert.equal(g.source, 'pnj');
});

test('DOJI XML: ưu tiên dòng SJC, nghìn đồng/lượng', async () => {
  const g = await fetchGoldDoji(mockFetch([[/doji/, DOJI_XML]]));
  assert.equal(g.sellPerLuong, 149_000_000); assert.equal(g.source, 'doji');
});

test('vàng VN thử lần lượt PNJ -> SJC -> DOJI', async () => {
  const g = await fetchGoldVn(mockFetch(SOURCES));
  assert.equal(g.source, 'sjc', 'PNJ hỏng thì tới SJC');
  const g2 = await fetchGoldVn(mockFetch([[/pnj/, new Error('x')], [/sjc/, new Error('y')], [/doji/, DOJI_XML]]));
  assert.equal(g2.source, 'doji');
  await assert.rejects(fetchGoldVn(mockFetch([])), /PNJ.*SJC.*DOJI|Pnj|Sjc|Doji/);
});

test('VNDirect: lấy dòng mới nhất, nghìn đồng -> đồng', async () => {
  const m = await fetchVnDirect(['HPG'], mockFetch(SOURCES));
  assert.equal(m.get('HPG').major, 28_550);
});

test('Yahoo: mã không hậu tố thì thử hậu tố theo đồng tiền ví', async () => {
  const src = [[/chart\/VWCE\?/, { chart: { error: { description: 'No data' } } }], [/chart\/VWCE\.DE/, { chart: { result: [{ meta: { regularMarketPrice: 130.5, currency: 'EUR' } }] } }]];
  insert('holdings', { account_id: acc, symbol: 'VWCE', name: 'Vanguard All-World', asset_class: 'etf', quantity: 1, avg_cost: 10_000, last_price: 10_000, currency: 'EUR' });
  const r = await refreshPrices({ force: true, symbols: ['VWCE'], fetchImpl: mockFetch(src) });
  assert.equal(r.results[0].ok, true); assert.equal(r.results[0].price, 13_050); assert.match(r.results[0].note || '', /VWCE\.DE/);
  run("DELETE FROM holdings WHERE symbol = 'VWCE'");
});

test('Yahoo: giá kèm đồng tiền niêm yết', async () => {
  const y = await fetchYahoo('CSPX', mockFetch(SOURCES));
  assert.equal(y.major, 560.25);
  assert.equal(y.currency, 'USD');
});

test('CoinGecko: giá theo đúng đồng tiền nắm giữ', async () => {
  const m = await fetchCrypto([{ symbol: 'BTC', currency: 'VND' }], mockFetch(SOURCES));
  assert.equal(m.get('BTC').major, 1_750_000_000);
});

test('refreshPrices cập nhật đúng đơn vị cho từng loại, mã hỏng không kéo cả lượt', async () => {
  const r = await refreshPrices({ force: true, fetchImpl: mockFetch(SOURCES) });
  const by = Object.fromEntries(r.results.map((x) => [x.symbol, x]));
  assert.equal(by.HPG.ok, true); assert.equal(by.HPG.price, 28_550); assert.equal(by.HPG.source, 'vndirect');
  assert.equal(by.SJC.price, 12_050_000, 'vàng VN theo chỉ = giá bán/lượng ÷ 10'); assert.equal(by.SJC.source, 'sjc');
  assert.equal(by.BTC.price, 1_750_000_000);
  // CSPX niêm yết USD, ví EUR: 560.25 USD -> EUR theo tỉ giá test (1 EUR = 1.1 USD) -> 509.32 EUR = 50932 cent
  assert.equal(by.CSPX.price, Math.round((560.25 / 1.1) * 100)); assert.equal(by.CSPX.source, 'yahoo');
  assert.equal(by.XYZ.ok, true); assert.equal(by.XYZ.price, 12_300); assert.equal(by.XYZ.source, 'vps', 'VNDirect thiếu thì sang VPS');
  assert.equal(r.updated, 5);
  assert.equal(get("SELECT last_price, price_source FROM holdings WHERE symbol = 'HPG'").last_price, 28_550);
  assert.ok(Math.abs(by.HPG.change_pct - (28_550 - 26_000) / 26_000) < 1e-9);
  assert.equal(all("SELECT * FROM price_history WHERE symbol = 'HPG'").length, 1);
  assert.equal(priceHistory('HPG').length, 1);
  assert.equal(priceStatus().results.length, 5);
});

test('giới hạn 1 giờ: gọi lại không force thì bỏ qua, force thì gọi thật', async () => {
  const before = calls.length;
  const r = await refreshPrices({ fetchImpl: mockFetch(SOURCES) });
  assert.equal(r.skipped, true);
  assert.equal(calls.length, before);
});

test('vàng VN: SJC lỗi thì dùng giá thế giới quy đổi theo chỉ (+ premium)', async () => {
  setting('gold_premium_pct', 10);
  const src = [[/sjc\.com\.vn|pnj|doji/, new Error('fetch failed')], ...SOURCES.filter(([re]) => !/sjc|pnj|doji/.test(String(re)))];
  const r = await refreshPrices({ force: true, symbols: ['SJC'], fetchImpl: mockFetch(src) });
  const sjc = r.results[0];
  assert.equal(sjc.ok, true);
  // 2650.5 USD/oz × 0.120565 oz/chỉ × 1.10 ; USD->VND qua EUR: 1 USD = 28000/1.1 VND
  const expect = Math.round(2650.5 * 0.120565 * 1.1 * 100) /* cent */ * (28000 / 1.1) / 100;
  assert.ok(Math.abs(sjc.price - expect) / expect < 0.002, `${sjc.price} vs ${expect}`);
  assert.match(sjc.source, /gold-api/);
  setting('gold_premium_pct', 0);
});

test('mất mạng hoàn toàn: mọi mã báo lỗi, giá cũ giữ nguyên, không ném ra ngoài', async () => {
  const r = await refreshPrices({ force: true, fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.equal(r.updated, 0);
  assert.ok(r.results.every((x) => !x.ok && /không gọi được/.test(x.error)));
  assert.equal(get("SELECT last_price FROM holdings WHERE symbol = 'HPG'").last_price, 28_550);
});

test('goldQuote gộp SJC + thế giới và tính chênh lệch', async () => {
  const g = await goldQuote({ fetchImpl: mockFetch(SOURCES) });
  assert.equal(g.sjc.sell_per_chi, 12_050_000);
  assert.equal(g.world.usd_per_oz, 2650.5);
  assert.equal(typeof g.premium_pct, 'number');
});

test('FINMATE_FX_OFFLINE tắt hẳn việc gọi ra ngoài', async () => {
  process.env.FINMATE_FX_OFFLINE = '1';
  const r = await refreshPrices({ force: true, fetchImpl: mockFetch(SOURCES) });
  assert.equal(r.offline, true);
  process.env.FINMATE_FX_OFFLINE = '';
});

test.after(() => { for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s); });
