# FinMate — Cố vấn tài chính cá nhân all-in-one

Ứng dụng quản lý tài chính cá nhân cho người Việt: **tự động theo dõi thu chi**, **tự phân bổ tiền vào quỹ**, và một **cố vấn tài chính trò chuyện bằng tiếng Việt** hiểu lệnh tự nhiên ("trưa nay ăn 60k", "bao giờ mình tự do tài chính?", "dư 200 triệu nên làm gì?").

Không cần internet, không cần tài khoản, không gửi dữ liệu đi đâu — mọi thứ nằm trong một file SQLite trên máy bạn.

---

## Chạy trong 60 giây

```bash
cd finmate
npm install            # cài cho cả server + web
npm run seed           # tạo dữ liệu mẫu 6 tháng (persona Nam, 28 tuổi, TP.HCM)
npm run dev            # API :4000 + giao diện :5173
```

Mở http://localhost:5173 → app mở thẳng vào màn hình **Chat**. Nhắn "chào bạn" để bắt đầu.

Chạy bản production (1 cổng duy nhất):

```bash
npm start              # build web rồi phục vụ tại http://localhost:4000
```

Bắt đầu từ dữ liệu trắng của chính bạn:

```bash
npm run reset          # xoá sạch, app sẽ tự chạy onboarding qua chat
```

> Yêu cầu **Node.js ≥ 22.5** (dùng module `node:sqlite` có sẵn, không phải build native).

---

## Tính năng

### 1. Chat — trái tim của app
Onboarding hoàn toàn bằng hội thoại: app hỏi tuổi, thu nhập, tài khoản, nợ, mục tiêu... rồi **tự dựng kế hoạch tài chính** ngay khi bạn trả lời xong.

Sau đó chat hiểu ~30 loại ý định, tự phát hiện số tiền kiểu Việt (`60k`, `1tr5`, `1,2 tỷ`, `3 củ`, `1 triệu rưỡi`):

| Bạn nhắn | App làm gì |
|---|---|
| `trưa nay ăn 65k ở cơm tấm` | ghi chi tiêu, tự phân loại, trừ ngân sách |
| `nhận lương 31 triệu` | ghi thu nhập + **tự chia vào các quỹ** theo tỷ lệ |
| `chuyển 5 triệu từ VCB sang tiết kiệm` | ghi chuyển khoản giữa 2 tài khoản |
| `tạo mục tiêu mua xe 500 triệu trong 24 tháng` | tạo mục tiêu + tính số tiền cần để dành/tháng |
| `đặt ngân sách ăn uống 5 triệu` | tạo ngân sách tháng |
| `chia quỹ thiết yếu 45% tự do tài chính 20%` | đổi công thức phân bổ |
| `mua 100 cổ phiếu VNM giá 62` | ghi lệnh mua, cập nhật danh mục |
| `tôi có nên mua macbook 45 triệu không` | phân tích khả năng chi trả, ảnh hưởng tới mục tiêu |
| `tôi dư 200 triệu nên làm gì` | thác nước ưu tiên: nợ lãi cao → quỹ khẩn cấp → đầu tư → hưởng thụ |
| `bao giờ tôi tự do tài chính` | ngày FIRE + các kịch bản rút ngắn |
| `undo` | hoàn tác thao tác vừa rồi |

Ngoài ra còn **19 chủ đề kiến thức** trả lời gắn với số liệu thật của bạn: lạm phát, lãi kép, vàng, crypto, mua nhà hay thuê, bảo hiểm, ETF, quy tắc 50/30/20, thị trường giảm mạnh, thuế TNCN, cho bạn vay tiền, tiêu tiền cho bản thân sao cho hợp lý...

### 2. Tự động hoá — không nhập tay
- **Webhook `/api/ingest`**: đẩy SMS/thông báo ngân hàng từ điện thoại vào (xem [Tự động hoá](#tự-động-hoá-thu-chi) bên dưới).
- **Parser SMS ngân hàng VN**: đọc được số tiền, ngày, số dư, nội dung, tự nhận biết tiền vào/ra.
- **Import CSV sao kê** (có xem trước, tự dò cột, chống trùng lặp).
- **Khoản định kỳ**: lương, tiền trọ, trả góp, subscription... tự ghi sổ khi tới hạn, bù cả kỳ bị bỏ lỡ.
- **Luật phân loại**: tự gán danh mục theo tên người bán, học dần từ thao tác của bạn.
- **Chống trùng**: mọi giao dịch có `external_id`, nạp lại cùng một SMS không tạo bản ghi thừa.

### 3. Quản lý tiền
- **Tài khoản & ví**: ngân hàng, tiền mặt, ví điện tử, tiết kiệm có kỳ hạn, chứng khoán, thẻ tín dụng (số dư âm), tự cân bằng lại số dư khi lệch.
- **Quỹ (hũ)**: chia thu nhập tự động theo tỷ lệ — thiết yếu / tự do tài chính / mục tiêu lớn / hưởng thụ / học tập / dự phòng.
- **Mục tiêu**: tiến độ, còn bao nhiêu tháng, cần để dành bao nhiêu/tháng, cảnh báo chậm tiến độ, tự nạp từ quỹ.
- **Ngân sách** theo danh mục, cảnh báo khi sắp vượt, có rollover.
- **Nợ**: kế hoạch trả **avalanche** vs **snowball**, ngày sạch nợ, tổng lãi tiết kiệm được.
- **Đầu tư**: cổ phiếu / quỹ mở / vàng / crypto, lãi lỗ, phân bổ tài sản, cổ tức dự kiến.
- **Bất động sản**: giá trị, dòng tiền cho thuê, tỷ suất.
- **Thu nhập**: lương, freelance, cho thuê, lãi ngân hàng, cổ tức — theo dõi độ ổn định và tỷ trọng **thu nhập thụ động**.

### 4. Cố vấn & dự báo
- **Điểm sức khoẻ tài chính** (0–100) với chẩn đoán từng thành phần.
- **FIRE**: ngày tự do tài chính, tuổi nghỉ hưu, các kịch bản (tăng tiết kiệm, giảm chi, tăng thu).
- **Dự báo dòng tiền 90 ngày**: ngày số dư thấp nhất, cảnh báo cạn tiền.
- **Số tiền an toàn để tiêu hôm nay** (đã trừ hoá đơn sắp tới và hạn mức ngân sách).
- **Quỹ khẩn cấp**: đang đủ mấy tháng, cần thêm bao nhiêu.
- **Thuế TNCN Việt Nam**: gross ↔ net, biểu luỹ tiến 7 bậc, giảm trừ người phụ thuộc.
- **Insights tự động**: chi tiêu bất thường, ngân sách sắp vượt, subscription quên huỷ, tiền nằm chết, nợ lãi cao...
- **Gợi ý tiêu tiền dư dả**: khi có tiền dư, app đề xuất thứ tự phân bổ có lý do, không chỉ bảo "hãy tiết kiệm".

---

## Tự động hoá thu chi

Bật webhook trong tab **Tự động hoá**, lấy URL + token, rồi cấu hình trên điện thoại:

**Android (MacroDroid / Tasker):** trigger khi có SMS từ ngân hàng → HTTP POST

```
POST http://<ip-máy-bạn>:4000/api/ingest
Header: x-finmate-token: <token trong tab Tự động hoá>
Body:   {"text": "<nội dung SMS>", "sender": "VCB"}
```

**iOS (Shortcuts):** Automation → khi nhận tin nhắn từ ngân hàng → Get Contents of URL với cùng nội dung trên.

**Không muốn cài gì:** vào tab **Tự động hoá** → dán nội dung SMS vào ô "Thử tin nhắn", hoặc **import CSV sao kê** tải từ app ngân hàng.

Mọi giao dịch nạp vào đều được tự phân loại, tự trừ ngân sách, tự phân bổ quỹ nếu là thu nhập.

---

## Kết nối LLM (tuỳ chọn)

App **chạy đầy đủ mà không cần LLM** — toàn bộ NLU là rule-based tiếng Việt. Nếu muốn câu trả lời tự nhiên hơn cho câu hỏi ngoài luồng, đặt biến môi trường (bất kỳ endpoint nào tương thích OpenAI):

```bash
FINMATE_LLM_URL=https://api.openai.com/v1/chat/completions
FINMATE_LLM_KEY=sk-...
FINMATE_LLM_MODEL=gpt-4o-mini
```

LLM chỉ được dùng để diễn đạt; mọi con số vẫn tính từ dữ liệu trong máy.

---

## Kiến trúc

```
finmate/
├─ server/                    # API Node.js + Express, DB = node:sqlite
│  ├─ src/
│  │  ├─ db.js                # kết nối SQLite, helper all/get/insert/update/run
│  │  ├─ schema.sql           # ~25 bảng
│  │  ├─ bootstrap.js         # danh mục, quỹ, luật phân loại mặc định
│  │  ├─ routes/api.js        # ~84 endpoint + vòng lặp tự động hoá
│  │  ├─ services/
│  │  │  ├─ ledger.js         # ghi sổ, chống trùng, cân bằng số dư
│  │  │  ├─ funds.js          # phân bổ thu nhập vào quỹ
│  │  │  ├─ ingest.js         # parser SMS + CSV
│  │  │  ├─ recurring.js      # khoản định kỳ, bù kỳ bỏ lỡ
│  │  │  ├─ goals/budgets/debts/investments/networth/tax/...
│  │  │  ├─ fire.js           # FIRE, quỹ khẩn cấp
│  │  │  ├─ forecast.js       # dòng tiền 90 ngày, số tiền an toàn để tiêu
│  │  │  ├─ advisor.js        # điểm sức khoẻ, thác nước tiền dư
│  │  │  ├─ insights.js       # phát hiện bất thường
│  │  │  └─ chat/             # nlu.js · handlers.js · knowledge.js · onboarding.js
│  │  └─ scripts/{seed,reset}.js
│  └─ test/
└─ web/                       # React 18 + Vite, 15 trang, biểu đồ tự vẽ bằng SVG
   └─ src/pages/              # Chat, Dashboard, Transactions, Accounts, Funds, Goals,
                              # Budgets, Income, Investments, Debts, Fire, Advisor,
                              # Insights, Automation, Settings
```

Không dùng thư viện biểu đồ, không ORM, không service ngoài. Dữ liệu nằm ở `server/data/finmate.db`.

---

## Đưa vào sử dụng thật

### 1. Đặt mã PIN (bắt buộc)
Vào **Cài đặt → Bảo mật → Bật khoá**. Khi đã bật, mọi endpoint đều cần khoá phiên; mở app lên sẽ hiện màn hình nhập PIN. Phiên hết hạn sau 30 ngày hoặc khi server khởi động lại. Sai PIN 8 lần liên tiếp sẽ bị khoá 5 phút.

### 2. Dùng từ điện thoại (cùng wifi)

```bash
npm run start:lan          # nghe trên 0.0.0.0, in sẵn địa chỉ LAN
```

Mặc định server **chỉ nghe 127.0.0.1** để an toàn. Chỉ mở ra LAN sau khi đã đặt PIN — server sẽ cảnh báo nếu chưa. Mở `http://<ip-máy>:4000` trên điện thoại rồi "Thêm vào màn hình chính" để dùng như app.

### 3. Bật webhook SMS
Tab **Tự động hoá** → tạo token → cấu hình Shortcuts/MacroDroid như phần [Tự động hoá](#tự-động-hoá-thu-chi). Endpoint `/api/ingest` dùng token riêng nên điện thoại không cần giữ PIN.

### 4. Sao lưu
- Tự động mỗi ngày vào `server/data/backups/` (giữ 14 bản gần nhất).
- Thủ công: `npm run backup`, hoặc **Cài đặt → Sao lưu → Tải file dữ liệu / Xuất JSON**.
- **Nên** copy thư mục `backups` sang OneDrive/Google Drive hoặc ổ ngoài — máy hỏng là mất hết.

### 5. Chạy nền lâu dài
Windows: dùng Task Scheduler chạy `npm start` lúc đăng nhập. macOS/Linux: `pm2 start server/src/index.js --name finmate` hoặc systemd unit.

### 6. Nếu muốn truy cập qua internet
Đừng mở thẳng cổng 4000 ra ngoài. Dùng **Tailscale** (đơn giản nhất, không cần mở cổng) hoặc đặt sau reverse proxy có HTTPS (Caddy/Nginx + Let's Encrypt) và đặt `FINMATE_ORIGINS=https://ten-mien-cua-ban`.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | Cổng server |
| `FINMATE_HOST` | `127.0.0.1` | `0.0.0.0` để mở ra LAN |
| `FINMATE_ORIGINS` | – | Origin bổ sung được phép gọi API (phân tách bằng dấu phẩy) |
| `FINMATE_DB` | `server/data/finmate.db` | Đường dẫn file dữ liệu |
| `FINMATE_BACKUP_DIR` | `server/data/backups` | Nơi lưu bản sao lưu |
| `FINMATE_BACKUP_KEEP` | `14` | Số bản sao lưu giữ lại |
| `FINMATE_LLM_URL/KEY/MODEL` | – | Kết nối LLM tuỳ chọn |

### Những việc chỉ bạn làm được
- **Kết nối ngân hàng tự động**: Việt Nam chưa có Open Banking mở cho cá nhân. Cách khả thi nhất vẫn là webhook SMS/thông báo như trên, hoặc import CSV sao kê định kỳ.
- **Giá chứng khoán/vàng tự cập nhật**: hiện nhập tay hoặc qua chat (`giá HPG 30`). Nếu có nguồn API bạn được phép dùng, có thể nối vào `services/investments.js` → `setPrice()`.
- **Nhiều người dùng**: app thiết kế cho một người. Muốn dùng chung cho gia đình thì cần thêm bảng `users` và tách dữ liệu theo `user_id`.

---

## Kiểm thử

```bash
npm test                          # unit test (node --test): parser tiền, thuế, NLU, SMS
cd server && node test/smoke-auth.mjs      # PIN, phiên, sao lưu, xuất dữ liệu
cd server && node test/smoke-ui.mjs        # mọi field frontend dùng đều tồn tại trong API
cd server && node test/smoke-chat.mjs      # 29 ý định chat
cd server && node test/smoke-knowledge.mjs # 19 câu hỏi tài chính mở
cd web    && node test/render.mjs          # render thật 15 trang trong jsdom với API thật
```

Các lệnh smoke cần server đang chạy (`npm run dev:api`). `render.mjs` bắt cả lỗi hiển thị `undefined`/`NaN` trên giao diện.

---

## Ghi chú kỹ thuật

- Tiền lưu bằng **số nguyên VND**, không dùng số thực.
- `node:sqlite` trả về object null-prototype → luôn đi qua helper `plain()` trong `db.js`.
- SQLite hiểu `"..."` là tên cột — trong SQL luôn dùng nháy đơn cho chuỗi.
- Ngày lưu dạng `YYYY-MM-DD` theo giờ địa phương.
- Thẻ tín dụng để `include_in_networth = 0` và theo dõi qua bảng `debts` để không đếm nợ hai lần.
- Mã PIN băm bằng `scrypt` + salt ngẫu nhiên, so sánh bằng `timingSafeEqual`, không bao giờ xuất ra `/settings` hay bản export.
- Khoá phiên nằm trong RAM (mất khi restart) — không lưu xuống đĩa, không dùng cookie nên miễn nhiễm CSRF.
- CORS chỉ chấp nhận origin localhost/LAN hoặc origin bạn khai báo trong `FINMATE_ORIGINS`.
- Sao lưu dùng `VACUUM INTO` nên bản sao luôn nhất quán kể cả khi server đang ghi.
