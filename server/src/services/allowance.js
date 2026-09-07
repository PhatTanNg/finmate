/**
 * Tiền tiêu vặt: bố mẹ cấp tiền từ sổ nhà sang sổ riêng của con.
 *
 * Một lần cấp là HAI sự thật ở HAI cuốn sổ khác nhau:
 *   · sổ nhà   — một khoản CHI ("tiêu vặt cho Bé")
 *   · sổ con   — một khoản THU ("tiền tiêu vặt")
 *
 * Hai file SQLite riêng nên không có giao dịch chung nào ôm được cả hai. Cách
 * xử lý ở đây: ghi sổ con TRƯỚC, rồi mới ghi sổ nhà; sổ nhà hỏng thì xoá lại
 * khoản vừa ghi vào sổ con. Chọn thứ tự đó vì nếu có kẹt lại một nửa thì thà
 * kẹt ở phía "chưa trừ tiền nhà" còn hơn "đã trừ mà con không nhận được" —
 * tiền hụt bao giờ cũng khó chịu hơn tiền thừa. Và nếu cả bước xoá lại cũng
 * hỏng thì nói to lên chứ không nuốt: một cuốn sổ đang lệch.
 *
 * Định kỳ thì lịch nằm ở SỔ DANH BẠ chứ không phải trong sổ nào, vì nó là
 * quan hệ giữa hai cuốn sổ. Để trong sổ nhà thì tầng tự động hoá của sổ nhà
 * không với sang sổ con được, và ngược lại.
 */
import { withLedger } from './ledgers.js';
import { createTransaction, deleteTransaction } from './ledger.js';
import { get, all, insert } from '../db.js';
import { today } from '../util/date.js';

/** Lịch cấp tiền định kỳ, sống trong sổ danh bạ. */
export function ensureBang(ctl) {
  ctl.exec(`
    CREATE TABLE IF NOT EXISTS allowances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ledger_id INTEGER REFERENCES ledgers(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      -- Ngày trong tháng. 29-31 ở tháng ngắn sẽ rơi vào ngày cuối tháng.
      day_of_month INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      -- Tài khoản nguồn trong SỔ NHÀ. Trống thì lấy tài khoản tiền mặt đầu tiên.
      source_account_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      last_paid_on TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_allowances_child ON allowances(child_id);
  `);
}

const soTien = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) throw new Error('Số tiền tiêu vặt phải lớn hơn 0');
  if (n > 1_000_000_000) throw new Error('Số tiền tiêu vặt lớn bất thường — kiểm lại giúp mình');
  return n;
};

/**
 * Tài khoản nhận trong sổ con: ví đang dùng đầu tiên, chưa có thì mở một cái.
 *
 * Tự mở ví thay vì báo lỗi, vì đứa trẻ vừa được mời vào thì sổ của nó trống
 * trơn — bắt nó tự mở tài khoản trước khi bố mẹ cấp được đồng nào là dựng một
 * bức tường ngay ở bước đầu tiên.
 */
function viCuaCon() {
  const co = get('SELECT id FROM accounts WHERE is_active = 1 ORDER BY id LIMIT 1');
  if (co) return Number(co.id);
  return insert('accounts', { name: 'Ví tiêu vặt', type: 'cash', balance: 0, opening_balance: 0 });
}

/** Tài khoản nguồn trong sổ nhà. */
function nguonCuaNha(id) {
  if (id) {
    const co = get('SELECT id FROM accounts WHERE id = ? AND is_active = 1', [Number(id)]);
    if (co) return Number(co.id);
  }
  const tm = get("SELECT id FROM accounts WHERE is_active = 1 AND type = 'cash' ORDER BY id LIMIT 1")
    || get('SELECT id FROM accounts WHERE is_active = 1 ORDER BY id LIMIT 1');
  if (!tm) throw new Error('Sổ nhà chưa có tài khoản nào để trừ tiền tiêu vặt.');
  return Number(tm.id);
}

/**
 * Cấp một lần.
 *
 * @param {{childId:number, childName?:string, ledgerKey:string, amount:number,
 *          sourceAccountId?:number|null, note?:string, actorId:number, date?:string}} o
 */
export function capMotLan(o) {
  const tien = soTien(o.amount);
  const ngay = o.date || today();
  const ten = o.childName || `#${o.childId}`;

  // 1) Sổ CON trước — xem phần đầu tệp để biết vì sao thứ tự này.
  const ben = withLedger(`u${o.childId}`, () => createTransaction({
    type: 'income',
    amount: tien,
    date: ngay,
    merchant: 'Tiền tiêu vặt',
    note: o.note || null,
    account_id: viCuaCon(),
    source: 'allowance',
  }), o.actorId);

  // 2) Sổ NHÀ.
  try {
    const nha = withLedger(o.ledgerKey, () => createTransaction({
      type: 'expense',
      amount: tien,
      date: ngay,
      merchant: `Tiền tiêu vặt cho ${ten}`,
      note: o.note || null,
      account_id: nguonCuaNha(o.sourceAccountId),
      source: 'allowance',
    }), o.actorId);
    return { ok: true, amount: tien, date: ngay, con: ben.transaction?.id ?? null, nha: nha.transaction?.id ?? null };
  } catch (e) {
    // Sổ nhà hỏng: gỡ lại khoản vừa ghi cho con, đừng để con "được" một khoản
    // mà nhà không hề trừ.
    try {
      withLedger(`u${o.childId}`, () => deleteTransaction(ben.transaction.id), o.actorId);
    } catch (e2) {
      // Không gỡ được thì phải kêu to. Im lặng ở đây nghĩa là hai cuốn sổ lệch
      // nhau vĩnh viễn mà không ai biết.
      console.error(`[finmate] TIÊU VẶT LỆCH SỔ: đã ghi ${tien} vào sổ con #${o.childId} `
        + `(giao dịch ${ben.transaction?.id}) nhưng sổ nhà ${o.ledgerKey} hỏng và không gỡ lại được:`, e2.message);
      const err = new Error(`Đã ghi vào sổ của ${ten} nhưng không trừ được ở sổ nhà, và cũng không gỡ lại được. `
        + `Hãy xoá tay khoản "Tiền tiêu vặt" ngày ${ngay} trong sổ của ${ten}.`);
      err.lech_so = true;
      throw err;
    }
    throw new Error(`Không trừ được tiền ở sổ nhà nên chưa cấp: ${e.message}`);
  }
}

/** Ngày cấp của tháng chứa `d`, kẹp vào ngày cuối tháng nếu tháng ngắn. */
export function ngayCapTrongThang(d, dayOfMonth) {
  const [y, m] = String(d).split('-').map(Number);
  const cuoi = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ngay = Math.min(Math.max(1, Number(dayOfMonth) || 1), cuoi);
  return `${y}-${String(m).padStart(2, '0')}-${String(ngay).padStart(2, '0')}`;
}

/** Đã tới hạn cấp cho tháng này chưa (và tháng này đã cấp chưa). */
export function toiHan(a, d = today()) {
  if (!a.active) return false;
  const moc = ngayCapTrongThang(d, a.day_of_month);
  if (d < moc) return false;
  return !a.last_paid_on || a.last_paid_on < moc;
}

/**
 * Chạy hết những khoản tới hạn. Gọi từ tầng tự động hoá của máy chủ.
 *
 * Một nhà hỏng thì chỉ nhà đó không được cấp lần này — không được để nó chặn
 * những nhà còn lại.
 */
export function chayDenHan(ctl, { hom = today() } = {}) {
  ensureBang(ctl);
  const ds = ctl.prepare('SELECT * FROM allowances WHERE active = 1').all();
  let cap = 0; let loi = 0;
  for (const a of ds) {
    if (!toiHan(a, hom)) continue;
    const chu = ctl.prepare('SELECT name, email FROM users WHERE id = ?').get(a.child_id);
    if (!chu) continue;
    try {
      capMotLan({
        childId: a.child_id,
        childName: chu.name || chu.email,
        ledgerKey: `g${a.ledger_id}`,
        amount: a.amount,
        sourceAccountId: a.source_account_id,
        note: a.note,
        actorId: null,
        date: ngayCapTrongThang(hom, a.day_of_month),
      });
      ctl.prepare('UPDATE allowances SET last_paid_on = ? WHERE id = ?')
        .run(ngayCapTrongThang(hom, a.day_of_month), a.id);
      cap += 1;
    } catch (e) {
      loi += 1;
      console.warn(`[finmate] không cấp được tiêu vặt #${a.id}:`, e.message);
    }
  }
  return { cap, loi };
}

/** Tổng đã cấp trong tháng, đọc từ chính sổ con — số thật, không phải số dự kiến. */
export function daNhanThangNay(childId, thang = today().slice(0, 7)) {
  return withLedger(`u${childId}`, () => Number(
    get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE source = 'allowance' AND type = 'income' AND date LIKE ?",
      [`${thang}%`])?.s || 0,
  ));
}

/** Con đã tiêu bao nhiêu trong tháng, và còn lại bao nhiêu. */
export function tinhHinhCon(childId, thang = today().slice(0, 7)) {
  return withLedger(`u${childId}`, () => {
    const nhan = Number(get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE source = 'allowance' AND type = 'income' AND date LIKE ?", [`${thang}%`])?.s || 0);
    const tieu = Number(get("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type = 'expense' AND date LIKE ?", [`${thang}%`])?.s || 0);
    const du = Number(get('SELECT COALESCE(SUM(balance),0) s FROM accounts WHERE is_active = 1')?.s || 0);
    const gan = all("SELECT id, date, amount, merchant, note FROM transactions WHERE type = 'expense' ORDER BY date DESC, id DESC LIMIT 5");
    return { thang, nhan, tieu, con_lai: du, gan_day: gan };
  });
}
