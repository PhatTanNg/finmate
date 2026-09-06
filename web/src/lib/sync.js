/**
 * Đồng bộ sổ của bản chạy trên máy với một tài khoản trên máy chủ.
 *
 * Mô hình cố ý đơn giản: gửi/nhận NGUYÊN CUỐN SỔ, có số hiệu bản để phát hiện
 * lệch. Không trộn từng dòng — id ở đây là số tự tăng của từng máy, trộn kiểu
 * đó là nhân đôi hoặc nuốt mất giao dịch (xem server/src/services/sync.js).
 *
 * Ba việc tự động, đều là việc KHÔNG THỂ mất dữ liệu:
 *   - máy chủ mới hơn mà máy này chưa sửa gì  -> tự tải về (sao lưu trước)
 *   - máy này có sửa mà máy chủ vẫn ở bản cũ  -> tự gửi lên
 *   - cả hai cùng đổi                          -> DỪNG, hỏi người dùng
 */
const KHOA = 'finmate.sync';

const doc = () => {
  try { return JSON.parse(localStorage.getItem(KHOA) || '{}') || {}; } catch { return {}; }
};
const ghi = (c) => {
  try { localStorage.setItem(KHOA, JSON.stringify(c)); } catch { /* chế độ riêng tư */ }
  return c;
};

export const cauHinh = () => {
  const c = doc();
  return { url: c.url || '', email: c.email || '', token: c.token || '', rev: Number(c.rev || 0), at: c.at || null, doi: Number(c.doi || 0) };
};
export const daNoi = () => Boolean(cauHinh().url && cauHinh().token);
export const luuCauHinh = (moi) => ghi({ ...doc(), ...moi });
export const ngatKetNoi = () => ghi({});

/**
 * Có phải một thay đổi ĐÁNG ĐỒNG BỘ không?
 *
 * App tự ghi rất nhiều thứ vặt mỗi lần mở: mốc "đã chạy tự động hoá lúc mấy
 * giờ", tỷ giá vừa tải, giá cổ phiếu, chính số hiệu bản đồng bộ… Tính những
 * thứ đó là "người dùng vừa sửa sổ" thì lần mở app nào máy này cũng tự nhận là
 * có thay đổi, và mọi sửa đổi bên máy chủ đều biến thành xung đột phải hỏi —
 * trong khi thực ra chẳng có gì để mà chọn.
 *
 * Nghi ngờ thì tính là CÓ sửa: gửi thừa lên chỉ tốn ít mạng, còn bỏ sót một
 * giao dịch thật là mất tiền của người ta.
 */
const KHOA_VAT = new Set([
  'last_automation_run', 'last_backup', 'fx_last_fetch', 'fx_last_ok', 'fx_last_error',
  'prices_last_refresh', 'prices_last_ok', 'prices_status',
  'sync_rev', 'sync_at', 'sync_owner', 'sync_device',
]);
const BANG_VAT = /\b(fx_rates|price_history|ai_audit_state)\b/i;

export function laThayDoiThat(sql, params) {
  const s = String(sql || '');
  if (BANG_VAT.test(s)) return false;
  if (/\bsettings\b/i.test(s)) {
    // settings vừa chứa cấu hình thật của người dùng (đồng tiền gốc, hồ sơ
    // thuế) vừa chứa mốc thời gian máy tự ghi — phân biệt bằng chính tên khoá.
    const key = Array.isArray(params) ? params.find((v) => typeof v === 'string') : null;
    if (key && KHOA_VAT.has(key)) return false;
  }
  return true;
}

/** Sổ trên máy này đã sửa bao nhiêu lần kể từ lần đồng bộ gần nhất. */
export const danhDauDaSua = () => ghi({ ...doc(), doi: Number(doc().doi || 0) + 1 }).doi;
export const coThayDoi = () => Number(doc().doi || 0) > 0;

const goc = () => String(cauHinh().url).replace(/\/+$/, '');
const nem = async (res) => {
  const d = await res.json().catch(() => ({}));
  const e = new Error(d.error || `Lỗi ${res.status}`);
  e.status = res.status;
  e.data = d;
  throw e;
};

/** Đăng nhập vào máy chủ và nhớ khoá phiên. Không đụng gì tới sổ. */
export async function dangNhap({ url, email, password }) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Địa chỉ máy chủ phải bắt đầu bằng http:// hoặc https://');
  const res = await fetch(`${base}/api/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    // 404 nghĩa là máy chủ đó chạy chế độ một sổ — nói thẳng, đừng để người
    // dùng loay hoay tưởng mình gõ sai mật khẩu.
    if (res.status === 404) throw new Error('Máy chủ này chạy chế độ một sổ, chưa bật tài khoản (FINMATE_MULTIUSER=1)');
    return nem(res);
  }
  const d = await res.json();
  luuCauHinh({ url: base, email: d.user?.email || email, token: d.token, user: d.user, rev: 0, at: null, doi: 1 });

  // Lần nối đầu tiên: tài khoản còn trắng thì nhận luôn số hiệu bản hiện tại
  // làm mốc, để cú đồng bộ đầu chỉ việc gửi sổ trên máy lên. Không làm bước
  // này thì ai nối máy vào tài khoản mới cũng bị báo "hai bên cùng đổi" ngay
  // lần đầu — trong khi bên kia chẳng có gì.
  const tt = await thongTinSo().catch(() => null);
  if (tt?.trong) luuCauHinh({ rev: tt.sync.rev });
  return { user: d.user, trong: Boolean(tt?.trong), transactions: tt?.transactions ?? null };
}

/** Sổ trên tài khoản: số hiệu bản, còn trắng hay đã có giao dịch. */
export async function thongTinSo() {
  const res = await fetch(`${goc()}/api/account/ledger/info`, { headers: khoa() });
  if (!res.ok) return nem(res);
  return res.json();
}

const khoa = () => ({ 'x-finmate-key': cauHinh().token });

/**
 * Máy chủ đang ở bản nào. Có hạn chờ vì hàm này được gọi ngay lúc mở app —
 * máy chủ nghỉ hay mất sóng thì phải bỏ qua nhanh, không được giữ app lại.
 */
export async function trangThaiMayChu({ timeoutMs = 0 } = {}) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${goc()}/api/account/ledger/info`, { headers: khoa(), ...(ctrl ? { signal: ctrl.signal } : {}) });
    if (!res.ok) return nem(res);
    return (await res.json()).sync;
  } finally { clearTimeout(t); }
}

/**
 * Gửi nguyên sổ trên máy này lên tài khoản.
 * Máy chủ đã đổi kể từ lần đồng bộ trước thì ném lỗi có `.conflict` — người
 * dùng chọn, không tự quyết hộ.
 */
export async function guiLen({ bytes, force = false } = {}) {
  const c = cauHinh();
  const q = new URLSearchParams({ base_rev: String(c.rev) });
  if (force) q.set('force', '1');
  const res = await fetch(`${goc()}/api/account/ledger?${q}`, {
    method: 'PUT',
    headers: { ...khoa(), 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    const e = new Error(d.error || `Không gửi được (${res.status})`);
    e.status = res.status;
    e.conflict = Boolean(d.conflict);
    e.sync = d.sync;
    throw e;
  }
  const d = await res.json();
  luuCauHinh({ rev: d.rev, at: new Date().toISOString(), doi: 0 });
  return d;
}

/** Tải nguyên sổ từ tài khoản về. Trả bytes + số hiệu bản, CHƯA thay sổ. */
export async function taiVe() {
  const res = await fetch(`${goc()}/api/account/ledger`, { headers: khoa() });
  if (!res.ok) return nem(res);
  const rev = Number(res.headers.get('x-finmate-rev') || 0);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 6)) !== 'SQLite') throw new Error('Máy chủ trả về thứ không phải sổ FinMate');
  return { bytes, rev };
}

/**
 * Một lượt đồng bộ. KHÔNG tự xử lý khi cả hai bên cùng đổi.
 *
 * Việc lấy về thường đã xảy ra sớm hơn, ngay lúc mở app (xem native/boot.js) —
 * phải sớm như vậy vì tự động hoá chạy lúc mở app cũng sửa sổ, mà sửa rồi thì
 * không còn phân biệt được "máy này có thay đổi thật" với "vừa mở app xong".
 * Hàm này vẫn lấy về được, dùng cho nút bấm tay trong Cài đặt.
 *
 * @param {{ layBytes: () => Uint8Array, thaySo: (b: Uint8Array) => Promise<any>, saoLuu: () => Promise<any> }} tay
 * @returns {Promise<{viec: 'khong-can'|'gui-len'|'tai-ve'|'lech'|'chua-noi', ...}>}
 */
export async function dongBoMotLuot(tay) {
  if (!daNoi()) return { viec: 'chua-noi' };
  const c = cauHinh();
  const may = await trangThaiMayChu();
  const mayMoiHon = may.rev > c.rev;
  const toiCoSua = coThayDoi();

  if (mayMoiHon && toiCoSua) return { viec: 'lech', sync: may, rev: c.rev };
  if (mayMoiHon) {
    const { bytes, rev } = await taiVe();
    await tay.saoLuu?.();               // giữ bản trên máy lại trước khi thay
    await tay.thaySo(bytes);
    luuCauHinh({ rev, at: new Date().toISOString(), doi: 0 });
    return { viec: 'tai-ve', rev };
  }
  if (toiCoSua) {
    const d = await guiLen({ bytes: tay.layBytes() });
    return { viec: 'gui-len', rev: d.rev };
  }
  return { viec: 'khong-can', rev: c.rev };
}
