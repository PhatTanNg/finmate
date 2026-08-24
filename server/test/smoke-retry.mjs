/**
 * Kiểm cơ chế thử lại khi nhà cung cấp model chập chờn.
 *
 * Vì sao có bài test này: khi cắm Claude thật, nhật ký cho thấy 18 trên 58
 * lượt gọi trả về 503/529 "overloaded_error" — lỗi tạm thời, chờ một nhịp gọi
 * lại là được. Nhưng app bỏ cuộc ngay lượt đầu và lùi thẳng về bộ luật, nên
 * gần một phần ba câu hỏi mất phần AI dù key vẫn tốt và người dùng vẫn đang
 * trả tiền cho model. Đây là loại lỗi không bao giờ lộ ra khi đọc mã, chỉ khi
 * chạy thật đủ lâu mới thấy.
 *
 * Không gọi API thật: máy chủ giả trả mã lỗi theo kịch bản từng lượt.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, '.tmp-retry.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);

// Kịch bản: mỗi phần tử là mã HTTP máy chủ giả trả về cho lượt tương ứng.
// 200 nghĩa là trả lời tử tế.
let script = [];
let turn = 0;
let hits = 0;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    hits += 1;
    const status = script[Math.min(turn, script.length - 1)];
    turn += 1;
    if (status !== 200) {
      const type = status === 529 || status === 503 ? 'overloaded_error' : 'api_error';
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type, message: 'thử lại sau' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'claude-test',
      content: [{ type: 'text', text: 'Chào bạn, mình đây.' }],
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

process.env.FINMATE_DB = DB;
process.env.FINMATE_LLM_KEY = 'sk-ant-fake-for-test';
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${port}/v1/messages`;
process.env.FINMATE_LLM_MODEL = 'claude-test';

const { complete, llmStatus } = await import('../src/services/chat/llm.js');

const reset = (s) => { script = s; turn = 0; hits = 0; };
const ask = () => complete([{ role: 'user', content: 'chào' }], []).catch((e) => ({ err: String(e?.message || e) }));

/* ---------- 1. Lỗi quá tải một lần thì phải tự gượng dậy ---------- */
head('529 một lần rồi thành công');
{
  reset([529, 200]);
  const t0 = Date.now();
  const r = await ask();
  ok('trả lời được dù lượt đầu hỏng', String(r?.content || '').includes('mình đây'), JSON.stringify(r)?.slice(0, 120));
  ok('có gọi lại lần hai', hits === 2, `hits=${hits}`);
  ok('có chờ trước khi gọi lại', Date.now() - t0 >= 350, `${Date.now() - t0}ms`);
}

/* ---------- 2. Quá tải hai lần vẫn phải cứu được ---------- */
head('503 hai lần rồi thành công');
{
  reset([503, 503, 200]);
  const r = await ask();
  ok('trả lời được sau hai lần hỏng', String(r?.content || '').includes('mình đây'));
  ok('gọi đúng ba lượt', hits === 3, `hits=${hits}`);
}

/* ---------- 3. Hỏng mãi thì chịu thua, không thử vô hạn ---------- */
head('Quá tải liên tục thì dừng đúng lúc');
{
  reset([529]);
  const r = await ask();
  ok('cuối cùng vẫn ném lỗi ra cho agent lùi về bộ luật', Boolean(r?.err), JSON.stringify(r)?.slice(0, 120));
  ok('không thử lại vô hạn (tối đa 3 lượt)', hits === 3, `hits=${hits}`);
  ok('lỗi nói rõ mã trạng thái', /529/.test(r?.err || ''), r?.err);
}

/* ---------- 4. Lỗi vĩnh viễn thì không được phí tiền gọi lại ---------- */
head('Lỗi key/request hỏng thì bỏ cuộc ngay');
for (const [status, ten] of [[401, 'key sai'], [400, 'request hỏng'], [404, 'sai tên model']]) {
  reset([status]);
  const r = await ask();
  ok(`${ten} (${status}): chỉ gọi đúng một lượt`, hits === 1, `hits=${hits}`);
  ok(`${ten} (${status}): vẫn báo lỗi ra ngoài`, Boolean(r?.err));
}

/* ---------- 5. Nhật ký sức khoẻ phải nói thật ---------- */
head('llmStatus phản ánh đúng chuyện đã xảy ra');
{
  const s = llmStatus();
  ok('đếm được số lượt gọi', s.lan_goi > 0, JSON.stringify(s));
  ok('đếm được số lượt lỗi', s.lan_loi > 0);
  ok('đếm được số lần thử lại', s.lan_thu_lai > 0, `lan_thu_lai=${s.lan_thu_lai}`);
  ok('có mã model', s.model === 'claude-test');
  ok('bật vì có key', s.bat === true);
}

/* ---------- 6. Lượt thành công không được xoá dấu vết lỗi cũ ---------- */
head('Lỗi lác đác không bị một lượt tốt xoá sạch');
{
  reset([200]);
  await ask();
  const s = llmStatus();
  ok('lượt gần nhất là tốt', s.gan_nhat_ok === true);
  ok('vẫn còn giữ lỗi gần nhất để soi', Boolean(s.loi_gan_nhat), JSON.stringify(s.loi_gan_nhat));
  ok('có mốc thời gian của lỗi', Boolean(s.loi_luc));
  ok('không lộ key trong thông điệp lỗi', !/sk-ant-fake/.test(JSON.stringify(s)));
}

server.close();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

console.log(`\n${fail === 0 ? '🎉' : '❌'} smoke-retry: ${pass} đạt, ${fail} hỏng`);
if (fail) process.exitCode = 1;
