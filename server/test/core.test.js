/** Unit test cho các hàm lõi không phụ thuộc HTTP. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAmount, findAmounts, parsePercent, norm } from '../src/util/vi.js';
import { short, pct, monthsToTarget } from '../src/util/money.js';
import { addMonths, monthStart, monthEnd, diffDays, lastMonths } from '../src/util/date.js';
import { grossToNet, netToGross, taxOnTaxable, BRACKETS } from '../src/services/tax.js';
import { detectIntent } from '../src/services/chat/nlu.js';
import { findTopic } from '../src/services/chat/knowledge.js';
import { parseBankMessage } from '../src/services/ingest.js';

test('parseAmount hiểu cách viết tiền của người Việt', () => {
  const v = (s) => parseAmount(s)?.value;
  assert.equal(v('60k'), 60_000);
  assert.equal(v('1tr5'), 1_500_000);
  assert.equal(v('2 triệu'), 2_000_000);
  assert.equal(v('350.000'), 350_000);
  assert.equal(v('1,2 tỷ'), 1_200_000_000);
  assert.equal(v('45 nghìn'), 45_000);
  assert.equal(v('1 triệu rưỡi'), 1_500_000);
  assert.equal(v('không có số nào'), undefined);
});

test('findAmounts lấy được nhiều số tiền trong một câu', () => {
  const a = findAmounts('sáng ăn 30k trưa 65k tối 120 nghìn');
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.value), [30_000, 65_000, 120_000]);
});

test('parsePercent trả về dạng thập phân, phân biệt 0% với không có', () => {
  assert.equal(parsePercent('lãi 0%'), 0);
  assert.equal(parsePercent('lãi suất 12%'), 0.12);
  assert.equal(parsePercent('lãi 8,5%'), 0.085);
  assert.equal(parsePercent('không có gì'), null);
});

test('norm bỏ dấu tiếng Việt', () => {
  assert.equal(norm('Tự do tài chính'), 'tu do tai chinh');
  assert.equal(norm('ĐẦU TƯ'), 'dau tu');
});

test('short rút gọn số tiền theo cách đọc của người Việt', () => {
  assert.match(short(1_500_000), /1,5 triệu/);
  assert.match(short(2_000_000_000), /2 tỷ/);
  assert.equal(short(0), '0đ');
  assert.match(short(-350_000), /^-350k$/);
});

test('pct định dạng phần trăm an toàn với giá trị lỗi', () => {
  assert.equal(pct(0.256), '25,6%');
  assert.equal(pct(0.256, 0), '26%');
  assert.equal(pct(NaN), '0,0%');
  assert.equal(pct(undefined), '0,0%');
});

test('monthsToTarget tính số tháng cần để đạt mục tiêu', () => {
  // không lãi: 12 tháng x 1 triệu = 12 triệu
  assert.ok(Math.abs(monthsToTarget(0, 1_000_000, 0, 12_000_000) - 12) < 0.05);
  // đã đủ tiền
  assert.equal(monthsToTarget(12_000_000, 1_000_000, 0, 12_000_000), 0);
  // không đóng góp, không lãi -> không bao giờ đạt
  assert.equal(monthsToTarget(0, 0, 0, 1_000_000), null);
  // có lãi thì đạt nhanh hơn
  assert.ok(monthsToTarget(0, 1_000_000, 0.1, 120_000_000) < monthsToTarget(0, 1_000_000, 0, 120_000_000));
});

test('tiện ích ngày tháng', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(monthStart('2026-03'), '2026-03-01');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(diffDays('2026-01-01', '2026-01-11'), 10);
  assert.equal(lastMonths(3).length, 3);
});

test('thuế TNCN theo biểu luỹ tiến từng phần', () => {
  assert.equal(taxOnTaxable(0), 0);
  assert.equal(taxOnTaxable(5_000_000), 250_000);
  // 5tr đầu 5% + 5tr tiếp 10%
  assert.equal(taxOnTaxable(10_000_000), 250_000 + 500_000);
  assert.equal(BRACKETS.at(-1).rate, 0.35);
});

test('grossToNet trừ đúng bảo hiểm và giảm trừ gia cảnh', () => {
  const r = grossToNet(30_000_000, { dependents: 0 });
  assert.equal(r.insurance, Math.round(30_000_000 * 0.105));
  assert.equal(r.deduction, 15_500_000);
  assert.equal(r.taxable, 30_000_000 - r.insurance - 15_500_000);
  assert.equal(r.net, 30_000_000 - r.insurance - r.tax);
  assert.ok(r.net < 30_000_000 && r.net > 20_000_000);
});

test('người phụ thuộc làm giảm thuế phải nộp', () => {
  const a = grossToNet(40_000_000, { dependents: 0 });
  const b = grossToNet(40_000_000, { dependents: 2 });
  assert.ok(b.tax < a.tax);
  assert.ok(b.net > a.net);
});

test('netToGross là hàm ngược của grossToNet', () => {
  const gross = 45_000_000;
  const net = grossToNet(gross, { dependents: 1 }).net;
  const back = netToGross(net, { dependents: 1 });
  assert.ok(Math.abs(back.gross - gross) <= 1000, `lệch ${Math.abs(back.gross - gross)}đ`);
});

test('detectIntent phân biệt ghi sổ với câu hỏi', () => {
  const cases = {
    'trưa nay ăn 60k': 'add_expense',
    'nhận lương 31 triệu': 'add_income',
    'tháng này tiêu bao nhiêu': 'query_spending',
    'số dư của tôi': 'query_balance',
    'bao giờ tôi tự do tài chính': 'query_fire',
    'tôi dư 200 triệu nên làm gì': 'surplus_advice',
    'có nên mua macbook 45 triệu không': 'affordability',
    'tạo mục tiêu mua xe 500 triệu trong 24 tháng': 'create_goal',
    'chuyển 5 triệu từ VCB sang tiết kiệm': 'add_transfer',
    'undo': 'undo',
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(detectIntent(text).intent, expected, `"${text}"`);
  }
});

test('câu hỏi mở không bị hiểu nhầm thành ghi chi tiêu', () => {
  const { intent } = detectIntent('lạm phát ảnh hưởng gì tới kế hoạch của tôi');
  assert.notEqual(intent, 'add_expense');
});

test('cơ sở tri thức nhận diện chủ đề tài chính', () => {
  assert.equal(findTopic('lạm phát ảnh hưởng gì')?.key, 'inflation');
  assert.equal(findTopic('có nên giữ vàng không')?.key, 'gold');
  assert.equal(findTopic('mình nên mua nhà hay tiếp tục thuê')?.key, 'rent_vs_buy');
  assert.equal(findTopic('trưa nay ăn 60k'), null);
});

test('parseBankMessage đọc được SMS ngân hàng', () => {
  const p = parseBankMessage('VCB: 23/08/2026 12:34 TK 0071000123456 -350,000VND. So du: 42,150,000VND. ND: THANH TOAN GRABFOOD');
  assert.equal(p.amount, 350_000);
  assert.equal(p.type, 'expense');
  assert.equal(p.date, '2026-08-23');
  assert.equal(p.balance, 42_150_000);
  assert.match(p.description, /GRABFOOD/i);
});

test('parseBankMessage nhận tiền vào là thu nhập', () => {
  const p = parseBankMessage('TCB: TK 19036 +31,200,000VND luc 05/03/2026. ND: CONG TY ABC TRA LUONG THANG 2');
  assert.equal(p.amount, 31_200_000);
  assert.equal(p.type, 'income');
});
