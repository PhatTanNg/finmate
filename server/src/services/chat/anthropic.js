/**
 * Lớp dịch giữa cách nói của OpenAI (mà cả app đang dùng) và Messages API của Anthropic.
 *
 * Toàn bộ agent, bộ công cụ và lịch sử hội thoại trong FinMate đều theo hình dạng
 * của OpenAI: `messages[]` có role system/user/assistant/tool, `tool_calls` với
 * `function.arguments` là chuỗi JSON. Claude nói khác: system tách khỏi messages,
 * tool nằm trong content block, kết quả công cụ gửi lại dưới vai user.
 *
 * Thay vì sửa agent.js, ta dịch ở đây — chỗ hẹp nhất và dễ kiểm chứng nhất.
 */

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** Nhận diện nhà cung cấp mà không bắt người dùng khai báo thêm biến môi trường. */
export function detectProvider(key = '', url = '') {
  if (/anthropic\.com/i.test(url) || /^sk-ant-/.test(key)) return 'anthropic';
  return 'openai';
}

export const anthropicUrl = (url = '') =>
  (url && !/\/chat\/completions$/.test(url) ? url : DEFAULT_URL);

export const anthropicHeaders = (key) => ({
  'content-type': 'application/json',
  'x-api-key': key,
  'anthropic-version': API_VERSION,
});

/** OpenAI: {type:'function', function:{name, description, parameters}} -> Claude: {name, description, input_schema} */
function toolsFor(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => {
    const f = t.function || t;
    return {
      name: f.name,
      description: (f.description || '').slice(0, 1000),
      input_schema: f.parameters || { type: 'object', properties: {} },
    };
  });
}

const textOf = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  return c == null ? '' : String(c);
};

/**
 * Dựng thân request cho Claude từ messages kiểu OpenAI.
 *
 * Ba điều Claude khó tính hơn OpenAI, và đều đã xử lý ở đây:
 *  - `system` phải là trường riêng, không được nằm trong messages;
 *  - kết quả công cụ đi dưới vai `user`, và mọi tool_result của cùng một lượt
 *    phải gom vào MỘT message, nếu tách ra sẽ bị từ chối;
 *  - message đầu tiên bắt buộc là `user`, và không block text nào được rỗng.
 */
export function toAnthropicRequest(messages, tools, { model, json = false, temperature = 0.4, maxTokens = 2048 } = {}) {
  const sys = [];
  const out = [];

  for (const m of messages) {
    if (m.role === 'system') { sys.push(textOf(m.content)); continue; }

    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: textOf(m.content).slice(0, 20000) || '(không có nội dung)',
      };
      // Gom vào message user ngay trước nếu message đó cũng đang chứa tool_result.
      const prev = out[out.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content) && prev.content[0]?.type === 'tool_result') {
        prev.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const blocks = [];
      const t = textOf(m.content).trim();
      if (t) blocks.push({ type: 'text', text: t });
      for (const tc of m.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
      }
      if (!blocks.length) continue; // assistant rỗng -> Claude từ chối
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    const t = textOf(m.content).trim();
    if (t) out.push({ role: 'user', content: t });
  }

  // Lịch sử có thể mở đầu bằng lời của trợ lý (ví dụ câu chào onboarding).
  while (out.length && out[0].role === 'assistant') out.shift();
  if (!out.length) out.push({ role: 'user', content: 'Xin chào' });

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: out,
    ...(sys.length ? { system: sys.join('\n\n') } : {}),
    ...(tools?.length ? { tools: toolsFor(tools), tool_choice: { type: 'auto' } } : {}),
  };

  // Claude không có response_format. Cách đáng tin nhất là mớm sẵn dấu "{" cho
  // câu trả lời — model buộc phải viết tiếp thành JSON. Chỉ làm khi không có
  // công cụ, vì mớm lời sẽ chặn model gọi tool.
  if (json && !tools?.length) {
    body.system = `${body.system || ''}\n\nChỉ trả lời bằng một object JSON hợp lệ, không thêm lời dẫn hay khối mã.`.trim();
    body.messages = [...out, { role: 'assistant', content: '{' }];
  }

  return body;
}

/** Claude trả content[] -> dựng lại message kiểu OpenAI để agent xử lý như cũ. */
export function fromAnthropicResponse(data, { json = false, prefilled = false } = {}) {
  if (!data) return null;
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
  const tool_calls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      id: b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  let content = text;
  if (json && prefilled && content) {
    // Ta đã mớm "{" nên phần model trả về thiếu đúng ký tự đó.
    content = `{${content}`;
    // Model đôi khi vẫn viết thêm sau dấu đóng ngoặc; cắt tới ngoặc cuối cùng.
    const end = content.lastIndexOf('}');
    if (end > 0) content = content.slice(0, end + 1);
  }

  return {
    role: 'assistant',
    content: content || null,
    ...(tool_calls.length ? { tool_calls } : {}),
  };
}
