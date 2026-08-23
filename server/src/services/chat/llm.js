/**
 * Lớp LLM tuỳ chọn. Không có API key thì toàn bộ app vẫn chạy đủ tính năng bằng bộ luật tiếng Việt.
 * Cấu hình: FINMATE_LLM_URL (OpenAI-compatible /chat/completions), FINMATE_LLM_KEY, FINMATE_LLM_MODEL
 */
const URL_ = process.env.FINMATE_LLM_URL || 'https://api.openai.com/v1/chat/completions';
const KEY = process.env.FINMATE_LLM_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.FINMATE_LLM_MODEL || 'gpt-4o-mini';

export const llmEnabled = () => Boolean(KEY);

async function call(messages, { json = false, timeout = 15000, temperature = 0.4 } = {}) {
  if (!KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const INTENT_LIST = [
  'add_expense', 'add_income', 'add_transfer', 'query_spending', 'query_balance', 'query_networth', 'query_fire',
  'query_forecast', 'query_debt', 'query_goal', 'query_budget', 'query_investment', 'query_income', 'surplus_advice',
  'affordability', 'summary', 'create_goal', 'create_budget', 'set_allocation', 'add_account', 'add_income_stream',
  'add_debt', 'add_holding', 'add_recurring', 'undo', 'help', 'greeting', 'update_profile', 'unknown',
];

/** Nhờ LLM phân loại lại khi bộ luật không chắc chắn. */
export async function classify(text) {
  const content = await call(
    [
      { role: 'system', content: `Bạn phân loại ý định người dùng cho app tài chính cá nhân tiếng Việt. Chỉ trả JSON: {"intent": one of ${INTENT_LIST.join('|')}, "amount": number|null, "confidence": 0..1}. amount là số tiền VND nếu có (quy đổi "50k"=50000, "2 triệu"=2000000).` },
      { role: 'user', content: String(text).slice(0, 500) },
    ],
    { json: true, temperature: 0 }
  );
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
  return call(
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
}
