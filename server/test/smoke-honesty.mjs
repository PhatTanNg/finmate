/**
 * Kiểm chốt chặn "nói suông": AI không được phép nói đã làm khi chưa gọi công cụ.
 *
 * Vì sao có bài test này: khi cắm Claude thật, model đọc lịch sử chat thấy
 * những câu bộ luật từng trả lời ("✍️ Đã ghi chi 45.000đ…") rồi bắt chước y
 * hệt mà không gọi công cụ nào. Người dùng đọc thấy "đã ghi" nhưng sổ trống
 * trơn. Trong app tài chính đây là lỗi tệ nhất có thể có, nên phải khoá lại.
 *
 * Không gọi API thật: máy chủ giả nói giọng Messages API, kịch bản do test đặt.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, '.tmp-honesty.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);

// Kịch bản do từng bài đặt: mảng các content[] mà model sẽ trả về lần lượt.
let script = [];
let turn = 0;
const seen = [];

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const content = script[Math.min(turn, script.length - 1)];
    turn += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

process.env.FINMATE_DB = DB;
process.env.FINMATE_LLM_KEY = 'sk-ant-fake-for-test';
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${port}/v1/messages`;
process.env.FINMATE_LLM_MODEL = 'claude-test';

const { runAgent } = await import('../src/services/chat/agent.js');
const { all } = await import('../src/db.js');
const { listActions } = await import('../src/services/ai_audit.js');

const noiSuong = [{ type: 'text', text: '✍️ Đã ghi chi **45.000đ** — 🍜 Ăn uống\n🏠 Trừ vào quỹ *Thiết yếu*' }];
const goiCongCu = [
  { type: 'text', text: 'Được, mình ghi ngay.' },
  { type: 'tool_use', id: 'tu_1', name: 'ghi_giao_dich', input: { so_tien: 45000, loai: 'chi', mo_ta: 'ăn sáng', danh_muc: 'Ăn uống' } },
];

/* ---------- 1. Nói suông rồi được nhắc thì phải làm thật ---------- */
head('Nói suông -> bị nhắc -> gọi công cụ thật');
{
  script = [noiSuong, goiCongCu, [{ type: 'text', text: 'Xong, mình đã ghi 45.000đ ăn sáng.' }]];
  turn = 0; seen.length = 0;
  const before = all('SELECT * FROM transactions').length;
  const r = await runAgent('ghi giúp mình ăn sáng 45k', []);

  ok('agent vẫn trả lời được', Boolean(r?.reply), JSON.stringify(r)?.slice(0, 160));
  ok('công cụ thực sự được gọi sau khi nhắc', (r?.calls || []).includes('ghi_giao_dich'), JSON.stringify(r?.calls));
  ok('giao dịch vào sổ thật', all('SELECT * FROM transactions').length === before + 1);
  ok('có ghi nhật ký thao tác', listActions({ limit: 3 }).some((a) => a.cong_cu === 'ghi_giao_dich'));

  const nhac = seen[1]?.messages?.slice(-1)[0];
  ok('lời nhắc đi ở vai user, không phải system', nhac?.role === 'user', JSON.stringify(nhac)?.slice(0, 120));
  ok('lời nhắc nói rõ là chưa có gì thay đổi', /chưa/i.test(JSON.stringify(seen[1]?.messages || '')));
}

/* ---------- 2. Nhắc rồi vẫn nói suông -> phải nhường, không được nói dối ---------- */
head('Cố chấp nói suông -> nhường cho bộ luật');
{
  script = [noiSuong];   // lần nào cũng nói suông
  turn = 0; seen.length = 0;
  const before = all('SELECT * FROM transactions').length;
  const r = await runAgent('ghi giúp mình ăn trưa 60k', []);

  ok('agent trả null để tầng trên xử lý thật', r === null, JSON.stringify(r)?.slice(0, 160));
  ok('không ghi bừa giao dịch nào', all('SELECT * FROM transactions').length === before);
  ok('đã thử nhắc đúng một lần rồi mới bỏ', seen.length === 2, `gọi model ${seen.length} lượt`);
}

/* ---------- 3. Không chặn nhầm câu chỉ kể lại số liệu ---------- */
head('Không chặn nhầm lời tư vấn bình thường');
for (const [ten, text] of [
  ['câu kể số liệu chi tiêu', 'Tháng này bạn đã chi 32,9 triệu, vẫn trong ngân sách.'],
  ['câu nói về tiền đã nhận', 'Lương tháng 8 đã về tài khoản Techcombank rồi nhé.'],
  ['câu khuyên thuần tuý', 'Quỹ khẩn cấp của bạn mới đủ 2 tháng, nên nâng dần lên 6 tháng.'],
]) {
  script = [[{ type: 'text', text }]];
  turn = 0; seen.length = 0;
  const r = await runAgent('cho mình hỏi tình hình', []);
  ok(`${ten} vẫn được trả lời bình thường`, r?.reply === text, JSON.stringify(r)?.slice(0, 160));
  ok(`${ten} không tốn thêm lượt gọi model`, seen.length === 1, `gọi ${seen.length} lượt`);
}

/* ---------- 4. Có gọi công cụ rồi thì nói "đã làm" là hợp lệ ---------- */
head('Đã làm thật thì không bị chặn');
{
  script = [goiCongCu, [{ type: 'text', text: 'Mình đã ghi xong và đã cập nhật quỹ Thiết yếu.' }]];
  turn = 0; seen.length = 0;
  const r = await runAgent('ghi giúp mình ăn sáng 45k', []);
  ok('câu khẳng định sau khi làm thật được giữ nguyên', /đã ghi/.test(r?.reply || ''), JSON.stringify(r)?.slice(0, 160));
  ok('không phát sinh lượt nhắc thừa', seen.length === 2, `gọi ${seen.length} lượt`);
}

/* ---------- 5. Nhận diện lời khẳng định có dấu tiếng Việt ---------- */
head('Nhận diện được chữ tiếng Việt có dấu');
{
  // Bản đầu tiên dùng \b nên không khớp "đã" — nhìn mã thì thấy đúng, chỉ chạy
  // thật mới lộ. Giữ lại đúng những câu từng lọt lưới.
  const lot = ['✍️ Đã ghi chi **45.000đ**', 'Mình đã cập nhật quỹ cho bạn', 'Đã tạo quỹ Mua nhà', 'Mình vừa xoá khoản đó rồi'];
  for (const text of lot) {
    script = [[{ type: 'text', text }]];
    turn = 0; seen.length = 0;
    const r = await runAgent('làm giúp mình', []);
    ok(`bắt được: "${text.slice(0, 32)}…"`, r === null && seen.length === 2, `r=${JSON.stringify(r)?.slice(0, 80)} lượt=${seen.length}`);
  }
}

await new Promise((r) => server.close(r));

console.log(`\n${fail ? '✗' : '✓'} smoke-honesty: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
