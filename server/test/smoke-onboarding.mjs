/**
 * Trong lúc thiết lập, app phải phân biệt được ba loại câu rất giống nhau:
 *
 *  1. Câu KHAI BÁO ("lương 30 triệu", "thuê nhà 5 triệu") -> là câu trả lời
 *     cho câu hỏi thiết lập đang dở.
 *  2. Câu GHI SỔ thật ("tối qua cà phê 40k") -> phải ghi đúng thành giao dịch
 *     rồi quay lại bước đang dở. Trước đây câu này bị nuốt vào luồng hỏi đáp
 *     và 40k bị ghi thành *lương tháng* — sai hẳn hồ sơ tài chính.
 *  3. Câu HỎI ("số dư còn bao nhiêu") -> trả lời rồi quay lại bước đang dở.
 */
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('./.tmp-onboarding.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

process.env.FINMATE_DB = DB;
process.env.FINMATE_FX_OFFLINE = '1';
delete process.env.FINMATE_LLM_KEY;
delete process.env.FINMATE_LLM_URL;

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { all, get } = await import('../src/db.js');
const { chat, ensureWelcome } = await import('../src/services/chat/index.js');
const { parseDate } = await import('../src/util/vi.js');
const { today, addDays } = await import('../src/util/date.js');

const step = () => get('SELECT * FROM profile WHERE id = 1')?.onboarding_step;
const txs = () => all('SELECT * FROM transactions ORDER BY id');
const streams = () => all('SELECT * FROM income_streams ORDER BY id');

ensureWelcome();
await chat('chào bạn');
ok('đang ở giữa luồng thiết lập', step() && step() !== 'done', 'step=' + step());

head('Ghi sổ thật giữa lúc thiết lập');
{
  const before = step();
  const r = await chat('tối qua cà phê 40k');
  const t = txs();
  ok('không bị nuốt thành câu trả lời thiết lập', r.intent !== 'onboarding', 'intent=' + r.intent);
  ok('ghi đúng thành một khoản chi', t.length === 1 && t[0].type === 'expense' && t[0].amount === 40000,
    JSON.stringify(t.map((x) => [x.type, x.amount])));
  ok('KHÔNG ghi nhầm thành nguồn thu nhập', streams().length === 0, JSON.stringify(streams().map((s) => s.name)));
  ok('"tối qua" được hiểu là hôm qua', t[0]?.date === addDays(today(), -1), t[0]?.date + ' vs ' + addDays(today(), -1));
  ok('vẫn ở nguyên bước thiết lập đang dở', step() === before, before + ' -> ' + step());
  ok('có nhắc quay lại phần thiết lập', /thiết lập/i.test(r.reply), r.reply.slice(-80));
  ok('vẫn báo cho giao diện là đang thiết lập', r.onboarding === true);
}

head('Câu khai báo vẫn đi đúng luồng thiết lập');
{
  const r = await chat('lương 30 triệu');
  ok('"lương 30 triệu" là câu trả lời thiết lập', r.intent === 'onboarding', 'intent=' + r.intent);
  ok('ghi thành nguồn thu hằng tháng', streams().length === 1, JSON.stringify(streams().map((s) => [s.name, s.amount])));
  ok('không tạo thêm giao dịch lẻ', txs().length === 1, String(txs().length));
  ok('bước thiết lập tiến lên', step() !== 'income', 'step=' + step());
}
{
  const nTx = txs().length;
  const r = await chat('thuê nhà 5 triệu, điện nước 800k');
  ok('"thuê nhà 5 triệu" vẫn là câu khai báo, không phải giao dịch', r.intent === 'onboarding', 'intent=' + r.intent);
  ok('không ghi thành khoản chi lẻ', txs().length === nTx, String(txs().length));
}

head('Câu hỏi giữa lúc thiết lập');
{
  const before = step();
  const r = await chat('tài sản ròng của mình bao nhiêu');
  ok('câu hỏi được trả lời chứ không bị nuốt', r.intent !== 'onboarding', 'intent=' + r.intent);
  ok('vẫn ở nguyên bước đang dở', step() === before, before + ' -> ' + step());
}

head('Các mốc thời gian tiếng Việt');
{
  const ref = '2026-09-04';
  const cases = [
    ['tối qua cà phê 40k', '2026-09-03'], ['đêm qua 50k', '2026-09-03'],
    ['chiều qua ăn 30k', '2026-09-03'], ['sáng qua 20k', '2026-09-03'],
    ['hôm qua đổ xăng 100k', '2026-09-03'], ['hôm kia 20k', '2026-09-02'],
    ['sáng nay ăn phở 50k', '2026-09-04'], ['trưa nay 65k', '2026-09-04'],
    ['tối nay 80k', '2026-09-04'], ['cà phê 40k', '2026-09-04'],
  ];
  for (const [msg, want] of cases) {
    const got = parseDate(msg, ref);
    ok(`"${msg}" -> ${want}`, got === want, 'ra ' + got);
  }
}

console.log(`\n${fail ? '✗' : '✓'} smoke-onboarding: ${pass} đạt, ${fail} hỏng`);
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);
process.exit(fail ? 1 : 0);
