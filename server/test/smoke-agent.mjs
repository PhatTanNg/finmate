/**
 * Kiểm chứng vòng lặp AI agent bằng một LLM giả lập.
 * Mục đích: chứng minh agent gọi đúng tool, ghi đúng dữ liệu và trả lời được,
 * mà không cần API key thật.
 */
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = fileURLToPath(new URL('./.tmp-agent.db', import.meta.url));
if (existsSync(DB)) rmSync(DB);

// --- LLM giả: đọc lượt cuối rồi phát ra kịch bản tool-calling định sẵn ---
let scenario = [];
let seen = [];
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    seen.push(payload);
    const step = scenario.shift() || { content: 'Xong rồi bạn nhé.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.content ?? null, tool_calls: step.tool_calls } }] }));
  });
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

process.env.FINMATE_DB = DB;
process.env.FINMATE_LLM_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
process.env.FINMATE_LLM_KEY = 'test-key';
process.env.FINMATE_LLM_MODEL = 'mock';

const { bootstrap } = await import('../src/bootstrap.js');
bootstrap();
const { chat } = await import('../src/services/chat/index.js');
const { agentEnabled } = await import('../src/services/chat/agent.js');
const { get, all } = await import('../src/db.js');

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${extra}`); }
};
const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

console.log(`\nagentEnabled = ${agentEnabled()}`);
ok('agent bật khi có LLM key', agentEnabled());

console.log('\n— Onboarding: agent ghi hồ sơ + tài khoản + nguồn thu trong một lượt —');
seen = [];
scenario = [
  { tool_calls: [
    tc('c1', 'cap_nhat_ho_so', { ten: 'Tân', nam_sinh: 1997, thanh_pho: 'Dublin' }),
    tc('c2', 'tao_tai_khoan', { ten: 'AIB Current', loai: 'bank', so_du: 4200, dong_tien: 'EUR' }),
    tc('c3', 'them_nguon_thu', { ten: 'Lương chính', loai: 'salary', so_tien: 5200, dong_tien: 'EUR', ngay_nhan: 25 }),
  ] },
  { content: 'Rõ rồi Tân! Mình đã lưu tài khoản AIB **€4.200** và lương **€5.200**/tháng. Bạn có khoản nợ nào không?' },
];
let r = await chat('Mình tên Tân, sinh 1997, đang sống ở Dublin. Lương 5200 euro/tháng nhận ngày 25, tài khoản AIB đang có 4200 euro.');
ok('trả lời tự nhiên, không phải câu mẫu', /Tân/.test(r.reply) && r.reply.includes('4.200'));
ok('đánh dấu intent = onboarding', r.intent === 'onboarding' && r.onboarding === true, JSON.stringify({ i: r.intent, o: r.onboarding }));
ok('báo frontend cần refresh', r.refresh === true);
ok('ghi nhận 3 tool đã gọi', r.tools?.length === 3, JSON.stringify(r.tools));
ok('hồ sơ đã vào DB', get('SELECT name FROM profile WHERE id=1')?.name === 'Tân');
ok('tài khoản EUR đã vào DB', all("SELECT * FROM accounts WHERE name='AIB Current'")[0]?.balance === 420000);
ok('nguồn thu đã vào DB', all('SELECT * FROM income_streams')[0]?.net_amount === 520000);
ok('prompt onboarding được dùng', /vừa mở app lần đầu/.test(seen[0].messages[0].content));
ok('gửi kèm danh sách tool', Array.isArray(seen[0].tools) && seen[0].tools.length > 30);
ok('kết quả tool được đưa lại cho model', seen[1].messages.some((m) => m.role === 'tool'));

console.log('\n— Onboarding kết thúc bằng hoan_tat_thiet_lap —');
scenario = [
  { tool_calls: [tc('c4', 'hoan_tat_thiet_lap', {})] },
  { content: 'Xong! Tài sản của bạn đang là **€4.200**. Việc nên làm ngay: dựng quỹ khẩn cấp 3 tháng chi phí.' },
];
r = await chat('Vậy là đủ rồi');
ok('profile.onboarded bật', get('SELECT onboarded FROM profile WHERE id=1')?.onboarded === 1);
ok('trả cờ onboarded cho frontend', r.onboarded === true);
ok('thoát chế độ onboarding', r.onboarding === false || r.onboarding === undefined, JSON.stringify(r.onboarding));

console.log('\n— Chat thường: agent tra cứu rồi mới trả lời —');
seen = [];
scenario = [
  { tool_calls: [tc('c5', 'xem_chi_tieu', {}), tc('c6', 'xem_tai_san', {})] },
  { content: 'Tháng này bạn tiêu **€0**. Tài sản ròng **€4.200**. Ổn, nhưng quỹ khẩn cấp còn mỏng.' },
];
r = await chat('Tình hình tài chính của mình sao rồi?');
ok('dùng prompt thường', /TÌNH HÌNH HIỆN TẠI/.test(seen[0].messages[0].content));
ok('intent = agent', r.intent === 'agent');
ok('tool tra cứu không bắt refresh', r.refresh === false || r.refresh === undefined, JSON.stringify(r.refresh));
ok('có quick replies', Array.isArray(r.quick) && r.quick.length > 0);
ok('lịch sử hội thoại được truyền vào', seen[0].messages.filter((m) => m.role === 'user').length > 1);

console.log('\n— Agent ghi giao dịch từ câu nói đời thường —');
scenario = [
  { tool_calls: [tc('c7', 'ghi_giao_dich', { so_tien: 12.5, loai: 'expense', mo_ta: 'cà phê' })] },
  { content: 'Đã ghi **€12,5** cho cà phê ☕' },
];
r = await chat('vừa uống cà phê hết 12.5 euro');
ok('giao dịch vào DB', all("SELECT * FROM transactions WHERE note LIKE '%cà phê%'").length === 1);
ok('bắt frontend refresh', r.refresh === true);

console.log('\n— Model trả tên tham số sai vẫn ghi đúng (nhờ alias) —');
scenario = [
  { tool_calls: [tc('c8', 'capnhat_so_du', { tai_khoan: 'AIB', so_du_moi: 5000 })] },
  { content: 'Đã cập nhật số dư AIB thành **€5.000**.' },
];
await chat('AIB giờ còn 5000 euro');
ok('alias so_du_moi -> so_du', get("SELECT balance FROM accounts WHERE name='AIB Current'")?.balance === 500000);

console.log('\n— Tool lỗi: agent nhận error và tự sửa ở vòng sau —');
scenario = [
  { tool_calls: [tc('c9', 'dat_ngan_sach', { danh_muc: 'Không tồn tại', so_tien: 100 })] },
  { tool_calls: [tc('c10', 'dat_ngan_sach', { danh_muc: 'Ăn uống', so_tien: 400, dong_tien: 'EUR' })] },
  { content: 'Mình đặt hạn mức **€400**/tháng cho Ăn uống nhé.' },
];
r = await chat('đặt ngân sách ăn uống 400 euro');
ok('vòng 2 sửa được lỗi', all('SELECT * FROM budgets').length === 1, JSON.stringify(all('SELECT * FROM budgets')));
ok('ghi lại cả 2 lần gọi', r.tools?.length === 2, JSON.stringify(r.tools));

console.log('\n— Agent nhìn thấy đủ tài nguyên để điều phối —');
seen = [];
scenario = [{ content: 'Ừ mình nắm rồi.' }];
await chat('tình hình quỹ thế nào');
const sys = seen[0].messages[0].content;
const bf = JSON.parse(sys.match(/\{[\s\S]*\}/)[0]);

ok('thấy danh sách quỹ kèm % và ưu tiên', Array.isArray(bf.cac_quy) && bf.cac_quy.length > 0
  && bf.cac_quy[0].ten && bf.cac_quy[0].phan_tram != null && bf.cac_quy[0].uu_tien != null, JSON.stringify(bf.cac_quy?.[0]));
const tongThat = all('SELECT percent FROM funds WHERE archived=0').reduce((s, f) => s + (f.percent || 0), 0);
ok('tổng % khớp với DB', bf.tong_phan_tram_quy === tongThat, `brief=${bf.tong_phan_tram_quy} db=${tongThat}`);
ok('biết phân bổ có cân bằng hay không', typeof bf.phan_bo_can_bang === 'boolean');
ok('thấy số dư từng ví, không chỉ tên', Array.isArray(bf.vi_va_so_du) && bf.vi_va_so_du.every((v) => typeof v.so_du === 'number'), JSON.stringify(bf.vi_va_so_du?.[0]));
ok('thấy ngân sách kèm tên danh mục', !bf.ngan_sach?.length || bf.ngan_sach.every((b) => typeof b.danh_muc === 'string'), JSON.stringify(bf.ngan_sach?.[0]));
ok('thấy danh mục đầu tư', bf.dau_tu === null || typeof bf.dau_tu.gia_tri === 'number', JSON.stringify(bf.dau_tu));
ok('prompt dạy cách xử lý khi phân bổ lệch', /phan_bo_can_bang/.test(sys) && /can_moi_thang/.test(sys));

// Số liệu sai tên field lọt vào prompt sẽ thành "undefined" — tức là nói dối agent.
const undef = JSON.stringify(bf).match(/"[a-z_]+":undefined/g);
ok('không có trường undefined lọt vào prompt', !undef, JSON.stringify(undef));

console.log('\n— Trường gõ sai tên không bị nuốt im lặng —');
const hs = await import('../src/services/chat/tools.js').then((m) => m.runTool('cap_nhat_ho_so', { ten: 'Tân', nuoc_tinh_thue: 'IE', truong_bia_dat: 1 }));
ok('alias nuoc_tinh_thue -> quoc_gia_thue có tác dụng', get('SELECT tax_country FROM profile WHERE id=1')?.tax_country === 'IE', JSON.stringify(hs));
ok('trường lạ được báo lại, không im lặng', /truong_bia_dat/.test(hs.canh_bao || ''), JSON.stringify(hs.canh_bao));


const old = srv.listeners('request')[0];
srv.removeAllListeners('request');
srv.on('request', (req, res) => { res.writeHead(500); res.end('boom'); });
r = await chat('tháng này tiêu bao nhiêu');
ok('vẫn trả lời được bằng bộ luật', typeof r.reply === 'string' && r.reply.length > 10, JSON.stringify(r).slice(0, 200));
ok('không phải intent agent', r.intent !== 'agent', r.intent);
srv.removeAllListeners('request');
srv.on('request', old);

console.log(`\nKết quả: ${pass} đạt / ${fail} lỗi`);
srv.close();
process.exit(fail ? 1 : 0);
