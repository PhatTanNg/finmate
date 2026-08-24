/** Điều phối hội thoại: onboarding -> nhận diện ý định -> hành động -> trả lời. */
import { all, get, insert, update, run } from '../../db.js';
import { today, monthKey, monthStart, monthEnd } from '../../util/date.js';
import { norm } from '../../util/vi.js';
import { detectIntent } from './nlu.js';
import { HANDLERS } from './handlers.js';
import { handleOnboarding, startOnboarding } from './onboarding.js';
import { llmEnabled, classify, answer } from './llm.js';
import { runAgent, agentEnabled } from './agent.js';
import { totals } from '../reports.js';
import { netWorth } from '../networth.js';
import { fireStats, emergencyStatus } from '../fire.js';
import { healthScore } from '../advisor.js';
import { generateInsights } from '../insights.js';
import { safeToSpend } from '../forecast.js';
import { findTopic, answerTopic } from './knowledge.js';

function saveMessage(role, content, intent = null, data = {}) {
  return insert('chat_messages', { role, content, intent, data: JSON.stringify(data || {}) });
}

export function history(limit = 100) {
  return all('SELECT * FROM chat_messages ORDER BY id ASC LIMIT ?', [limit]).map((m) => ({
    ...m,
    data: safeParse(m.data),
  }));
}

function safeParse(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

/** Số liệu tóm tắt để LLM (nếu bật) trả lời câu hỏi mở mà không bịa. */
function snapshotContext() {
  const mk = monthKey();
  const t = totals(monthStart(mk), monthEnd(mk));
  const nw = netWorth();
  const f = fireStats();
  const ef = emergencyStatus();
  const h = healthScore();
  return {
    thang_hien_tai: mk,
    thu_thang_nay: t.income,
    chi_thang_nay: t.expense,
    ty_le_tiet_kiem: Math.round(t.savings_rate * 100) + '%',
    tai_san_rong: nw.net,
    co_cau_tai_san: nw.breakdown,
    quy_khan_cap_thang: ef.months_covered,
    so_tien_can_de_tu_do: f.fi_number,
    ngay_du_kien_tu_do: f.fi_date,
    thu_nhap_thu_dong_thang: f.passive_income.total,
    chi_phi_song_thang: f.monthly_expense,
    doi_du_thang: f.monthly_surplus,
    diem_suc_khoe: h.score,
    an_toan_tieu_con_lai: safeToSpend().available,
    quy: all('SELECT name, percent, balance FROM funds'),
    muc_tieu: all("SELECT name, target_amount, current_amount, deadline FROM goals WHERE status='active'"),
    no: all("SELECT name, balance, interest_rate FROM debts WHERE status='active'"),
    nguon_thu: all('SELECT name, type, net_amount FROM income_streams WHERE active=1'),
  };
}

const OPEN_QUESTION_INTENTS = new Set(['unknown']);

/** Ý định ghi/sửa dữ liệu — không được để câu hỏi kiến thức chiếm chỗ. */
const WRITE_INTENTS = new Set([
  'add_expense', 'add_income', 'add_transfer', 'add_account', 'add_income_stream', 'add_debt',
  'add_holding', 'add_recurring', 'create_goal', 'create_budget', 'set_allocation', 'set_price',
  'update_profile', 'undo', 'contribute_goal', 'pay_debt',
]);

/** Lượt hội thoại gần nhất (đúng thứ tự thời gian) — dùng làm ngữ cảnh cho AI. */
function recent(limit = 30) {
  return all('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?', [limit]).reverse();
}

/** Gợi ý nút bấm nhanh sau khi agent trả lời — tuỳ theo đang thiết lập hay dùng thường. */
function quickFor(onboarding) {
  return onboarding
    ? ['Bỏ qua bước này', 'Mình chưa rõ, giải thích giúp', 'Xong rồi, xem tổng quan']
    : ['Tình hình tài chính của mình', 'Tháng này tiêu bao nhiêu?', 'Mình nên làm gì tiếp theo?', 'Bao giờ mình tự do tài chính?'];
}

export async function chat(text) {
  const message = String(text || '').trim();
  if (!message) return { reply: 'Bạn muốn hỏi gì nào?', quick: [] };
  saveMessage('user', message);

  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  const isOnboarding = !p.onboarded;

  // Ưu tiên AI cố vấn: hiểu ngữ cảnh cả cuộc trò chuyện và tự thao tác trong app.
  // Không cấu hình LLM (hoặc gọi lỗi) thì lùi về bộ luật tiếng Việt bên dưới.
  if (agentEnabled()) {
    const prior = recent(30).slice(0, -1); // bỏ chính câu vừa lưu
    const res = await runAgent(message, prior, { onboarding: isOnboarding });
    if (res) {
      if (res.mutated) generateInsights();
      saveMessage('assistant', res.reply, isOnboarding ? 'onboarding' : 'agent', { tools: res.calls });
      return {
        reply: res.reply,
        intent: isOnboarding && !res.onboarded ? 'onboarding' : 'agent',
        tools: res.calls,
        refresh: res.mutated,
        onboarding: isOnboarding && !res.onboarded,
        onboarded: res.onboarded || undefined,
        quick: quickFor(isOnboarding && !res.onboarded),
      };
    }
  }

  if (isOnboarding) {
    const res = handleOnboarding(message);
    saveMessage('assistant', res.reply, 'onboarding', { step: res.step });
    return { ...res, onboarding: !res.onboarded, intent: 'onboarding' };
  }

  let { intent, score, entities, is_question } = detectIntent(message);

  // Câu hỏi kiến thức tài chính (không kèm số tiền, không phải lệnh ghi sổ)
  // -> trả lời bằng cơ sở tri thức, gắn với số liệu thật của người dùng.
  // Bỏ qua khi bộ luật đã khớp rất chắc (score 9: tỷ giá, kiều hối, thuế...)
  // vì các handler đó trả lời sát tình huống hơn bài viết kiến thức chung.
  if (!entities.amount && !WRITE_INTENTS.has(intent) && score < 9) {
    const topic = findTopic(message);
    if (topic) {
      const reply = answerTopic(topic);
      saveMessage('assistant', reply, 'explain', { topic: topic.key });
      return { reply, intent: 'explain', topic: topic.key, quick: ['Việc nên làm tiếp theo', 'Tình hình tài chính của mình', 'Bao giờ tự do tài chính'] };
    }
  }

  // bộ luật không chắc -> nhờ LLM phân loại (nếu có cấu hình)
  if ((intent === 'unknown' || score < 3) && llmEnabled()) {
    const guess = await classify(message);
    if (guess && guess.confidence >= 0.5 && HANDLERS[guess.intent]) {
      intent = guess.intent;
      if (guess.amount && !entities.amount) entities.amount = guess.amount;
    }
  }

  const handler = HANDLERS[intent] || HANDLERS.unknown;
  let result;
  try {
    result = handler(message, entities) || HANDLERS.unknown(message, entities);
  } catch (e) {
    result = { reply: `Mình gặp trục trặc khi xử lý: ${e.message}. Bạn thử diễn đạt khác giúp mình nhé.` };
  }

  // câu hỏi mở: để LLM diễn giải dựa trên số liệu thật
  if (OPEN_QUESTION_INTENTS.has(intent) && is_question && llmEnabled()) {
    const llmReply = await answer(message, snapshotContext());
    if (llmReply) result = { reply: llmReply, data: result.data, quick: result.quick };
  }

  if (result.refresh) generateInsights();
  saveMessage('assistant', result.reply, intent, result.data ? { intent } : {});
  return { ...result, intent, score };
}

export function ensureWelcome() {
  const count = get('SELECT COUNT(*) c FROM chat_messages').c;
  if (count > 0) return null;
  const p = get('SELECT * FROM profile WHERE id = 1') || {};
  if (!p.onboarded) {
    const start = startOnboarding();
    saveMessage('assistant', start.reply, 'onboarding', { step: start.step });
    return start;
  }
  // Đã setup xong: chào lại kèm tình hình hiện tại thay vì hỏi onboarding.
  const back = HANDLERS.greeting('', {});
  saveMessage('assistant', back.reply, 'greeting');
  return back;
}

export function resetChat({ keepData = true } = {}) {
  run('DELETE FROM chat_messages');
  if (!keepData) update('profile', 1, { onboarded: 0, onboarding_step: 'welcome' });
  return ensureWelcome();
}

export { startOnboarding };
