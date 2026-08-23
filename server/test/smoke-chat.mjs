const BASE = 'http://localhost:4000/api';
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

const msgs = [
  'chào bạn',
  'ăn trưa 65k ở cơm tấm',
  'nhận lương 31 triệu',
  'tháng này tôi tiêu bao nhiêu',
  'số dư của tôi',
  'tài sản ròng',
  'bao giờ tôi tự do tài chính',
  'dự báo dòng tiền',
  'tình hình nợ',
  'mục tiêu của tôi',
  'ngân sách thế nào',
  'danh mục đầu tư',
  'thu nhập của tôi',
  'tôi dư 200 triệu nên làm gì',
  'tôi có nên mua macbook 45 triệu không',
  'tạo mục tiêu mua xe 500 triệu trong 24 tháng',
  'đặt ngân sách ăn uống 5 triệu',
  'chia quỹ thiết yếu 45% tự do tài chính 20%',
  'thêm tài khoản ACB 20 triệu',
  'thêm nguồn thu dạy học 5 triệu mỗi tháng',
  'thêm nợ vay bạn 30 triệu lãi 0%',
  'mua 100 cổ phiếu VNM giá 62',
  'cà phê 45k mỗi ngày',
  'chuyển 5 triệu từ VCB sang tiết kiệm',
  'tóm tắt tài chính',
  'giá HPG 30',
  'undo',
  'giúp tôi',
  'lạm phát ảnh hưởng gì tới kế hoạch của tôi',
];

let fail = 0;
for (const m of msgs) {
  try {
    const r = await post('/chat', { message: m });
    const reply = (r.reply || r.error || '').replace(/\s+/g, ' ').slice(0, 110);
    const flag = r.ok === false || !r.reply ? 'FAIL' : r.intent === 'unknown' ? 'HUH ' : 'OK  ';
    if (flag !== 'OK  ') fail++;
    console.log(`${flag} [${(r.intent || '-').padEnd(16)}] ${m}\n      -> ${reply}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${m} :: ${e.message}`);
  }
}

console.log('\n--- ingest SMS ---');
const sms = [
  'VCB: 15/03/2025 12:34 TK 0071000123456 -350,000VND. So du: 42,150,000VND. ND: THANH TOAN GRABFOOD',
  'TK TCB 19036789456|GD: +31,200,000VND luc 05/03/2025|So du: 49,500,000VND|ND: ABC TECH TRA LUONG THANG 3',
  'MoMo: Ban da thanh toan 120,000d cho Highlands Coffee. So du vi: 2,030,000d',
];
for (const s of sms) {
  const r = await post('/ingest', { text: s });
  console.log(r.ok === false ? 'FAIL ' + r.error : `${r.status || 'ok'} :: ${JSON.stringify(r.transaction ? { amount: r.transaction.amount, type: r.transaction.type, cat: r.transaction.category_id } : r).slice(0, 160)}`);
}

console.log('\n--- CSV ---');
const csv = 'Ngay,Noi dung,So tien\n01/03/2025,Mua sam Shopee,-450000\n02/03/2025,Nhan tien ban hang,+1200000';
console.log(JSON.stringify(await post('/ingest/csv', { csv, dry_run: true })).slice(0, 300));

console.log('\n--- tax ---');
console.log(JSON.stringify(await post('/tax/pit', { gross: 38000000, dependents: 1 })).slice(0, 300));

console.log(`\nfail/huh: ${fail}/${msgs.length}`);
