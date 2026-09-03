/**
 * Kiểm ba năng lực khiến AI thành cố vấn thực thụ thay vì chatbot có công cụ:
 *   1. Nhật ký + hoàn tác — mọi việc AI làm đều xem lại và trả lại được,
 *      kể cả số dư tài khoản chứ không chỉ bản ghi giao dịch.
 *   2. Trí nhớ dài hạn — không quên sau 14 lượt hội thoại.
 *   3. Rà soát chủ động — tự mở hồ sơ ra xem, và không được đụng tiền khi
 *      người dùng vắng mặt trừ khi họ cho phép.
 * Dùng LLM giả lập nên không cần API key.
 */
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('./.tmp-ai.db', import.meta.url));
for (const s of ['', '-shm', '-wal']) if (existsSync(DB + s)) rmSync(DB + s);

let scenario = [];
let seen = [];
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push(JSON.parse(body || '{}'));
    const step = scenario.shift() || { content: 'Xong rồi bạn nhé.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.content ?? null, tool_calls: step.tool_calls } }] }));
  });
});
await new Promise((r) => srv.listen(0, r));

process.env.FINMATE_DB = DB;
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${srv.address().port}/v1/chat/completions`;
process.env.FINMATE_LLM_KEY = 'test-key';
process.env.FINMATE_LLM_MODEL = 'mock';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { runAgent } = await import('../src/services/chat/agent.js');
const { get, all, beginAudit, endAudit, run } = await import('../src/db.js');
const { runTool } = await import('../src/services/chat/tools.js');
const { listActions, actionDetail, undoBatch, undoLast, undoAction, actionStats, pruneActions } = await import('../src/services/ai_audit.js');
const { memoryBrief, listMemory } = await import('../src/services/ai_memory.js');
const { runReview, setReviewConfig, reviewConfig, lastReview } = await import('../src/services/ai_review.js');

let pass = 0; let fail = 0; const bad = [];
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; bad.push(name); console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
}
const tc = (n, a) => ({ id: `c${Math.random().toString(36).slice(2, 6)}`, type: 'function', function: { name: n, arguments: JSON.stringify(a) } });
const bal = (n) => get('SELECT balance FROM accounts WHERE name = ?', [n])?.balance;

console.log('\n— 1. Nhật ký ghi lại mọi việc AI làm —');
scenario = [
  { tool_calls: [tc('tao_tai_khoan', { ten: 'AIB', so_du: 4000, dong_tien: 'EUR' })] },
  { tool_calls: [tc('ghi_giao_dich', { loai: 'expense', so_tien: 850, dong_tien: 'EUR', mo_ta: 'Tiền thuê nhà', tai_khoan: 'AIB' })] },
  { content: 'Mình đã ghi tiền thuê nhà 850 EUR nhé.' },
];
const r1 = await runAgent('mình vừa trả tiền nhà 850 euro', []);
const acts = listActions({ limit: 10 });
ok('mỗi lần gọi công cụ đều vào nhật ký', acts.length === 2, `có ${acts.length}`);
ok('nhật ký ghi được vì sao AI làm', acts.every((a) => a.ly_do), JSON.stringify(acts.map((a) => a.ly_do)));
ok('nhật ký gom theo lượt chat', acts.every((a) => a.batch === r1.batch));
ok('biết thao tác nào đụng vào dữ liệu', acts.every((a) => a.thay_doi_du_lieu));

const chi = actionDetail(acts.find((a) => a.cong_cu === 'ghi_giao_dich').id);
ok('chi tiết nêu đúng tên công cụ', chi.cong_cu === 'ghi_giao_dich', chi.cong_cu);
const bang = new Set(chi.thay_doi.map((c) => c.bang));
ok('bắt được cả thay đổi số dư, không chỉ giao dịch', bang.has('accounts') && bang.has('transactions'), [...bang].join(','));

console.log('\n— 2. Hoàn tác trả lại đúng số dư —');
const sauChi = bal('AIB');
const u = undoLast(1);
ok('hoàn tác báo thành công', u.ok, JSON.stringify(u));
ok('giao dịch bị gỡ', get("SELECT COUNT(*) n FROM transactions WHERE note='Tiền thuê nhà'").n === 0);
ok('số dư về đúng trước khi chi', bal('AIB') === sauChi + 85000, `${bal('AIB')} vs ${sauChi + 85000}`);
ok('không hoàn tác được hai lần', undoAction(acts.find((a) => a.cong_cu === 'ghi_giao_dich').id).ok === false);

console.log('\n— 3. Hoàn tác cả một lượt chat nhiều thao tác —');
scenario = [
  { tool_calls: [tc('tao_quy', { ten: 'Quỹ Xe', muc_tieu: 20000, dong_tien: 'EUR', han: '2029-06-30' })] },
  { tool_calls: [tc('dat_phan_bo_quy', { phan_bo: { 'Quỹ Xe': 15 } })] },
  { tool_calls: [tc('ghi_giao_dich', { loai: 'income', so_tien: 3000, dong_tien: 'EUR', mo_ta: 'Lương', tai_khoan: 'AIB' })] },
  { content: 'Xong rồi nhé.' },
];
const truocLuot = bal('AIB');
const r2 = await runAgent('mở quỹ mua xe 20 nghìn euro trước hè 2029, lương về 3000', []);
ok('lượt chat làm được nhiều việc', !!get("SELECT 1 FROM funds WHERE name='Quỹ Xe'") && bal('AIB') > truocLuot);
const ub = undoBatch(r2.batch);
ok('hoàn tác cả lượt', ub.ok && ub.so_thao_tac_hoan_tac === 3, JSON.stringify(ub));
ok('quỹ mới bị gỡ', !get("SELECT 1 FROM funds WHERE name='Quỹ Xe'"));
ok('số dư về nguyên sau khi hoàn cả lượt', bal('AIB') === truocLuot, `${bal('AIB')} vs ${truocLuot}`);

console.log('\n— 4. Thao tác của người dùng KHÔNG bị ghi nhầm thành của AI —');
const truocNguoiDung = get('SELECT COUNT(*) n FROM ai_actions').n;
runTool('ghi_giao_dich', { loai: 'expense', so_tien: 30, dong_tien: 'EUR', mo_ta: 'Tự ghi tay', tai_khoan: 'AIB' });
ok('gọi ngoài phiên không sinh nhật ký', get('SELECT COUNT(*) n FROM ai_actions').n === truocNguoiDung);
ok('cũng không sinh bản ghi thay đổi', get('SELECT COUNT(*) n FROM ai_changes WHERE action_id NOT IN (SELECT id FROM ai_actions)').n === 0);

console.log('\n— 5. Trí nhớ dài hạn —');
scenario = [
  { tool_calls: [tc('ghi_nho', { muc: 'Phụ cấp mẹ', noi_dung: 'Gửi mẹ 5 triệu VND mỗi tháng, tuyệt đối không cắt', loai: 'constraint', do_quan_trong: 5 })] },
  { content: 'Mình nhớ rồi.' },
];
await runAgent('nhớ giúp mình tháng nào cũng gửi mẹ 5 triệu', []);
ok('AI ghi nhớ được', listMemory().some((m) => m.muc === 'Phụ cấp mẹ'));

seen = [];
scenario = [{ content: 'Ừ.' }];
await runAgent('tình hình sao rồi', []);
const brief = JSON.parse(seen[0].messages[0].content.match(/\{[\s\S]*\}/)[0]);
ok('điều đã nhớ được nhắc lại trong mọi lượt sau', JSON.stringify(brief.ghi_nho_lau_dai || {}).includes('5 triệu'), JSON.stringify(brief.ghi_nho_lau_dai));
ok('prompt dạy AI phải ghi nhớ', /ghi_nho/.test(seen[0].messages[0].content));

runTool('ghi_nho', { muc: 'Phụ cấp mẹ', noi_dung: 'Tăng lên 7 triệu từ 2027', loai: 'constraint' });
ok('ghi đè khi hoàn cảnh đổi, không tạo bản trùng',
  listMemory().filter((m) => m.muc === 'Phụ cấp mẹ').length === 1
  && listMemory().find((m) => m.muc === 'Phụ cấp mẹ').noi_dung.includes('7 triệu'));
run("INSERT INTO ai_memory (kind, key, value, expires_at) VALUES ('plan','Tạm thời','hết hạn rồi', date('now','-1 day'))");
ok('mục hết hạn không lọt vào prompt', !JSON.stringify(memoryBrief() || {}).includes('hết hạn rồi'));
ok('quên được khi không còn đúng', runTool('quen_di', { muc: 'Phụ cấp mẹ' }).ok && !listMemory().some((m) => m.muc === 'Phụ cấp mẹ'));
ok('quên mục không có thì báo lỗi, không im lặng', runTool('quen_di', { muc: 'Không Có Thật' }).ok === false);

console.log('\n— 6. Rà soát chủ động: vắng mặt thì không được đụng tiền —');
setReviewConfig({ che_do: 'suggest' });
seen = [];
scenario = [
  { tool_calls: [tc('xem_suc_khoe', {})] },
  { tool_calls: [tc('ghi_giao_dich', { loai: 'expense', so_tien: 999, dong_tien: 'EUR', mo_ta: 'Tự ý tiêu' })] },
  { content: '• Quỹ khẩn cấp mới đủ 1,2 tháng chi tiêu.\nBạn muốn mình nâng lên 3 tháng không?' },
];
const rv = await runReview({ force: true });
const toolsSent = (seen[0].tools || []).map((t) => t.function.name);
ok('model không được đưa công cụ ghi dữ liệu', !toolsSent.includes('ghi_giao_dich') && toolsSent.length > 5, `${toolsSent.length} công cụ`);
ok('vẫn chặn lần nữa lúc thực thi nếu model tự bịa', get("SELECT COUNT(*) n FROM transactions WHERE note='Tự ý tiêu'").n === 0);
ok('công cụ bị chặn không bị tính là đã dùng', !rv.cong_cu_da_dung.includes('ghi_giao_dich'), rv.cong_cu_da_dung.join(','));
ok('kết quả rà soát tới được người dùng', get("SELECT COUNT(*) n FROM chat_messages WHERE intent='ai_review'").n === 1);
ok('xem lại được lần rà soát gần nhất', !!lastReview()?.noi_dung);

console.log('\n— 7. Chế độ cho phép hành động —');
setReviewConfig({ che_do: 'act' });
scenario = [
  { tool_calls: [tc('tao_quy', { ten: 'Khẩn cấp Auto', muc_tieu: 6000, dong_tien: 'EUR' })] },
  { content: 'Mình đã mở quỹ khẩn cấp cho bạn.' },
];
const rv2 = await runReview({ force: true });
ok('được phép chỉnh khi người dùng cho phép', !!get("SELECT 1 FROM funds WHERE name='Khẩn cấp Auto'"));
ok('nhật ký phân biệt việc tự làm với việc do người dùng nhờ', listActions({ limit: 1 })[0]?.nguon === 'review');
ok('việc AI tự làm cũng hoàn tác được', undoBatch(rv2.batch).ok && !get("SELECT 1 FROM funds WHERE name='Khẩn cấp Auto'"));

console.log('\n— 8. Tắt và giới hạn tần suất —');
setReviewConfig({ che_do: 'off' });
ok('tắt thì không chạy', await runReview() === null);
setReviewConfig({ che_do: 'suggest', moi_bao_nhieu_gio: 24 });
scenario = [{ content: 'ok' }];
await runReview({ force: true });
scenario = [{ content: 'lần hai' }];
ok('chưa tới hạn thì không chạy lại', await runReview() === null);
ok('tần suất bị kẹp trong khoảng hợp lý', setReviewConfig({ moi_bao_nhieu_gio: 99999 }).moi_bao_nhieu_gio === 720);

console.log('\n— 9. Nhật ký không phình mãi —');
const tong = get('SELECT COUNT(*) n FROM ai_actions').n;
run("UPDATE ai_actions SET created_at = datetime('now','-200 days') WHERE id <= 2");
const pr = pruneActions(90);
ok('dọn được bản ghi cũ', pr.xoa === 2, JSON.stringify(pr));
ok('bản ghi mới vẫn còn', get('SELECT COUNT(*) n FROM ai_actions').n === tong - 2);
ok('chi tiết thay đổi cũng được dọn theo', get('SELECT COUNT(*) n FROM ai_changes WHERE action_id <= 2').n === 0);
ok('thống kê tính được', actionStats().tong > 0);

console.log(`\nKết quả: ${pass} đạt / ${fail} lỗi`);
if (bad.length) console.log('Cần sửa:', [...new Set(bad)].join(', '));
srv.close();
process.exit(fail ? 1 : 0);
