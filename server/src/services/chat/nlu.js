/** Nhận diện ý định & bóc tách thực thể từ câu tiếng Việt tự nhiên. */
import { all, get } from '../../db.js';
import { norm, findAmounts, parseAmount, parseDate, parseRange, parsePercent, scoreKeywords } from '../../util/vi.js';
import { today } from '../../util/date.js';

const QUESTION_HINTS = ['bao nhieu', 'the nao', 'khi nao', 'bao gio', 'co nen', 'nen khong', 'lam sao', 'tai sao', 'co du', '?', 'la gi', 'ra sao', 'hay khong', 'duoc khong', 'tinh hinh', 'cho minh xem', 'xem '];

export function extractEntities(text) {
  const n = norm(text);
  const amounts = findAmounts(text).filter((a) => a.value > 0);
  const main = amounts.length ? [...amounts].sort((a, b) => b.value - a.value)[0] : null;
  const percent = parsePercent(text);
  const range = parseRange(text);
  const date = parseDate(text);

  // thời hạn: "trong 5 năm", "sau 18 thang", "2 nam nua"
  let horizonMonths = null;
  const my = n.match(/(\d{1,3})\s*(nam|năm)/);
  const mm = n.match(/(\d{1,3})\s*(thang|tháng)/);
  if (my) horizonMonths = Number(my[1]) * 12;
  else if (mm && !/thang (1|2|3|4|5|6|7|8|9|10|11|12)\b/.test(n)) horizonMonths = Number(mm[1]);

  const accounts = all('SELECT id, name, type, institution FROM accounts WHERE is_active = 1');
  const account = accounts.find((a) => n.includes(norm(a.name)) || (a.institution && n.includes(norm(a.institution))));

  const funds = all('SELECT id, name, type FROM funds');
  const fund = funds.find((f) => n.includes(norm(f.name)));

  const cats = all('SELECT id, name, kind, keywords, icon FROM categories');
  let category = null;
  let best = 0;
  for (const c of cats) {
    const kws = [c.name, ...(c.keywords || '').split(',')].map((s) => s.trim()).filter(Boolean);
    const s = scoreKeywords(text, kws);
    if (s > best) { best = s; category = c; }
  }

  const symbol = (text.match(/\b([A-Z]{3})\b/g) || []).find((s) => !['VND', 'USD', 'ATM', 'GDP', 'CEO'].includes(s));

  return { amounts, amount: main ? main.value : null, amount_confidence: main ? main.confidence : 0, percent, date, range, horizonMonths, account, fund, category, category_score: best, symbol };
}

/**
 * Bộ luật ưu tiên: duyệt từ trên xuống, luật đầu tiên khớp sẽ thắng.
 * Ổn định hơn chấm điểm vì câu tiếng Việt hay chứa cả số tiền lẫn từ khoá truy vấn.
 */
const has = (n, ...ws) => ws.some((w) => n.includes(w));
const POSSESSIVE = ['cua minh', 'cua toi', 'cua em', 'hien tai', 'dang the nao', 'ra sao', 'tien do'];

const RULES = [
  // --- thao tác đặc biệt ---
  { intent: 'undo', w: 9, t: (n) => has(n, 'undo', 'xoa giao dich', 'huy giao dich', 'nham roi', 'ghi nham', 'bo giao dich', 'xoa cai vua') },
  { intent: 'help', w: 9, t: (n) => has(n, 'lam duoc gi', 'giup duoc gi', 'huong dan', 'cach dung', 'ban co the lam', 'chuc nang', 'help', 'menu') || ['giup toi', 'giup minh', 'giup em', 'help me'].includes(n) },
  { intent: 'greeting', w: 9, t: (n, e) => !e.amount && n.length <= 28 && has(n, 'xin chao', 'chao ban', 'chao buoi', 'hello', 'hey', 'alo', 'chao app', 'chao') },
  { intent: 'set_price', w: 9, t: (n, e) => e.symbol && e.amount && has(n, 'gia ', 'gia la', 'update gia', 'cap nhat gia') && !has(n, 'mua ', 'ban ', 'co phieu', 'chung khoan', ' cp ') },
  { intent: 'update_profile', w: 8, t: (n) => has(n, 'minh ten', 'toi ten', 'goi minh la', 'minh sinh nam', 'toi sinh nam', 'minh nam nay', 'khau vi rui ro cua minh') },

  // --- lệnh cấu hình (phải đứng trước ghi giao dịch) ---
  { intent: 'set_allocation', w: 8, t: (n, e) => has(n, 'chia quy', 'chia thu nhap', 'phan bo thu nhap', 'phan bo luong', 'ty le quy', 'ti le quy', 'doi ty le', 'chia luong') || (e.percent != null && has(n, 'quy ', 'thiet yeu', 'tu do tai chinh', 'huong thu', 'khan cap')) },
  { intent: 'create_budget', w: 8, t: (n, e) => e.amount && has(n, 'ngan sach', 'gioi han chi', 'chi toi da', 'budget') && has(n, 'dat', 'tao', 'set', 'them', 'gioi han', 'toi da', 'chi cho') },
  { intent: 'query_budget', w: 7, t: (n) => has(n, 'ngan sach', 'budget') },
  { intent: 'create_goal', w: 8, t: (n, e) => (has(n, 'tao muc tieu', 'dat muc tieu', 'them muc tieu', 'lap muc tieu', 'muc tieu moi') || (e.amount && has(n, 'muon mua', 'muon tiet kiem', 'du dinh mua', 'len ke hoach mua', 'muon co', 'muon di du lich', 'de dum', 'tiet kiem de'))) && !has(n, ...POSSESSIVE) },
  { intent: 'query_goal', w: 7, t: (n) => has(n, 'muc tieu', 'tien do', 'goal') },
  { intent: 'add_account', w: 8, t: (n, e) => e.amount && has(n, 'them tai khoan', 'tao tai khoan', 'mo tai khoan', 'them vi', 'them the', 'them so tiet kiem', 'khai bao tai khoan', 'cap nhat so du', 'tai khoan moi') },
  { intent: 'add_income_stream', w: 8, t: (n, e) => has(n, 'them nguon thu', 'khai bao nguon thu', 'nguon thu moi', 'them thu nhap') || (e.amount && has(n, 'moi thang', 'hang thang', 'mot thang', '/thang') && has(n, 'luong', 'day hoc', 'freelance', 'cho thue', 'lam them', 'part time', 'kiem duoc', 'thu nhap', 'nguon thu')) },
  { intent: 'add_debt', w: 8, t: (n, e) => e.amount && has(n, 'them no', 'khai bao no', 'dang vay', 'minh vay', 'toi vay', 'khoan vay', 'vay ngan hang', 'tra gop', 'vay ban', 'no the', 'them khoan no') && !has(n, 'bao gio', 'khi nao', 'ke hoach', 'tinh hinh') },
  { intent: 'add_holding', w: 8, t: (n, e) => has(n, 'co phieu', 'chung khoan', 'chung chi quy', ' cp ', 'ma ck') && has(n, 'mua', 'ban ', 'dang giu', 'so huu', 'them') && (e.symbol || e.amount) },
  { intent: 'add_recurring', w: 7, t: (n, e) => e.amount && has(n, 'hang thang', 'moi thang', 'dinh ky', 'hang tuan', 'moi tuan', 'hang nam', 'moi ngay', 'hang ngay', 'thue bao', 'subscription') },

  // --- tư vấn ---
  { intent: 'affordability', w: 8, t: (n) => has(n, 'co nen mua', 'nen mua khong', 'mua duoc khong', 'co du tien mua', 'co nen chi', 'co kham noi', 'co nen sam', 'du tien mua', 'co nen dau tu vao') },
  { intent: 'surplus_advice', w: 8, t: (n) => has(n, 'nen lam gi', 'lam gi voi', 'dau tu vao dau', 'nen dau tu gi', 'tien nhan roi', 'nhan roi', 'xai tien sao', 'tieu vao dau', 'dung tien sao', 'du tien', 'con du', 'dang du', 'tien du', 'thua tien', 'tien thua', 'toi du', 'minh du') },
  { intent: 'summary', w: 7, t: (n) => has(n, 'tinh hinh tai chinh', 'tong quan', 'suc khoe tai chinh', 'review tai chinh', 'bao cao tong the', 'diem tai chinh', 'tom tat', 'summary', 'tinh hinh cua minh') },

  // --- truy vấn ---
  { intent: 'query_fire', w: 7, t: (n) => has(n, 'tu do tai chinh', 'nghi huu', 'fire', 'bao gio giau', 'khi nao du tien nghi', 'retire', 'khong can lam viec') },
  { intent: 'query_networth', w: 7, t: (n) => has(n, 'tai san rong', 'net worth', 'tong tai san', 'tat ca tai san', 'giau co nao') },
  { intent: 'query_debt', w: 7, t: (n) => has(n, 'bao gio het no', 'no bao nhieu', 'tra no', 'khi nao tra xong', 'ke hoach tra no', 'tinh hinh no', 'du no', 'con no', 'khoan no') },
  { intent: 'query_investment', w: 7, t: (n) => has(n, 'danh muc dau tu', 'danh muc', 'portfolio', 'co phieu cua', 'lai lo', 'dang lai bao nhieu', 'co phieu', 'chung khoan') },
  { intent: 'query_income', w: 7, t: (n) => has(n, 'thu nhap bao nhieu', 'kiem duoc bao nhieu', 'tong thu nhap', 'nguon thu', 'thu nhap cua', 'thu nhap thang', 'luong cua minh', 'luong cua toi', 'thu nhap') },
  { intent: 'query_forecast', w: 7, t: (n) => has(n, 'du bao', 'thang sau', 'sap toi co du', 'co du tien khong', 'het tien khi nao', 'dong tien', 'cash flow', 'thang toi') },
  { intent: 'query_spending', w: 7, t: (n) => has(n, 'tieu bao nhieu', 'chi bao nhieu', 'da xai', 'chi tieu', 'ton nhieu nhat', 'tieu gi nhieu', 'thong ke chi', 'chi nhieu vao dau', 'xai het bao nhieu', 'tieu het bao nhieu', 'da tieu') },
  { intent: 'query_balance', w: 7, t: (n) => has(n, 'con bao nhieu tien', 'so du', 'con nhieu tien khong', 'trong tai khoan', 'tien con lai', 'con xai duoc bao nhieu', 'tieu duoc bao nhieu', 'con bao nhieu') },
];

const TX_EXPENSE_HINTS = ['mua', 'an ', 'an sang', 'an trua', 'an toi', 'uong', 'do xang', 'tra tien', 'thanh toan', 'chi ', 'tieu ', 'ca phe', 'com ', 'grab', 'ship', 've ', 'sam', 'nap tien', 'hoa don', 'vua tra', 'dong tien', 'tra phi'];

export function detectIntent(text) {
  const n = norm(text);
  const ent = extractEntities(text);
  const isQuestion = QUESTION_HINTS.some((q) => n.includes(q)) || text.trim().endsWith('?');

  for (const r of RULES) {
    try {
      if (r.t(n, ent, isQuestion)) return { intent: r.intent, score: r.w, entities: ent, is_question: isQuestion };
    } catch {}
  }

  // Không khớp luật nào -> có thể là ghi nhận giao dịch
  if (ent.amount && !isQuestion) {
    const transferHint = /chuyen|nap vao|rut tien|gui tiet kiem|bo vao quy|dua vao quy|sang tai khoan|sang vi/.test(n);
    const incomeHint = /nhan luong|nhan tien|duoc tra|duoc thuong|thuong tet|thu duoc|ban duoc|co tuc|lai ngan hang|tien ve|tien thue nha|hoan tien|luong ve|nhan duoc|khach tra/.test(n);
    if (transferHint) return { intent: 'add_transfer', score: 5, entities: ent, is_question: isQuestion };
    if (incomeHint) return { intent: 'add_income', score: 5, entities: ent, is_question: isQuestion };
    // chỉ ghi chi khi thực sự có dấu hiệu tiêu tiền hoặc nhận ra danh mục rõ ràng
    if (has(n, ...TX_EXPENSE_HINTS) || ent.category_score >= 2) {
      return { intent: 'add_expense', score: 4, entities: ent, is_question: isQuestion };
    }
  }
  return { intent: 'unknown', score: 0, entities: ent, is_question: isQuestion };
}

/** Tách câu liệt kê nhiều mục: "VCB 50 triệu, Momo 2 triệu và tiết kiệm 300 triệu" */
export function splitItems(text) {
  return String(text)
    .split(/[,;\n]|\s+va\s+|\s+và\s+|\s+\+\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** Bóc "tên + số tiền" cho từng mục (dùng khi khai báo tài khoản, chi phí cố định). */
export function parseNamedAmounts(text) {
  return splitItems(text)
    .map((part) => {
      const a = parseAmount(part);
      if (!a) return null;
      const name = part.replace(a.raw, '').replace(/[:\-–]/g, ' ').replace(/\b(co|con|la|khoang|tam|gan|o|trong|tai|moi thang|hang thang|\/thang)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      return { name: name || 'Khoản', amount: a.value, raw: part };
    })
    .filter(Boolean);
}
