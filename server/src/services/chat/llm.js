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
const MAX_TOKENS = Number(process.env.FINMATE_LLM_MAX_TOKENS) || 4096;

export const llmEnabled = () => Boolean(KEY);
export const llmModel = () => MODEL;
export const llmProvider = () => PROVIDER;

/**
 * Sức khoẻ đường dây LLM. Trước đây mọi lỗi gọi model đều bị nuốt im lặng và
 * app lặng lẽ lùi về bộ luật: người dùng vẫn nhận được câu trả lời tử tế nên
 * không hề biết mình đã cấu hình sai key, hết hạn mức hay gõ nhầm tên model —
 * chỉ thấy AI "bỗng dưng kém thông minh". Ghi lại lần gọi gần nhất để
 * /api/health nói thẳng ra chuyện đó.
 */
const health = { ok: null, at: null, error: null, errorAt: null, calls: 0, fails: 0, retries: 0 };
export function llmStatus() {
  return {
    bat: Boolean(KEY), nha_cung_cap: PROVIDER, model: MODEL,
    lan_goi: health.calls, lan_loi: health.fails, lan_thu_lai: health.retries,
    gan_nhat_ok: health.ok, gan_nhat_luc: health.at,
    loi_gan_nhat: health.error, loi_luc: health.errorAt,
  };
}
function noteOk() { health.ok = true; health.at = new Date().toISOString(); health.calls += 1; }
function noteFail(e) {
  health.ok = false; health.at = new Date().toISOString(); health.calls += 1; health.fails += 1;
  // Cắt ngắn và bỏ mọi thứ trông giống key: thông điệp này đi ra tới API health.
  // Không xoá khi có lượt thành công sau đó — lỗi lác đác là thứ cần thấy nhất,
  // mà chính nó lại là thứ dễ bị một lượt tốt kế tiếp xoá sạch dấu vết.
  health.error = String(e?.message || e).replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 300);
  health.errorAt = health.at;
  console.warn(`[finmate] gọi ${PROVIDER}/${MODEL} lỗi: ${health.error}`);
}

/**
 * Anthropic trả 429/503/529 khá thường xuyên khi đông khách ("overloaded"), và
 * đó là lỗi tạm thời — chờ một nhịp rồi gọi lại là xong. Trước đây app bỏ cuộc
 * ngay lượt đầu nên gần một phần ba câu hỏi rơi về bộ luật dù key vẫn tốt và
 * người dùng vẫn đang trả tiền cho model. Không thử lại lỗi 4xx khác (key sai,
 * request hỏng — có gọi lại vẫn hỏng) và không thử lại khi quá hạn chờ, vì
 * người dùng đang ngồi đợi câu trả lời.
 */
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS = [400, 1200];
function isTransient(e) {
  const msg = String(e?.message || e);
  if (e?.name === 'AbortError') return false;
  const m = msg.match(/^LLM (\d{3}):/);
  if (m) return RETRY_STATUS.has(Number(m[1]));
  // Lỗi mạng của fetch không có mã: đứt cáp, DNS chập chờn, TLS reset.
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi API chat. Trả về nguyên message của model (có thể chứa tool_calls)
 * khi `raw: true`, ngược lại chỉ trả chuỗi nội dung.
 */
async function callApi(messages, { json = false, timeout = 25000, temperature = 0.4, tools = null, raw = false } = {}) {
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

/** Bọc quanh lời gọi thật: ghi nhận thành/bại, thử lại khi lỗi tạm thời, rồi ném tiếp như cũ. */
async function call(messages, opts = {}) {
  if (!KEY) return null;
  let last;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      const r = await callApi(messages, opts);
      noteOk();
      return r;
    } catch (e) {
      noteFail(e);
      last = e;
      if (attempt === RETRY_DELAYS.length || !isTransient(e)) break;
      health.retries += 1;
      console.warn(`[finmate] thử lại lần ${attempt + 1} sau ${RETRY_DELAYS[attempt]}ms`);
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw last;
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
