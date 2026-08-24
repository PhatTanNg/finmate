/** Khởi tạo dữ liệu mặc định: hồ sơ, danh mục, quỹ (6 hũ tuỳ biến). */
import { db, get, run, insert, all } from './db.js';

export const DEFAULT_CATEGORIES = [
  // ----- CHI -----
  { name: 'Ăn uống', kind: 'expense', group_name: 'Sinh hoạt', icon: '🍜', essential: 1, keywords: 'an uong,com,pho,bun,tra sua,ca phe,cà phê,cafe,coffee,highlands,starbucks,phuc long,the coffee house,katinat,grabfood,shopeefood,baemin,nha hang,quan,an sang,an trua,an toi,do an,bakery,circle k,gs25,pizza,lau,nuong,buffet,tesco meal,boojum,camile,deliveroo,just eat,supermac,eddie rockets,centra,spar,bunsen,wagamama,chipotle,greggs,mcdonald,burger king,kfc,subway,dominos,nando' },
  { name: 'Đi chợ / Siêu thị', kind: 'expense', group_name: 'Sinh hoạt', icon: '🛒', essential: 1, keywords: 'sieu thi,bach hoa xanh,winmart,vinmart,coopmart,co.opmart,bigc,big c,lotte mart,aeon,go!,emart,di cho,thuc pham,rau cu,thit ca,ca tuoi,tesco,lidl,aldi,dunnes,supervalu,asia market,marks spencer,m&s food,grocery,fresh market' },
  { name: 'Di chuyển', kind: 'expense', group_name: 'Sinh hoạt', icon: '🛵', essential: 1, keywords: 'grab,gojek,be,xanh sm,taxi,mai linh,vinasun,xang,petrolimex,pvoil,gui xe,ve xe,bus,metro,do xe,rua xe,sua xe,bao duong xe,leap card,dublin bus,irish rail,luas,go-ahead,freenow,bolt,uber,aircoach,applegreen,maxol,transport for ireland,tfi' },
  { name: 'Nhà ở', kind: 'expense', group_name: 'Cố định', icon: '🏠', essential: 1, keywords: 'tien nha,thue nha,thue phong,chung cu,phi quan ly,quan ly chung cu,tro,rent,daft,landlord,management fee,property tax,lpt' },
  { name: 'Điện nước & Internet', kind: 'expense', group_name: 'Cố định', icon: '💡', essential: 1, keywords: 'tien dien,evn,tien nuoc,sawaco,cap nuoc,internet,wifi,fpt,vnpt,viettel telecom,truyen hinh,gas,electric ireland,esb,bord gais,sse airtricity,energia,virgin media,eir,sky ireland,pinergy,uisce,irish water' },
  { name: 'Điện thoại', kind: 'expense', group_name: 'Cố định', icon: '📱', essential: 1, keywords: 'dien thoai,nap the,topup,mobifone,vinaphone,viettel,vietnamobile,cuoc dt,three,48months,vodafone,gomo,tesco mobile,eir mobile,an post mobile' },
  { name: 'Mua sắm', kind: 'expense', group_name: 'Lối sống', icon: '🛍️', essential: 0, keywords: 'shopee,lazada,tiki,sendo,tiktok shop,uniqlo,zara,h&m,mua sam,quan ao,giay,dien may,thegioididong,fpt shop,cellphones,amazon,mall,penneys,primark,ikea,currys,harvey norman,argos,brown thomas,arnotts,dealz,tk maxx,decathlon,smyths' },
  { name: 'Sức khoẻ', kind: 'expense', group_name: 'Sinh hoạt', icon: '🩺', essential: 1, keywords: 'pharmacity,long chau,an khang,nha thuoc,thuoc,benh vien,phong kham,kham benh,nha khoa,rang,guardian,vitamin,xet nghiem,boots,hickeys,mccabes,lloyds pharmacy,vhi,laya,irish life health,gp visit,blackrock clinic,mater private,dentist' },
  { name: 'Giải trí', kind: 'expense', group_name: 'Lối sống', icon: '🎬', essential: 0, keywords: 'netflix,spotify,youtube premium,disney,cgv,lotte cinema,galaxy cinema,bhd,rap phim,game,steam,karaoke,bar,pub,bia,ruou,nhau,concert,ve xem,odeon,cineworld,omniplex,ticketmaster,eventbrite,3arena,aviva stadium,croke park,pub,guinness storehouse' },
  { name: 'Giáo dục & Phát triển', kind: 'expense', group_name: 'Đầu tư bản thân', icon: '📚', essential: 0, keywords: 'khoa hoc,hoc phi,udemy,coursera,sach,fahasa,nha sach,tieng anh,ielts,chatgpt,claude,notion,workshop,seminar,chung chi,trinity,ucd,dcu,dit,tud,springboard,skillnet' },
  { name: 'Thể thao & Gym', kind: 'expense', group_name: 'Đầu tư bản thân', icon: '🏋️', essential: 0, keywords: 'gym,california fitness,citigym,yoga,boi,pt,the thao,chay bo,cau long,tennis,pickleball,flyefit,ben dunne,icon health,westwood,swan leisure,parkrun' },
  { name: 'Du lịch', kind: 'expense', group_name: 'Lối sống', icon: '✈️', essential: 0, keywords: 'du lich,booking,agoda,traveloka,ve may bay,vietjet,vietnam airlines,bamboo,khach san,resort,homestay,tour,airbnb,ryanair,aer lingus,trainline,eurostar,hostelworld,expedia,skyscanner' },
  { name: 'Làm đẹp', kind: 'expense', group_name: 'Lối sống', icon: '💅', essential: 0, keywords: 'spa,salon,cat toc,lam toc,nail,my pham,hasaki,watson,skincare,massage,peter mark,toni guy,sostrene,penneys beauty' },
  { name: 'Quà tặng & Hiếu hỉ', kind: 'expense', group_name: 'Xã hội', icon: '🎁', essential: 0, keywords: 'qua,mung cuoi,phong bi,dam cuoi,sinh nhat,li xi,thoi noi,dam tang,hieu hi' },
  { name: 'Từ thiện', kind: 'expense', group_name: 'Xã hội', icon: '🤝', essential: 0, keywords: 'tu thien,quyen gop,ung ho,cuu tro,thien nguyen' },
  { name: 'Gia đình & Con cái', kind: 'expense', group_name: 'Cố định', icon: '👨‍👩‍👧', essential: 1, keywords: 'bieu bo me,gui gia dinh,sua,bim,ta,hoc phi con,giu tre,mam non,creche,childcare,gui tien ve nha,gui ve viet nam,bieu bo me' },
  { name: 'Bảo hiểm', kind: 'expense', group_name: 'Cố định', icon: '🛡️', essential: 1, keywords: 'bao hiem,prudential,manulife,aia,dai-ichi,generali,pvi,bhyt,bhxh,bao viet,vhi healthcare,laya healthcare,irish life,aviva insurance,axa ireland,allianz ireland,fbd' },
  { name: 'Thuế & Phí', kind: 'expense', group_name: 'Cố định', icon: '🧾', essential: 1, keywords: 'thue,tncn,le phi,phi truoc ba,phi dich vu,phi thuong nien,phi sms,phi chuyen khoan,phi duy tri,revenue,paye,usc,prsi,dirt,cgt,local property tax,tv licence' },
  { name: 'Trả nợ & Lãi vay', kind: 'expense', group_name: 'Cố định', icon: '🏦', essential: 1, keywords: 'tra no,tra gop,lai vay,goc vay,thanh toan the,sao ke the,khoan vay,credit union,an post loan,avant money,ptsb loan,mortgage' },
  { name: 'Thú cưng', kind: 'expense', group_name: 'Lối sống', icon: '🐾', essential: 0, keywords: 'thu cung,cho,meo,pet,thuc an cho,thu y' },
  { name: 'Chi khác', kind: 'expense', group_name: 'Khác', icon: '📦', essential: 0, keywords: '' },

  // ----- THU -----
  { name: 'Lương', kind: 'income', group_name: 'Thu nhập chủ động', icon: '💼', keywords: 'luong,salary,payroll,tra luong,thu nhap thang,wages,net pay,payslip,stripe payroll' },
  { name: 'Thưởng', kind: 'income', group_name: 'Thu nhập chủ động', icon: '🎉', keywords: 'thuong,bonus,thuong tet,luong thang 13,kpi,hoa hong' },
  { name: 'Freelance / Dự án', kind: 'income', group_name: 'Thu nhập chủ động', icon: '💻', keywords: 'freelance,du an,project,job ngoai,cong tac vien,upwork,fiverr' },
  { name: 'Kinh doanh', kind: 'income', group_name: 'Thu nhập chủ động', icon: '🏪', keywords: 'kinh doanh,ban hang,doanh thu,shop,cua hang' },
  { name: 'Cổ tức', kind: 'income', group_name: 'Thu nhập thụ động', icon: '📈', keywords: 'co tuc,dividend,tra co tuc,cp thuong' },
  { name: 'Lãi ngân hàng', kind: 'income', group_name: 'Thu nhập thụ động', icon: '🏦', keywords: 'lai tien gui,lai suat,tat toan,so tiet kiem,lai ngan hang,interest,savings interest,n26 interest,revolut savings' },
  { name: 'Cho thuê BĐS', kind: 'income', group_name: 'Thu nhập thụ động', icon: '🏡', keywords: 'tien thue nha,cho thue,tien tro,thue mat bang,thue can ho' },
  { name: 'Lãi vốn đầu tư', kind: 'income', group_name: 'Thu nhập thụ động', icon: '💹', keywords: 'ban co phieu,lai von,chot loi,capital gain,ban vang,crypto' },
  { name: 'Hoàn tiền', kind: 'income', group_name: 'Khác', icon: '↩️', keywords: 'hoan tien,refund,cashback,hoan phi,tra lai tien' },
  { name: 'Quà tặng nhận', kind: 'income', group_name: 'Khác', icon: '🧧', keywords: 'duoc tang,li xi,mung tuoi,qua tang' },
  { name: 'Thu khác', kind: 'income', group_name: 'Khác', icon: '➕', keywords: '' },
];

export const DEFAULT_FUNDS = [
  { name: 'Thiết yếu', type: 'necessity', percent: 50, priority: 1, spendable: 1, color: '#38bdf8', icon: '🏠', note: 'Chi phí bắt buộc: ăn ở, đi lại, hoá đơn, nợ tối thiểu.' },
  { name: 'Quỹ khẩn cấp', type: 'emergency', percent: 10, priority: 2, spendable: 0, color: '#f97316', icon: '🛟', note: 'Đệm an toàn 3-6 tháng chi phí. Chỉ dùng khi thật sự khẩn cấp.' },
  { name: 'Tự do tài chính', type: 'ltss', percent: 15, priority: 3, spendable: 0, color: '#22c55e', icon: '🌱', note: 'Không bao giờ tiêu. Chỉ đầu tư để sinh dòng tiền thụ động.' },
  { name: 'Mục tiêu lớn', type: 'goal', percent: 10, priority: 4, spendable: 0, color: '#a78bfa', icon: '🎯', note: 'Tích luỹ cho mua nhà/xe, cưới, du lịch dài ngày.' },
  { name: 'Phát triển bản thân', type: 'education', percent: 5, priority: 5, spendable: 1, color: '#eab308', icon: '📚', note: 'Khoá học, sách, sức khoẻ, kỹ năng.' },
  { name: 'Hưởng thụ', type: 'fun', percent: 8, priority: 6, spendable: 1, color: '#ec4899', icon: '🎈', note: 'Tiêu không cần thấy tội lỗi. Hết là hết.' },
  { name: 'Cho đi', type: 'giving', percent: 2, priority: 7, spendable: 1, color: '#14b8a6', icon: '🤝', note: 'Từ thiện, quà tặng, giúp đỡ người thân.' },
];

/** Ánh xạ quỹ mặc định theo nhóm danh mục chi */
export const CATEGORY_FUND_MAP = {
  'Ăn uống': 'Thiết yếu',
  'Đi chợ / Siêu thị': 'Thiết yếu',
  'Di chuyển': 'Thiết yếu',
  'Nhà ở': 'Thiết yếu',
  'Điện nước & Internet': 'Thiết yếu',
  'Điện thoại': 'Thiết yếu',
  'Sức khoẻ': 'Thiết yếu',
  'Bảo hiểm': 'Thiết yếu',
  'Thuế & Phí': 'Thiết yếu',
  'Trả nợ & Lãi vay': 'Thiết yếu',
  'Gia đình & Con cái': 'Thiết yếu',
  'Mua sắm': 'Hưởng thụ',
  'Giải trí': 'Hưởng thụ',
  'Du lịch': 'Hưởng thụ',
  'Làm đẹp': 'Hưởng thụ',
  'Thú cưng': 'Hưởng thụ',
  'Giáo dục & Phát triển': 'Phát triển bản thân',
  'Thể thao & Gym': 'Phát triển bản thân',
  'Từ thiện': 'Cho đi',
  'Quà tặng & Hiếu hỉ': 'Cho đi',
  'Chi khác': 'Thiết yếu',
};

export function bootstrap() {
  if (!get('SELECT id FROM profile WHERE id = 1')) {
    run('INSERT INTO profile (id, name) VALUES (1, ?)', ['Bạn']);
  }
  const catCount = get('SELECT COUNT(*) AS c FROM categories').c;
  if (!catCount) {
    for (const c of DEFAULT_CATEGORIES) {
      insert('categories', { ...c, essential: c.essential || 0, keywords: c.keywords || '' });
    }
  } else {
    syncKeywords();
  }
  const fundCount = get('SELECT COUNT(*) AS c FROM funds').c;
  if (!fundCount) {
    for (const f of DEFAULT_FUNDS) insert('funds', f);
  }
  if (!get('SELECT COUNT(*) AS c FROM accounts').c) {
    insert('accounts', { name: 'Tiền mặt', type: 'cash', balance: 0, icon: '👛', color: '#94a3b8', auto_sync: 'manual' });
  }
  return { ok: true };
}

/**
 * Tu khoa qua chung chung da bi go bo o cac ban truoc. Vi so khop theo tu,
 * 'ca' se dinh vao 'ca phe' va 'rau' dinh vao 'rau cau' -> phan loai sai.
 * Danh sach nay duoc xoa khoi moi danh muc khi khoi dong.
 */
const RETIRED_KEYWORDS = new Set(['ca', 'rau', 'thit', 'an', 'uong', 've']);

/**
 * Bo sung tu khoa moi cua ban cap nhat vao cac danh muc mac dinh da ton tai,
 * dong thoi go bo cac tu khoa qua chung chung cua ban cu.
 * Tu khoa nguoi dung tu dat van duoc giu nguyen.
 */
export function syncKeywords() {
  for (const def of DEFAULT_CATEGORIES) {
    if (!def.keywords) continue;
    const row = get('SELECT id, keywords FROM categories WHERE name = ? AND kind = ?', [def.name, def.kind]);
    if (!row) continue;
    const before = String(row.keywords || '');
    const have = new Set(before.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    for (const k of RETIRED_KEYWORDS) have.delete(k);
    for (const k of def.keywords.split(',')) {
      const t = k.trim().toLowerCase();
      if (t) have.add(t);
    }
    const after = [...have].join(',');
    if (after !== before) run('UPDATE categories SET keywords = ? WHERE id = ?', [after, row.id]);
  }
}

export function categoryByName(name, kind = 'expense') {
  return get('SELECT * FROM categories WHERE name = ? AND kind = ?', [name, kind]);
}

export function fundByName(name) {
  return get('SELECT * FROM funds WHERE name = ?', [name]);
}

export function defaultFundIdForCategory(categoryId) {
  if (!categoryId) return null;
  const cat = get('SELECT * FROM categories WHERE id = ?', [categoryId]);
  if (!cat) return null;
  const fundName = CATEGORY_FUND_MAP[cat.name];
  if (!fundName) return null;
  const f = fundByName(fundName);
  return f ? f.id : null;
}
