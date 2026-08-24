/**
 * Kiểm lớp dịch sang Anthropic Claude.
 *
 * Không gọi API thật: dựng một máy chủ nói đúng giọng Messages API rồi cho
 * agent chạy trọn vòng lặp qua đó. Mục đích là chứng minh Claude cắm vào được
 * mà agent, bộ công cụ và nhật ký AI không phải sửa gì.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, '.tmp-llm.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);

/* ---------- 1. Dịch xuôi: messages kiểu OpenAI -> thân request của Claude ---------- */
const { toAnthropicRequest, fromAnthropicResponse, detectProvider, anthropicUrl } =
  await import('../src/services/chat/anthropic.js');

head('Dịch xuôi sang Messages API');
{
  const body = toAnthropicRequest(
    [
      { role: 'system', content: 'Bạn là cố vấn.' },
      { role: 'system', content: 'Luôn nói tiếng Việt.' },
      { role: 'user', content: 'Tôi tiêu 50k cà phê' },
      { role: 'assistant', content: 'Để mình ghi.', tool_calls: [{ id: 'tu_1', function: { name: 'ghi_giao_dich', arguments: '{"so_tien":50000}' } }] },
      { role: 'tool', tool_call_id: 'tu_1', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 'tu_2', content: '{"ok":true}' },
    ],
    [{ type: 'function', function: { name: 'ghi_giao_dich', description: 'Ghi', parameters: { type: 'object', properties: { so_tien: { type: 'number' } } } } }],
    { model: 'claude-x', temperature: 0.5, maxTokens: 1234 }
  );

  ok('system gom thành trường riêng, không lẫn vào messages', body.system === 'Bạn là cố vấn.\n\nLuôn nói tiếng Việt.' && !body.messages.some((m) => m.role === 'system'));
  ok('max_tokens bắt buộc có mặt', body.max_tokens === 1234);
  ok('message đầu là user', body.messages[0].role === 'user');
  ok('tool_calls -> khối tool_use kèm input đã parse', body.messages[1].content.some((b) => b.type === 'tool_use' && b.name === 'ghi_giao_dich' && b.input.so_tien === 50000));
  ok('lời nói kèm tool vẫn giữ làm khối text', body.messages[1].content[0].type === 'text');

  const last = body.messages[body.messages.length - 1];
  ok('kết quả công cụ đi dưới vai user', last.role === 'user');
  ok('nhiều tool_result gom vào MỘT message', last.content.length === 2 && last.content.every((b) => b.type === 'tool_result'), `thấy ${last.content.length} khối trong ${body.messages.length} message`);
  ok('tools dịch sang input_schema', body.tools[0].input_schema.properties.so_tien.type === 'number' && !body.tools[0].parameters);
}

{
  const body = toAnthropicRequest([
    { role: 'system', content: 'S' },
    { role: 'assistant', content: 'Chào bạn!' },
    { role: 'user', content: 'ừ' },
  ], null, { model: 'm' });
  ok('lịch sử mở đầu bằng lời trợ lý được cắt bỏ', body.messages[0].role === 'user' && body.messages.length === 1);
}
{
  const body = toAnthropicRequest([{ role: 'system', content: 'S' }], null, { model: 'm' });
  ok('không có message nào thì vẫn dựng được request hợp lệ', body.messages.length === 1 && body.messages[0].role === 'user');
}
{
  const body = toAnthropicRequest([
    { role: 'user', content: 'x' },
    { role: 'assistant', content: null },
  ], null, { model: 'm' });
  ok('assistant rỗng bị loại (Claude từ chối content rỗng)', body.messages.length === 1);
}
{
  const body = toAnthropicRequest([{ role: 'user', content: 'phân loại giúp' }], null, { model: 'm', json: true });
  const last = body.messages[body.messages.length - 1];
  ok('chế độ JSON mớm sẵn dấu ngoặc mở', last.role === 'assistant' && last.content === '{');
  ok('chế độ JSON có nhắc trong system', /JSON hợp lệ/.test(body.system));
}
{
  const body = toAnthropicRequest([{ role: 'user', content: 'x' }], [{ type: 'function', function: { name: 'a', parameters: {} } }], { model: 'm', json: true });
  ok('có công cụ thì KHÔNG mớm lời (sẽ chặn model gọi tool)', body.messages[body.messages.length - 1].role === 'user');
}

/* ---------- 2. Dịch ngược ---------- */
head('Dịch ngược câu trả lời của Claude');
{
  const msg = fromAnthropicResponse({
    content: [
      { type: 'text', text: 'Mình ghi nhé.' },
      { type: 'tool_use', id: 'tu_9', name: 'ghi_giao_dich', input: { so_tien: 50000 } },
    ],
    stop_reason: 'tool_use',
  });
  ok('text lấy đúng', msg.content === 'Mình ghi nhé.');
  ok('tool_use -> tool_calls đúng hình dạng OpenAI', msg.tool_calls[0].function.name === 'ghi_giao_dich' && JSON.parse(msg.tool_calls[0].function.arguments).so_tien === 50000);
  ok('giữ nguyên id để khớp tool_result', msg.tool_calls[0].id === 'tu_9');
}
{
  const msg = fromAnthropicResponse({ content: [{ type: 'text', text: 'Chỉ nói thôi' }] });
  ok('không gọi công cụ thì không có trường tool_calls', !('tool_calls' in msg));
}
{
  const msg = fromAnthropicResponse({ content: [{ type: 'text', text: '"intent":"greeting"}' }] }, { json: true, prefilled: true });
  ok('ghép lại dấu ngoặc đã mớm -> JSON parse được', JSON.parse(msg.content).intent === 'greeting');
}
{
  const msg = fromAnthropicResponse({ content: [{ type: 'text', text: '"a":1} Chúc bạn một ngày vui!' }] }, { json: true, prefilled: true });
  ok('cắt phần model lỡ viết thêm sau JSON', JSON.parse(msg.content).a === 1);
}
ok('trả về null khi không có dữ liệu', fromAnthropicResponse(null) === null);

head('Nhận diện nhà cung cấp');
ok('key sk-ant- -> anthropic', detectProvider('sk-ant-abc', '') === 'anthropic');
ok('url anthropic.com -> anthropic', detectProvider('', 'https://api.anthropic.com/v1/messages') === 'anthropic');
ok('key OpenAI -> openai', detectProvider('sk-proj-abc', '') === 'openai');
ok('url mặc định /chat/completions bị thay bằng /v1/messages', anthropicUrl('https://api.openai.com/v1/chat/completions') === 'https://api.anthropic.com/v1/messages');
ok('url tự đặt được tôn trọng (proxy nội bộ)', anthropicUrl('http://localhost:9/v1/messages') === 'http://localhost:9/v1/messages');

/* ---------- 3. Chạy thật qua máy chủ giả nói giọng Claude ---------- */
head('Agent chạy trọn vòng qua giọng Claude');

const seen = [];
let turn = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, url: req.url, body });
    turn += 1;
    // Lượt 1: đòi gọi công cụ. Lượt 2: đã thấy kết quả -> chốt lời.
    const content = turn === 1
      ? [{ type: 'text', text: 'Được, mình ghi ngay.' }, { type: 'tool_use', id: 'tu_a', name: 'ghi_giao_dich', input: { so_tien: 50000, loai: 'chi', mo_ta: 'cà phê', danh_muc: 'Ăn uống' } }]
      : [{ type: 'text', text: 'Xong rồi, mình đã ghi 50.000đ cà phê vào mục Ăn uống.' }];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content, stop_reason: turn === 1 ? 'tool_use' : 'end_turn' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

process.env.FINMATE_DB = DB;
process.env.FINMATE_LLM_KEY = 'sk-ant-fake-for-test';
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${port}/v1/messages`;
process.env.FINMATE_LLM_MODEL = 'claude-test';

const { llmProvider, llmModel } = await import('../src/services/chat/llm.js');
ok('tự nhận ra đang dùng Claude từ dạng key', llmProvider() === 'anthropic');

const { runAgent } = await import('../src/services/chat/agent.js');
const { listActions } = await import('../src/services/ai_audit.js');
const { all } = await import('../src/db.js');

const before = all('SELECT * FROM transactions').length;
const r = await runAgent('cho mình ghi 50k cà phê', []);

ok('agent trả lời được', Boolean(r?.reply), JSON.stringify(r)?.slice(0, 200));
ok('đúng là lời của lượt cuối', /đã ghi/.test(r?.reply || ''));
const called = (r?.calls || []).map((c) => (typeof c === 'string' ? c : c.name));
ok('công cụ thực sự chạy', called.length === 1 && called[0] === 'ghi_giao_dich', JSON.stringify(r?.calls));
ok('giao dịch vào sổ thật', all('SELECT * FROM transactions').length === before + 1);
ok('đánh dấu có đổi dữ liệu', r?.mutated === true);

const acts = listActions({ limit: 5 });
ok('nhật ký AI ghi lại việc Claude làm', acts.some((a) => a.cong_cu === 'ghi_giao_dich'), JSON.stringify(acts.map((a) => a.cong_cu)));
ok('hoàn tác được (có dòng dữ liệu kèm theo)', acts.find((a) => a.cong_cu === 'ghi_giao_dich')?.so_hang_doi > 0);

head('Máy chủ nhận đúng thứ Claude mong đợi');
ok('gọi đúng 2 lượt', seen.length === 2, `thấy ${seen.length}`);
ok('dùng header x-api-key, không phải Authorization', seen[0].headers['x-api-key'] === 'sk-ant-fake-for-test' && !seen[0].headers.authorization);
ok('có anthropic-version', Boolean(seen[0].headers['anthropic-version']));
ok('gửi model đã cấu hình', seen[0].body.model === 'claude-test' && llmModel() === 'claude-test');
ok('lượt 1 có kèm bộ công cụ', seen[0].body.tools?.length > 0);
ok('mọi công cụ đều có input_schema', seen[0].body.tools.every((t) => t.input_schema && t.name && !('parameters' in t)));
ok('system prompt đi ở trường riêng', typeof seen[0].body.system === 'string' && seen[0].body.system.length > 100);
{
  const m2 = seen[1].body.messages;
  const tr = m2[m2.length - 1];
  ok('lượt 2 gửi lại kết quả công cụ đúng chỗ', tr.role === 'user' && tr.content[0].type === 'tool_result' && tr.content[0].tool_use_id === 'tu_a', JSON.stringify(tr).slice(0, 200));
  ok('lượt 2 có nhắc lại tool_use của trợ lý', m2.some((m) => m.role === 'assistant' && m.content.some?.((b) => b.type === 'tool_use')));
}

await new Promise((r) => server.close(r));
// Không xoá file DB ở đây: trên Windows, gỡ file mà node:sqlite còn giữ sẽ làm
// tiến trình sập ngay lúc thoát và nuốt mất mã lỗi. Lần chạy sau tự xoá ở đầu file.

console.log(`\n${fail ? '✗' : '✓'} smoke-llm: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
