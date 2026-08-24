/** Kiểm thử lớp bảo mật: PIN, phiên đăng nhập, sao lưu, xuất dữ liệu. */
const BASE = process.env.FINMATE_URL || 'http://localhost:4000';
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${extra}`}`);
  if (!cond) fails++;
};

const call = async (path, { method = 'GET', body, key, token } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (key) headers['x-finmate-key'] = key;
  if (token) headers['x-finmate-token'] = token;
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const PIN = 'test-pin-9713';

// dọn PIN cũ nếu lần chạy trước lỗi giữa chừng
const pre = await call('/auth/status');
if (pre.data.pin_set) {
  const l = await call('/auth/login', { method: 'POST', body: { pin: PIN } });
  if (l.data.key) await call('/auth/disable', { method: 'POST', body: { pin: PIN }, key: l.data.key });
}

check('chưa đặt PIN thì API mở bình thường', (await call('/dashboard')).status === 200);

const setup = await call('/auth/setup', { method: 'POST', body: { pin: PIN } });
check('đặt PIN trả về khoá phiên', setup.status === 200 && typeof setup.data.key === 'string', JSON.stringify(setup.data));
const key = setup.data.key;

check('PIN quá ngắn bị từ chối', (await call('/auth/change', { method: 'POST', body: { old_pin: PIN, pin: '12' }, key })).status === 400);

const noKey = await call('/dashboard');
check('không có khoá thì bị chặn 401', noKey.status === 401 && noKey.data.locked === true, JSON.stringify(noKey.data));

check('khoá sai bị chặn', (await call('/dashboard', { key: 'sai-khoa' })).status === 401);
check('có khoá thì đọc được dữ liệu', (await call('/dashboard', { key })).status === 200);
check('ghi dữ liệu cũng cần khoá', (await call('/chat', { method: 'POST', body: { message: 'số dư của tôi' } })).status === 401);

check('/health luôn mở để giám sát', (await call('/health')).status === 200);

// --- webhook /ingest: cửa duy nhất mở ra ngoài cho iPhone Shortcuts ---
{
  const st = await call('/automation/status', { key });
  const wtok = st.data.token;
  check('webhook luôn có sẵn token bí mật', typeof wtok === 'string' && wtok.length >= 16, JSON.stringify(st.data).slice(0, 160));

  const SMS = 'AIB: Your Visa Debit card ending 4321 was used for EUR 3.30 at SPAR on 24/08/2026';
  const noTok = await call('/ingest', { method: 'POST', body: { text: SMS } });
  check('bật PIN mà không có token thì webhook bị chặn', noTok.status === 401, `status ${noTok.status}`);

  const badTok = await call('/ingest', { method: 'POST', body: { text: SMS }, token: 'token-gia-mao' });
  check('token sai bị chặn', badTok.status === 401, `status ${badTok.status}`);

  const good = await call('/ingest', { method: 'POST', body: { text: SMS }, token: wtok });
  check('token đúng thì ghi được giao dịch', good.status === 200 && good.data.status !== 'ignored', JSON.stringify(good.data).slice(0, 160));
  check('tin nhắn EUR được ghi đúng 3,30 € = 330 cent', good.data?.parsed?.amount === 330 && good.data?.parsed?.currency === 'EUR', JSON.stringify(good.data?.parsed).slice(0, 200));

  const dup = await call('/ingest', { method: 'POST', body: { text: SMS }, token: wtok });
  check('gửi lại cùng tin nhắn không tạo giao dịch trùng', dup.data.status === 'duplicate', JSON.stringify(dup.data).slice(0, 120));

  const prev = await call('/ingest/preview', { method: 'POST', body: { text: SMS }, token: wtok });
  check('token webhook KHÔNG mở được các đường khác của /ingest', prev.status === 401, `status ${prev.status}`);
}
check('đăng nhập sai PIN trả 401', (await call('/auth/login', { method: 'POST', body: { pin: 'sai' } })).status === 401);

const login = await call('/auth/login', { method: 'POST', body: { pin: PIN } });
check('đăng nhập đúng PIN cấp khoá mới', login.status === 200 && login.data.key && login.data.key !== key);

const settings = await call('/settings', { key });
check('mã PIN không lộ qua /settings', !JSON.stringify(settings.data).includes('app_pin'), JSON.stringify(settings.data).slice(0, 120));
check('không đặt được app_pin qua /settings', (await call('/settings', { method: 'POST', body: { app_pin: 'hack' }, key })).status === 400);

const backup = await call('/backup/run', { method: 'POST', key });
check('sao lưu tạo được file', backup.status === 200 && backup.data.backup?.size > 0, JSON.stringify(backup.data));
check('liệt kê được bản sao lưu', (await call('/backup/list', { key })).data.backups?.length > 0);

const exported = await call('/export', { key });
check('xuất JSON có đủ bảng chính', ['transactions', 'accounts', 'goals'].every((t) => Array.isArray(exported.data.data?.[t])));
check('bản xuất không chứa mã PIN', !JSON.stringify(exported.data.data?.settings || []).includes('app_pin'));

const logout = await call('/auth/logout', { method: 'POST', key: login.data.key });
check('đăng xuất huỷ phiên', logout.status === 200 && (await call('/dashboard', { key: login.data.key })).status === 401);

await call('/auth/disable', { method: 'POST', body: { pin: PIN }, key });
check('tắt khoá thì API mở lại', (await call('/dashboard')).status === 200);

console.log(fails ? `\n❌ ${fails} kiểm thử thất bại` : '\n🎉 Lớp bảo mật hoạt động đúng.');
process.exit(fails ? 1 : 0);
