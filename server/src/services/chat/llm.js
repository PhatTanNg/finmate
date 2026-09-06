/**
 * Lớp LLM tuỳ chọn. Không có API key thì toàn bộ app vẫn chạy đủ tính năng bằng bộ luật tiếng Việt.
 * Cấu hình: FINMATE_LLM_KEY, FINMATE_LLM_MODEL, FINMATE_LLM_URL (tuỳ chọn).
 *
 * Hỗ trợ hai nhà cung cấp, tự nhận diện qua dạng API key:
 *  - OpenAI và mọi dịch vụ tương thích /chat/completions (mặc định);
 *  - Anthropic Claude — key `sk-ant-...` — nói chuyện qua Messages API, được
 *    dịch qua lại ở anthropic.js nên phần còn lại của app không cần biết.
 * Muốn ép cứng thì đặt FINMATE_LLM_PROVIDER = openai | anthropic.
 *
 * Riêng với Claude còn ba nút chỉnh, đều tuỳ chọn:
 *  - FINMATE_LLM_EFFORT   low | medium | high | xhigh | max — độ sâu suy nghĩ.
 *                         Bỏ trống = mặc định của model (high). Chat ngắn hằng
 *                         ngày chạy `low`/`medium` nhanh và rẻ hơn hẳn.
 *  - FINMATE_LLM_THINKING adaptive | off — bật/tắt suy nghĩ trước khi trả lời.
 *                         Bỏ trống = để model tự quyết (Opus 5 mặc định có).
 *  - FINMATE_LLM_MAX_TOKENS  trần độ dài câu trả lời (tính cả phần suy nghĩ).
 */
import { detectProvider, anthropicUrl, anthropicHeaders, toAnthropicRequest, fromAnthropicResponse } from './anthropic.js';
import { setting } from '../../db.js';

/**
 * Cấu hình model đọc LẠI mỗi lần dùng, không đóng băng lúc nạp module.
 *
 * Bản chạy trên điện thoại cho người dùng dán key ngay trong app rồi ghi vào
 * process.env. Nếu đọc một lần lúc khởi động thì key mới chỉ có tác dụng sau
 * khi tải lại — mà tải lại đúng lúc hay không thì không ai kiểm soát được.
 * Hậu quả thật đã gặp: Cài đặt bấm "Thử kết nối" báo xanh, còn Trò chuyện
 * cùng lúc báo "chưa có key AI được lưu", hai màn hình của cùng một app nói
 * ngược nhau và người dùng không biết tin ai. Đọc lười thì lưu xong là dùng
 * được ngay, và mọi nơi trong app luôn thấy cùng một sự thật.
 */
/**
 * Cấu hình model đọc theo thứ tự: SỔ ĐANG DÙNG trước, biến môi trường sau.
 *
 * Máy chủ nhiều người dùng mà chỉ đọc biến môi trường thì cả nhà tiêu chung một
 * key của chủ máy chủ, và không ai mang key riêng vào được — chủ máy chủ trả
 * tiền cho mọi người, còn người dùng thì không tự chọn được model. Cất key
 * trong chính sổ của từng người thì mỗi người một đường dây AI, cách ly vật lý
 * y như số liệu tài chính.
 *
 * Biến môi trường vẫn là bậc dưới, nên hai cách dùng cũ không đổi gì: máy cá
 * nhân đặt key trong .env, bản chạy trên điện thoại đặt vào process.env lúc
 * khởi động. Chủ máy chủ muốn bao cả nhà thì cứ đặt biến môi trường, ai chưa
 * dán key riêng sẽ dùng nó.
 */
const KHOA_SO = {
  FINMATE_LLM_KEY: 'llm_key',
  FINMATE_LLM_URL: 'llm_url',
  FINMATE_LLM_MODEL: 'llm_model',
  FINMATE_LLM_PROVIDER: 'llm_provider',
  FINMATE_LLM_EFFORT: 'llm_effort',
  FINMATE_LLM_THINKING: 'llm_thinking',
  FINMATE_LLM_MAX_TOKENS: 'llm_max_tokens',
  FINMATE_LLM_TIMEOUT_MS: 'llm_timeout_ms',
};

const trongSo = (k) => {
  const khoa = KHOA_SO[k];
  if (!khoa) return '';
  // Sổ có thể chưa dựng xong (lúc import db.js chạy schema) — đọc hỏng thì coi
  // như chưa đặt, đừng làm hỏng cả lượt gọi.
  try { return String(setting(khoa) || '').trim(); } catch { return ''; }
};

const env = (k) => trongSo(k) || String(process.env[k] || '').trim();

const rawUrl = () => env('FINMATE_LLM_URL');
const apiKey = () => env('FINMATE_LLM_KEY') || env('ANTHROPIC_API_KEY') || env('OPENAI_API_KEY');
const provider = () => env('FINMATE_LLM_PROVIDER') || detectProvider(apiKey(), rawUrl());
const openaiUrl = () => rawUrl() || 'https://api.openai.com/v1/chat/completions';
const modelName = () => env('FINMATE_LLM_MODEL') || (provider() === 'anthropic' ? 'claude-opus-5' : 'gpt-4o-mini');
// Với Claude, max_tokens là trần cho CẢ phần suy nghĩ lẫn câu trả lời, nên phải
// rộng tay hơn hẳn con số 2-4k của thời chưa có thinking; kẻo câu trả lời bị
// cắt ngang giữa chừng mà không ai hiểu vì sao.
const maxTokens = () => Number(env('FINMATE_LLM_MAX_TOKENS')) || (provider() === 'anthropic' ? 16000 : 4096);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const effortCfg = () => (EFFORTS.has(env('FINMATE_LLM_EFFORT').toLowerCase()) ? env('FINMATE_LLM_EFFORT').toLowerCase() : null);
const thinkingCfg = () => {
  const v = env('FINMATE_LLM_THINKING').toLowerCase();
  if (v === 'adaptive' || v === 'on') return { type: 'adaptive' };
  if (v === 'off' || v === 'disabled') return { type: 'disabled' };
  return null;
};
// Model suy nghĩ lâu hơn model đời cũ; 25 giây là quá chật cho một lượt có
// nhiều công cụ. Vẫn cho chỉnh vì Ollama trên máy yếu có thể cần lâu hơn nữa.
const timeoutMs = () => Number(env('FINMATE_LLM_TIMEOUT_MS')) || 90000;

export const llmEnabled = () => Boolean(apiKey());
export const llmModel = () => modelName();
export const llmProvider = () => provider();

/**
 * Sức khoẻ đường dây LLM. Trước đây mọi lỗi gọi model đều bị nuốt im lặng và
 * app lặng lẽ lùi về bộ luật: người dùng vẫn nhận được câu trả lời tử tế nên
 * không hề biết mình đã cấu hình sai key, hết hạn mức hay gõ nhầm tên model —
 * chỉ thấy AI "bỗng dưng kém thông minh". Ghi lại lần gọi gần nhất để
 * /api/health nói thẳng ra chuyện đó.
 *
 * Kèm theo là đồng hồ token: người dùng trả tiền theo token, nên phải thấy được
 * mỗi lượt chat tốn bao nhiêu và bộ đệm prompt có thực sự trúng hay không.
 */
const health = { ok: null, at: null, error: null, errorAt: null, calls: 0, fails: 0, retries: 0 };
/**
 * Cầu dao mất mạng. Không có internet thì mỗi lượt chat sẽ chờ fetch hỏng,
 * thử lại hai lần, rồi mới lùi về bộ luật — người dùng ngồi nhìn ba chấm vài
 * giây cho một việc app làm được ngay. Sau một lần lỗi mạng, tạm không gọi
 * model trong PAUSE_MS: bộ luật trả lời tức thì, hết hạn thì thử lại một lần.
 */
const PAUSE_MS = 60_000;
let pausedUntil = 0;
const isNetworkError = (e) => e?.name !== 'AbortError' && /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|network/i.test(String(e?.message || e));
export const llmPaused = () => Date.now() < pausedUntil;
export function pauseLlm(ms = PAUSE_MS) { pausedUntil = Date.now() + ms; }
export function resumeLlm() { pausedUntil = 0; }
const tokens = { vao: 0, ra: 0, cache_doc: 0, cache_ghi: 0, luot: 0, gan_nhat: null };
export function llmStatus() {
  return {
    bat: Boolean(apiKey()), nha_cung_cap: provider(), model: modelName(),
    do_sau_suy_nghi: effortCfg(), suy_nghi: thinkingCfg()?.type || 'mac_dinh',
    lan_goi: health.calls, lan_loi: health.fails, lan_thu_lai: health.retries,
    gan_nhat_ok: health.ok, gan_nhat_luc: health.at,
    loi_gan_nhat: health.error, loi_luc: health.errorAt,
    tam_dung_den: llmPaused() ? new Date(pausedUntil).toISOString() : null,
    token: { ...tokens },
  };
}
function noteOk(usage) {
  health.ok = true; health.at = new Date().toISOString(); health.calls += 1;
  pausedUntil = 0;
  if (usage) {
    tokens.vao += usage.vao; tokens.ra += usage.ra;
    tokens.cache_doc += usage.cache_doc; tokens.cache_ghi += usage.cache_ghi;
    tokens.luot += 1; tokens.gan_nhat = usage;
  }
}
function noteFail(e) {
  health.ok = false; health.at = new Date().toISOString(); health.calls += 1; health.fails += 1;
  // Cắt ngắn và bỏ mọi thứ trông giống key: thông điệp này đi ra tới API health.
  // Không xoá khi có lượt thành công sau đó — lỗi lác đác là thứ cần thấy nhất,
  // mà chính nó lại là thứ dễ bị một lượt tốt kế tiếp xoá sạch dấu vết.
  health.error = String(e?.message || e).replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 300);
  health.errorAt = health.at;
  console.warn(`[finmate] gọi ${provider()}/${modelName()} lỗi: ${health.error}`);
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

/** Thống kê token theo kiểu OpenAI -> hình dạng chung. */
function openaiUsage(data) {
  const u = data?.usage;
  if (!u) return null;
  const cached = Number(u.prompt_tokens_details?.cached_tokens) || 0;
  return { vao: Math.max(0, (Number(u.prompt_tokens) || 0) - cached), ra: Number(u.completion_tokens) || 0, cache_doc: cached, cache_ghi: 0 };
}

/**
 * OpenAI và các dịch vụ tương thích không hiểu cờ `cache`, và một số (Ollama,
 * vài proxy) chỉ chấp nhận đúng MỘT message system ở đầu. Gom lại cho chắc.
 */
function openaiMessages(messages) {
  const out = [];
  for (const m of messages) {
    const { cache, blocks, stop, refusal, truncated, usage, ...rest } = m;
    void cache; void blocks; void stop; void refusal; void truncated; void usage;
    const prev = out[out.length - 1];
    if (rest.role === 'system' && prev?.role === 'system') {
      prev.content = `${prev.content}\n\n${rest.content}`;
      continue;
    }
    out.push(rest);
  }
  return out;
}

/**
 * Gọi API chat. Trả về { msg, usage }: `msg` là nguyên message của model
 * (có thể chứa tool_calls) theo hình dạng OpenAI.
 */
async function callApi(messages, { json = false, schema = null, timeout = timeoutMs(), temperature = 0.4, tools = null } = {}) {
  if (!apiKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    if (provider() === 'anthropic') {
      const body = toAnthropicRequest(messages, tools, {
        model: modelName(), json, schema, maxTokens: maxTokens(), effort: effortCfg(), thinking: thinkingCfg(),
      });
      const res = await fetch(anthropicUrl(rawUrl()), {
        method: 'POST',
        headers: anthropicHeaders(apiKey()),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`LLM ${res.status}: ${t.slice(0, 200)}`);
      }
      const msg = fromAnthropicResponse(await res.json(), { json });
      // Bộ lọc an toàn của model từ chối trả lời: không phải lỗi mạng, gọi lại
      // cũng vậy. Báo lên để tầng trên lùi về bộ luật thay vì im lặng trả rỗng.
      if (msg?.refusal) throw Object.assign(new Error(`LLM từ chối trả lời (${msg.refusal === true ? 'refusal' : msg.refusal})`), { permanent: true });
      if (msg?.truncated) console.warn(`[finmate] câu trả lời của ${modelName()} bị cắt ở ${maxTokens()} token — tăng FINMATE_LLM_MAX_TOKENS nếu hay gặp`);
      return { msg, usage: msg?.usage || null };
    }
    const res = await fetch(openaiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: modelName(),
        messages: openaiMessages(messages),
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
    const msg = data?.choices?.[0]?.message || null;
    return { msg, usage: openaiUsage(data) };
  } finally {
    clearTimeout(timer);
  }
}

/** Bọc quanh lời gọi thật: ghi nhận thành/bại, thử lại khi lỗi tạm thời, rồi ném tiếp như cũ. */
async function call(messages, opts = {}) {
  if (!apiKey()) return null;
  if (llmPaused()) {
    const e = Object.assign(new Error(`LLM tạm dừng vì mất mạng, thử lại sau ${Math.ceil((pausedUntil - Date.now()) / 1000)}s`), { permanent: true, offline: true });
    throw e;
  }
  const { raw = false, ...rest } = opts;
  let last;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      const r = await callApi(messages, rest);
      noteOk(r?.usage);
      const msg = r?.msg || null;
      return raw ? msg : msg?.content || null;
    } catch (e) {
      noteFail(e);
      last = e;
      if (attempt === RETRY_DELAYS.length || e?.permanent || !isTransient(e)) break;
      health.retries += 1;
      console.warn(`[finmate] thử lại lần ${attempt + 1} sau ${RETRY_DELAYS[attempt]}ms`);
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  if (isNetworkError(last)) {
    pauseLlm();
    console.warn(`[finmate] mất kết nối tới ${provider()}; tạm dùng bộ luật ${PAUSE_MS / 1000}s rồi thử lại`);
  }
  throw last;
}

/** Một lượt gọi model có kèm danh sách công cụ. Trả message thô để agent xử lý tool_calls. */
export async function complete(messages, tools, opts = {}) {
  return call(messages, { ...opts, tools, raw: true });
}

/**
 * Thử một lượt gọi thật để người dùng biết key có dùng được không.
 *
 * Không có nó thì lần đầu dán key rất ức chế: gửi tin nhắn, nhận câu trả lời
 * của bộ luật, không biết là key sai, model gõ nhầm tên, hay trình duyệt bị
 * CORS chặn. Ở đây gọi thẳng, hỏng thì trả nguyên văn lỗi của nhà cung cấp.
 *
 * Cố ý gọi rẻ nhất có thể: một câu, effort thấp, trần token nhỏ.
 */
export async function testLlm(override = {}) {
  // Thử ĐÚNG cấu hình đang nhìn thấy trên màn hình, không phải cấu hình đã
  // nạp lúc khởi động. Trình duyệt (nhất là Safari trên iPhone) có thể tự
  // điền ô key mà không bắn sự kiện cho giao diện: người dùng thấy ô đầy
  // dấu chấm, còn app thì không có gì trong tay. Gửi thẳng giá trị đang gõ
  // sang thì kết quả thử luôn khớp với thứ người ta đang nhìn.
  const key = String(override.key ?? '').trim() || apiKey();
  const model = String(override.model ?? '').trim() || modelName();
  const url = String(override.url ?? '').trim() || rawUrl();
  const nhaCungCap = String(override.provider ?? '').trim() || detectProvider(key, url);
  const t0 = Date.now();
  // dang_dung: cấu hình vừa thử có ĐÚNG là cấu hình app đang chạy không.
  // Thử được mà chưa lưu thì chat vẫn chạy bộ luật — người dùng phải được
  // bảo thẳng, không thì tưởng xong rồi.
  const info = {
    provider: nhaCungCap, model, url: url || undefined,
    da_luu: Boolean(apiKey()),
    dang_dung: Boolean(apiKey()) && key === apiKey() && model === modelName() && url === rawUrl(),
  };

  if (!key) {
    return {
      ...info,
      ok: false,
      error: 'Chưa có API key',
      goi_y: 'Ô key đang trống. Nếu bạn thấy ô có dấu chấm thì đó là trình duyệt tự điền — bấm vào ô, xoá hết rồi dán lại key bằng tay.',
    };
  }

  const msgs = [{ role: 'user', content: 'Trả lời đúng một từ: OK' }];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    let text = '';
    if (nhaCungCap === 'anthropic') {
      const body = toAnthropicRequest(msgs, null, { model, maxTokens: 64, effort: 'low' });
      const res = await fetch(anthropicUrl(url), {
        method: 'POST', headers: anthropicHeaders(key), body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text().catch(() => '')).slice(0, 220)}`);
      text = fromAnthropicResponse(await res.json(), {})?.content || '';
    } else {
      const res = await fetch(url || openaiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: openaiMessages(msgs), max_tokens: 64 }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text().catch(() => '')).slice(0, 220)}`);
      text = (await res.json())?.choices?.[0]?.message?.content || '';
    }
    return { ...info, ok: true, ms: Date.now() - t0, reply: String(text).trim().slice(0, 60) };
  } catch (e) {
    const raw = String(e?.message || e);
    return { ...info, ok: false, ms: Date.now() - t0, error: raw.slice(0, 400), goi_y: hintFor(raw) };
  } finally {
    clearTimeout(timer);
  }
}

/** Đổi lỗi thô của nhà cung cấp thành câu người dùng làm được gì đó. */
export function hintFor(msg = '') {
  const m = msg.toLowerCase();
  if (/401|unauthorized|invalid.*api.*key|authentication/.test(m)) return 'Key không đúng hoặc đã bị thu hồi. Kiểm tra lại chuỗi key, chú ý khoảng trắng thừa khi dán.';
  if (/403|permission|forbidden/.test(m)) return 'Key đúng nhưng không có quyền dùng model này. Thử model khác hoặc kiểm tra quyền của key.';
  if (/404|not_found|does not exist|unknown model/.test(m)) return 'Tên model sai. Ví dụ đúng: claude-opus-5, claude-sonnet-5, claude-haiku-4-5.';
  if (/429|rate.?limit|quota|credit|billing/.test(m)) return 'Hết hạn mức hoặc hết tiền trong tài khoản nhà cung cấp.';
  if (/cors|failed to fetch|networkerror|load failed/.test(m)) return 'Trình duyệt bị chặn gọi thẳng tới nhà cung cấp (CORS). Với Claude thì app đã xin phép sẵn; nhà cung cấp khác có thể không cho gọi từ trình duyệt — khi đó dùng bản chạy máy chủ.';
  if (/abort|timeout/.test(m)) return 'Gọi quá lâu không phản hồi. Mạng chậm, hoặc URL API sai.';
  if (/5\d\d/.test(m)) return 'Nhà cung cấp đang lỗi. Thử lại sau ít phút.';
  return '';
}

const INTENT_LIST = [
  'add_expense', 'add_income', 'add_transfer', 'query_spending', 'query_balance', 'query_networth', 'query_fire',
  'query_forecast', 'query_debt', 'query_goal', 'query_budget', 'query_investment', 'query_income', 'surplus_advice',
  'affordability', 'summary', 'create_goal', 'create_budget', 'set_allocation', 'add_account', 'add_income_stream',
  'add_debt', 'add_holding', 'add_recurring', 'undo', 'help', 'greeting', 'update_profile', 'unknown',
];

/** Schema cho câu trả lời phân loại — Claude ép đúng hình dạng này qua output_config. */
const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENT_LIST },
    amount: { type: ['number', 'null'], description: 'Số tiền theo đơn vị thường ngày của đồng tiền gốc, null nếu không có' },
    confidence: { type: 'number', description: 'Độ chắc chắn 0..1' },
  },
  required: ['intent', 'amount', 'confidence'],
  additionalProperties: false,
};

/**
 * Nhờ LLM phân loại lại khi bộ luật không chắc chắn.
 * @param {string} text
 * @param {{currency?: string}} ctx  đồng tiền gốc để hiểu "50k" là 50.000đ hay €50.000
 */
export async function classify(text, { currency = 'VND' } = {}) {
  let content = null;
  const viDu = currency === 'VND'
    ? '("50k" = 50000, "2 triệu" = 2000000, "1tr5" = 1500000)'
    : `("50" = 50, "1.5k" = 1500; riêng "2 tỷ"/"5 triệu" luôn là VND, để nguyên số VND)`;
  try {
    content = await call(
      [
        { role: 'system', content: `Bạn phân loại ý định người dùng cho app tài chính cá nhân tiếng Việt. Chỉ trả JSON: {"intent": one of ${INTENT_LIST.join('|')}, "amount": number|null, "confidence": 0..1}. amount là số tiền theo đơn vị thường ngày của ${currency} nếu có ${viDu}.` },
        { role: 'user', content: String(text).slice(0, 500) },
      ],
      { json: true, schema: CLASSIFY_SCHEMA, temperature: 0 }
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
export async function answer(question, context, { currency = 'VND' } = {}) {
  const donVi = currency === 'VND' ? 'đơn vị VND rút gọn (triệu/tỷ)' : `đồng tiền gốc là ${currency}, viết gọn kiểu "€1.250" / "${currency} 45k"`;
  try {
    return await call(
      [
        {
          role: 'system',
          content:
            'Bạn là cố vấn tài chính cá nhân người Việt, thực tế và thẳng thắn. Chỉ dùng số liệu trong CONTEXT, không bịa. ' +
            `Trả lời ngắn gọn (dưới 200 từ), dùng markdown, ${donVi}. Không khuyên mua bán mã cổ phiếu cụ thể. ` +
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
