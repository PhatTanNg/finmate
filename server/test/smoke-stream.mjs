/**
 * Kiểm chat dạng luồng (SSE), ảnh gửi kèm, và cờ "AI đã lùi về bộ luật".
 *
 * Vì sao có bài này: câu trả lời của AI mất 10-20 giây khi nó gọi vài công cụ
 * liên tiếp, và người dùng chỉ thấy ba chấm. Đường /chat/stream phát từng bước
 * ("đang ghi giao dịch…") ngay lúc nó xảy ra. Bài test dựng LLM giả kiểu
 * OpenAI và một server Express thật để chứng minh luồng đi tới tận trình duyệt.
 */
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

const DB = fileURLToPath(new URL('./.tmp-stream.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);
const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

// --- LLM giả kiểu OpenAI: phát kịch bản định sẵn, ghi lại request nhận được ---
let scenario = [];
const seen = [];
let mode = 'ok';
const llm = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push(JSON.parse(body || '{}'));
    if (mode === 'down') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"key sai"}'); return; }
    const step = scenario.shift() || { content: 'Xong rồi bạn nhé.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.content ?? null, tool_calls: step.tool_calls } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }));
  });
});
await new Promise((r) => llm.listen(0, r));

process.env.FINMATE_DB = DB;
process.env.FINMATE_FX_OFFLINE = '1';
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${llm.address().port}/v1/chat/completions`;
process.env.FINMATE_LLM_KEY = 'test-key';
process.env.FINMATE_LLM_MODEL = 'mock';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { chat, validImage, validImages } = await import('../src/services/chat/index.js');
const { router } = await import('../src/routes/api.js');
const { all, update } = await import('../src/db.js');
update('profile', 1, { onboarded: 1, onboarding_step: 'done' });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

head('Kiểm tra ảnh ở cửa');
ok('ảnh PNG data URL hợp lệ đi qua', validImage(PNG) === PNG);
ok('không có ảnh thì trả null', validImage(null) === null && validImage('') === null);
ok('chuỗi không phải ảnh bị chặn', (() => { try { validImage('data:text/plain;base64,aGVsbG8='); return false; } catch (e) { return /không hợp lệ/.test(e.message); } })());
ok('ảnh quá lớn bị chặn', (() => { try { validImage(`data:image/jpeg;base64,${'A'.repeat(6_100_000)}`); return false; } catch (e) { return /quá lớn/.test(e.message); } })());

head('Nhiều ảnh một lượt');
ok('mảng ảnh hợp lệ đi qua nguyên vẹn', (() => { const r = validImages([PNG, PNG, PNG]); return r.length === 3 && r.every((x) => x === PNG); })());
ok('không ảnh nào thì trả mảng rỗng', validImages(null).length === 0 && validImages([]).length === 0);
// Client cũ chỉ biết gửi `image` lẻ. Bỏ nhánh này là bản cài trên màn hình
// chính của người dùng gửi ảnh xong không thấy gì xảy ra.
ok('vẫn nhận đường cũ: một ảnh ở tham số image', (() => { const r = validImages(null, PNG); return r.length === 1 && r[0] === PNG; })());
ok('gộp được cả hai đường', validImages([PNG], PNG).length === 2);
ok('một ảnh hỏng trong xấp là chặn cả xấp', (() => { try { validImages([PNG, 'data:text/plain;base64,aGk=']); return false; } catch (e) { return /không hợp lệ/.test(e.message); } })());
ok('quá trần số ảnh bị chặn, và nói rõ trần là bao nhiêu', (() => { try { validImages(Array(11).fill(PNG)); return false; } catch (e) { return /tối đa 10 ảnh/.test(e.message); } })());
ok('trần đọc lúc gọi nên đổi biến môi trường là có hiệu lực ngay', (() => {
  process.env.FINMATE_MAX_IMAGES = '2';
  try { validImages([PNG, PNG, PNG]); return false; }
  catch (e) { return /tối đa 2 ảnh/.test(e.message); }
  finally { delete process.env.FINMATE_MAX_IMAGES; }
})());
// Trần đếm không đủ: mười ảnh 4MB vẫn vượt trần 32MB của một request, và lỗi
// nhận về từ API là một câu khó hiểu chứ không phải "ảnh nặng quá".
ok('tổng dung lượng vượt trần bị chặn dù số ảnh vẫn trong hạn', (() => {
  const nang = `data:image/jpeg;base64,${'A'.repeat(5_000_000)}`;
  try { validImages(Array(5).fill(nang)); return false; } catch (e) { return /Tổng dung lượng/.test(e.message); }
})());

head('chat() phát sự kiện từng bước');
{
  scenario = [
    { tool_calls: [tc('c1', 'ghi_giao_dich', { so_tien: 65000, loai: 'expense', mo_ta: 'ăn trưa' })] },
    { content: 'Đã ghi 65.000đ ăn trưa nhé.' },
  ];
  const events = [];
  const r = await chat('trưa nay ăn 65k', { onEvent: (e) => events.push(e) });
  ok('trả lời được', /65/.test(r.reply), r.reply);
  ok('có sự kiện thinking trước mỗi lượt gọi model', events.filter((e) => e.type === 'thinking').length === 2, JSON.stringify(events));
  const tool = events.find((e) => e.type === 'tool');
  ok('sự kiện tool nêu tên công cụ và tham số đáng nói', tool?.name === 'ghi_giao_dich' && tool.args.so_tien === '65000' && tool.args.mo_ta === 'ăn trưa', JSON.stringify(tool));
  ok('sự kiện tool_done báo thành công', events.some((e) => e.type === 'tool_done' && e.name === 'ghi_giao_dich' && e.ok === true));
  ok('trả về mã lượt (batch) để hoàn tác cả lượt', typeof r.batch === 'string' && r.batch.startsWith('chat-'));
  ok('lượt có đổi dữ liệu thì refresh = true', r.refresh === true);
  const saved = all("SELECT data FROM chat_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1")[0];
  ok('mã lượt được lưu vào lịch sử để hoàn tác sau khi tải lại', JSON.parse(saved.data).batch === r.batch);
  ok('người nghe sự kiện lỗi không làm hỏng lượt chat', Boolean((await chat('xin chào', { onEvent: () => { throw new Error('bùm'); } })).reply));
}

head('Ảnh đi tới model đúng hình dạng');
{
  scenario = [
    { tool_calls: [tc('c2', 'ghi_giao_dich', { so_tien: 12.5, loai: 'expense', mo_ta: 'Boojum' })] },
    { content: 'Mình đọc hoá đơn thấy 12,5 và đã ghi.' },
  ];
  const before = seen.length;
  const r = await chat('', { image: PNG });
  ok('không có chữ vẫn chat được nhờ ảnh', Boolean(r.reply));
  const req = seen[before];
  const user = req.messages[req.messages.length - 1];
  ok('lượt user gửi dạng nhiều phần: chữ + image_url', Array.isArray(user.content) && user.content.some((p) => p.type === 'image_url' && p.image_url.url === PNG) && user.content.some((p) => p.type === 'text' && /ảnh/.test(p.text)), JSON.stringify(user).slice(0, 200));
  // Kiểm nội dung chứ không kiểm câu chữ: prompt phải dạy agent chọn công cụ
  // theo LOẠI ảnh. Ảnh số dư mà đem ghi_giao_dich là sai hẳn dữ liệu.
  const sys = req.messages[0].content;
  ok('system prompt có phần hướng dẫn đọc ảnh', /ẢNH GỬI KÈM|hoá đơn/i.test(sys));
  ok('ảnh hoá đơn -> ghi giao dịch', /ghi_giao_dich/.test(sys));
  ok('ảnh màn hình số dư -> cập nhật số dư, KHÔNG phải giao dịch', /capnhat_so_du/.test(sys) && /KHÔNG phải giao dịch/.test(sys));
  ok('ảnh danh mục chứng khoán -> thêm/cập nhật đầu tư', /them_dau_tu/.test(sys) && /cap_nhat_gia/.test(sys));
  ok('dặn đọc đúng đồng tiền trên ảnh', /đồng tiền/.test(sys));
  ok('dạy xử lý từng tấm khi gửi nhiều ảnh', /Nhiều ảnh một lượt/.test(sys) && /từng tấm/.test(sys));
  ok('dặn không gộp ba hoá đơn thành một khoản', /ba lần ghi_giao_dich/.test(sys));
  ok('dặn nhận ra hai tấm chụp cùng một hoá đơn', /Trùng lặp/.test(sys));
  ok('đường OpenAI gộp hai message system thành một', req.messages.filter((m) => m.role === 'system').length === 1 && /TÌNH HÌNH/.test(req.messages[0].content));
}

head('Xấp ảnh: mỗi tấm có nhãn riêng, lịch sử ghi rõ mấy tấm');
{
  const A = PNG;
  const B = PNG.replace('AAAB', 'AAAC');   // khác byte để phân biệt hai tấm
  scenario = [
    { tool_calls: [tc('c9', 'ghi_giao_dich', { so_tien: 65000, loai: 'expense', mo_ta: 'chợ' })] },
    { content: 'Mình đọc ba hoá đơn và ghi xong.' },
  ];
  const before = seen.length;
  const r = await chat('ghi hết giúp mình', { images: [A, B, A] });
  ok('gửi ba ảnh một lượt vẫn chạy', Boolean(r.reply));
  const user = seen[before].messages[seen[before].messages.length - 1];
  const hinh = user.content.map((p2) => (p2.type === 'image_url' ? '<ảnh>' : p2.text));
  ok('ba ảnh đều tới model', user.content.filter((p2) => p2.type === 'image_url').length === 3);
  ok('mỗi tấm có nhãn đứng ngay trước nó',
    hinh.join('|') === 'Ảnh 1:|<ảnh>|Ảnh 2:|<ảnh>|Ảnh 3:|<ảnh>|ghi hết giúp mình', hinh.join('|'));
  ok('ảnh thứ hai đúng là tấm khác, không phải bản sao tấm đầu',
    user.content.filter((p2) => p2.type === 'image_url')[1].image_url.url === B);
  // Ảnh không lưu vào lịch sử (nặng), nên dòng ghi lại là thứ duy nhất còn nói
  // được lượt đó dựa trên mấy tấm. Ghi "đã gửi kèm ảnh" cho cả xấp là mất tin.
  const lich = all('SELECT content FROM chat_messages ORDER BY id DESC LIMIT 6').map((m) => m.content);
  ok('lịch sử ghi rõ số ảnh của lượt', lich.some((c) => /đã gửi kèm 3 ảnh/.test(c)), lich.slice(0, 3).join(' // '));
}

head('Một ảnh: giữ nguyên đường cũ, không chèn nhãn thừa');
{
  scenario = [{ content: 'Xong.' }];
  const before = seen.length;
  await chat('cái này bao nhiêu', { images: [PNG] });
  const user = seen[before].messages[seen[before].messages.length - 1];
  ok('một ảnh thì không có nhãn "Ảnh 1:"', !user.content.some((p2) => p2.type === 'text' && /^Ảnh 1:$/.test(p2.text)), JSON.stringify(user.content.map((p2) => p2.type)));
  ok('một ảnh vẫn đúng hai phần: chữ + ảnh', user.content.length === 2 && user.content.filter((p2) => p2.type === 'image_url').length === 1);
  const saved = all("SELECT content, data FROM chat_messages WHERE role='user' ORDER BY id DESC LIMIT 1")[0];
  ok('lịch sử không lưu ảnh, chỉ ghi dấu đã gửi ảnh', /đã gửi kèm ảnh/.test(saved.content) && !saved.content.includes('base64') && JSON.parse(saved.data).image === true);
}

head('AI hỏng thì nói rõ là bộ luật đang trả lời');
{
  mode = 'down';
  const r = await chat('trưa nay ăn 40k');
  ok('bộ luật vẫn ghi được giao dịch', /40/.test(r.reply) && all("SELECT id FROM transactions").length >= 2, r.reply);
  ok('kèm cờ fallback nêu lý do', r.fallback?.nguon === 'rules' && /401/.test(r.fallback.ly_do), JSON.stringify(r.fallback));
  const img = await chat('đọc giúp', { image: PNG });
  ok('gửi ảnh khi AI hỏng: lùi về bộ luật, không văng lỗi', Boolean(img.reply) && img.fallback?.nguon === 'rules');
  mode = 'ok';
}

head('Đường SSE /api/chat/stream qua Express thật');
{
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', router);
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;

  scenario = [
    { tool_calls: [tc('c3', 'ghi_giao_dich', { so_tien: 30000, loai: 'expense', mo_ta: 'cà phê' })] },
    { content: 'Ghi cà phê 30k rồi.' },
  ];
  const res = await fetch(`${base}/api/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'cà phê 30k' }) });
  ok('trả về text/event-stream', /text\/event-stream/.test(res.headers.get('content-type') || ''), res.headers.get('content-type'));
  const raw = await res.text();
  const events = raw.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => {
    const ev = /^event: (.+)$/m.exec(b)[1];
    const data = JSON.parse(/^data: (.+)$/m.exec(b)[1]);
    return { ev, data };
  });
  const names = events.map((e) => e.ev);
  ok('bắt đầu bằng start, kết thúc bằng done', names[0] === 'start' && names[names.length - 1] === 'done', names.join(','));
  ok('có sự kiện tool ở giữa', names.includes('tool') && names.includes('tool_done'));
  const done = events[events.length - 1].data;
  ok('done mang đúng payload như POST /chat', done.ok === true && /30/.test(done.reply) && done.refresh === true && Array.isArray(done.tools) && done.tools[0] === 'ghi_giao_dich', JSON.stringify(done).slice(0, 200));

  const bad = await fetch(`${base}/api/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x', image: 'data:text/html;base64,PGI+' }) });
  const badRaw = await bad.text();
  ok('ảnh sai định dạng -> sự kiện error, không treo kết nối', /event: error/.test(badRaw) && /không hợp lệ/.test(badRaw));

  const undo = await fetch(`${base}/api/ai/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: done.batch }) }).then((r) => r.json());
  ok('hoàn tác cả lượt theo batch từ giao diện', undo.ok === true && undo.so_thao_tac_hoan_tac === 1, JSON.stringify(undo));

  await new Promise((r) => srv.close(r));
}

await new Promise((r) => llm.close(r));
console.log(`\n${fail ? '✗' : '✓'} smoke-stream: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
