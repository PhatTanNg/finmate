import { openEngine } from './db_engine.js';
import { currentCtx } from './db_context.js';

// Engine đổi theo nơi chạy: node:sqlite trên máy chủ, SQLite WebAssembly
// trong bản chạy ngay trên điện thoại (xem web/src/native). Mọi thứ bên dưới
// — schema, migration, trigger nhật ký, helper — là chung.
const engine = openEngine();
export const DB_PATH = engine.DB_PATH;
export const ENGINE = engine.kind;

/**
 * Sổ đang dùng cho công việc hiện tại.
 *
 * Một sổ (máy cá nhân, bản chạy trên điện thoại): luôn là engine mặc định.
 * Nhiều người dùng: là sổ RIÊNG của người gửi request đang xử lý — mỗi người
 * một file SQLite, cách ly vật lý chứ không dựa vào việc nhớ viết WHERE.
 */
const activeDb = () => currentCtx()?.db || engine.db;
export const activePath = () => currentCtx()?.path || engine.DB_PATH;

/**
 * `db` là proxy trỏ tới sổ đang dùng, nên những chỗ gọi thẳng db.exec /
 * db.prepare (sao lưu, VACUUM, script reset) chạy đúng sổ mà không phải sửa.
 * Hàm phải bind về handle thật, nếu không `this` sẽ là chính cái proxy.
 */
export const db = new Proxy({}, {
  get(_t, k) {
    const real = activeDb();
    const v = real[k];
    return typeof v === 'function' ? v.bind(real) : v;
  },
  has: (_t, k) => k in activeDb(),
});

engine.db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT DEFAULT 'Bạn',
  birth_year INTEGER,
  currency TEXT DEFAULT 'VND',
  city TEXT,
  dependents INTEGER DEFAULT 0,
  marital_status TEXT,
  risk_profile TEXT DEFAULT 'balanced',          -- conservative | balanced | aggressive
  lifestyle TEXT,                                 -- mô tả phong cách sống tự do
  retire_age_target INTEGER DEFAULT 50,
  swr REAL DEFAULT 0.04,                          -- safe withdrawal rate
  expected_return REAL DEFAULT 0.09,              -- lợi suất đầu tư kỳ vọng/năm
  inflation REAL DEFAULT 0.04,
  savings_rate_target REAL DEFAULT 0.3,
  emergency_months_target REAL DEFAULT 6,
  onboarded INTEGER DEFAULT 0,
  onboarding_step TEXT DEFAULT 'welcome',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- cash | bank | ewallet | credit_card | savings | brokerage | crypto | real_estate | loan | other_asset
  institution TEXT,
  currency TEXT DEFAULT 'VND',
  balance INTEGER DEFAULT 0,        -- VND (đơn vị nhỏ nhất = 1đ). Nợ/credit_card: số dư âm = đang nợ
  opening_balance INTEGER DEFAULT 0,
  credit_limit INTEGER DEFAULT 0,
  interest_rate REAL DEFAULT 0,     -- %/năm cho savings, loan, credit_card
  interest_payout TEXT DEFAULT 'maturity', -- monthly | quarterly | maturity
  term_months INTEGER,
  opened_at TEXT,
  maturity_date TEXT,
  statement_day INTEGER,
  due_day INTEGER,
  account_no TEXT,
  color TEXT,
  icon TEXT,
  is_active INTEGER DEFAULT 1,
  include_in_networth INTEGER DEFAULT 1,
  auto_sync TEXT,                   -- sms | webhook | csv | manual
  last_synced_at TEXT,
  last_accrued_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,               -- income | expense
  group_name TEXT,
  icon TEXT,
  color TEXT,
  essential INTEGER DEFAULT 0,      -- chi phí thiết yếu?
  keywords TEXT DEFAULT '',         -- từ khoá để tự động phân loại
  is_system INTEGER DEFAULT 1,
  UNIQUE(name, kind)
);

CREATE TABLE IF NOT EXISTS funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,               -- necessity | freedom | education | fun | giving | ltss | emergency | goal
  balance INTEGER DEFAULT 0,
  target_amount INTEGER DEFAULT 0,
  percent REAL DEFAULT 0,           -- % thu nhập được phân bổ tự động
  cap INTEGER DEFAULT 0,            -- trần quỹ, 0 = không giới hạn
  priority INTEGER DEFAULT 100,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  color TEXT,
  icon TEXT,
  spendable INTEGER DEFAULT 1,      -- quỹ dùng để chi tiêu hay để tích luỹ
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sổ cái quỹ: quỹ là "phong bì ảo" phủ lên tiền thật, số dư = tổng bút toán
CREATE TABLE IF NOT EXISTS fund_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,          -- + nạp vào quỹ, - rút khỏi quỹ
  date TEXT NOT NULL,
  kind TEXT DEFAULT 'allocation',   -- allocation | spend | move | adjust | goal
  ref_tx_id INTEGER,
  goal_id INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fl_fund ON fund_ledger(fund_id);
CREATE INDEX IF NOT EXISTS idx_fl_ref ON fund_ledger(ref_tx_id);

CREATE TABLE IF NOT EXISTS income_streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- salary | business | freelance | dividend | interest | rental | capital_gain | royalty | other
  employer TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  gross_amount INTEGER DEFAULT 0,
  net_amount INTEGER DEFAULT 0,
  frequency TEXT DEFAULT 'monthly', -- monthly | quarterly | yearly | weekly | irregular
  payday INTEGER,                   -- ngày trong tháng
  stability INTEGER DEFAULT 5,      -- 1..5 độ ổn định
  growth_rate REAL DEFAULT 0,       -- tăng trưởng %/năm
  tax_mode TEXT DEFAULT 'net',      -- net | gross_pit (tự tính thuế TNCN)
  insurance_base INTEGER DEFAULT 0, -- lương đóng BHXH
  property_id INTEGER,
  active INTEGER DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,               -- income | expense | transfer
  amount INTEGER NOT NULL,          -- luôn dương
  currency TEXT DEFAULT 'VND',
  date TEXT NOT NULL,               -- YYYY-MM-DD
  occurred_at TEXT,                 -- ISO datetime
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  counter_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
  income_stream_id INTEGER REFERENCES income_streams(id) ON DELETE SET NULL,
  goal_id INTEGER,
  debt_id INTEGER,
  holding_id INTEGER,
  merchant TEXT,
  note TEXT,
  tags TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',     -- manual | chat | sms | email | csv | webhook | recurring | system | allocation
  external_id TEXT,
  raw TEXT,
  confidence REAL DEFAULT 1,
  needs_review INTEGER DEFAULT 0,
  excluded INTEGER DEFAULT 0,       -- loại khỏi thống kê chi tiêu
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external ON transactions(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'save',         -- save | purchase | travel | emergency | debt_payoff | investment | education | retirement
  target_amount INTEGER NOT NULL,
  current_amount INTEGER DEFAULT 0,
  deadline TEXT,
  monthly_contribution INTEGER DEFAULT 0,
  auto_contribute INTEGER DEFAULT 1,
  fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 3,       -- 1 cao nhất
  status TEXT DEFAULT 'active',     -- active | paused | done | archived
  expected_return REAL DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  fund_id INTEGER REFERENCES funds(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  period TEXT DEFAULT 'monthly',    -- monthly | weekly | yearly
  month TEXT,                       -- NULL = áp dụng mọi tháng
  rollover INTEGER DEFAULT 0,
  alert_threshold REAL DEFAULT 0.8,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- income | expense | transfer
  amount INTEGER NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  counter_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
  income_stream_id INTEGER REFERENCES income_streams(id) ON DELETE SET NULL,
  debt_id INTEGER,
  frequency TEXT DEFAULT 'monthly', -- daily | weekly | monthly | quarterly | yearly
  interval_n INTEGER DEFAULT 1,
  day_of_month INTEGER,
  weekday INTEGER,
  start_date TEXT,
  next_date TEXT,
  end_date TEXT,
  auto_post INTEGER DEFAULT 1,
  variable INTEGER DEFAULT 0,       -- số tiền thay đổi (điện, nước) -> chỉ dự báo, không tự ghi
  last_posted TEXT,
  active INTEGER DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  asset_class TEXT DEFAULT 'stock', -- stock | etf | fund | bond | crypto | gold | other
  quantity REAL DEFAULT 0,
  avg_cost REAL DEFAULT 0,
  last_price REAL DEFAULT 0,
  last_price_at TEXT,
  currency TEXT DEFAULT 'VND',
  dividend_yield REAL DEFAULT 0,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id INTEGER REFERENCES holdings(id) ON DELETE CASCADE,
  side TEXT NOT NULL,               -- buy | sell | dividend
  quantity REAL DEFAULT 0,
  price REAL DEFAULT 0,
  fee REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  amount INTEGER DEFAULT 0,
  date TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  purchase_price INTEGER DEFAULT 0,
  current_value INTEGER DEFAULT 0,
  purchase_date TEXT,
  monthly_rent INTEGER DEFAULT 0,
  monthly_cost INTEGER DEFAULT 0,
  occupancy REAL DEFAULT 1,
  debt_id INTEGER,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  appreciation_rate REAL DEFAULT 0.05,
  note TEXT
);

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'personal',     -- mortgage | auto | personal | credit_card | student | bnpl | family
  lender TEXT,
  principal INTEGER DEFAULT 0,
  balance INTEGER DEFAULT 0,
  interest_rate REAL DEFAULT 0,     -- %/năm
  monthly_payment INTEGER DEFAULT 0,
  min_payment INTEGER DEFAULT 0,
  start_date TEXT,
  term_months INTEGER,
  due_day INTEGER,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  method TEXT DEFAULT 'amortized',  -- amortized | flat | revolving
  status TEXT DEFAULT 'active',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  match_field TEXT DEFAULT 'text',  -- text | merchant | amount | account
  match_type TEXT DEFAULT 'contains',
  pattern TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  set_merchant TEXT,
  set_excluded INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 100,
  hits INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  learned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT,
  kind TEXT,                        -- alert | tip | win | risk | forecast
  severity TEXT DEFAULT 'info',     -- info | warn | danger | success
  title TEXT NOT NULL,
  body TEXT,
  action TEXT,
  data TEXT DEFAULT '{}',
  read INTEGER DEFAULT 0,
  dismissed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,               -- user | assistant | system
  content TEXT NOT NULL,
  intent TEXT,
  data TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS networth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  assets INTEGER DEFAULT 0,
  liabilities INTEGER DEFAULT 0,
  net INTEGER DEFAULT 0,
  breakdown TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ingest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,                     -- sms | email | webhook | csv
  payload TEXT,
  parsed TEXT,
  status TEXT,                      -- created | duplicate | ignored | error | review
  transaction_id INTEGER,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Tỷ giá theo ngày: rate = số đơn vị <quote> đổi được từ 1 <base>
CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  date TEXT NOT NULL,
  source TEXT DEFAULT 'manual',   -- manual | ecb-api | fallback | chat
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(base, quote, date)
);
CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(base, quote, date);

-- Nhật ký thao tác của AI. Một cố vấn thật phải giải trình được: đã làm gì,
-- lúc nào, vì sao, và hoàn tác được nếu bạn không đồng ý.
CREATE TABLE IF NOT EXISTS ai_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT,                       -- gom mọi thao tác trong cùng một lượt chat
  source TEXT DEFAULT 'chat',       -- chat | review | user
  tool TEXT NOT NULL,
  args TEXT DEFAULT '{}',
  result TEXT DEFAULT '{}',
  ok INTEGER DEFAULT 1,
  mutates INTEGER DEFAULT 0,
  reason TEXT,                      -- vì sao AI quyết định làm việc này
  undone_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_actions_batch ON ai_actions(batch, id);

-- Từng hàng dữ liệu bị đổi, kèm ảnh chụp trước/sau để hoàn tác chính xác.
CREATE TABLE IF NOT EXISTS ai_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL,
  op TEXT NOT NULL,                 -- insert | update | delete
  tbl TEXT NOT NULL,
  row_id INTEGER,
  before TEXT,
  after TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_changes_action ON ai_changes(action_id);

-- Trí nhớ dài hạn: hoàn cảnh, sở thích, ràng buộc và những quyết định đã chốt.
-- Hội thoại chỉ giữ 14 lượt gần nhất, nên thứ gì cần nhớ lâu phải nằm ở đây.
CREATE TABLE IF NOT EXISTS ai_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'fact',         -- fact | preference | constraint | decision | plan
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  importance INTEGER DEFAULT 3,     -- 1 thấp .. 5 cao
  source TEXT DEFAULT 'chat',
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(kind, key)
);

-- Lịch sử giá thị trường (mỗi mã một dòng/ngày) để vẽ đường giá và so hôm qua.
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT,
  source TEXT,
  UNIQUE(symbol, date)
);

-- Đề xuất của AI chờ người dùng gật đầu: mỗi đề xuất là một chuỗi lời gọi công
-- cụ cụ thể (không phải lời khuyên chung chung), bấm "Đồng ý" là app tự làm.
CREATE TABLE IF NOT EXISTS ai_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT,                         -- chống lặp: cùng key mà đang chờ thì không tạo bản mới
  title TEXT NOT NULL,
  body TEXT,
  actions TEXT NOT NULL,            -- JSON [{tool, args}]
  source TEXT DEFAULT 'autopilot',  -- autopilot | chat | review | ingest
  severity TEXT DEFAULT 'info',     -- info | warn | danger
  auto_ok INTEGER DEFAULT 0,        -- 1 = an toàn để tự làm khi bật chế độ tự lái
  status TEXT DEFAULT 'pending',    -- pending | accepted | rejected | failed | expired
  result TEXT,
  message_id INTEGER,               -- tin nhắn chat mang đề xuất này
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  expires_at TEXT
);
`;

activeDb().exec(SCHEMA);

// ---- migration: thêm cột cho DB đã tồn tại từ bản trước ------------------

/** Danh sách cột cần có thêm, an toàn khi chạy lại nhiều lần. */
const ADD_COLUMNS = [
  // Đa tiền tệ: số tiền quy đổi về đồng tiền gốc tại thời điểm phát sinh
  ['transactions', 'base_amount', 'INTEGER'],
  ['transactions', 'base_currency', 'TEXT'],
  ['transactions', 'fx_rate', 'REAL DEFAULT 1'],
  // Chuyển tiền khác đồng tiền: số thực nhận ở tài khoản đích + phí
  ['transactions', 'counter_amount', 'INTEGER'],
  ['transactions', 'counter_currency', 'TEXT'],
  ['transactions', 'fee', 'INTEGER DEFAULT 0'],
  // Số tiền người dùng nói ban đầu, trước khi quy đổi về đồng tiền tài khoản
  ['transactions', 'original_amount', 'INTEGER'],
  ['transactions', 'original_currency', 'TEXT'],
  // Đồng tiền riêng cho các thực thể khác
  ['income_streams', 'currency', "TEXT DEFAULT 'VND'"],
  ['goals', 'currency', "TEXT DEFAULT 'VND'"],
  ['debts', 'currency', "TEXT DEFAULT 'VND'"],
  ['recurring', 'currency', "TEXT DEFAULT 'VND'"],
  ['recurring', 'counter_amount', 'INTEGER'],
  ['properties', 'currency', "TEXT DEFAULT 'VND'"],
  ['funds', 'currency', "TEXT DEFAULT 'VND'"],
  // Quỹ có hạn hoàn thành -> tự suy ra số tiền cần bỏ mỗi tháng và mức khẩn cấp
  ['funds', 'target_date', 'TEXT'],
  // Quỹ đã đóng: giữ lịch sử nhưng ngừng nhận phân bổ tự động
  ['funds', 'archived', 'INTEGER DEFAULT 0'],
  ['funds', 'archived_at', 'TEXT'],
  ['budgets', 'currency', "TEXT DEFAULT 'VND'"],
  ['profile', 'country', "TEXT DEFAULT 'VN'"],
  ['profile', 'tax_country', "TEXT DEFAULT 'VN'"],
  ['profile', 'secondary_currency', 'TEXT'],
  // Giá thị trường tự động: nguồn của giá gần nhất (sjc, coingecko, vndirect, yahoo…)
  ['holdings', 'price_source', 'TEXT'],
];

function columnNames(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  } catch {
    return [];
  }
}

function migrate() {
  for (const [table, col, type] of ADD_COLUMNS) {
    const cols = columnNames(table);
    if (!cols.length || cols.includes(col)) continue;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {
      /* cột đã có hoặc bảng chưa tạo — bỏ qua */
    }
  }
  // Giao dịch cũ chưa có base_amount: coi như cùng đồng tiền, tỷ giá 1
  try {
    db.exec(`UPDATE transactions
             SET base_amount = amount, base_currency = COALESCE(currency, 'VND'), fx_rate = 1
             WHERE base_amount IS NULL`);
  } catch {
    /* bảng chưa tồn tại */
  }
}

migrate();

// ---- helpers -------------------------------------------------------------

const plain = (row) => (row ? { ...row } : row);

export function all(sql, params = []) {
  return activeDb().prepare(sql).all(...params).map(plain);
}
export function get(sql, params = []) {
  return plain(activeDb().prepare(sql).get(...params));
}
export function run(sql, params = []) {
  return activeDb().prepare(sql).run(...params);
}
export function tx(fn) {
  const d = activeDb();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Tên cột thật của một bảng (đọc một lần rồi nhớ).
 *
 * `insert`/`update` nối tên cột thẳng vào câu SQL, nên nếu để nguyên khoá do
 * client gửi lên thì một body kiểu `{"balance = 777777, name": "x"}` sẽ ghi đè
 * cột khác — chèn SQL thật sự. Lọc theo danh sách cột của bảng chặn hẳn đường
 * đó, đồng thời không để thông báo lỗi lộ cấu trúc cơ sở dữ liệu ra ngoài.
 */
const columnCache = new Map();
export function tableColumns(table) {
  if (!columnCache.has(table)) {
    columnCache.set(table, new Set(all(`PRAGMA table_info(${JSON.stringify(table)})`).map((c) => c.name)));
  }
  return columnCache.get(table);
}

/**
 * Bí danh cho những tên trường mà người dùng — và nhất là AI cố vấn thao tác
 * qua API — hay dùng thay cho tên cột thật. Không dịch thì `pickColumns` lặng
 * lẽ vứt trường đó đi: khoản vay được lưu với lãi suất 0%, quỹ mất mục tiêu,
 * nguồn thu mất số tiền — sai lệch âm thầm, không có thông báo lỗi nào.
 */
const COLUMN_ALIASES = {
  debts: { rate: 'interest_rate', kind: 'type', apr: 'interest_rate', payment: 'monthly_payment' },
  funds: { kind: 'type', target: 'target_amount', goal: 'target_amount', deadline: 'target_date' },
  income_streams: { kind: 'type', amount: 'net_amount', net: 'net_amount', gross: 'gross_amount' },
  accounts: { kind: 'type', amount: 'balance' },
  goals: { target: 'target_amount', current: 'current_amount', target_date: 'deadline' },
  budgets: { limit: 'amount', limit_amount: 'amount', max: 'amount' },
};

/** Đưa các bí danh về tên cột thật trước khi lọc. */
function applyAliases(table, data) {
  const map = COLUMN_ALIASES[table];
  if (!map || !data) return data;
  const cols = tableColumns(table);
  const out = { ...data };
  for (const [from, to] of Object.entries(map)) {
    // Chỉ dịch khi bí danh không phải cột thật và cột đích chưa được đặt.
    if (out[from] !== undefined && !cols.has(from) && out[to] === undefined) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

/** Chỉ giữ những khoá là cột thật của bảng, bỏ qua phần còn lại. */
function pickColumns(table, data) {
  const cols = tableColumns(table);
  return Object.keys(data || {}).filter((k) => data[k] !== undefined && cols.has(k));
}

/**
 * Những khoá bị bỏ đi một cách có chủ đích, không đáng cảnh báo: cờ điều khiển
 * của API, khoá tra cứu theo tên đã được tầng service xử lý xong, và metadata
 * do client gửi kèm.
 */
const HARMLESS_DROPS = new Set(['id', 'created_at', 'updated_at', 'learn', 'values', 'allocate', 'to_account_id']);
const isHarmlessDrop = (k) => HARMLESS_DROPS.has(k) || k.endsWith('_name') || k.startsWith('_');

/**
 * Đếm những trường bị vứt vì không khớp cột nào. Vứt im lặng là cách hỏng dữ
 * liệu tệ nhất: khoản vay 40 triệu lưu với lãi 0% mà không có một dòng lỗi nào,
 * và mãi tới lúc chạy mô phỏng nhiều năm mới lộ ra. Có thống kê thì lần sau
 * lỗi kiểu đó nổi lên ngay từ log.
 */
const droppedStats = new Map();
export function droppedFieldStats() {
  return [...droppedStats.entries()].map(([k, n]) => ({ field: k, count: n })).sort((a, b) => b.count - a.count);
}

function warnDropped(table, data, kept) {
  const cols = tableColumns(table);
  const keptSet = new Set(kept);
  for (const k of Object.keys(data || {})) {
    if (data[k] === undefined || keptSet.has(k) || cols.has(k) || isHarmlessDrop(k)) continue;
    const key = `${table}.${k}`;
    droppedStats.set(key, (droppedStats.get(key) || 0) + 1);
    console.warn(`[db] bỏ qua trường không khớp cột nào: ${key} = ${JSON.stringify(data[k])?.slice(0, 60)}`);
  }
}

/**
 * ---- Nhật ký thao tác của AI ---------------------------------------------
 * Bắt thay đổi bằng trigger SQLite chứ không móc vào insert/update/remove:
 * số dư tài khoản, số dư quỹ, tiến độ mục tiêu và dư nợ đều được cập nhật bằng
 * SQL thô (`UPDATE accounts SET balance = balance + ?`), nên móc vào helper sẽ
 * bỏ sót đúng những con số quan trọng nhất — hoàn tác kiểu đó trả lại giao dịch
 * mà không trả lại số dư, tức là làm hỏng dữ liệu chứ không phải cứu nó.
 *
 * Cách đầu tiên tôi viết là chụp ảnh toàn bộ bảng trước/sau rồi so sánh. Đo thử
 * thì chi phí tăng theo cỡ sổ: 6.000 giao dịch đã cộng thêm 189ms cho MỖI thao
 * tác, tức vài giây cho một lượt chat sau ít năm dùng. Trigger chỉ tốn công
 * theo số hàng thật sự đổi, nên sổ có to đến đâu cũng không chậm đi.
 */
const AUDIT_SKIP = new Set(['ai_actions', 'ai_changes', 'ai_audit_state', 'ai_proposals', 'chat_messages', 'price_history',
  'insights', 'networth_snapshots', 'fx_rates', 'settings', 'ingest_log', 'sqlite_sequence']);

function jsonOf(prefix, table) {
  const cols = [...tableColumns(table)];
  return `json_object(${cols.map((c) => `'${c}', ${prefix}."${c}"`).join(', ')})`;
}

/** Dựng trigger ghi nhật ký cho mọi bảng dữ liệu. An toàn khi chạy lại. */
function installAuditTriggers() {
  columnCache.clear();   // migrate() vừa thêm cột, cache cũ sẽ làm trigger thiếu cột
  db.exec('CREATE TABLE IF NOT EXISTS ai_audit_state (action_id INTEGER)');
  const tables = all("SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => r.name).filter((n) => !AUDIT_SKIP.has(n) && !n.startsWith('sqlite_'));

  for (const t of tables) {
    if (!tableColumns(t).has('id')) continue;   // không có khoá thì không hoàn tác được
    const on = '(SELECT COUNT(*) FROM ai_audit_state) > 0';
    const ins = `INSERT INTO ai_changes (action_id, op, tbl, row_id, before, after) VALUES ((SELECT action_id FROM ai_audit_state)`;
    db.exec(`
      DROP TRIGGER IF EXISTS aud_${t}_i;
      CREATE TRIGGER aud_${t}_i AFTER INSERT ON ${t} WHEN ${on}
      BEGIN ${ins}, 'insert', '${t}', NEW.id, NULL, ${jsonOf('NEW', t)}); END;

      DROP TRIGGER IF EXISTS aud_${t}_u;
      CREATE TRIGGER aud_${t}_u AFTER UPDATE ON ${t} WHEN ${on}
      BEGIN ${ins}, 'update', '${t}', OLD.id, ${jsonOf('OLD', t)}, ${jsonOf('NEW', t)}); END;

      DROP TRIGGER IF EXISTS aud_${t}_d;
      CREATE TRIGGER aud_${t}_d AFTER DELETE ON ${t} WHEN ${on}
      BEGIN ${ins}, 'delete', '${t}', OLD.id, ${jsonOf('OLD', t)}, NULL); END;
    `);
  }
  return tables.length;
}

installAuditTriggers();

/**
 * Dựng đầy đủ một sổ TRỐNG thành sổ dùng được: bảng, migration, trigger nhật
 * ký. Gọi trong ngữ cảnh của sổ đó (xem runInCtx) nên cùng một đoạn mã lo cho
 * sổ mặc định lẫn sổ riêng của từng người — hai bên không bao giờ lệch schema.
 */
export function prepareLedger() {
  activeDb().exec('PRAGMA foreign_keys = ON;');
  activeDb().exec(SCHEMA);
  migrate();
  installAuditTriggers();
}

/**
 * Phiên ghi nhật ký AI đang mở.
 *
 * Phải theo NGỮ CẢNH của từng người dùng, không được là một biến dùng chung:
 * beginAudit và endAudit cách nhau nhiều lượt gọi công cụ có await, nên hai
 * người dùng đồng thời sẽ chen vào nhau và việc của người này bị ghi vào
 * nhật ký của người kia. Chạy một sổ thì rơi về biến cục bộ như cũ.
 */
let soloAudit = null;
const auditOf = () => (currentCtx() ? currentCtx().auditAction ?? null : soloAudit);
const setAudit = (v) => { const c = currentCtx(); if (c) c.auditAction = v; else soloAudit = v; };

export function beginAudit({ tool, args, batch, source = 'chat', reason = null }) {
  if (auditOf()) abortAudit();   // phiên trước chưa đóng đúng cách
  const res = run(
    'INSERT INTO ai_actions (batch, source, tool, args, reason) VALUES (?,?,?,?,?)',
    [batch || null, source, tool, JSON.stringify(args ?? {}).slice(0, 4000), reason],
  );
  const id0 = Number(res.lastInsertRowid);
  setAudit(id0);
  run('DELETE FROM ai_audit_state');
  run('INSERT INTO ai_audit_state (action_id) VALUES (?)', [id0]);
  return id0;
}

export function endAudit(result, ok = true) {
  if (!auditOf()) return null;
  const id = auditOf();
  setAudit(null);
  run('DELETE FROM ai_audit_state');
  const n = get('SELECT COUNT(*) c FROM ai_changes WHERE action_id = ?', [id])?.c || 0;
  run('UPDATE ai_actions SET result = ?, ok = ?, mutates = ? WHERE id = ?',
    [JSON.stringify(result ?? {}).slice(0, 4000), ok ? 1 : 0, n > 0 ? 1 : 0, id]);
  return id;
}

/** Huỷ phiên ghi nhật ký đang mở (dùng khi có lỗi). */
export function abortAudit() { setAudit(null); run('DELETE FROM ai_audit_state'); }

export function auditing() { return auditOf() != null; }

/** Insert helper: insert(table, {col: val}) -> row id */
export function insert(table, raw) {
  const data = applyAliases(table, raw);
  const cols = pickColumns(table, data);
  warnDropped(table, data, cols);
  if (!cols.length) throw new Error('Không có trường hợp lệ nào để lưu.');
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const res = run(sql, cols.map((c) => normVal(data[c])));
  return Number(res.lastInsertRowid);
}

/** Update helper: update(table, id, {col: val}) */
export function update(table, id, raw) {
  const data = applyAliases(table, raw);
  const cols = pickColumns(table, data);
  warnDropped(table, data, cols);
  if (!cols.length) return 0;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return run(sql, [...cols.map((c) => normVal(data[c])), id]).changes;
}

export function remove(table, id) {
  return run(`DELETE FROM ${table} WHERE id = ?`, [id]).changes;
}

function normVal(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v === undefined ? null : v;
}

export function setting(key, value) {
  if (value === undefined) {
    const row = get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    typeof value === 'object' ? JSON.stringify(value) : String(value),
  ]);
  return value;
}
