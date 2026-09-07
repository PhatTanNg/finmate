/**
 * Hàng chờ ghi và kho đệm đọc phải biết mình thuộc SỔ NÀO.
 *
 * Từ khi một người mở được nhiều sổ (sổ riêng + sổ chung của nhà), hai chỗ
 * này thành hai đường rò dữ liệu tài chính — và cả hai đều rò trong im lặng:
 *
 *  1. GHI NHẦM SỔ. Ghi một khoản ngoài chợ vào sổ NHÀ lúc mất mạng, về nhà
 *     đổi sang sổ RIÊNG rồi mới có sóng. Việc trong hàng chờ không tự khai sổ
 *     của nó thì khoản đó rơi vào sổ riêng. Không lỗi, không cảnh báo, chỉ có
 *     số dư sai mà phải đối chiếu tay mới ra.
 *  2. ĐỌC NHẦM SỔ. Kho đệm khoá theo đường dẫn thôi thì mở /transactions ở sổ
 *     nhà, đổi về sổ riêng, mất mạng — và giao dịch cả nhà hiện ra như sổ
 *     riêng. Chiều ngược lại tệ hơn: khoản riêng tư hiện giữa màn hình sổ
 *     chung, ngay trước mặt người nhà.
 *
 * Chạy được bằng Node vì queue.js chỉ đụng localStorage — dựng một cái giả là
 * đủ, không cần trình duyệt.
 */
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); } };
const head = (t) => console.log(`\n${t}`);

const kho = new Map();
globalThis.localStorage = {
  getItem: (k) => (kho.has(k) ? kho.get(k) : null),
  setItem: (k, v) => kho.set(k, String(v)),
  removeItem: (k) => kho.delete(k),
};

const q = await import('../src/lib/queue.js');

head('Mỗi việc mang theo sổ của nó');
{
  q.boHet();
  q.datChu('nam@example.com');

  q.datSo('g3');                                   // đang mở sổ nhà, mất mạng
  const nha = q.xepHang('POST', '/transactions', { merchant: 'rau ngoài chợ', amount: 88000 });
  ok('việc ghi lúc ở sổ nhà mang khoá sổ nhà', nha.so === 'g3', String(nha.so));

  q.datSo('u7');                                   // về nhà, đổi sang sổ riêng
  const rieng = q.xepHang('POST', '/transactions', { merchant: 'cà phê', amount: 30000 });
  ok('việc ghi lúc ở sổ riêng mang khoá sổ riêng', rieng.so === 'u7', String(rieng.so));
  ok('việc cũ KHÔNG bị đổi sổ theo', q.danhSach().find((v) => v.id === nha.id).so === 'g3');
}

head('Đếm việc chờ theo sổ đang mở, nhưng không giấu mất việc của sổ khác');
{
  ok('đang ở sổ riêng thì chỉ đếm việc của sổ riêng', q.soViec() === 1, String(q.soViec()));
  ok('vẫn đếm được tổng của mọi sổ', q.soViecTatCa() === 2, String(q.soViecTatCa()));
  q.datSo('g3');
  ok('đổi sang sổ nhà thì đếm việc của sổ nhà', q.soViec() === 1, String(q.soViec()));
}

head('Gửi hàng chờ: việc của MỌI sổ đều được gửi, mỗi việc về đúng sổ của nó');
{
  // Cố ý gửi trong lúc đang mở sổ nhà. Việc của sổ riêng vẫn phải được gửi —
  // bắt phải mở đúng sổ mới gửi được thì một khoản có thể kẹt hàng tuần chỉ
  // vì người ta đang dùng sổ kia.
  q.datSo('g3');
  const daGui = [];
  const r = await q.guiHangCho(async (v) => { daGui.push({ path: v.path, so: v.so, body: v.body }); });
  ok('gửi hết cả hai việc', r.gui === 2, JSON.stringify(r));
  ok('việc ngoài chợ đi kèm sổ nhà', daGui.find((v) => v.body.merchant === 'rau ngoài chợ')?.so === 'g3');
  ok('việc cà phê đi kèm sổ riêng', daGui.find((v) => v.body.merchant === 'cà phê')?.so === 'u7');
  ok('hàng chờ sạch sau khi gửi xong', q.danhSach().length === 0);
}

head('Bấm lưu hai lần: chỉ tính là một việc — nhưng chỉ trong cùng một sổ');
{
  q.boHet();
  q.datSo('g3');
  const a = q.xepHang('POST', '/transactions', { merchant: 'bánh mì', amount: 45000 });
  const b = q.xepHang('POST', '/transactions', { merchant: 'bánh mì', amount: 45000 });
  ok('bấm lưu hai lần trong cùng một sổ chỉ xếp một việc', a.id === b.id && q.danhSach().length === 1);

  // Cùng nội dung nhưng sang sổ khác là chuyện KHÁC: vợ chồng đi cùng nhau,
  // mỗi người ghi phần mình vào sổ của mình, số tiền trùng nhau là bình thường.
  q.datSo('u7');
  const c = q.xepHang('POST', '/transactions', { merchant: 'bánh mì', amount: 45000 });
  ok('cùng nội dung nhưng khác sổ thì là hai việc thật', c.id !== a.id && q.danhSach().length === 2);
}

head('Việc của tài khoản khác không bị gửi nhầm');
{
  q.boHet();
  q.datChu('nam@example.com'); q.datSo('g3');
  q.xepHang('POST', '/transactions', { merchant: 'của Nam', amount: 1000 });
  q.datChu('thu@example.com');
  const daGui = [];
  await q.guiHangCho(async (v) => { daGui.push(v); });
  ok('người khác đăng nhập thì việc của Nam nằm yên', daGui.length === 0 && q.danhSach().length === 1);
  q.datChu('nam@example.com');
  await q.guiHangCho(async (v) => { daGui.push(v); });
  ok('đúng người quay lại thì gửi được', daGui.length === 1 && q.danhSach().length === 0);
}

head('Kho đệm đọc: khoá mang theo sổ nên hai sổ không lẫn vào nhau');
{
  q.datSo('g3');
  const khoaNha = q.khoaKho('/transactions');
  q.datSo('u7');
  const khoaRieng = q.khoaKho('/transactions');
  ok('cùng một trang, hai sổ, hai khoá khác nhau', khoaNha !== khoaRieng, `${khoaNha} vs ${khoaRieng}`);
  ok('khoá có mang tên sổ', khoaNha.includes('g3') && khoaRieng.includes('u7'));
  q.datSo(null);
  ok('chưa đăng nhập sổ nào thì vẫn ra một khoá dùng được', typeof q.khoaKho('/x') === 'string' && q.khoaKho('/x').length > 1);
}

console.log(`\n${fail ? '❌' : '✅'} queue: ${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
