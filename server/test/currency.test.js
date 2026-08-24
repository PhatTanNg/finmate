/**
 * Kiểm thử tầng đa tiền tệ: quy đổi đơn vị nhỏ nhất, đọc số tiền trong câu
 * tiếng Việt, bảng tỷ giá và thuế Ireland.
 *
 * Chạy độc lập với DB thật — mọi test dùng file tạm riêng.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FINMATE_DB = join(tmpdir(), `finmate-currency-test-${process.pid}.db`);

const {
  toMinor, toMajor, factorOf, fmtMoney, parseNumberFor, normalizeCurrency, currency,
} = await import('../src/util/currency.js');
const { findAmounts } = await import('../src/util/vi.js');
const { setRate, getRate, convert, ensureSeedRates } = await import('../src/services/fx.js');
const { grossToNetIE, usc, prsi } = await import('../src/services/tax_ie.js');

/** Euro -> cent, vì toàn bộ tầng thuế làm việc bằng đơn vị nhỏ nhất. */
const E = (x) => Math.round(x * 100);

describe('đơn vị nhỏ nhất', () => {
  test('VND không có phần lẻ nên giữ nguyên giá trị', () => {
    assert.equal(factorOf('VND'), 1);
    assert.equal(toMinor(50_000, 'VND'), 50_000);
    assert.equal(toMajor(50_000, 'VND'), 50_000);
  });

  test('EUR quy về cent', () => {
    assert.equal(factorOf('EUR'), 100);
    assert.equal(toMinor(12.5, 'EUR'), 1250);
    assert.equal(toMajor(1250, 'EUR'), 12.5);
  });

  test('làm tròn cent thay vì để số thực', () => {
    assert.equal(toMinor(0.1 + 0.2, 'EUR'), 30);
    assert.equal(Number.isInteger(toMinor(19.999, 'EUR')), true);
  });

  test('định dạng theo đúng đồng tiền', () => {
    assert.equal(fmtMoney(1250, 'EUR'), '€12.50');
    assert.equal(fmtMoney(100_000, 'EUR'), '€1,000');
    assert.equal(fmtMoney(1_500_000, 'VND'), '1.500.000đ');
  });

  test('nhận diện tên đồng tiền người Việt hay dùng', () => {
    assert.equal(normalizeCurrency('euro'), 'EUR');
    assert.equal(normalizeCurrency('€'), 'EUR');
    assert.equal(normalizeCurrency('vnđ'), 'VND');
    assert.equal(normalizeCurrency('đồng'), 'VND');
    assert.equal(normalizeCurrency('đô la'), 'USD');
    assert.equal(normalizeCurrency('không phải tiền'), null);
    assert.equal(currency('EUR').decimals, 2);
  });
});

describe('đọc số có dấu phân tách kiểu Việt và kiểu Âu', () => {
  const n = (s, c = 'EUR') => parseNumberFor(s, c);

  test('dấu xuất hiện sau cùng là dấu thập phân', () => {
    assert.equal(n('1.500,75'), 1500.75);
    assert.equal(n('1,500.75'), 1500.75);
  });

  test('lặp lại nhiều lần thì là phân tách nghìn', () => {
    assert.equal(n('1.500.000', 'VND'), 1_500_000);
    assert.equal(n('1,500,000', 'VND'), 1_500_000);
  });

  test('đúng 3 chữ số phía sau là phân tách nghìn', () => {
    assert.equal(n('1.500'), 1500);
    assert.equal(n('1,500'), 1500);
  });

  test('1-2 chữ số phía sau là phần lẻ', () => {
    assert.equal(n('12.50'), 12.5);
    assert.equal(n('68,40'), 68.4);
    assert.equal(n('1,2'), 1.2);
  });
});

describe('tìm số tiền trong câu chat', () => {
  const one = (s, opts) => findAmounts(s, opts)[0];

  test('ký hiệu viết rõ thì ưu tiên tuyệt đối', () => {
    assert.deepEqual(
      { v: one('ăn trưa 12.50 euro').value, c: one('ăn trưa 12.50 euro').currency },
      { v: 1250, c: 'EUR' },
    );
    assert.equal(one('trả €1.500,75 tiền nhà').value, 150075);
    assert.equal(one('nhận 2.000.000đ').currency, 'VND');
  });

  test('đơn vị thuần Việt luôn là VND dù đang dùng EUR', () => {
    const a = one('tiết kiệm 2 tỷ ở Việt Nam', { currency: 'EUR' });
    assert.equal(a.currency, 'VND');
    assert.equal(a.value, 2_000_000_000);
    assert.equal(one('gửi 5 triệu về nhà', { currency: 'EUR' }).currency, 'VND');
    assert.equal(one('3 củ', { currency: 'EUR' }).value, 3_000_000);
  });

  test('đơn vị viết tắt kiểu ASCII theo đồng tiền đang dùng', () => {
    assert.equal(one('thưởng 45k', { currency: 'EUR' }).currency, 'EUR');
    assert.equal(one('thưởng 45k', { currency: 'EUR' }).value, 4_500_000);
    assert.equal(one('thưởng 45k', { currency: 'VND' }).value, 45_000);
  });

  test('một câu chứa cả hai đồng tiền', () => {
    const a = findAmounts('đổi 500 euro được 15 triệu', { currency: 'EUR' });
    assert.equal(a.length, 2);
    assert.deepEqual(a.map((x) => x.currency), ['EUR', 'VND']);
    assert.equal(a[0].value, 50_000);
    assert.equal(a[1].value, 15_000_000);
  });

  test('không nhầm số thường thành tiền tệ khác', () => {
    assert.equal(one('mua 200 cổ phiếu', { currency: 'EUR' }).currency, 'EUR');
  });
});

describe('tỷ giá', () => {
  test('tra được chiều thuận, chiều nghịch và bắc cầu', () => {
    ensureSeedRates();
    setRate('EUR', 'VND', 30_000, '2026-01-01');
    setRate('EUR', 'USD', 1.2, '2026-01-01');

    assert.equal(getRate('EUR', 'VND', '2026-01-01'), 30_000);
    assert.ok(Math.abs(getRate('VND', 'EUR', '2026-01-01') - 1 / 30_000) < 1e-12);
    // USD -> VND phải suy ra qua EUR: 30000 / 1.2
    assert.ok(Math.abs(getRate('USD', 'VND', '2026-01-01') - 25_000) < 1);
  });

  test('cùng đồng tiền thì giữ nguyên số', () => {
    assert.equal(convert(12_345, 'EUR', 'EUR', '2026-01-01'), 12_345);
  });

  test('quy đổi tôn trọng số chữ số thập phân của từng đồng tiền', () => {
    setRate('EUR', 'VND', 30_000, '2026-02-01');
    // 100 EUR = 10.000 cent -> 3.000.000 đồng (VND không có phần lẻ)
    assert.equal(convert(10_000, 'EUR', 'VND', '2026-02-01'), 3_000_000);
    // và ngược lại
    assert.equal(convert(3_000_000, 'VND', 'EUR', '2026-02-01'), 10_000);
  });
});

describe('thuế Ireland', () => {
  test('người độc thân lương 50.000 € khớp số của Revenue', () => {
    const r = grossToNetIE(E(50_000), { status: 'single', dependents: 0 });
    assert.ok(Math.abs(r.total_tax - E(10_332.82)) <= 100, `total_tax = ${r.total_tax}`);
    assert.ok(Math.abs(r.net - E(39_667.18)) <= 100, `net = ${r.net}`);
  });

  test('dưới ngưỡng miễn thì không phải đóng USC', () => {
    assert.equal(usc(E(12_000)), 0);
    assert.ok(usc(E(30_000)) > 0);
  });

  test('PRSI tính 4,2% trên lương gộp', () => {
    assert.ok(Math.abs(prsi(E(50_000)) - E(2_100)) <= 100, `prsi = ${prsi(E(50_000))}`);
  });

  test('đóng quỹ hưu giảm thuế thu nhập nhưng không giảm USC/PRSI', () => {
    const a = grossToNetIE(E(60_000), { status: 'single' });
    const b = grossToNetIE(E(60_000), { status: 'single', pension: E(6_000) });
    assert.ok(b.income_tax < a.income_tax, 'thuế thu nhập phải giảm');
    assert.equal(b.usc, a.usc);
    assert.equal(b.prsi, a.prsi);
  });

  test('thu nhập cao hơn thì thuế suất hiệu dụng cao hơn', () => {
    const lo = grossToNetIE(E(35_000), { status: 'single' });
    const hi = grossToNetIE(E(90_000), { status: 'single' });
    assert.ok(hi.effective_rate > lo.effective_rate);
  });
});
