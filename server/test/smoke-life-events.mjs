/**
 * Kiểm tầng "biến cố lớn của đời".
 *
 * Vì sao có bài này: bộ luật từng trả lời "mình vừa ly hôn, tài sản còn một
 * nửa" bằng câu "Bạn muốn cập nhật thông tin gì? Ví dụ mình tên Nam, sinh năm
 * 1996" — đúng lúc người dùng cần cố vấn nhất thì app hỏi tên tuổi. Bài test
 * khoá cả hai chiều: nhận ra biến cố, và không chặn nhầm câu ghi sổ thường.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, '.tmp-life-event.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

process.env.FINMATE_DB = DB;
process.env.FINMATE_AGENT = 'off';
process.env.FINMATE_FX_OFFLINE = '1';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);

const { detectLifeEvent, answerLifeEvent, LIFE_EVENT_KEYS } = await import('../src/services/chat/life_events.js');
const { chat } = await import('../src/services/chat/index.js');
const { insert, update } = await import('../src/db.js');

// DB tạm mới tinh sẽ rơi vào luồng thiết lập lần đầu và nuốt mất câu hỏi thật.
update('profile', 1, { onboarded: 1, onboarding_step: 'done' });

/* ---------- 1. Nhận diện đúng biến cố ---------- */
head('Nhận ra biến cố qua nhiều cách nói');
const CA = [
  ['ly_hon', 'mình vừa ly hôn, tài sản còn một nửa, tuổi 40 thì nên tính lại thế nào'],
  ['ly_hon', 'tụi mình ly dị rồi, giờ chia đôi tài sản'],
  ['mat_viec', 'mình vừa mất việc, chưa biết tính sao'],
  ['mat_viec', 'công ty cắt giảm, mình bị cho nghỉ tháng sau'],
  ['sinh_con', 'vợ mình sắp sinh, cần chuẩn bị tiền thế nào'],
  ['sinh_con', 'mình có bầu rồi, tính toán sao đây'],
  ['ket_hon', 'tụi mình sắp cưới, cần bao nhiêu tiền'],
  ['thua_ke', 'mình mới được thừa kế một mảnh đất'],
  ['thua_ke', 'bố mẹ cho đất, mình nên làm gì'],
  ['benh_nang', 'mình phải nằm viện dài ngày, tiền bạc tính sao'],
  ['nghi_huu', 'mình sắp nghỉ hưu năm sau'],
  ['nguoi_than_mat', 'bố mình mất tuần trước'],
  ['chuyen_nuoc', 'mình sắp đi nước ngoài định cư'],
];
for (const [key, cau] of CA) {
  ok(`"${cau.slice(0, 42)}…" → ${key}`, detectLifeEvent(cau) === key, `nhận ra: ${detectLifeEvent(cau)}`);
}
ok('mọi key trong bảng đều dùng được', LIFE_EVENT_KEYS.every((k) => Boolean(answerLifeEvent(k))));

/* ---------- 2. Không chặn nhầm câu thường ---------- */
head('Không chặn nhầm câu ghi sổ và câu hỏi thường');
for (const cau of [
  'mình tiêu 45k ăn sáng',
  'hôm qua đi ăn cưới hết 500k',
  'lương về rồi 25 triệu',
  'tháng này mình tiêu bao nhiêu',
  'mình muốn mua nhà 2 tỷ',
  'bao giờ mình tự do tài chính',
  'chuyển 5 triệu từ ví sang tiết kiệm',
  'mình mất ví rồi, trong đó có 500k',
]) {
  ok(`không nhận nhầm: "${cau}"`, detectLifeEvent(cau) === null, `nhận ra: ${detectLifeEvent(cau)}`);
}

/* ---------- 3. Lời khuyên phải dùng số thật, không lỗi hiển thị ---------- */
head('Lời khuyên dựa trên số liệu thật');
insert('accounts', { name: 'Vietcombank', type: 'bank', currency: 'VND', balance: 200_000_000, is_active: 1 });
insert('accounts', { name: 'Tiền mặt', type: 'cash', currency: 'VND', balance: 5_000_000, is_active: 1 });
// alreadySetUp() coi là đã dùng thật khi có >= 2 tài khoản và >= 20 giao dịch.
for (let i = 0; i < 22; i += 1) {
  insert('transactions', { type: 'expense', amount: 500_000, currency: 'VND', date: '2026-08-01', note: `chi ${i}` });
}

for (const key of LIFE_EVENT_KEYS) {
  const r = answerLifeEvent(key);
  ok(`${key}: đủ dài để có ích`, r.reply.length > 200, `dài ${r.reply.length}`);
  ok(`${key}: không lộ undefined/NaN/[object`, !/undefined|NaN|\[object/.test(r.reply), r.reply.slice(0, 120));
  ok(`${key}: có gợi ý bước tiếp theo`, Array.isArray(r.quick) ? r.quick.length > 0 : true);
}

/* ---------- 4. Đi trọn đường chat thật ---------- */
head('Qua đường chat đầy đủ');
{
  const r = await chat('mình vừa ly hôn, tài sản còn một nửa, tuổi 40 thì nên tính lại thế nào');
  ok('intent là life_event', r.intent === 'life_event', r.intent);
  ok('không còn hỏi tên tuổi như trước', !/tên .* sinh năm/i.test(r.reply), r.reply.slice(0, 120));
  ok('trả lời đủ dài', r.reply.length > 200, `dài ${r.reply.length}`);
}
{
  const r = await chat('mình tiêu 45k ăn sáng');
  ok('câu ghi sổ vẫn ghi bình thường', r.intent === 'add_expense', r.intent);
}

console.log(`\n${fail ? '✗' : '✓'} smoke-life-events: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
