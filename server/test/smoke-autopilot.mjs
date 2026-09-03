/**
 * Kiểm tầng "AI điều phối": đề xuất chờ gật, chế độ tự lái, bản tin sáng,
 * phản hồi khi có giao dịch ngân hàng, và chữ "ừ" trong chat.
 *
 * Không cần model AI: toàn bộ chạy bằng bộ luật trên DB tạm. Phần agent
 * (công cụ de_xuat/chap_nhan_de_xuat) đi qua LLM giả kiểu OpenAI.
 */
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('./.tmp-autopilot.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const head = (t) => console.log(`\n${t}`);
const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

// LLM giả: chỉ dùng ở phần cuối; trước đó agent tắt để đi đường bộ luật.
let scenario = [];
const llm = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const step = scenario.shift() || { content: 'Xong.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.content ?? null, tool_calls: step.tool_calls } }] }));
  });
});
await new Promise((r) => llm.listen(0, r));

process.env.FINMATE_DB = DB;
process.env.FINMATE_FX_OFFLINE = '1';
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${llm.address().port}/v1/chat/completions`;
process.env.FINMATE_LLM_KEY = 'test-key';
process.env.FINMATE_LLM_MODEL = 'mock';
process.env.FINMATE_AGENT = 'off';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { all, get, run, update, insert } = await import('../src/db.js');
const { createTransaction } = await import('../src/services/ledger.js');
const { propose, listProposals, acceptProposal, rejectProposal, getProposal, expireProposals } = await import('../src/services/ai_proposals.js');
const { runAutopilot, generateProposals, dailyBrief, noteIngest, setAutopilotConfig, autopilotConfig, _internals } = await import('../src/services/autopilot.js');
const { chat } = await import('../src/services/chat/index.js');
const { ingestMessage } = await import('../src/services/ingest.js');
const { listActions, undoBatch } = await import('../src/services/ai_audit.js');
const { today, addMonths } = await import('../src/util/date.js');

update('profile', 1, { onboarded: 1, onboarding_step: 'done', name: 'Tân' });
const acc = insert('accounts', { name: 'VCB', type: 'bank', balance: 50_000_000, currency: 'VND' });
const lastMsg = () => get("SELECT * FROM chat_messages WHERE role='assistant' ORDER BY id DESC LIMIT 1");

head('Đề xuất: tạo, chống lặp, hết hạn');
{
  const p = propose({ key: 'k1', title: 'Việc A', body: 'vì', actions: [{ tool: 'ghi_nho', args: { muc: 'x', noi_dung: 'y' } }] });
  ok('tạo được đề xuất, trạng thái pending', p?.moi === true && p.trang_thai === 'pending' && p.hanh_dong[0].tool === 'ghi_nho');
  const again = propose({ key: 'k1', title: 'Việc A (mới)', actions: [{ tool: 'ghi_nho', args: {} }] });
  ok('cùng key đang chờ thì cập nhật, không tạo bản trùng', again.moi === false && again.id === p.id && listProposals().length === 1);
  ok('thiếu hành động thì từ chối', (() => { try { propose({ title: 'x', actions: [] }); return false; } catch (e) { return /ít nhất một/.test(e.message); } })());
  const r = rejectProposal(p.id);
  ok('bỏ qua được', r.ok && getProposal(p.id).trang_thai === 'rejected');
  ok('vừa bị từ chối thì không hỏi lại (trả null)', propose({ key: 'k1', title: 'Việc A', actions: [{ tool: 'ghi_nho', args: {} }] }) === null);
  const old = propose({ key: 'k_old', title: 'Cũ', actions: [{ tool: 'ghi_nho', args: {} }], expires_days: 1 });
  run("UPDATE ai_proposals SET expires_at = date('now', '-2 days') WHERE id = ?", [old.id]);
  ok('quá hạn thì tự đóng', expireProposals().het_han === 1 && getProposal(old.id).trang_thai === 'expired');
}

head('Chấp nhận đề xuất = chạy chuỗi công cụ qua nhật ký, hoàn tác được cả cụm');
{
  // Tổng % quỹ lệch 100 -> luật cân bằng phải nhìn thấy.
  run('UPDATE funds SET percent = percent + 10 WHERE id = (SELECT id FROM funds ORDER BY id LIMIT 1)');
  const created = generateProposals();
  const rb = created.find((p) => p.key === 'rebalance_funds');
  ok('luật cân bằng quỹ sinh đề xuất khi tổng % lệch', Boolean(rb) && rb.tu_lam_duoc === true, JSON.stringify(created.map((p) => p.key)));
  const r = acceptProposal(rb.id);
  ok('đồng ý -> chạy công cụ thật', r.ok === true && r.mutates === true && r.ket_qua[0].tool === 'can_bang_phan_bo', JSON.stringify(r).slice(0, 200));
  const tong = all('SELECT percent FROM funds WHERE archived = 0').reduce((s, f) => s + f.percent, 0);
  ok('tổng % về đúng 100', Math.abs(tong - 100) < 0.01, `tổng=${tong}`);
  ok('trạng thái chuyển sang accepted', getProposal(rb.id).trang_thai === 'accepted');
  const acts = listActions({ limit: 5, batch: r.batch });
  ok('mọi bước nằm trong nhật ký AI cùng một batch', acts.length === 1 && acts[0].cong_cu === 'can_bang_phan_bo' && acts[0].thay_doi_du_lieu, JSON.stringify(acts));
  const u = undoBatch(r.batch);
  ok('hoàn tác cả lượt theo batch', u.ok === true);
  const tong2 = all('SELECT percent FROM funds WHERE archived = 0').reduce((s, f) => s + f.percent, 0);
  ok('hoàn tác trả % về như trước (lệch 110)', Math.abs(tong2 - 110) < 0.01, `tổng=${tong2}`);
  ok('không chấp nhận lần hai', acceptProposal(rb.id).ok === false);
}

head('Luật: khoản chi lặp ba tháng -> đề xuất đặt định kỳ');
{
  for (let i = 1; i <= 3; i += 1) {
    createTransaction({ type: 'expense', amount: 8_000_000, currency: 'VND', date: addMonths(today(), -i).slice(0, 8) + '05', account_id: acc, merchant: 'Tiền nhà Q7', note: 'tiền nhà', source: 'manual' });
  }
  const created = _internals.ruleRecurringCandidates();
  const p = created.find((x) => /Tiền nhà/.test(x.tieu_de));
  ok('nhận ra "Tiền nhà Q7" lặp 3 tháng', Boolean(p), JSON.stringify(created.map((x) => x.tieu_de)));
  ok('đề xuất mang tham số đầy đủ cho tao_giao_dich_dinh_ky', p?.hanh_dong[0].tool === 'tao_giao_dich_dinh_ky' && p.hanh_dong[0].args.so_tien === 8000000 && p.hanh_dong[0].args.ngay_trong_thang === 5 && p.hanh_dong[0].args.tai_khoan === 'VCB', JSON.stringify(p?.hanh_dong));
  const r = acceptProposal(p.id);
  ok('đồng ý -> có khoản định kỳ thật', r.ok && get("SELECT * FROM recurring WHERE name = 'Tiền nhà Q7'")?.amount === 8_000_000);
  ok('đã có định kỳ thì luật không đề xuất lại', !_internals.ruleRecurringCandidates().some((x) => /Tiền nhà/.test(x.tieu_de)));
}

head('Luật: mục tiêu không kịp hạn -> giãn hạn tới mốc khả thi');
{
  // Thu 30tr, chi 10tr mỗi tháng trong 3 tháng qua -> dôi dư ~20tr.
  for (let i = 1; i <= 3; i += 1) {
    const d = addMonths(today(), -i).slice(0, 8);
    createTransaction({ type: 'income', amount: 30_000_000, currency: 'VND', date: `${d}01`, account_id: acc, note: 'lương', source: 'manual' });
    createTransaction({ type: 'expense', amount: 10_000_000, currency: 'VND', date: `${d}10`, account_id: acc, note: 'ăn uống', source: 'manual' });
  }
  const gid = insert('goals', { name: 'Mua xe', target_amount: 600_000_000, current_amount: 0, deadline: addMonths(today(), 6), currency: 'VND', status: 'active' });
  const created = _internals.ruleGoalsAtRisk();
  const p = created.find((x) => x.key === `goal_deadline_${gid}`);
  ok('mục tiêu 600tr trong 6 tháng với dôi dư 20tr bị đánh dấu không kịp', Boolean(p), JSON.stringify(created.map((x) => x.tieu_de)));
  ok('đề xuất sửa hạn bằng sua_muc_tieu với ngày mới xa hơn', p?.hanh_dong[0].tool === 'sua_muc_tieu' && p.hanh_dong[0].args.han > addMonths(today(), 6), JSON.stringify(p?.hanh_dong));
}

head('Luật: giao dịch chưa chắc danh mục -> một đề xuất xác nhận, chốt thì học');
{
  const t = createTransaction({ type: 'expense', amount: 150_000, currency: 'VND', date: today(), account_id: acc, merchant: 'Quán lạ 123', note: 'x', source: 'sms' });
  update('transactions', t.transaction.id, { needs_review: 1, category_id: get("SELECT id FROM categories WHERE name = 'Ăn uống'").id });
  const p = _internals.ruleReviewTransactions();
  ok('có đề xuất xác nhận danh mục', p && /Xác nhận danh mục/.test(p.tieu_de) && p.hanh_dong.some((a) => a.args.id === t.transaction.id), JSON.stringify(p?.hanh_dong));
  const r = acceptProposal(p.id);
  const tx = get('SELECT needs_review, confidence FROM transactions WHERE id = ?', [t.transaction.id]);
  ok('chốt xong thì hết cờ cần xem lại', r.ok && tx.needs_review === 0 && tx.confidence === 1, JSON.stringify(tx));
  ok('và app học luật phân loại từ giao dịch đó', Boolean(get("SELECT id FROM rules WHERE pattern LIKE '%Quán lạ 123%'")));
}

head('Chế độ tự lái: propose hỏi, act tự làm việc an toàn');
{
  run('UPDATE funds SET percent = percent + 10 WHERE id = (SELECT id FROM funds ORDER BY id LIMIT 1)');
  run("DELETE FROM ai_proposals WHERE key = 'rebalance_funds'");
  setAutopilotConfig({ che_do: 'propose' });
  const r1 = runAutopilot({ brief: false });
  ok('propose: tạo đề xuất và nhắn vào chat', r1.de_xuat.some((x) => /Cân bằng/.test(x.tieu_de)) && lastMsg()?.intent === 'proposal', JSON.stringify(r1));
  const rbId = r1.de_xuat.find((x) => /Cân bằng/.test(x.tieu_de)).id;
  ok('tin nhắn mang mã đề xuất', all("SELECT data FROM chat_messages WHERE intent = 'proposal'").some((m) => JSON.parse(m.data).proposal === rbId));
  ok('chạy lại không nhắn lại cùng đề xuất', runAutopilot({ brief: false }).de_xuat.length === 0);

  rejectProposal(r1.de_xuat[0].id);
  run("DELETE FROM ai_proposals WHERE key = 'rebalance_funds'");
  setAutopilotConfig({ che_do: 'act' });
  const r2 = runAutopilot({ brief: false });
  const tong = all('SELECT percent FROM funds WHERE archived = 0').reduce((s, f) => s + f.percent, 0);
  ok('act: việc an toàn được tự làm luôn', r2.tu_lam.length === 1 && Math.abs(tong - 100) < 0.01, JSON.stringify(r2));
  ok('và có tin nhắn "mình vừa tự làm" kèm batch để hoàn tác', lastMsg()?.intent === 'autopilot' && JSON.parse(lastMsg().data).batch === r2.tu_lam[0].batch);
  setAutopilotConfig({ che_do: 'off' });
  ok('off: im lặng', runAutopilot({ brief: false }).de_xuat.length === 0 && autopilotConfig().che_do === 'off');
  setAutopilotConfig({ che_do: 'propose' });
}

head('Bản tin mỗi sáng');
{
  const b = dailyBrief({ force: true });
  ok('viết được bản tin từ số liệu', b && /Chào Tân/.test(b.noi_dung) && /an toàn tiêu/.test(b.noi_dung), b?.noi_dung);
  ok('không lộ undefined/NaN', !/undefined|NaN/.test(b.noi_dung));
  ok('mỗi ngày chỉ một lần', dailyBrief() === null);
}

head('Chat: "ừ" sau đề xuất là gật, "thôi" là bỏ qua');
{
  const p = propose({ key: 'k_chat', title: 'Ghi nhớ mẹ cần 5 triệu mỗi tháng', actions: [{ tool: 'ghi_nho', args: { muc: 'Phụ cấp mẹ', noi_dung: '5 triệu/tháng' } }] });
  insert('chat_messages', { role: 'assistant', content: 'Đề xuất…', intent: 'proposal', data: JSON.stringify({ proposal: p.id }) });
  const r = await chat('ừ');
  ok('"ừ" chấp nhận đề xuất mới nhất', r.intent === 'proposal_done' && /Xong/.test(r.reply), JSON.stringify(r).slice(0, 200));
  ok('công cụ trong đề xuất đã chạy thật', Boolean(get("SELECT id FROM ai_memory WHERE key = 'Phụ cấp mẹ'")));

  const p2 = propose({ key: 'k_chat2', title: 'Việc B', actions: [{ tool: 'ghi_nho', args: { muc: 'B', noi_dung: 'b' } }] });
  insert('chat_messages', { role: 'assistant', content: 'Đề xuất…', intent: 'proposal', data: JSON.stringify({ proposal: p2.id }) });
  const r2 = await chat('thôi khỏi');
  ok('"thôi khỏi" bỏ qua', r2.intent === 'proposal_skip' && getProposal(p2.id).trang_thai === 'rejected');

  const r3 = await chat('ok');
  ok('"ok" khi không còn đề xuất chờ thì không bị hiểu nhầm', r3.intent !== 'proposal_done' && r3.intent !== 'proposal_skip', r3.intent);

  const p3 = propose({ key: 'k_chat3', title: 'Việc C', actions: [{ tool: 'ghi_nho', args: { muc: 'C', noi_dung: 'c' } }] });
  insert('chat_messages', { role: 'assistant', content: 'Câu trả lời thường', intent: 'query_balance', data: '{}' });
  const r4 = await chat('ừ');
  ok('"ừ" khi tin trước KHÔNG phải đề xuất thì không tự chấp nhận', r4.intent !== 'proposal_done' && getProposal(p3.id).trang_thai === 'pending', r4.intent);
  rejectProposal(p3.id);
}

head('Tin nhắn ngân hàng vào sổ -> cố vấn nhắn một dòng, mơ hồ thì hỏi lại');
{
  const r = ingestMessage({ text: 'VCB: TK 0071 -150,000VND luc 12:30 03/09. So du 49,850,000VND. ND: HIGHLANDS COFFEE', channel: 'sms' });
  ok('giao dịch được ghi', r.status === 'created', JSON.stringify(r).slice(0, 160));
  const n = noteIngest(r);
  const m = lastMsg();
  ok('có tin nhắn ingest trong chat', n?.message_id && (m.intent === 'ingest' || m.intent === 'proposal'), JSON.stringify(m).slice(0, 200));
  const ingestMsg = get('SELECT * FROM chat_messages WHERE id = ?', [n.message_id]);
  ok('tin nói rõ số tiền và nơi chi', /150k|150\.000/.test(ingestMsg.content) && /HIGHLANDS/i.test(ingestMsg.content), ingestMsg.content);
  ok('trùng thì không nhắn', noteIngest(ingestMessage({ text: 'VCB: TK 0071 -150,000VND luc 12:30 03/09. So du 49,850,000VND. ND: HIGHLANDS COFFEE', channel: 'sms' })) === null);
}

head('Agent (LLM) dùng công cụ đề xuất');
{
  process.env.FINMATE_AGENT = 'on';
  scenario = [
    { tool_calls: [tc('c1', 'de_xuat', { tieu_de: 'Giãn hạn mục tiêu Mua xe tới 2028', noi_dung: 'vì dôi dư không đủ', hanh_dong: [{ cong_cu: 'sua_muc_tieu', tham_so: { muc_tieu: 'Mua xe', han: '2028-06-30' } }], muc_do: 'warn' })] },
    { content: 'Mình đề xuất giãn hạn mục tiêu Mua xe tới 06/2028. Ừ là mình làm nhé.' },
  ];
  const r = await chat('mục tiêu mua xe có kịp không?');
  const p = listProposals({ status: 'pending' }).find((x) => /Giãn hạn/.test(x.tieu_de));
  ok('agent tạo được đề xuất qua de_xuat', Boolean(p) && p.nguon === 'chat' && p.hanh_dong[0].tool === 'sua_muc_tieu', JSON.stringify(r).slice(0, 200));
  ok('công cụ sai tên trong đề xuất bị chặn', (await import('../src/services/chat/tools.js')).runTool('de_xuat', { tieu_de: 'x', hanh_dong: [{ cong_cu: 'khong_co' }] }).ok === false);

  scenario = [
    { tool_calls: [tc('c2', 'chap_nhan_de_xuat', {})] },
    { content: 'Đã giãn hạn mục tiêu Mua xe tới 06/2028 rồi nhé.' },
  ];
  const r2 = await chat('ừ làm đi');
  ok('agent chấp nhận đề xuất mới nhất -> mục tiêu đổi hạn thật', get("SELECT deadline FROM goals WHERE name = 'Mua xe'").deadline === '2028-06-30', JSON.stringify(r2).slice(0, 200));
  ok('lượt chat có batch để hoàn tác', typeof r2.batch === 'string' && r2.refresh === true);
  process.env.FINMATE_AGENT = 'off';
}

await new Promise((r) => llm.close(r));
console.log(`\n${fail ? '✗' : '✓'} smoke-autopilot: ${pass} đạt, ${fail} hỏng`);
process.exitCode = fail ? 1 : 0;
