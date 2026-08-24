/**
 * Lớp LLM tuỳ chọn. Không có API key thì toàn bộ app vẫn chạy đủ tính năng bằng bộ luật tiếng Việt.
 * Cấu hình: FINMATE_LLM_KEY, FINMATE_LLM_MODEL, FINMATE_LLM_URL (tuỳ chọn).
 *
 * Hỗ trợ hai nhà cung cấp, tự nhận diện qua dạng API key:
 *  - OpenAI và mọi dịch vụ tương thích /chat/completions (mặc định);
 *  - Anthropic Claude — key `sk-ant-...` — nói chuyện qua Messages API, được
 *    dịch qua lại ở anthropic.js nên phần còn lại của app không cần biết.
 * Muốn ép cứng thì đặt FINMATE_LLM_PROVIDER = openai | anthropic.
 */
import { detectProvider, anthropicUrl, anthropicHeaders, toAnthropicRequest, fromAnthropicResponse } from './anthropic.js';

const RAW_URL = process.env.FINMATE_LLM_URL || '';
const KEY = process.env.FINMATE_LLM_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';
const PROVIDER = process.env.FINMATE_LLM_PROVIDER || detectProvider(KEY, RAW_URL);
const URL_ = RAW_URL || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.FINMATE_LLM_MODEL || (PROVIDER === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
const MAX_TOKENS = Number(process.env.FINMATE_LLM_MAX_TOKENS) || 2048;

export const llmEnabled = () => Boolean(KEY);
export const llmModel = () => MODEL;
export const llmProvider = () => PROVIDER;

/**
 * Gọi API chat. Trả về nguyên message của model (có thể chứa tool_calls)
 * khi `raw: true`, ngược lại chỉ trả chuỗi nội dung.
 */
async function call(messages, { json = false, timeout = 25000, temperature = 0.4, tools = null, raw = false } = {}) {
  if (!KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    if (PROVIDER === 'anthropic') {
      const body = toAnthropicRequest(messages, tools, { model: MODEL, json, temperature, maxTokens: MAX_TOKENS });
      const res = await fetch(anthropicUrl(RAW_URL), {
        method: 'POST',
        headers: anthropicHeaders(KEY),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`LLM ${res.status}: ${t.slice(0, 200)}`);
      }
      const msg = fromAnthropicResponse(await res.json(), { json, prefilled: json && !tools?.length });
      return raw ? msg : msg?.content || null;
    }
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    return raw ? msg || null : msg?.content || null;
  } finally {
    clearTimeout(timer);
  }
}

/** Một lượt gọi model có kèm danh sách công cụ. Trả message thô để agent xử lý tool_calls. */
export async function complete(messages, tools, opts = {}) {
  return call(messages, { ...opts, tools, raw: true });
}

const INTENT_LIST = [
  'add_expense', 'add_income', 'add_transfer', 'query_spending', 'query_balance', 'query_networth', 'query_fire',
  'query_forecast', 'query_debt', 'query_goal', 'query_budget', 'query_investment', 'query_income', 'surplus_advice',
  'affordability', 'summary', 'create_goal', 'create_budget', 'set_allocation', 'add_account', 'add_income_stream',
  'add_debt', 'add_holding', 'add_recurring', 'undo', 'help', 'greeting', 'update_profile', 'unknown',
];

/** Nhờ LLM phân loại lại khi bộ luật không chắc chắn. */
export async function classify(text) {
  let content = null;
  try {
    content = await call(
      [
        { role: 'system', content: `Bạn phân loại ý định người dùng cho app tài chính cá nhân tiếng Việt. Chỉ trả JSON: {"intent": one of ${INTENT_LIST.join('|')}, "amount": number|null, "confidence": 0..1}. amount là số tiền VND nếu có (quy đổi "50k"=50000, "2 triệu"=2000000).` },
        { role: 'user', content: String(text).slice(0, 500) },
      ],
      { json: true, temperature: 0 }
    );
  } catch {
    return null;
  }
  if (!content) return null;
  try {
    const p = JSON.parse(content);
    if (!INTENT_LIST.includes(p.intent)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Nhờ LLM trả lời câu hỏi mở, dựa hoàn toàn trên số liệu thật của người dùng. */
export async function answer(question, context) {
  try {
    return await call(
      [
        {
          role: 'system',
          content:
            'Bạn là cố vấn tài chính cá nhân người Việt, thực tế và thẳng thắn. Chỉ dùng số liệu trong CONTEXT, không bịa. ' +
            'Trả lời ngắn gọn (dưới 200 từ), dùng markdown, đơn vị VND rút gọn (triệu/tỷ). Không khuyên mua bán mã cổ phiếu cụ thể. ' +
            'Nếu thiếu dữ liệu, nói rõ cần bổ sung gì.',
        },
        { role: 'user', content: `CONTEXT:\n${JSON.stringify(context).slice(0, 6000)}\n\nCÂU HỎI: ${question}` },
      ],
      { temperature: 0.5 }
    );
  } catch {
    return null;
  }
}
