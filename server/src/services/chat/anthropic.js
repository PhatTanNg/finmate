/**
 * Lớp dịch giữa cách nói của OpenAI (mà cả app đang dùng) và Messages API của Anthropic.
 *
 * Toàn bộ agent, bộ công cụ và lịch sử hội thoại trong FinMate đều theo hình dạng
 * của OpenAI: `messages[]` có role system/user/assistant/tool, `tool_calls` với
 * `function.arguments` là chuỗi JSON. Claude nói khác: system tách khỏi messages,
 * tool nằm trong content block, kết quả công cụ gửi lại dưới vai user.
 *
 * Thay vì sửa agent.js, ta dịch ở đây — chỗ hẹp nhất và dễ kiểm chứng nhất.
 *
 * Những điều thế hệ Claude hiện tại (Opus 5, Sonnet 5, dòng 4.6+) khó tính hơn
 * bản cũ, và đều được xử lý ở đây:
 *  - KHÔNG nhận `temperature`/`top_p` — gửi lên là bị từ chối 400. Ta không gửi.
 *  - KHÔNG nhận mớm lời trợ lý (prefill) — cách cũ ép JSON bằng cách mớm "{"
 *    nay hỏng. Thay bằng `output_config.format` kèm JSON schema.
 *  - Model tự suy nghĩ (thinking) trước khi trả lời và gửi kèm các khối
 *    `thinking` có chữ ký. Khi gửi lại lượt trợ lý đó (vòng lặp gọi công cụ),
 *    phải trả nguyên vẹn các khối ấy, nếu không API từ chối. Ta giữ nguyên
 *    `content[]` thô của câu trả lời trong trường `blocks` và dùng lại y nguyên.
 *  - Bộ nhớ đệm prompt (prompt caching): bộ công cụ và phần hướng dẫn tĩnh
 *    của system prompt giống hệt nhau qua mọi lượt, nên được đánh dấu
 *    `cache_control` để chỉ trả ~10% giá cho phần đó từ lượt thứ hai.
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

const CACHE = { type: 'ephemeral' };

/**
 * OpenAI: {type:'function', function:{name, description, parameters}}
 *   -> Claude: {name, description, input_schema}
 * Khối cuối cùng mang cache_control: toàn bộ danh sách công cụ đứng trước nó
 * được ghi vào bộ đệm và dùng lại ở các lượt sau.
 */
function toolsFor(tools, { cache = true } = {}) {
  if (!tools?.length) return undefined;
  const out = tools.map((t) => {
    const f = t.function || t;
    return {
      name: f.name,
      description: (f.description || '').slice(0, 1000),
      input_schema: f.parameters || { type: 'object', properties: {} },
    };
  });
  if (cache) out[out.length - 1].cache_control = CACHE;
  return out;
}

const textOf = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  return c == null ? '' : String(c);
};

/**
 * Nội dung user có thể là mảng phần (kiểu OpenAI): text + image_url. Ảnh dạng
 * data URL được dịch sang khối image base64 của Claude; ảnh đặt TRƯỚC chữ như
 * tài liệu khuyến nghị.
 */
function userBlocks(content) {
  if (!Array.isArray(content)) {
    const t = textOf(content).trim();
    return t ? [{ type: 'text', text: t }] : [];
  }
  const images = [];
  const texts = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') { if (part.trim()) texts.push({ type: 'text', text: part }); continue; }
    if (part.type === 'text' && part.text?.trim()) { texts.push({ type: 'text', text: part.text }); continue; }
    if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s.exec(url || '');
      if (m) images.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2].replace(/\s+/g, '') } });
      else if (/^https?:\/\//.test(url || '')) images.push({ type: 'image', source: { type: 'url', url } });
    }
  }
  return [...images, ...texts];
}

/**
 * Dựng thân request cho Claude từ messages kiểu OpenAI.
 *
 * Ba điều Claude khó tính hơn OpenAI, và đều đã xử lý ở đây:
 *  - `system` phải là trường riêng, không được nằm trong messages;
 *  - kết quả công cụ đi dưới vai `user`, và mọi tool_result của cùng một lượt
 *    phải gom vào MỘT message, nếu tách ra sẽ bị từ chối;
 *  - message đầu tiên bắt buộc là `user`, và không block text nào được rỗng.
 *
 * Message `system` có cờ `cache: true` là phần hướng dẫn cố định — được gắn
 * cache_control. Message `system` xuất hiện SAU khi hội thoại đã bắt đầu (lời
 * nhắc "trả lời ngay đi") không được gom lên đầu — làm vậy vừa mất vị trí vừa
 * phá bộ đệm — mà đi xuống dưới dạng lời người dùng.
 */
export function toAnthropicRequest(messages, tools, {
  model, json = false, schema = null, maxTokens = 16000, effort = null, thinking = null, cache = true,
} = {}) {
  const sys = [];
  const out = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const t = textOf(m.content).trim();
      if (!t) continue;
      if (!out.length) sys.push({ type: 'text', text: t, ...(m.cache && cache ? { cache_control: CACHE } : {}) });
      else out.push({ role: 'user', content: [{ type: 'text', text: t }] });
      continue;
    }

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
      // Câu trả lời do chính Claude sinh ra trong lượt này: gửi lại NGUYÊN VẸN,
      // kể cả khối thinking có chữ ký — API đòi vậy khi tiếp tục vòng công cụ.
      if (Array.isArray(m.blocks) && m.blocks.length) {
        out.push({ role: 'assistant', content: m.blocks });
        continue;
      }
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

    const blocks = userBlocks(m.content);
    if (blocks.length) out.push({ role: 'user', content: blocks });
  }

  // Lịch sử có thể mở đầu bằng lời của trợ lý (ví dụ câu chào onboarding).
  while (out.length && out[0].role === 'assistant') out.shift();
  if (!out.length) out.push({ role: 'user', content: [{ type: 'text', text: 'Xin chào' }] });

  const outputConfig = {};
  if (effort) outputConfig.effort = effort;
  if (json && schema) outputConfig.format = { type: 'json_schema', schema };

  const body = {
    model,
    max_tokens: maxTokens,
    messages: out,
    ...(sys.length ? { system: sys } : {}),
    ...(tools?.length ? { tools: toolsFor(tools, { cache }), tool_choice: { type: 'auto' } } : {}),
    ...(thinking ? { thinking } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
  };

  // Không có schema thì chỉ nhắc bằng lời — không còn mớm "{" như trước, vì
  // thế hệ Claude hiện tại từ chối thẳng mọi request có mớm lời trợ lý.
  if (json && !schema) {
    body.system = [...(body.system || []), { type: 'text', text: 'Chỉ trả lời bằng một object JSON hợp lệ, không thêm lời dẫn hay khối mã.' }];
  }

  return body;
}

/** Thống kê token của một lượt gọi, chuẩn hoá về một hình dạng chung. */
export function usageOf(data) {
  const u = data?.usage;
  if (!u) return null;
  return {
    vao: Number(u.input_tokens) || 0,
    ra: Number(u.output_tokens) || 0,
    cache_doc: Number(u.cache_read_input_tokens) || 0,
    cache_ghi: Number(u.cache_creation_input_tokens) || 0,
  };
}

/**
 * Claude trả content[] -> dựng lại message kiểu OpenAI để agent xử lý như cũ.
 *
 * Giữ thêm `blocks` (content thô) để lượt sau gửi lại nguyên vẹn, và `stop`
 * để tầng trên biết model bị cắt giữa chừng (max_tokens) hay từ chối trả lời
 * (refusal) — hai trường hợp không được coi như một câu trả lời bình thường.
 */
export function fromAnthropicResponse(data, { json = false } = {}) {
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
  if (json && content) {
    // Model đôi khi vẫn bọc JSON trong khối mã hoặc viết thêm lời dẫn; cắt lấy
    // đúng phần từ ngoặc mở đầu tiên tới ngoặc đóng cuối cùng.
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) content = content.slice(start, end + 1);
  }

  const stop = data.stop_reason || null;
  return {
    role: 'assistant',
    content: content || null,
    ...(tool_calls.length ? { tool_calls } : {}),
    blocks,
    stop,
    ...(stop === 'refusal' ? { refusal: data.stop_details?.category || data.stop_details?.explanation || true } : {}),
    ...(stop === 'max_tokens' ? { truncated: true } : {}),
    usage: usageOf(data),
  };
}
