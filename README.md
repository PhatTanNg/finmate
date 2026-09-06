# FinMate — Cố vấn tài chính cá nhân all-in-one

[![CI](https://github.com/PhatTanNg/finmate/actions/workflows/ci.yml/badge.svg)](https://github.com/PhatTanNg/finmate/actions/workflows/ci.yml)

Ứng dụng quản lý tài chính cá nhân cho người Việt — kể cả người Việt đang sống ở nước ngoài: **tự động theo dõi thu chi**, **tự phân bổ tiền vào quỹ**, **đa tiền tệ (VND, EUR, USD, GBP, JPY, KRW, TWD, AUD, CAD, SGD)**, và một **cố vấn tài chính AI** trò chuyện bằng tiếng Việt — không chỉ trả lời, mà còn **tự thao tác trong app** giúp bạn: ghi giao dịch, cập nhật số dư, tạo mục tiêu, chia lại quỹ ("trưa nay ăn 60k", "AIB còn 5000 euro", "gửi 800 euro về Việt Nam", "bao giờ mình tự do tài chính?").

Thiết kế cho **điện thoại** trước — mở app là vào thẳng cuộc trò chuyện với cố vấn của bạn.

Không cần tài khoản, không gửi dữ liệu đi đâu — mọi thứ nằm trong một file SQLite trên máy bạn. (Chỉ tỷ giá lấy online và có thể nhập tay; phần cố vấn AI là tuỳ chọn, tắt đi app vẫn chạy đủ tính năng offline.)

---

## Chạy trong 60 giây

```bash
cd finmate
npm install            # cài cho cả server + web
npm run seed           # dữ liệu mẫu 6 tháng — persona Nam, 28 tuổi, TP.HCM (VND)
npm run dev            # API :4000 + giao diện :5173
```

Đang sống và làm việc ở nước ngoài? Dùng persona đa tiền tệ:

```bash
npm run seed:ie        # persona Phát, 30 tuổi, Dublin — lương EUR, đầu tư + gửi tiền về VN
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

## Chạy ngay trên điện thoại — không cần máy chủ

FinMate có hai cách chạy, cùng một mã nguồn:

| | Máy chủ Node (mặc định) | **App trên điện thoại** |
|---|---|---|
| Engine SQLite | `node:sqlite`, file `.db` trên đĩa | **SQLite WebAssembly** (sql.js) trong trình duyệt, chép xuống IndexedDB sau mỗi lần ghi |
| API | Express qua HTTP | Cùng `routes/api.js`, gọi **thẳng trong tiến trình** (không cổng, không mạng) |
| Cần gì để chạy | Node ≥ 22.5 trên máy tính | Chỉ trình duyệt của điện thoại; cài lên màn hình chính là thành app |
| Webhook tin ngân hàng | Có (`/api/ingest`) | Không có máy chủ nên không có webhook — dán tin nhắn vào ô nhận diện |
| Cố vấn AI | key trong `.env` | key nhập trong **Cài đặt**, lưu trên máy, gọi thẳng nhà cung cấp |
| Sao lưu | thư mục `backups/` | hệ tệp ảo trong IndexedDB + nút **Xuất file .db** / **Nhập file .db** |

```bash
npm run build:app          # -> web/dist-embedded/  (một thư mục tĩnh, mở là chạy)
npm run preview:app        # xem thử tại http://localhost:5174
npm run test:app           # 27 kiểm: engine WebAssembly, router trong tiến trình, PIN, sao lưu, xoá sạch
```

Đưa `web/dist-embedded/` lên bất kỳ nơi phục vụ file tĩnh có HTTPS (GitHub Pages, Netlify, Cloudflare Pages…), mở trên điện thoại rồi **Thêm vào màn hình chính**: từ đó app mở toàn màn hình, chạy được khi tắt wifi (service worker đệm mã, IndexedDB giữ dữ liệu). Muốn lên App Store / Play Store thì bọc bằng Capacitor — cấu hình đã có sẵn ở `web/capacitor.config.json`:

```bash
cd web
npm run cap:init           # cài Capacitor, tạo thư mục ios/ và android/
npm run cap:sync           # build bản nhúng rồi chép vào project native
npm run cap:ios            # mở Xcode  (macOS)  -> Run lên iPhone
npm run cap:android        # mở Android Studio -> Run lên máy Android
```

Cách nó hoạt động (thư mục `web/src/native/`): `db_engine.browser.js` bọc sql.js theo đúng giao diện `node:sqlite` mà `server/src/db.js` dùng, nên schema, migration, trigger nhật ký AI là chung; `router.js` thay HTTP bằng `dispatch(method, path, body)` với req/res giả đủ cho các handler (kể cả luồng SSE của chat và tải file sao lưu); `shims/` giả `fs` (hệ tệp ảo), `crypto` (scrypt thuần JS cùng tham số với Node nên PIN băm giống nhau), `express`; `boot.js` dựng môi trường rồi mới import `routes/api.js`. Vite đổi module theo `web/native.aliases.js` khi build `--mode embedded`; bản máy chủ không đổi gì.

Giới hạn đáng biết: dữ liệu nằm trong bộ nhớ trình duyệt của máy đó — xoá dữ liệu trang / gỡ app là mất, nên hãy **xuất file .db** định kỳ (nút trong Cài đặt, chia sẻ thẳng lên iCloud/Drive). Safari có thể dọn IndexedDB của web app không dùng lâu; bản bọc Capacitor không bị vậy.

## Tính năng

### 1. Chat — trái tim của app

Có hai chế độ, tự chọn theo cấu hình:

**A. Cố vấn AI thật sự** (khi có `FINMATE_LLM_KEY` — [xem cách bật](#kết-nối-llm-tuỳ-chọn))

Chat box trở thành một cố vấn tài chính có toàn quyền đọc và chỉnh sửa dữ liệu trong app qua **74 công cụ**. Không phải kịch bản hỏi-A-đáp-A: AI tự quyết định cần tra cứu gì, ghi gì, rồi trả lời bằng số liệu thật của bạn.

**App là công cụ làm việc của AI.** Nó không chỉ tra cứu và khuyên — nó tự dựng và vận hành cấu trúc tài chính cho bạn: tạo tài khoản, mở quỹ mới, đặt mục tiêu và hạn hoàn thành, đổi tỷ lệ phân bổ, sắp xếp lại độ ưu tiên, đóng quỹ không còn phù hợp và dồn số dư sang quỹ khác. Việc nào hoàn tác được thì nó làm luôn rồi báo lại; chỉ những việc xoá vĩnh viễn mới hỏi bạn trước.

**Dọn dẹp và sửa sai cũng là việc của nó.** Bộ công cụ ban đầu chỉ biết *thêm vào*, nên khi sổ sách lộn xộn — trùng mục tiêu, nợ đã trả xong, nguồn thu cũ — AI chỉ biết hứa mà không làm được. Giờ nó liệt kê, sửa và xoá được mọi loại tài nguyên (mục tiêu, nguồn thu, nợ, đầu tư, ngân sách, khoản định kỳ, tài khoản, từng giao dịch), gộp bản trùng lặp, và làm lại từ đầu khi bạn muốn.

- **Onboarding bằng hội thoại tự nhiên**: lần đầu mở app, AI trò chuyện để tìm hiểu bạn — tên, tuổi, đang sống ở đâu, thu nhập, các tài khoản và số dư, nợ, mục tiêu — và **ghi ngay vào app trong lúc nói chuyện**. Bạn kể một lúc nhiều thứ cũng được, nó lưu hết.
- **Tự thao tác trong app**: bạn nói "AIB còn 5000 euro" → nó cập nhật số dư; "đặt ngân sách ăn uống 400 euro" → nó tạo ngân sách; "mình vừa trả 300 euro thẻ tín dụng" → nó ghi trả nợ và tính lại dư nợ. Mỗi thao tác đều hiện chip xác nhận dưới câu trả lời (✍️ Đã ghi giao dịch, 💰 Đã cập nhật số dư…).
- **Quản lý quỹ theo mục tiêu và thời hạn**: "mở quỹ đổi xe 30.000 euro trước hè 2028" → nó tạo quỹ, đặt hạn, tính ra bạn cần bỏ vào bao nhiêu mỗi tháng, xếp độ ưu tiên so với các quỹ khác, và cảnh báo nếu tổng gánh nặng hàng tháng vượt quá khả năng của bạn.
- **Lời khuyên gắn với số của bạn**: nó tra tài sản ròng, tỷ lệ tiết kiệm, quỹ khẩn cấp, ngày FIRE… trước khi khuyên, nên không nói chung chung.
- **Chủ động cảnh báo** khi thấy rủi ro thật: sắp âm tiền, nợ lãi cao, quỹ khẩn cấp mỏng.
- Câu trả lời được tối ưu để **đọc trên điện thoại**: ngắn, ít bảng, in đậm con số quan trọng.
- **Thấy AI đang làm gì theo thời gian thực**: câu trả lời đi qua luồng SSE (`POST /api/chat/stream`), nên thay vì ba chấm chờ 10-20 giây, màn hình hiện từng bước "⏳ Đang ghi giao dịch: 65000 · ăn trưa" → "✅" → "💬 Đang soạn câu trả lời…". Server cũ hay proxy không hỗ trợ luồng thì giao diện tự lùi về `POST /api/chat`.
- **Chụp hoá đơn là xong** 📷: bấm nút máy ảnh trong chat, chụp hoá đơn, biên lai hay màn hình thông báo ngân hàng — AI đọc số tiền, nơi chi, ngày rồi ghi sổ, nói rõ nó đã đọc được gì để bạn kiểm. Ảnh được thu nhỏ ngay trên điện thoại (≤1600px) trước khi gửi và **không lưu vào cơ sở dữ liệu**, lịch sử chỉ ghi dấu "đã gửi kèm ảnh". Cần cố vấn AI đang bật; chưa bật thì app nói thẳng thay vì im lặng.
- **Hoàn tác cả lượt bằng một chạm**: dưới mỗi câu trả lời có thay đổi dữ liệu là nút "↩️ Hoàn tác lượt này" — trả lại mọi thứ lượt đó đã đụng vào (số dư, quỹ, mục tiêu), không chỉ giao dịch.
- **Không giả vờ là AI**: nếu AI bật mà không phản hồi được (key sai, hết hạn mức, quá tải), câu trả lời của bộ luật mang chip "📐 Bộ luật trả lời — AI không phản hồi được: …" kèm lý do, thay vì để bạn tưởng đó là lời cố vấn.

**AI nhìn thấy toàn bộ tài nguyên nó đang quản.** Mỗi lượt chat, app gửi kèm cho AI một bức tranh đầy đủ chứ không bắt nó mò từng công cụ: số dư từng ví, từng quỹ kèm % + độ ưu tiên + hạn hoàn thành + số tiền cần bỏ mỗi tháng, tổng % phân bổ có cân bằng chưa, ngân sách từng danh mục còn bao nhiêu, danh mục đầu tư lãi lỗ ra sao, các khoản định kỳ 30 ngày tới. Nhờ vậy nó điều phối được tổng thể như một cố vấn thật:

| AI thấy gì | Nó tự làm gì |
|---|---|
| Tổng % các quỹ đang là 125% chứ không phải 100% | Gọi `can_bang_phan_bo` kéo về đúng 100% mà **giữ nguyên tỉ lệ** giữa các quỹ, rồi báo lại một dòng |
| Tổng tiền cần bỏ vào quỹ mỗi tháng vượt tiền dư | Nói thẳng con số thiếu hụt, đề xuất giãn hạn quỹ nào / hạ mục tiêu quỹ nào, thay vì im lặng nhận thêm mục tiêu mới |
| Tiền không đủ cho mọi quỹ | Cắt theo **độ ưu tiên** từ thấp lên, không cắt đều tay |
| Quỹ quá hạn, ngân sách sắp vượt, nợ lãi cao | Nêu ra dù bạn không hỏi |

**Lan can an toàn cho AI.** AI suy luận vẫn có lúc sai — gõ thừa số 0, gửi số âm, đặt hạn đã qua. Mọi công cụ ghi dữ liệu đều tự kiểm trước khi lưu:

| Tình huống | App làm gì |
|---|---|
| Số tiền âm (chi tiêu, nguồn thu, góp mục tiêu, giá cổ phiếu) | **Chặn**, kèm gợi ý đúng (ví dụ "muốn ghi tiền vào thì đặt `loai=income`") |
| Số tiền lớn bất thường (gấp >30 lần mức chi trung bình) | **Vẫn ghi** — mua nhà là có thật — nhưng báo để AI hỏi lại bạn cho chắc |
| Ngày ở tương lai xa quá 60 ngày | Cảnh báo và nhắc dùng giao dịch định kỳ thay vì ghi sổ ngay |
| Hạn mục tiêu/quỹ nằm ở quá khứ | Cảnh báo, vì không tính được số tiền cần góp mỗi tháng |
| Lãi suất nợ ngoài khoảng 0-200%/năm | **Chặn**, tránh làm vỡ kế hoạch trả nợ |
| Độ ưu tiên quỹ âm hoặc quá lớn | Kẹp về khoảng 1-99 để không vượt mặt quỹ thiết yếu |
| Tổng phân bổ quỹ khác 100% | Báo rõ **% thực nhận** của từng quỹ, vì tiền được chia theo tỉ lệ chứ không theo con số tuyệt đối |
| Xoá quỹ còn số dư | **Chặn**, hướng sang đóng quỹ để giữ lịch sử và dồn tiền sang quỹ khác |

**AI có trí nhớ, có nhật ký, và tự rà soát khi bạn vắng mặt.** Ba thứ tách một con bot trả lời hay khỏi một cố vấn thật sự — vì cố vấn thật thì nhớ bạn là ai, ghi lại việc mình làm, và không ngồi im chờ được hỏi:

| Năng lực | Nghĩa là gì trong app |
|---|---|
| **Nhật ký thao tác** (trang *AI đã làm gì*) | Mọi lần AI đụng vào dữ liệu đều được ghi lại kèm **lý do**. Bấm vào xem đúng từng dòng dữ liệu đã đổi — cũ thành mới — rồi **Hoàn tác** nếu không đồng ý. Hoàn tác trả lại **cả số dư**, không chỉ xoá giao dịch. Việc bạn tự làm bằng tay không bị ghi nhầm thành của AI |
| **Trí nhớ dài hạn** | AI ghi nhớ những điều quan trọng về bạn (sở thích, ràng buộc, quyết định đã chốt, kế hoạch) và mang theo vào **mọi** lượt chat sau. Không còn cảnh kể lại hoàn cảnh từ đầu sau vài chục tin nhắn. Bạn xem, sửa, xoá được từng mục |
| **Tự rà soát định kỳ** | Theo chu kỳ bạn đặt, AI tự mở hồ sơ ra xem và nhắn lại nếu thấy điều đáng chú ý. Ba chế độ: **Tắt** · **Chỉ gợi ý** (mặc định — được xem, **không được đụng vào tiền** lúc bạn vắng mặt) · **Được phép chỉnh** (tự sửa, nhưng mọi thứ vẫn nằm trong nhật ký và hoàn tác được) |

Nhật ký bắt thay đổi ở tầng cơ sở dữ liệu bằng trigger SQLite, nên chi phí **không tăng theo độ dày sổ sách**: khoảng 6ms dù bạn đã ghi 6.000 giao dịch.

**AI điều phối app thay bạn — chế độ tự lái.** Bạn không phải mở tab nào để "vận hành" sổ sách. Mỗi giờ (và ngay khi có tin nhắn ngân hàng mới), cố vấn tự nhìn toàn bộ dữ liệu và biến việc cần làm thành **đề xuất cụ thể có sẵn tham số** — không phải lời khuyên chung chung. Mỗi đề xuất là một chuỗi công cụ (đúng bộ 74 công cụ AI dùng trong chat); bấm **Đồng ý** ở Trang chủ/Chat, hoặc nhắn "ừ", là app làm, có nhật ký và **hoàn tác được cả cụm**.

| Cố vấn tự nhận ra | Nó đề xuất (và làm khi bạn gật) |
|---|---|
| Tổng % các quỹ lệch 100 | `can_bang_phan_bo` — việc an toàn, ở chế độ *Tự làm* nó làm luôn rồi báo |
| Tiền nhà / gói cước lặp 3 tháng liền mà chưa có trong định kỳ | `tao_giao_dich_dinh_ky` đúng số tiền, ngày, tài khoản, danh mục |
| Danh mục chi lớn chưa có ngân sách | `dat_ngan_sach` theo mức trung bình 3 tháng |
| Mục tiêu không kịp hạn với dôi dư hiện tại | `sua_muc_tieu` giãn hạn tới mốc thực tế, kèm con số vì sao |
| Quỹ âm vì tỉ lệ đặt sai | nâng % quỹ đó rồi cân bằng phần còn lại — hai bước, một lần gật |
| Giao dịch app phân loại chưa chắc | một đề xuất xác nhận cả cụm; chốt xong app **học luật** để lần sau tự xếp đúng |
| Tin nhắn ngân hàng vừa vào sổ | nhắn một dòng "Vừa thấy −€45,20 tại Tesco → Đi chợ, ngân sách còn €120"; mơ hồ thì hỏi lại |
| Mỗi sáng | bản tin ngắn: hôm qua chi gì, còn tiêu an toàn bao nhiêu, hoá đơn sắp tới, việc đang chờ gật |

Ba mức trong **Cài đặt → Cố vấn tự lái**: *Tắt* · *Đề xuất rồi chờ gật* (mặc định) · *Tự làm việc an toàn* (việc hoàn tác được thì làm luôn rồi báo, việc còn lại vẫn hỏi). Có model AI thì agent dùng thêm công cụ `de_xuat` để đưa đề xuất của chính nó vào cùng hàng đợi — kể cả trong phiên tự rà soát lúc bạn vắng mặt; "ừ"/"thôi" ngay sau một đề xuất được xử lý chắc chắn ở tầng bộ luật, không cần model.

**AI là lớp tiện lợi, không phải điều kiện để dùng app.** Mọi việc AI làm được qua công cụ đều có nút làm tay tương ứng trên giao diện: thêm/sửa/xoá tài khoản, quỹ (kể cả nút *Cân bằng về 100%*), mục tiêu, ngân sách, nguồn thu, nợ (*Trả nợ* ghi một lần trả và trừ dư nợ), đầu tư, bất động sản, khoản định kỳ (sửa, tạm dừng), trí nhớ của cố vấn (*+ Ghi nhớ*), danh mục thu chi, gộp bản trùng, và xoá sạch dữ liệu với cùng chốt chặn "XOA HET". Không có key AI hay không có internet thì:

- **Chat vẫn trả lời** bằng bộ luật tiếng Việt bên dưới, ghi sổ và tra số liệu như thường; chỉ đọc ảnh hoá đơn là cần model.
- **Cầu dao mất mạng**: sau một lần không tới được máy chủ AI, app tạm không gọi model trong 60 giây và bộ luật trả lời tức thì, thay vì bắt bạn chờ thử lại ở mỗi câu. Giao diện gửi kèm cờ `offline` khi trình duyệt báo mất mạng nên còn không cần chờ lần lỗi đầu tiên. Thanh trên hiện "📴 Ngoại tuyến", câu trả lời mang chip "📴 Bộ luật trả lời".
- **Tỷ giá** dùng bản đã lưu; sao lưu, xuất dữ liệu, webhook tin nhắn ngân hàng trong mạng nội bộ đều không cần internet.
- **Cài lên màn hình chính** iPhone/Android như một app (manifest + chế độ toàn màn hình), không thanh địa chỉ.

**B. Bộ luật tiếng Việt offline** (mặc định, không cần key, không cần internet)

Onboarding theo từng bước, hiểu ~30 loại ý định và tự phát hiện số tiền kiểu Việt (`60k`, `1tr5`, `1,2 tỷ`, `3 củ`, `1 triệu rưỡi`). Đây cũng là lưới an toàn: nếu API AI lỗi hay hết hạn mức, app tự động rơi về chế độ này thay vì báo lỗi.

| Bạn nhắn | App làm gì |
|---|---|
| `trưa nay ăn 65k ở cơm tấm` | ghi chi tiêu, tự phân loại, trừ ngân sách |
| `nhận lương 31 triệu` | ghi thu nhập + **tự chia vào các quỹ** theo tỷ lệ |
| `chuyển 5 triệu từ VCB sang tiết kiệm` | ghi chuyển khoản giữa 2 tài khoản |
| `tạo mục tiêu mua xe 500 triệu trong 24 tháng` | tạo mục tiêu + tính số tiền cần để dành/tháng |
| `đặt ngân sách ăn uống 5 triệu` | tạo ngân sách tháng |
| `chia quỹ thiết yếu 45% tự do tài chính 20%` | đổi công thức phân bổ |
| `mua 100 cổ phiếu VNM giá 62` | ghi lệnh mua, cập nhật danh mục |
| `ăn trưa 12.50 euro ở Boojum` | ghi chi bằng EUR, quy đổi về đồng tiền gốc để lên báo cáo |
| `gửi 800 euro về Việt Nam` | báo giá chuyển tiền + tư vấn thời điểm theo tỷ giá 90 ngày |
| `tỷ giá euro hôm nay` | tỷ giá hiện tại, các cặp khác, so với trung bình 90 ngày |
| `thuế thu nhập của mình năm nay bao nhiêu` | tính thuế theo nước cư trú (Việt Nam hoặc Ireland) |
| `tôi có nên mua macbook 45 triệu không` | phân tích khả năng chi trả, ảnh hưởng tới mục tiêu |
| `tôi dư 200 triệu nên làm gì` | thác nước ưu tiên: nợ lãi cao → quỹ khẩn cấp → đầu tư → hưởng thụ |
| `bao giờ tôi tự do tài chính` | ngày FIRE + các kịch bản rút ngắn |
| `làm sao để có thu nhập thụ động` | lộ trình từng mốc: vốn cần, ngày đạt, việc làm ngay |
| `undo` | hoàn tác thao tác vừa rồi |

Ngoài ra còn **19 chủ đề kiến thức** trả lời gắn với số liệu thật của bạn: lạm phát, lãi kép, vàng, crypto, mua nhà hay thuê, bảo hiểm, ETF, quy tắc 50/30/20, thị trường giảm mạnh, thuế TNCN, cho bạn vay tiền, tiêu tiền cho bản thân sao cho hợp lý...

### 2. Tự động hoá — không nhập tay
- **Webhook `/api/ingest`**: đẩy SMS/thông báo ngân hàng từ điện thoại vào (xem [Tự động hoá](#tự-động-hoá-thu-chi) bên dưới). Luôn cần token riêng, không ai trong mạng LAN đẩy giao dịch giả vào được.
- **Parser tin nhắn ngân hàng đa quốc gia**: đọc được tin tiếng Anh lẫn tiếng Việt. Ireland & châu Âu: AIB, Bank of Ireland, Revolut, N26, Permanent TSB, Wise, Monzo, Starling, An Post, PayPal. Việt Nam: Vietcombank, Techcombank, BIDV, ACB, MB, VPBank, TPBank, Sacombank, VietinBank, Agribank, MoMo, ZaloPay, ShopeePay, VNPay, Cake, Timo.
- **Hiểu đúng từng đồng tiền**: `EUR 45.20` → 4.520 cent, `8,99 EUR` (dấu phẩy kiểu Đức) → 899 cent, `-350,000VND` → 350.000đ. Tự bỏ qua số thẻ, số tài khoản, mã tham chiếu để không nhầm thành số tiền; tự tách số dư còn lại ra khỏi số tiền giao dịch.
- **Tự khớp tài khoản theo đồng tiền**: tin nhắn euro vào tài khoản euro, tin nhắn đồng vào tài khoản đồng.
- **Import CSV sao kê** (có xem trước, tự dò cột, chống trùng lặp).
- **Khoản định kỳ**: lương, tiền trọ, trả góp, subscription... tự ghi sổ khi tới hạn, bù cả kỳ bị bỏ lỡ.
- **Luật phân loại**: tự gán danh mục theo tên người bán, học dần từ thao tác của bạn.
- **Chống trùng**: mọi giao dịch có `external_id`, nạp lại cùng một SMS không tạo bản ghi thừa.

### 3. Quản lý tiền
- **Tài khoản & ví**: ngân hàng, tiền mặt, ví điện tử, tiết kiệm có kỳ hạn, chứng khoán, thẻ tín dụng (số dư âm), tự cân bằng lại số dư khi lệch.
- **Quỹ (hũ)**: chia thu nhập tự động theo tỷ lệ — thiết yếu / tự do tài chính / mục tiêu lớn / hưởng thụ / học tập / dự phòng. Mỗi quỹ có thể đặt **số tiền mục tiêu + hạn hoàn thành**, app tự tính **cần bỏ vào bao nhiêu mỗi tháng** và cảnh báo khi trễ tiến độ. **Độ ưu tiên** (1 = thiết yếu → 5+ = hưởng thụ) quyết định quỹ nào được ưu tiên khi tiền không đủ. Quỹ không còn phù hợp thì **đóng** (giữ nguyên lịch sử, dồn số dư sang quỹ khác) thay vì xoá, và mở lại bất cứ lúc nào.
- **Mục tiêu**: tiến độ, còn bao nhiêu tháng, cần để dành bao nhiêu/tháng, cảnh báo chậm tiến độ, tự nạp từ quỹ.
- **Ngân sách** theo danh mục, cảnh báo khi sắp vượt, có rollover.
- **Nợ**: kế hoạch trả **avalanche** vs **snowball**, ngày sạch nợ, tổng lãi tiết kiệm được.
- **Đầu tư**: cổ phiếu / quỹ mở / vàng / crypto, lãi lỗ, phân bổ tài sản, cổ tức dự kiến. **Giá thị trường tự cập nhật mỗi giờ** từ nguồn miễn phí không cần key: VNDirect → VPS (cổ phiếu VN, nghìn đồng → đồng), Yahoo → Stooq (ETF/cổ phiếu quốc tế, tự quy đổi khi niêm yết bằng đồng khác ví), SJC (XML chính thức, theo lượng → chỉ) → giá thế giới × premium (vàng), CoinGecko (crypto theo đúng đồng tiền nắm giữ). Lịch sử giá lưu mỗi ngày một dòng; mã nào lỗi thì giữ giá cũ và ghi rõ vì sao, nhập tay vẫn được. Nút ↻ Cập nhật giá trên trang Đầu tư, chat _"cập nhật giá"_, _"giá vàng hôm nay"_, hoặc AI tự gọi `cap_nhat_gia_thi_truong` khi bạn hỏi lãi lỗ.
- **Bất động sản**: giá trị, dòng tiền cho thuê, tỷ suất.
- **Thu nhập**: lương, freelance, cho thuê, lãi ngân hàng, cổ tức — theo dõi độ ổn định và tỷ trọng **thu nhập thụ động**.

### 4. Cố vấn & dự báo
- **Điểm sức khoẻ tài chính** (0–100) với chẩn đoán từng thành phần.
- **FIRE**: ngày tự do tài chính, tuổi nghỉ hưu, các kịch bản (tăng tiết kiệm, giảm chi, tăng thu).
- **Lộ trình thu nhập thụ động**: từ "tiền của bạn đang phủ bao nhiêu % chi phí sống" tới vốn cần cho từng mốc (10% → 25% → 50% → 100%), ngày dự kiến đạt, và việc phải làm tuần này. Còn thiếu quỹ khẩn cấp hoặc còn nợ lãi trên 8%/năm thì app **chặn** gợi ý rót vốn thay vì vừa bảo trả nợ vừa bảo đầu tư.
- **Dự báo dòng tiền 90 ngày**: ngày số dư thấp nhất, cảnh báo cạn tiền.
- **Số tiền an toàn để tiêu hôm nay** (đã trừ hoá đơn sắp tới và hạn mức ngân sách).
- **Quỹ khẩn cấp**: đang đủ mấy tháng, cần thêm bao nhiêu.
- **Thuế TNCN Việt Nam**: gross ↔ net, biểu luỹ tiến 7 bậc, giảm trừ người phụ thuộc.
- **Thuế Ireland**: PAYE (20%/40% + tax credits), USC, PRSI, DIRT trên lãi ngân hàng, CGT, ưu đãi thuế khi đóng quỹ hưu.
- **Insights tự động**: chi tiêu bất thường, ngân sách sắp vượt, subscription quên huỷ, tiền nằm chết, nợ lãi cao...
- **Gợi ý tiêu tiền dư dả**: khi có tiền dư, app đề xuất thứ tự phân bổ có lý do, không chỉ bảo "hãy tiết kiệm".
- **Biến cố lớn của đời**: ly hôn, mất việc, sắp có con, cưới, thừa kế, bệnh nặng, người thân qua đời, nghỉ hưu, chuyển nước — app nhận ra và tư vấn theo số liệu thật của bạn (quỹ khẩn cấp trụ được mấy tháng, dòng tiền còn dư bao nhiêu, nợ lãi cao nào nên xử trước), kèm việc cần làm ngay. Đây là tầng chạy **không cần AI**, nên vẫn dùng được khi chưa cắm key hoặc lúc gọi model lỗi.

### 5. Đa tiền tệ & kiều hối
Dành cho người Việt sống ở nước ngoài: sinh hoạt bằng EUR nhưng vẫn giữ tài sản và đầu tư ở Việt Nam.

- **Mỗi tài khoản một đồng tiền riêng** — €8.237,06 ở AIB và 275.965.174đ ở Vietcombank cùng tồn tại, báo cáo tổng hợp tự quy đổi về **đồng tiền gốc** bạn chọn. Hỗ trợ 10 đồng tiền: VND, EUR, USD, GBP, JPY, KRW, TWD, AUD, CAD, SGD — đủ cho cả người xuất khẩu lao động Nhật, Hàn, Đài lẫn người định cư Úc, Canada, Singapore.
- **Mọi số tiền lưu bằng đơn vị nhỏ nhất** (VND: đồng, EUR: cent) nên không bao giờ sai lệch vì làm tròn.
- **Tỷ giá theo ngày**: giao dịch ghi kèm tỷ giá tại thời điểm phát sinh, đổi đồng tiền gốc sau này không làm sai lịch sử.
- **Tự cập nhật tỷ giá** mỗi ngày (open.er-api.com), có thể nhập tay khi offline.
- **Chat hiểu cả hai hệ**: `2 tỷ` luôn là VND kể cả khi bạn đang dùng EUR; `45k` theo đồng tiền gốc; `€1.500,75` và `1,500.75` đều đọc đúng.
- **Cổ phiếu Việt Nam vẫn tính bằng VND**: "FPT giá 135k" là 135.000đ/cp, không phải 135 nghìn euro.
- **Theo dõi kiều hối**: mỗi lần gửi tiền về nhà được ghi nhận kèm tỷ giá thực nhận, app tính **tổng chi phí thật** (phí + chênh lệch tỷ giá) theo % và quy ra mỗi năm.
- **Tư vấn thời điểm gửi**: so tỷ giá hiện tại với biên độ 90 ngày để gợi ý nên gửi ngay hay chờ.
- **Giả định thị trường theo đồng tiền**: kế hoạch FIRE dùng 9%/4% cho VND, 7%/2,5% cho EUR — đổi đồng tiền gốc thì tự đổi theo (trừ khi bạn đã tự chỉnh).
- **Mọi biểu mẫu đều nhận đồng tiền riêng**: tài khoản, nguồn thu, mục tiêu, ngân sách, quỹ, nợ, giao dịch, cổ phiếu và bất động sản đều có ô chọn đồng tiền; nhãn ô nhập luôn hiện đúng đồng tiền gốc và bạn gõ số như đời thường (`1.234,50` hay `1,234.50`).
- **Không cộng nhầm đồng tiền**: mọi phép tổng hợp (số dư, thu nhập thụ động, quỹ khẩn cấp, dự báo dòng tiền) đều quy đổi trước khi cộng.

Trang **Tiền tệ & chuyển tiền** cho xem tỷ giá, sửa tỷ giá tay, tính thử một lần gửi tiền, xem lịch sử kiều hối và đổi đồng tiền gốc. Trang **Cài đặt** hiện bảng thuế đúng theo nước cư trú — Việt Nam (BHXH + biểu 7 bậc + giảm trừ gia cảnh) hoặc Ireland (PAYE, USC, PRSI, SRCOP, tax credits).

---

## Tự động hoá thu chi

Vào tab **Tự động hoá** để lấy địa chỉ webhook + token (token tự sinh, có nút chép sẵn và nút đổi token).

### iPhone — cách duy nhất chạy được

> **Sự thật cần biết trước:** iOS **không cho phép bất kỳ app nào đọc SMS hoặc thông báo của app khác**. Không có API nào làm được, kể cả app trên App Store. Đường duy nhất là để **Shortcuts** đẩy nội dung tin nhắn sang FinMate.

**Cách 1 — Tự động hoàn toàn (áp dụng cho tin nhắn SMS)**

1. Mở app **Shortcuts** → tab **Automation** → **+** → **Message**
2. **Sender**: nhập tên/đầu số ngân hàng (AIB, BOI, Revolut, Vietcombank…). Có thể thêm nhiều automation cho nhiều ngân hàng.
3. Chọn **Run Immediately** và **tắt** "Notify When Run" (iOS 17+) để nó chạy im lặng
4. Thêm hành động **Get Contents of URL**
5. Điền:
   - **URL**: `http://<địa-chỉ-máy-chạy-FinMate>:4000/api/ingest`
   - **Method**: `POST`
   - **Headers**: `x-finmate-token` = token trong tab Tự động hoá
   - **Request Body**: `Text` → chọn biến **Shortcut Input**
6. Xong. Từ giờ mỗi SMS ngân hàng tự thành giao dịch trong app.

**Cách 2 — Bán tự động (cho app ngân hàng chỉ gửi push notification)**

Revolut, N26, Monzo… gửi **push notification** chứ không gửi SMS, mà **push notification không trigger được Automation**. Với các app này:

1. Tạo một Shortcut thường (không phải Automation) tên "Gửi FinMate", nội dung y hệt bước 4–5 ở trên nhưng lấy body từ **Shortcut Input**
2. Bật **Show in Share Sheet** trong phần cài đặt của Shortcut
3. Khi nhận thông báo giao dịch: giữ để copy → mở Share Sheet → chọn "Gửi FinMate" (2 chạm)

Hoặc: bật email thông báo giao dịch trong app ngân hàng, rồi dùng Automation loại **Email** thay cho **Message**.

**Cách 3 — Không cài gì**

Vào tab **Tự động hoá** → dán nội dung tin nhắn vào ô "Thử nhận diện tin nhắn" (có sẵn 4 mẫu AIB/Revolut/BOI/Vietcombank để bấm thử), hoặc **import CSV sao kê** tải từ app ngân hàng.

### Android (MacroDroid / Tasker)

Trigger khi có SMS từ ngân hàng → HTTP POST:

```
POST http://<địa-chỉ-máy-bạn>:4000/api/ingest
Header: x-finmate-token: <token trong tab Tự động hoá>
Body:   {"text": "<nội dung SMS>", "sender": "VCB"}
```

### Lưu ý mạng

`localhost` chỉ chạy khi điện thoại và máy chủ **cùng wifi**. Nếu muốn dùng khi ra ngoài, cần một địa chỉ truy cập được từ internet — **Tailscale** (đơn giản nhất, miễn phí) hoặc **Cloudflare Tunnel** — rồi thay `localhost` bằng địa chỉ đó.

Mọi giao dịch nạp vào đều được tự phân loại, tự trừ ngân sách, tự phân bổ quỹ nếu là thu nhập, và tự chống trùng nếu cùng một tin nhắn bị gửi hai lần.

---

## Kết nối LLM (tuỳ chọn)

App **chạy đầy đủ mà không cần LLM** — toàn bộ NLU là rule-based tiếng Việt và chạy offline. Nhưng bật LLM sẽ đổi hẳn trải nghiệm chat: từ "hỏi A đáp A" thành một **cố vấn tài chính thật sự** biết tra cứu và tự thao tác trong app.

Chép `.env.example` thành `.env` rồi điền — app tự nạp file này lúc khởi động (đặt ở gốc repo hoặc trong `server/` đều được):

```bash
FINMATE_LLM_KEY=sk-...
FINMATE_LLM_URL=https://api.openai.com/v1/chat/completions   # hoặc Azure/Groq/OpenRouter/Ollama
FINMATE_LLM_MODEL=gpt-4o-mini                                # cần hỗ trợ function calling
FINMATE_AGENT=off                                            # tuỳ chọn: tắt agent dù đã có key
```

Dùng **Claude của Anthropic** thì chỉ cần dán key — app nhận ra qua tiền tố `sk-ant-` và tự chuyển sang Messages API, **không phải đặt `FINMATE_LLM_URL`**:

```bash
FINMATE_LLM_KEY=sk-ant-...
FINMATE_LLM_MODEL=claude-opus-5        # mặc định; rẻ hơn: claude-sonnet-5, claude-haiku-4-5
FINMATE_LLM_EFFORT=medium              # tuỳ chọn: low | medium | high | xhigh | max — chat hằng ngày chạy medium là đủ
```

> Nếu tự nhận diện sai (ví dụ đi qua proxy nội bộ), ép cứng bằng `FINMATE_LLM_PROVIDER=anthropic` hoặc `=openai`.

Lớp nói chuyện với Claude (`services/chat/anthropic.js`) viết theo API hiện hành của thế hệ Claude 4.6+ / 5, nên có mấy điều đáng biết:

- **Bộ đệm prompt (prompt caching)**: bộ 74 công cụ và phần hướng dẫn cố định của system prompt giống hệt nhau qua mọi lượt, được đánh dấu `cache_control`; phần "tình hình hiện tại" (đổi từng lượt) đặt sau cùng để không phá bộ đệm. Từ lượt thứ hai, phần lớn token đầu vào chỉ tính ~10% giá. Thẻ "Cố vấn AI" trong **Cài đặt** hiện tỉ lệ bộ đệm trúng, tổng token vào/ra và lỗi gần nhất — nếu tỉ lệ trúng là 0% suốt thì có gì đó đang làm prompt đổi mỗi lượt.
- **Model tự suy nghĩ** trước khi trả lời (Opus 5 mặc định bật). Các khối suy nghĩ có chữ ký được gửi lại nguyên vẹn trong vòng lặp gọi công cụ — API đòi vậy. `FINMATE_LLM_EFFORT` chỉnh độ sâu; `FINMATE_LLM_THINKING=off` tắt hẳn khi cần nhanh.
- **Không gửi `temperature`, không mớm lời trợ lý**: hai thứ thế hệ Claude mới từ chối thẳng (400). Phân loại ý định ép JSON bằng `output_config.format` + JSON schema thay vì mớm "{" như trước.
- **Model từ chối trả lời** (bộ lọc an toàn, `stop_reason: refusal`) được coi như lỗi vĩnh viễn: không thử lại, lùi về bộ luật và ghi lý do vào `/api/health`.
- **`max_tokens` mặc định 16.000** vì nó là trần cho cả phần suy nghĩ lẫn câu trả lời; đặt thấp như thời chưa có thinking thì câu trả lời bị cắt ngang.

Muốn số liệu tài chính **không rời khỏi máy**, chạy model ngay tại chỗ bằng [Ollama](https://ollama.com) — miễn phí, không cần key thật:

```bash
FINMATE_LLM_URL=http://127.0.0.1:11434/v1/chat/completions
FINMATE_LLM_KEY=ollama
FINMATE_LLM_MODEL=qwen2.5:14b
```

Vào tab **Cài đặt** để xem app đang chạy chế độ nào — thẻ "Cố vấn AI" ở đầu trang nói rõ đang dùng bộ luật hay AI thật, và model nào.

Cách hoạt động: mỗi lượt chat, agent nhận ảnh chụp tình hình tài chính của bạn cùng **74 công cụ** (39 công cụ ghi/sửa/xoá dữ liệu, 35 công cụ tra cứu và phân tích). Nó gọi công cụ tối đa 6 vòng — tra số, ghi giao dịch, sửa số dư, mở quỹ, đặt hạn mục tiêu, dọn bản trùng — rồi mới trả lời.

- **Mọi con số vẫn tính từ dữ liệu trong máy bạn.** LLM không được phép tự bịa số; nó chỉ diễn đạt kết quả công cụ trả về.
- **Không được nói suông là đã làm.** Nếu model trả lời "đã ghi 45.000đ" mà chưa hề gọi công cụ nào, app chặn lại và nhắc nó làm thật; vẫn nói suông lần nữa thì câu trả lời đó **bị bỏ** và bộ luật xử lý thay — thà mất một câu văn hay còn hơn để người dùng tin là đã ghi trong khi sổ trống. (Model nhỏ hay bắt chước định dạng câu trả lời cũ trong lịch sử chat, nên các lượt do bộ luật sinh cũng được đánh dấu rõ trước khi đưa cho model.)
- **Việc phá dữ liệu đòi chính bạn gõ, không nhận lời model tự khai.** Bài học phải trả giá bằng sổ thật: người dùng nói "đồng ý, dọn thật đi" (ý là dọn mục tiêu trùng), model hiểu nhầm, **tự điền mật khẩu xác nhận `XOA HET`** và xoá sạch 723 giao dịch — phải khôi phục từ bản sao lưu tự động. Giờ các thao tác phá dữ liệu kiểm thẳng **câu bạn vừa gõ**, thứ model không giả mạo được: xoá sạch đòi bạn tự gõ `XOA HET`; xoá tài khoản kèm lịch sử đòi bạn nói rõ "xoá cả giao dịch". Trước khi phá, app luôn **chụp lại một bản sao DB**, và **kiểm lại sau khi xoá** để không báo cáo dối.
- **Gửi đi cái gì:** nội dung hội thoại + số liệu tóm tắt (không gửi toàn bộ lịch sử giao dịch). Nếu không muốn gửi gì ra ngoài, cứ để trống key — app vẫn đủ tính năng.
- **Hỏng thì sao:** hết hạn mức, mất mạng, model trả sai — app tự động rơi về bộ luật offline, và câu trả lời đó mang chip "📐 Bộ luật trả lời" kèm lý do để bạn biết. Riêng lỗi tạm thời (429/503/529 "overloaded", đứt mạng) được **thử lại 2 lần với giãn cách 0,4s và 1,2s** trước khi bỏ cuộc: khi chạy thật với Claude haiku có lúc gần một phần ba lượt gọi trả 503 dù key vẫn tốt, nếu bỏ cuộc ngay thì mất oan phần AI mà vẫn tốn tiền. Lỗi vĩnh viễn (key sai, sai tên model, request hỏng) thì dừng ngay, không gọi lại cho phí. Mọi lỗi được ghi ra log server và hiện ở `GET /api/health` (`llm.trang_thai`: số lượt gọi, số lượt lỗi, số lần thử lại, thông điệp lỗi gần nhất đã che key — **không bị xoá** khi có lượt thành công sau đó, vì lỗi lác đác mới là thứ cần thấy nhất), nên bạn biết ngay khi key sai hay hết hạn mức thay vì chỉ thấy "AI bỗng kém thông minh".
- **Model gọi sai tên tham số** (rất hay xảy ra) được ánh xạ lại tự động; công cụ báo lỗi kèm danh sách giá trị hợp lệ để agent tự sửa ở vòng sau.

---

## Giao diện

Tối giản, hiện đại, dễ chạm — theo tinh thần các app ngân hàng số: nền phẳng, thẻ bo tròn không viền, một màu nhấn, con số to, nút pill.

- **Trang chủ** như màn hình chính app ngân hàng: tài sản ròng thật to kèm chênh lệch so tháng trước, "còn tiêu an toàn" ngay trong thẻ, hàng hành động nhanh (nhắn cố vấn, chụp hoá đơn, ghi giao dịch…), thẻ tài khoản cuộn ngang, **đề xuất của cố vấn với nút Đồng ý ngay tại chỗ**, giao dịch gần đây, mục tiêu, khoản sắp tới hạn.
- **Giao dịch** là danh sách theo ngày (Hôm nay / Hôm qua / …) với icon tròn, chạm vào hàng để sửa, nút tròn nổi để thêm; bộ lọc dạng segment.
- **Thanh dưới 5 mục** trên điện thoại: Trang chủ · Giao dịch · Trò chuyện · Cảnh báo · Thêm — trang *Thêm* gom mọi mục còn lại thành nhóm thay cho ngăn kéo trượt. Máy tính giữ sidebar.
- **Chat**: bong bóng của bạn màu mực, của cố vấn màu thẻ; thẻ đề xuất có nút Đồng ý/Bỏ qua; chip cho biết tin nhắn đến từ đâu (tự động từ ngân hàng, bản tin sáng, tự lái).
- **Chủ đề sáng (mặc định) / tối / theo hệ thống** — bấm nút ở góc trên, không chớp nền khi tải lại. Ô nhập chat dính đáy màn hình, gợi ý trả lời nhanh cuộn ngang, tôn trọng `safe-area` của iPhone.
- **Tìm nhanh `Ctrl/⌘ + K`** — nhảy tới bất kỳ trang nào, gõ không dấu vẫn ra.
- Biểu đồ tự vẽ bằng SVG (không thư viện), skeleton khi tải, tôn trọng `prefers-reduced-motion`, có style riêng cho in ấn.

---

## Kiến trúc

```
finmate/
├─ server/                    # API Node.js + Express, DB = node:sqlite
│  ├─ src/
│  │  ├─ db.js                # kết nối SQLite, helper all/get/insert/update/run
│  │  ├─ schema.sql           # ~25 bảng
│  │  ├─ bootstrap.js         # danh mục, quỹ, luật phân loại mặc định (VN + Ireland)
│  │  ├─ routes/api.js        # ~95 endpoint + vòng lặp tự động hoá
│  │  ├─ util/
│  │  │  ├─ currency.js       # đơn vị nhỏ nhất, định dạng, đọc số kiểu Việt/Âu
│  │  │  └─ vi.js             # bỏ dấu, đọc số tiền trong câu, đọc ngày
│  │  ├─ services/
│  │  │  ├─ ledger.js         # ghi sổ, chống trùng, cân bằng số dư, an toàn tiền tệ
│  │  │  ├─ fx.js             # bảng tỷ giá theo ngày, quy đổi, tự cập nhật online
│  │  │  ├─ remittance.js     # kiều hối: chi phí thật, báo giá, tư vấn thời điểm
│  │  │  ├─ tax.js / tax_ie.js / tax_router.js   # thuế Việt Nam & Ireland
│  │  │  ├─ funds.js          # phân bổ thu nhập vào quỹ
│  │  │  ├─ ingest.js         # parser tin nhắn ngân hàng VN + EU/Ireland, import CSV
│  │  │  ├─ recurring.js      # khoản định kỳ, bù kỳ bỏ lỡ
│  │  │  ├─ goals/budgets/debts/investments/networth/...
│  │  │  ├─ fire.js           # FIRE, quỹ khẩn cấp, giả định theo đồng tiền
│  │  │  ├─ passive.js        # lộ trình thu nhập thụ động: kênh, vốn cần, mốc, việc làm ngay
│  │  │  ├─ forecast.js       # dòng tiền 90 ngày, số tiền an toàn để tiêu
│  │  │  ├─ advisor.js        # điểm sức khoẻ, thác nước tiền dư
│  │  │  ├─ insights.js       # phát hiện bất thường
│  │  │  ├─ ai_audit.js       # nhật ký thao tác của AI + hoàn tác (kể cả số dư)
│  │  │  ├─ ai_memory.js      # trí nhớ dài hạn, nhét vào prompt mỗi lượt chat
│  │  │  ├─ ai_review.js      # phiên rà soát chủ động theo chu kỳ
│  │  │  └─ chat/             # agent.js (vòng lặp AI + tool calling) · tools.js (74 công cụ)
│  │  │                       # tools_manage.js (sửa/xoá/dọn dẹp + chốt chặn phá dữ liệu)
│  │  │                       # llm.js · anthropic.js (lớp dịch sang Claude) · nlu.js
│  │  │                       # handlers.js · knowledge.js · life_events.js · onboarding.js
│  │  └─ scripts/{seed,seed_ie,reset}.js
│  └─ test/
└─ web/                       # React 18 + Vite, 17 trang, biểu đồ tự vẽ bằng SVG
   ├─ src/lib/theme.js        # chủ đề sáng/tối/theo hệ thống
   ├─ src/components/         # ui.jsx · CommandPalette.jsx (Ctrl+K)
   └─ src/pages/              # Chat, Dashboard, Transactions, Accounts, Funds, Goals,
                              # Budgets, Income, Investments, Debts, Fire, Advisor,
                              # Insights, Currency, Automation, AiLog, Settings
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

### 3. Bật webhook nhận giao dịch
Tab **Tự động hoá** → chép địa chỉ + token → cấu hình iOS Shortcuts (có hướng dẫn 6 bước ngay trong app) hoặc MacroDroid, xem phần [Tự động hoá](#tự-động-hoá-thu-chi). Endpoint `POST /api/ingest` dùng token riêng nên điện thoại không cần giữ PIN — nhưng **luôn bắt buộc có token đúng**, kể cả khi chưa đặt PIN. Token có thể đổi bất cứ lúc nào bằng nút "Đổi token"; Shortcut trên máy cũ sẽ ngừng gửi được ngay lập tức.

Ngoài ra, khi **chưa đặt PIN** thì app chỉ phục vụ yêu cầu phát ra từ chính máy chạy server. Nếu bạn mở ra mạng LAN bằng `FINMATE_HOST=0.0.0.0` để dùng trên điện thoại, hãy đặt PIN trước — nếu không, mọi thiết bị cùng wifi sẽ bị từ chối kèm lời nhắc đặt PIN.

### 4. Sao lưu
- Tự động mỗi ngày vào `server/data/backups/` (giữ 14 bản gần nhất).
- Thủ công: `npm run backup`, hoặc **Cài đặt → Sao lưu → Tải file dữ liệu / Xuất JSON**.
- **Nên** copy thư mục `backups` sang OneDrive/Google Drive hoặc ổ ngoài — máy hỏng là mất hết.

### 5. Chạy nền lâu dài
Windows: dùng Task Scheduler chạy `npm start` lúc đăng nhập. macOS/Linux: `pm2 start server/src/index.js --name finmate` hoặc systemd unit.

### 6. Nếu muốn truy cập qua internet
Đừng mở thẳng cổng 4000 ra ngoài. Dùng **Tailscale** (đơn giản nhất, không cần mở cổng) hoặc đặt sau reverse proxy có HTTPS (Caddy/Nginx + Let's Encrypt) và đặt `FINMATE_ORIGINS=https://ten-mien-cua-ban`.

### 7. Chạy bằng Docker (khi muốn app sống độc lập với máy cá nhân)

Ở chế độ production, **một tiến trình duy nhất** phục vụ cả API lẫn giao diện — không cần chạy Vite riêng:

```bash
npm run build --workspace web     # tạo web/dist
npm start --workspace server      # server tự phục vụ web/dist ở cùng cổng
```

Docker đóng gói đúng hai bước đó:

```bash
export FINMATE_INGEST_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
docker compose up -d
```

Vài điểm cần nhớ:

- **Dữ liệu phải nằm trên volume** (`/data`). Container không có volume thì xoá container là mất toàn bộ sổ sách.
- Compose chỉ bind vào `127.0.0.1:4000` — cố ý như vậy. Đặt reverse proxy có HTTPS ở trước rồi mới phơi ra Internet; mã PIN và token webhook không nên đi qua HTTP trần.
- `FINMATE_INGEST_TOKEN` là **bắt buộc**, compose sẽ từ chối chạy nếu thiếu. Không có token thì bất kỳ ai gọi được `/api/ingest` cũng đẩy giao dịch giả vào sổ của bạn.
- Image dùng `node:22-alpine` vì app cần `node:sqlite` (Node ≥ 22.5) — không cài driver SQLite ngoài nào.

### 8. Máy chủ thật trên Internet (nhiều người dùng, mỗi người một sổ)

Đây là cách dùng app từ điện thoại lẫn máy tính mà dữ liệu vẫn là một: sổ nằm trên máy chủ, đăng nhập ở đâu cũng thấy đúng sổ của mình.

Bật bằng **một biến môi trường**:

```bash
FINMATE_MULTIUSER=1
```

Khi bật:

- Cửa vào là **email + mật khẩu** thay cho mã PIN. PIN chỉ khoá app trên một máy; tài khoản mới là thứ mang sổ đi theo người.
- **Mỗi người một file SQLite riêng** ở `$FINMATE_DATA_DIR/users/<id>.db`. Cách ly là vật lý: không câu SQL nào với sang sổ người khác được, kể cả khi ai đó viết thiếu mệnh đề `WHERE`. Danh bạ tài khoản nằm riêng ở `finmate-accounts.db`, không lẫn với sổ tài chính của ai.
- Tự động hoá (giao dịch định kỳ, tính lãi, sao lưu, cảnh báo) chạy **trên từng sổ**, mỗi giờ một lượt.
- Mật khẩu băm bằng scrypt có muối; sai nhiều lần thì khoá tạm 5 phút. Đổi mật khẩu sẽ đăng xuất mọi thiết bị khác.

Deploy lên **Fly.io** (đã có sẵn `fly.toml` với đầy đủ chú thích từng dòng):

```bash
curl -L https://fly.io/install.sh | sh          # 1. cài flyctl
fly auth signup                                  # 2. tài khoản Fly (bạn tự làm — mình không thay bạn đăng ký được)
fly launch --no-deploy --copy-config --name ten-app-cua-ban
fly volumes create finmate_data --size 3 --region sin   # 3. ổ đĩa giữ dữ liệu
fly secrets set FINMATE_INGEST_TOKEN="$(openssl rand -hex 24)"                 FINMATE_SIGNUP_CODE="mã mời của riêng bạn"
fly deploy && fly open
```

Vài điều quyết định app sống hay chết trên máy chủ:

- **`FINMATE_DATA_DIR` phải trỏ vào volume.** Dockerfile đã đặt sẵn `/data`. Quên biến này là lỗi nguy hiểm nhất: `finmate.db` vẫn nằm đúng chỗ nên nhìn qua tưởng ổn, còn sổ của mọi người dùng thì bay sạch sau mỗi lần deploy. `test/smoke-deploy.mjs` canh đúng chuyện này.
- **Chỉ chạy một máy.** SQLite cho một tiến trình ghi. Cần khoẻ hơn thì tăng CPU/RAM, đừng tăng số máy (`fly scale count 1`).
- **Luôn đặt `FINMATE_SIGNUP_CODE`.** Cửa đăng ký là cửa duy nhất ai cũng gọi được; không có mã mời thì người lạ tạo tài khoản đến khi đầy đĩa. Kèm theo còn có trần `FINMATE_MAX_USERS` và giới hạn số lần đăng ký mỗi giờ theo IP.
- **Quên mật khẩu.** Người dùng bấm “Quên mật khẩu?” ở màn đăng nhập, nhận một đường dẫn qua email, tự đặt mật khẩu mới. Đường dẫn **dùng một lần**, hết hạn sau 60 phút, và đặt lại xong thì mọi thiết bị đều bị đăng xuất — nếu ai đó đã lén vào được tài khoản thì việc chủ tài khoản đặt lại mật khẩu phải đá được kẻ đó ra. Sổ sách không mất gì: mật khẩu chỉ là cửa vào, không phải chìa khoá mã hoá.

  Bật gửi thư (Resend, miễn phí 3.000 thư/tháng):

  ```bash
  fly secrets set FINMATE_MAIL_KEY=re_...  FINMATE_MAIL_FROM="FinMate <finmate@ten-mien-cua-ban>"
  ```

  **Chưa gắn dịch vụ gửi thư thì vẫn dùng được**, chỉ là bạn phát đường dẫn bằng tay — đây cũng là đường cứu khi chính bạn quên mật khẩu của mình:

  ```bash
  fly ssh console -C "node server/src/scripts/reset_password.js --list"
  fly ssh console -C "node server/src/scripts/reset_password.js --email ai-do@example.com"
  # in ra một đường dẫn dùng một lần — gửi cho họ, họ tự gõ mật khẩu mới
  ```

  Máy chạy tại chỗ thì gọn hơn: `npm run reset-password -w server -- --email ai-do@example.com`. Thêm `--password "..."` để đặt thẳng, nhưng nên tránh — mật khẩu đó bạn cũng biết.

  App **không bao giờ nói “email này chưa đăng ký”**: với một app tài chính thì việc dò được ai đang dùng đã là rò rỉ, nên câu trả lời luôn y hệt nhau dù email có tài khoản hay không.

- **Sao lưu vẫn là việc của bạn.** Volume của Fly có snapshot hằng ngày, nhưng snapshot không thay được bản sao lưu bạn giữ trong tay: `fly ssh sftp get /data/backups/<tên-file>`.

Tắt máy chủ (deploy lại, máy ngủ, `fly scale`) đều đi qua SIGTERM: app ngừng nhận request mới, đóng mọi sổ để SQLite gộp nốt WAL vào file chính rồi mới thoát. Không làm vậy thì một bản sao lưu chép đúng lúc đó sẽ thiếu phần vừa ghi.

### Biến môi trường

Chép `.env.example` thành `.env`; app tự nạp file này lúc khởi động. Sửa xong phải **khởi động lại** — biến môi trường chỉ đọc một lần lúc chạy.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | Cổng server |
| `FINMATE_HOST` | `127.0.0.1` | `0.0.0.0` để mở ra LAN |
| `FINMATE_ORIGINS` | – | Origin bổ sung được phép gọi API (phân tách bằng dấu phẩy) |
| `FINMATE_DB` | `server/data/finmate.db` | Đường dẫn file dữ liệu |
| `FINMATE_BACKUP_DIR` | `server/data/backups` | Nơi lưu bản sao lưu |
| `FINMATE_BACKUP_KEEP` | `14` | Số bản sao lưu giữ lại |
| `FINMATE_FX_URL` | `https://open.er-api.com/v6/latest/EUR` | Nguồn tỷ giá (JSON có trường `rates`) |
| `FINMATE_FX_OFFLINE` | – | Đặt `1` để tắt hẳn việc gọi mạng lấy tỷ giá |
| `FINMATE_LLM_KEY` | – | Bật cố vấn AI (function calling). Trống = dùng bộ luật offline |
| `FINMATE_LLM_URL` | OpenAI | Endpoint tương thích OpenAI. Bỏ trống khi dùng Claude |
| `FINMATE_LLM_MODEL` | `gpt-4o-mini` / `claude-opus-5` | Model, cần hỗ trợ tool calling (đọc ảnh hoá đơn cần model có vision) |
| `FINMATE_LLM_PROVIDER` | tự nhận diện | `openai` hoặc `anthropic`, chỉ đặt khi nhận diện sai |
| `FINMATE_LLM_EFFORT` | mặc định của model (`high`) | `low` · `medium` · `high` · `xhigh` · `max` — độ sâu suy nghĩ (chỉ Claude) |
| `FINMATE_LLM_THINKING` | model tự quyết | `adaptive` bật, `off` tắt suy nghĩ trước khi trả lời (chỉ Claude) |
| `FINMATE_LLM_MAX_TOKENS` | `16000` (Claude) / `4096` | Trần độ dài câu trả lời, tính cả phần suy nghĩ |
| `FINMATE_LLM_TIMEOUT_MS` | `90000` | Chờ tối đa cho một lượt gọi model |
| `FINMATE_AGENT` | – | Đặt `off` để tắt agent dù đã có key |
| `FINMATE_MULTIUSER` | – | `1` để bật chế độ nhiều người dùng (đăng nhập bằng tài khoản, mỗi người một sổ) |
| `FINMATE_DATA_DIR` | `server/data` | Thư mục dữ liệu: danh bạ tài khoản, sổ riêng từng người. Phải là volume khi chạy Docker |
| `FINMATE_SIGNUP_CODE` | – | Mã mời bắt buộc khi đăng ký. Máy chủ chạm được từ Internet thì luôn nên đặt |
| `FINMATE_MAX_USERS` | – | Trần số tài khoản (0/trống = không giới hạn) |
| `FINMATE_SIGNUP_PER_HOUR` | `5` | Số tài khoản tạo được mỗi giờ từ một IP |
| `FINMATE_SESSION_DAYS` | `30` | Phiên đăng nhập sống bao lâu |
| `FINMATE_MAX_OPEN_LEDGERS` | `200` | Số sổ giữ mở cùng lúc trong bộ nhớ |
| `FINMATE_SHUTDOWN_MS` | `8000` | Chờ request đang dở bao lâu khi nhận SIGTERM trước khi đóng sổ |
| `FINMATE_MAIL_KEY` | – | Khoá dịch vụ gửi thư (Resend `re_...`). Có thì bật được “quên mật khẩu” qua email |
| `FINMATE_MAIL_FROM` | `FinMate <onboarding@resend.dev>` | Địa chỉ người gửi. Tên miền phải đã xác minh với nhà cung cấp |
| `FINMATE_MAIL_URL` | `https://api.resend.com/emails` | Đổi khi dùng dịch vụ khác có cùng dạng API |
| `FINMATE_PUBLIC_URL` | tự đoán theo request | Địa chỉ app nhìn từ ngoài, để dán vào đường dẫn trong thư |
| `FINMATE_RESET_MINUTES` | `60` | Đường dẫn đặt lại mật khẩu sống bao lâu |
| `FINMATE_FORGOT_PER_HOUR` | `8` | Số lần xin đặt lại mật khẩu mỗi giờ từ một IP |

### Những việc chỉ bạn làm được
- **Kết nối ngân hàng tự động (Open Banking)**: ở châu Âu có PSD2 — các nhà cung cấp như GoCardless Bank Account Data (Nordigen cũ) cho phép đọc trực tiếp giao dịch từ AIB, BOI, Revolut, N26… mà không cần Shortcuts. Cần bạn tự đăng ký tài khoản nhà cung cấp và lấy khoá; sau đó nối vào `services/ingest.js`. Việt Nam chưa có Open Banking mở cho cá nhân nên vẫn phải dùng webhook tin nhắn hoặc import CSV.
- **Nguồn giá trả phí / realtime**: giá đang lấy từ nguồn miễn phí (trễ vài phút tới cuối ngày tuỳ nguồn). Có nguồn riêng thì nối thêm một fetcher trong `services/prices.js`.
- **Khoá dịch vụ gửi email**: chức năng quên mật khẩu đã có sẵn, nhưng thư phải đi qua một dịch vụ gửi thư và khoá đó chỉ bạn lấy được. [Resend](https://resend.com) miễn phí 3.000 thư/tháng, đăng ký 5 phút, không cần thẻ: lấy khoá `re_...` rồi `fly secrets set FINMATE_MAIL_KEY=re_...`. Chưa có khoá thì vẫn đặt lại được bằng tay từ máy chủ (xem mục 8).
- **Đồng bộ khi mất mạng ở chế độ tài khoản**: bản dùng máy chủ cần mạng để đọc/ghi. Bản chạy thẳng trên điện thoại thì offline hoàn toàn nhưng dữ liệu nằm ở máy đó. Nối hai thứ lại (ghi offline rồi đồng bộ lên) là việc còn để ngỏ.

---

## Cài lên điện thoại

**iPhone.** iOS không có nút "Cài ứng dụng" tự động như Android — phải tự thêm:

1. Mở FinMate bằng **Safari** (Chrome/Firefox trên iOS không thêm được).
2. Bấm nút **Chia sẻ** ở thanh dưới (hình vuông có mũi tên đi lên).
3. Vuốt xuống, chọn **Thêm vào MH chính**.

App cũng tự nhắc việc này ngay ở Trang chủ và có hướng dẫn đầy đủ trong **Cài đặt**.

> **Nên cài thật, đừng chỉ để trong tab Safari.** Safari dọn dữ liệu website sau khoảng 7 ngày không mở. Sổ sách nằm trong bộ nhớ trình duyệt nên có thể mất theo; app đã thêm vào màn hình chính thì không bị luật này. Dù sao vẫn nên thỉnh thoảng bấm **Sao lưu** và cất file ra ngoài.

Vài chỗ iOS hay làm khó đã được xử lý sẵn: `apple-touch-icon` phải là **PNG** (iOS không đọc SVG — để SVG là ra icon trống), ô nhập tối thiểu **16px** (dưới ngưỡng đó Safari tự phóng to trang mỗi lần chạm vào ô nhập), `viewport-fit=cover` + `env(safe-area-inset-*)` cho tai thỏ và thanh home, `100dvh` thay `100vh` vì Safari tính cả thanh công cụ đang ẩn. Bộ `test/pwa.mjs` giữ những thứ này không trôi.

**Android.** Trình duyệt tự mời cài; app hiện nút **Cài ngay** khi bắt được lời mời đó.

### Tự phát hành lên GitHub Pages

`.github/workflows/deploy.yml` build `web/dist-embedded` rồi đẩy lên Pages mỗi lần có code mới. Bản này chạy trọn vẹn trong trình duyệt nên chỉ cần chỗ chứa tệp tĩnh, và Pages cấp sẵn HTTPS — điều kiện bắt buộc để service worker chạy, tức là điều kiện để cài được vào màn hình chính.

**Phải bật Pages một lần bằng tay** (token của workflow không có quyền tự tạo site — nó trả `Resource not accessible by integration`):

1. **Settings → Pages → Source** chọn **GitHub Actions**.
2. **Settings → Actions → General → Workflow permissions** chọn **Read and write permissions**.
3. Chạy lại workflow **Deploy** (tab Actions → Deploy → Re-run jobs).

Repo **private** thì Pages cần gói trả phí (GitHub Pro trở lên); tài khoản miễn phí phải để repo public. Lưu ý bản đưa lên chỉ là **mã của app** — không có máy chủ, không có kho dữ liệu chung, sổ sách của mỗi người nằm trong bộ nhớ trình duyệt máy họ.

Trước khi phát hành, workflow chạy `web/test/pwa.mjs`: thiếu tài nguyên đệm sẵn là mất mạng mở app ra trang trắng, mà lỗi đó chỉ lộ sau khi đã cài lên điện thoại rồi.

**Bản đóng gói native (.ipa / .apk).** Có sẵn cấu hình Capacitor (`npm run cap:init`, `cap:sync`, `cap:ios`, `cap:android`). Dựng `.ipa` **bắt buộc máy Mac có Xcode** và tài khoản Apple Developer để cài lên máy thật; `.apk` cần Android SDK. Bản PWA ở trên không cần gì cả và chạy cùng một mã.

## Bật cố vấn AI trên máy của bạn

Bản chạy trên điện thoại gọi **thẳng** tới nhà cung cấp, không qua máy chủ trung gian nào. Key nằm trong bộ nhớ máy bạn.

1. **Cài đặt → Cố vấn AI**: dán API key (Claude `sk-ant-…`, hoặc bất kỳ API OpenAI-compatible nào — điền thêm ô URL), chọn model.
2. Bấm **Lưu và tải lại**.
3. Bấm **Thử kết nối** — app gọi thật một lượt rồi báo model đã trả lời, hoặc in nguyên văn lỗi kèm cách xử lý (key sai, tên model sai, hết hạn mức, bị CORS chặn…).

Anthropic **chặn** trình duyệt gọi thẳng theo mặc định, để người ta không nhúng key máy chủ vào trang web công khai. FinMate khai báo header `anthropic-dangerous-direct-browser-access` để qua được — an toàn ở đây theo đúng nghĩa Anthropic gọi là "công cụ nội bộ, người dùng tin cậy": key là của chính chủ máy, do họ tự dán, chỉ nằm trên máy họ, và app không có máy chủ nên không giữ key của ai. Ai cầm được máy đã mở khoá thì đọc được key — đặt PIN cho app nếu điều đó đáng lo. Nhà cung cấp khác có thể không cho gọi từ trình duyệt; khi đó dùng bản chạy máy chủ.

Có key rồi, mở **Trò chuyện**: cố vấn sẽ dẫn bạn thiết lập hồ sơ bằng một cuộc nói chuyện — hỏi từng câu một, ghi lại ngay khi biết (tài khoản, nguồn thu, nợ, mục tiêu), rồi tóm tắt bức tranh tài chính và đề xuất việc nên làm. Không có key thì luồng này vẫn chạy bằng bộ luật tiếng Việt, chỉ kém linh hoạt hơn.

## Kiểm thử

```bash
npm test                          # unit test (node --test): tiền tệ, tỷ giá, thuế VN + IE, NLU, SMS
npm run test:smoke                # chạy liền 18 bộ smoke bên dưới
npm run test:sim                  # 4 bộ mô phỏng dài (kịch bản, 5 năm, trọn đời, chân dung)
npm run test:e2e                  # 3 hành trình đầu-cuối trên trình duyệt thật (mobile 390x844)
npm run test:all                  # tất cả: unit + smoke + mô phỏng + bản điện thoại + đầu-cuối

cd server && node test/smoke-auth.mjs        # PIN, phiên, sao lưu, xuất dữ liệu
cd server && node test/smoke-ui.mjs          # mọi field frontend dùng đều tồn tại trong API
cd server && node test/smoke-chat.mjs        # 29 ý định chat
cd server && node test/smoke-knowledge.mjs   # 19 câu hỏi tài chính mở
cd server && node test/smoke-tools.mjs       # 74 công cụ AI ghi/đọc đúng dữ liệu (không cần key)
cd server && node test/smoke-agent.mjs       # vòng lặp AI agent qua LLM giả lập (không cần key)
cd server && node test/smoke-ai.mjs          # nhật ký + hoàn tác, trí nhớ dài hạn, rà soát chủ động
cd server && node test/smoke-llm.mjs         # lớp dịch sang Claude, chạy qua máy chủ giả (không cần key)
cd server && node test/smoke-retry.mjs       # nhà cung cấp trả 503/529 thì tự thử lại, key sai thì bỏ cuộc ngay
cd server && node test/smoke-manage.mjs      # sửa/xoá mọi tài nguyên; model tự gõ mật khẩu xoá thì bị chặn
cd server && node test/smoke-stream.mjs      # chat dạng luồng SSE, ảnh hoá đơn tới model đúng hình dạng, cờ "bộ luật trả lời" khi AI hỏng
cd server && node test/smoke-autopilot.mjs   # đề xuất chờ gật, chế độ tự lái, bản tin sáng, phản hồi tin ngân hàng, "ừ"/"thôi" trong chat
cd server && node test/smoke-manual.mjs      # làm tay không cần AI: trả nợ, cân bằng quỹ, gộp trùng, xoá sạch có chốt; cầu dao mất mạng, cờ offline
cd server && node test/smoke-onboarding.mjs  # lúc thiết lập: câu ghi sổ thật, câu khai báo và câu hỏi không được lẫn vào nhau
cd server && node test/smoke-accounts.mjs    # nhiều người dùng: đăng nhập, mã mời, quên mật khẩu (thư đi qua máy chủ thư giả),
                                             # và trên hết là CÁCH LY sổ giữa người này với người kia
cd server && node test/smoke-deploy.mjs      # máy chủ thật: chạy đúng tiến trình server, SIGTERM, bật lại — dữ liệu phải còn nguyên
cd server && node test/smoke-honesty.mjs     # AI không được nói "đã ghi" khi chưa gọi công cụ
cd server && node test/smoke-life-events.mjs # ly hôn, mất việc, sắp sinh con, thừa kế, nghỉ hưu...
cd server && node test/scenarios.mjs         # 203 kịch bản người dùng thật, 17 nhóm tính năng
cd server && node test/personas.mjs          # 8 hành trình người dùng đầu-cuối, 160 bước
cd server && node test/journey5y.mjs         # 5 năm liên tục của một người Việt ở Ireland, 34 bước
cd server && node test/lifetime.mjs          # 12 cuộc đời từ đi học đến nghỉ hưu, 58 bước
cd web    && node test/render.mjs            # render thật 18 trang trong jsdom với API thật
cd web    && node test/embedded.mjs          # bản chạy trên điện thoại: engine WebAssembly + router trong tiến trình, không node:sqlite
cd web    && node test/pwa.mjs               # đệm đủ tài nguyên (mất mạng không ra trang trắng) + các bẫy riêng của iPhone
cd web    && node scripts/make-icons.mjs     # sinh lại icon PNG từ icon.svg (cần playwright-core + Chromium)
cd web    && npm run test:e2e                # hành trình thật trên Chromium: thêm tài khoản, ghi/sửa giao dịch, mục tiêu,
                                             # ngân sách, chat, quỹ, rút wifi, mở lại app, sao lưu, cỡ vùng chạm 44px
```

`test:e2e` mở Chromium ở khổ điện thoại (390×844) và đi trọn một ngày dùng app — trên **cả hai bản**: bản gọi máy chủ (`dist`) và bản chạy thẳng trên máy (`dist-embedded`) — rồi thêm một hành trình thứ ba cho **máy chủ nhiều người dùng**: đăng ký bằng mã mời, ghi dữ liệu, tải lại trang, đăng xuất, đăng nhập lại (`test/e2e-account.mjs`; chính nó bắt được lỗi tải lại trang là bị đá về màn đăng nhập). Nó bắt đúng những lỗi mà test chạy trong Node không thấy được: nút quá nhỏ để chạm, bố cục tràn ngang, lỗi JavaScript lúc chạy thật, và quan trọng nhất — **rút wifi rồi mở lại app có ra trang trắng không**. Cần `playwright-core` và một bản Chromium (tự tìm qua `PLAYWRIGHT_BROWSERS_PATH`, hoặc chỉ định bằng `E2E_CHROME`); thiếu thì bộ test tự bỏ qua chứ không báo hỏng.

### Chạy tự động trên GitHub

`.github/workflows/ci.yml` chạy toàn bộ những thứ trên cho **mỗi lần push và mỗi pull request**, chia hai việc song song:

| Việc | Nội dung |
|---|---|
| `test` | unit → dựng API trên DB tạm **có dữ liệu mẫu** → smoke → mô phỏng → render 18 trang → bản nhúng + PWA |
| `e2e` | cài Chromium → build cả hai bản → ba hành trình người dùng thật (máy chủ, bản nhúng, tài khoản nhiều người dùng); hỏng thì tự lưu ảnh chụp màn hình làm artifact |

Không bước nào cần khoá API: mọi bộ test hoặc tự dựng DB tạm, hoặc dùng LLM giả lập. `FINMATE_FX_OFFLINE=1` chặn mọi lời gọi ra mạng ngoài để CI không phụ thuộc nguồn tỷ giá/giá cổ phiếu của bên thứ ba. Trên CI, `E2E_REQUIRED=1` biến "thiếu trình duyệt → bỏ qua" thành **báo hỏng** — một bộ test âm thầm bỏ qua trên CI còn tệ hơn là không có nó.

Các lệnh smoke cần server đang chạy (`npm run dev:api`), trừ `smoke-tools`, `smoke-agent`, `smoke-ai`, `smoke-llm`, `smoke-retry`, `smoke-manage`, `smoke-honesty`, `smoke-life-events`, `smoke-stream`, `smoke-autopilot`, `smoke-manual`, `scenarios`, `personas`, `journey5y` và `lifetime` — các lệnh này tự dựng DB tạm và LLM giả lập nên chạy được ở bất kỳ đâu, không tốn tiền API. `render.mjs` bắt cả lỗi hiển thị `undefined`/`NaN` trên giao diện.

`scenarios.mjs` là bộ đánh giá lớn nhất: nó tự khởi động một server con trên DB tạm rồi diễn lại trọn vẹn hành trình của một người Việt sống ở Ireland — mở tài khoản EUR/VND, nhận lương, đọc 12 mẫu tin nhắn ngân hàng thật (AIB, BOI, Revolut, Wise, N26, VCB, Techcombank...), nhập sao kê CSV, chia quỹ, đặt mục tiêu, trả nợ, mua bán chứng khoán, gửi tiền về Việt Nam, tính thuế, hỏi AI 21 câu — kèm cả những tình huống người dùng hay làm sai (số tiền âm, JSON hỏng, chuyển khoản thiếu tài khoản nhận, bán nhiều hơn số đang có). Mỗi kịch bản kiểm chứng **hiệu ứng thật trên dữ liệu**, không chỉ mã trạng thái HTTP.

`personas.mjs` bổ sung góc nhìn ngược lại: thay vì bắn từng tính năng, nó dựng **8 con người khác nhau, mỗi người một server và một cơ sở dữ liệu riêng** — như 8 người tải app về 8 máy — rồi đi trọn vòng đời từ lần mở app đầu tiên đến khi hỏi cố vấn:

| # | Người dùng | Kiểm chứng điều gì |
|---|---|---|
| 1 | ✈️ Kỹ sư Việt ở Dublin | EUR + VND song song, kiều hối, thuế Ireland, ETF châu Âu lẫn cổ phiếu VN |
| 2 | 🎓 Sinh viên làm thêm | Thu nhập rất nhỏ, số dư âm, ngân sách chặt, FIRE không ra số vô lý |
| 3 | 🏢 Nhân viên văn phòng | Thuế VN có người phụ thuộc, khoản cố định, trả góp xe, SMS ngân hàng vào thẳng sổ |
| 4 | 🎨 Người làm tự do | Thu nhập trồi sụt 9,6 lần, thu USD, quỹ đệm cho tháng ế |
| 5 | 🏪 Chủ quán cà phê | Tách bạch tiền kinh doanh với tiền nhà, vay kinh doanh, BĐS cho thuê |
| 6 | 🌴 Người sắp nghỉ hưu | Thu nhập thụ động phủ chi tiêu, không có lương, "sống được bao lâu nếu ngừng thu" |
| 7 | 🆘 Người đang ngập nợ | 4 khoản nợ, tài sản ròng âm, tuyết lở vs bóng tuyết, điểm sức khoẻ phải thấp |
| 8 | 💑 Vợ chồng trẻ | Hai lương gộp, mục tiêu mua nhà, ví riêng không bị đụng, vàng cưới |

Bộ này bắt được những lỗi mà kiểm thử theo tính năng bỏ sót — ví dụ câu hỏi thật của người dùng bị luồng thiết lập nuốt mất, hay app đề xuất việc vô nghĩa kiểu "nạp thêm 0đ" khi chưa có dữ liệu chi tiêu.

### Mô phỏng dài hạn

Hai bộ cuối không chỉ hỏi "đúng hay sai" mà còn thu thập **nhận xét sản phẩm**: mỗi lần phát hiện app trả lời vô nghĩa hay bỏ sót thứ người dùng thật cần, chúng ghi lại một `FINDINGS` kèm mức độ, in ra cuối phiên chạy.

`journey5y.mjs` nén **60 tháng liên tục** của một kỹ sư Việt ở Dublin: lương EUR tăng dần, gửi tiền về cho bố mẹ hàng tháng, mua vàng và cổ phiếu VN, mua căn hộ cho thuê ở Việt Nam, vay mua nhà ở Ireland — rồi kiểm báo cáo xu hướng có đủ 60 tháng liền mạch không, tài sản ròng có đi lên đều không, và hỏi cố vấn 10 câu mà chỉ người sống xa xứ mới hỏi ("giữ euro hay đổi hết về tiền Việt", "nếu mình về Việt Nam sống thì tiền đủ dùng bao lâu").

`lifetime.mjs` dựng **12 con người, mỗi người một server và một DB riêng**, đi trọn từ tuổi đi học đến lúc nghỉ hưu:

| # | Nhân vật | Câu chuyện |
|---|---|---|
| 1 | Minh | Sinh viên vay học phí → kỹ sư → cưới → hai con → mua nhà → nghỉ hưu tuổi 60 |
| 2 | Lan | Giáo viên lương thấp, không nợ, tích luỹ đều đặn 35 năm |
| 3 | Tuấn | Công nhân mất việc 5 tháng mùa dịch rồi gây dựng lại |
| 4 | Hà | Bác sĩ học 9 năm, thu nhập đến muộn nhưng rất cao |
| 5 | Khoa | Khởi nghiệp thất bại, tài sản ròng âm, làm lại từ đầu |
| 6 | Thảo | Nghỉ việc 6 năm nuôi con rồi quay lại thị trường lao động |
| 7 | Dũng | Ly hôn chia đôi tài sản ở tuổi 40 |
| 8 | Mai | Freelancer thu nhập bấp bênh, không có bảo hiểm xã hội |
| 9 | Sơn | Xuất khẩu lao động Nhật (thu nhập JPY) rồi về mở xưởng |
| 10 | Ngọc | Thừa kế đất: giàu tài sản nhưng nghèo dòng tiền |
| 11 | An | Độc thân theo đuổi FIRE, tiết kiệm 60%, nghỉ hưu tuổi 42 |
| 12 | Bình | Chủ doanh nghiệp đa tiền tệ USD, kết thúc bằng bán công ty |

Mỗi chương đời chụp lại một ảnh tài sản ròng, cuối phiên in ra "đường đời tài sản ròng" của từng người — nếu con số nhảy cóc vô lý hay tụt không giải thích được thì lỗi nằm ở tầng báo cáo chứ không phải ở kịch bản.

---

## Ghi chú kỹ thuật

- Tiền lưu bằng **số nguyên đơn vị nhỏ nhất** của từng đồng tiền (VND: đồng, EUR/USD/GBP: cent), không dùng số thực.
- Mỗi giao dịch lưu thêm `base_amount` + `fx_rate` — số tiền quy về đồng tiền gốc **tại thời điểm phát sinh**, nên báo cáo quá khứ không đổi khi tỷ giá đổi.
- Giao dịch luôn ghi theo đồng tiền của tài khoản; nếu bạn nói bằng đồng tiền khác thì app quy đổi và giữ `original_amount`/`original_currency` làm dấu vết.
- `node:sqlite` trả về object null-prototype → luôn đi qua helper `plain()` trong `db.js`.
- SQLite hiểu `"..."` là tên cột — trong SQL luôn dùng nháy đơn cho chuỗi.
- Ngày lưu dạng `YYYY-MM-DD` theo giờ địa phương.
- Thẻ tín dụng để `include_in_networth = 0` và theo dõi qua bảng `debts` để không đếm nợ hai lần.
- Mã PIN băm bằng `scrypt` + salt ngẫu nhiên, so sánh bằng `timingSafeEqual`, không bao giờ xuất ra `/settings` hay bản export.
- Khoá phiên nằm trong RAM (mất khi restart) — không lưu xuống đĩa, không dùng cookie nên miễn nhiễm CSRF.
- CORS chỉ chấp nhận origin localhost/LAN hoặc origin bạn khai báo trong `FINMATE_ORIGINS`.
- Sao lưu dùng `VACUUM INTO` nên bản sao luôn nhất quán kể cả khi server đang ghi.
