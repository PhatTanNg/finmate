/** Kiểm tra chatbot trả lời được câu hỏi kiến thức tài chính mở. */
const Q = [
  'lạm phát ảnh hưởng gì tới kế hoạch của tôi',
  'lãi kép là gì',
  'có nên giữ vàng không',
  'crypto có phù hợp với mình không',
  'mình nên mua nhà hay tiếp tục thuê',
  'nên mua bảo hiểm gì',
  'gửi tiết kiệm hay đầu tư thì hơn',
  'có nên trả nợ trước hạn không',
  'dùng thẻ tín dụng sao cho có lợi',
  'chứng chỉ quỹ ETF có hợp với mình không',
  'quy tắc 50/30/20 áp dụng thế nào',
  'làm sao tăng thu nhập',
  'thị trường giảm mạnh thì nên làm gì',
  'chuẩn bị tài chính cho con thế nào',
  'nghỉ hưu sớm cần bao nhiêu tiền',
  'quỹ khẩn cấp bao nhiêu là đủ',
  'thuế thu nhập cá nhân tính thế nào',
  'có nên cho bạn vay tiền không',
  'mình có nên tự thưởng đi du lịch không',
];

const post = async (message) => {
  const r = await fetch('http://localhost:4000/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
  return r.json();
};

let weak = 0;
for (const q of Q) {
  const d = await post(q);
  const reply = d.reply || '';
  const bad = /chưa chắc hiểu ý bạn|Bạn muốn hỏi gì/.test(reply);
  const thin = reply.length < 220;
  const flag = bad ? '❌' : thin ? '⚠️' : '✅';
  if (bad || thin) weak++;
  console.log(`${flag} ${q}\n   → ${reply.replace(/\n/g, ' ').slice(0, 130)}`);
}
console.log(weak ? `\n${weak}/${Q.length} câu trả lời yếu.` : `\n🎉 ${Q.length}/${Q.length} câu hỏi mở đều được trả lời có chiều sâu.`);
process.exit(weak ? 1 : 0);
