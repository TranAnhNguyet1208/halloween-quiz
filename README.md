# Đố Vui Tranh Biện - Halloween: hướng dẫn cho BTC

Game đố vui Halloween chạy **offline** trên laptop Windows. Người chơi lần lượt dùng chung một máy, còn BTC theo dõi và trao quà trực tiếp.
Game được viết bằng HTML, CSS và JavaScript thuần. Không cần Internet, không cần đăng nhập, không cài thêm phần mềm.
Không có nickname, bảng xếp hạng hay mã nhận quà.

## 1. Cách chạy

### Cách khuyến nghị: `start-game.bat`

1. Nhấp đúp `start-game.bat`. Một cửa sổ đen mở ra, sau đó trình duyệt mặc định mở địa chỉ **http://localhost:8765/**.
2. **Giữ cửa sổ đen mở** suốt sự kiện. Đóng cửa sổ này là tắt game.
3. Bấm **F11** để trình duyệt hiện toàn màn hình.

File `.bat` dùng Windows PowerShell (có sẵn trên Windows 10/11) để chạy một máy chủ tĩnh nhỏ, chỉ phục vụ trên chính máy này. Nếu có lỗi, cửa sổ sẽ hiện thông báo:
- *Không tìm thấy PowerShell*: dùng cách dự phòng bên dưới.
- *Không mở được cổng 8765*: có chương trình khác đang dùng cổng này. Hãy đóng chương trình đó. **Không đổi sang cổng khác** giữa sự kiện (xem mục 8).
- Nếu game đã chạy sẵn ở cửa sổ khác, file `.bat` chỉ mở lại trình duyệt.

### Cách dự phòng: mở trực tiếp `index.html`

Nhấp chuột phải vào `index.html`, chọn **Open with → Google Chrome** (hoặc Microsoft Edge). Game chạy đầy đủ ở chế độ `file://`.

Có thể chép nguyên thư mục `halloween-quiz` sang máy khác hoặc ổ khác: mọi ảnh, âm thanh, hiệu ứng đều nằm trong thư mục này (đường dẫn tương đối), không cần các thư mục nguồn bên ngoài.

### ⚠️ Chọn MỘT cách mở và giữ nguyên suốt sự kiện

Trình duyệt lưu dữ liệu **riêng theo địa chỉ**. Dữ liệu mở bằng `file://…/index.html` và dữ liệu mở bằng `http://localhost:8765/` là **hai kho khác nhau, không dùng chung** — tức là **hai tồn kho quà khác nhau**. `http://127.0.0.1:8765/` cũng khác `http://localhost:8765/`.

Trong suốt sự kiện:
- Luôn dùng **cùng một cách mở**, **cùng trình duyệt** và **cùng hồ sơ (profile)** trình duyệt.
- **Không dùng cửa sổ ẩn danh/InPrivate**, vì dữ liệu sẽ mất khi đóng cửa sổ.
- **Không xóa lịch sử hoặc dữ liệu duyệt web**, không chạy công cụ “dọn dẹp” trình duyệt.
- **Sao lưu** dữ liệu sự kiện định kỳ (mục 6.3), nhất là cuối buổi.

## 2. Luồng chơi

1. **Màn hình chào**: logo, luật ngắn và nút **Bắt đầu**.
2. **Câu hỏi**: 10 câu chia thành 5 level, mỗi level 2 câu. Mỗi câu có 3 lựa chọn A/B/C. Người chơi chọn một đáp án rồi bấm **Chốt đáp án**. Đã chốt thì không đổi được. Game không giới hạn thời gian.
   **Trả lời sai thì dừng ngay**; game tô xanh đáp án đúng (có thể tắt trong cấu hình).
3. **Kết quả phần hỏi**: số câu đúng, số level đã vượt và tổng lượt quay.
4. **Vòng quay may mắn** (nếu có lượt): mỗi lần bấm **Quay** mở đúng một lượt (khoảng 3 giây; bấm vào vòng quay để mở nhanh). Vòng quay có đủ 5 ô: Gấu bông, Mảnh ghép, Sticker, Kẹo, Không quà. Khi dừng, thẻ kết quả hiện tên quà; ô “Không quà” hiện lời chúc **“Chúc bạn may mắn lần sau!”**.
5. **Tổng kết**: số câu đúng, số lượt đã quay và danh sách quà thực nhận (món trùng được gộp, ví dụ “Kẹo × 2”).
6. BTC trao quà rồi bấm **“Đã trao quà — Người chơi tiếp theo”** (hoặc **“Kết thúc — Người chơi tiếp theo”** nếu người chơi không có quà). Nút này chỉ đóng phiên và mở phiên mới; **không** đụng tới tồn kho, nhật ký hay cài đặt sự kiện.

Bảng lượt quay (tổng lượt theo số câu đúng, không cộng dồn):

| Số câu đúng | 0–1 | 2–3 | 4–5 | 6–7 | 8–9 | 10 |
|---|---|---|---|---|---|---|
| Lượt quay | 0 | 1 | 2 | 3 | 4 | 5 |

Màn hình người chơi không có nút “Chơi lại”, không hiện tồn kho hay công cụ kỹ thuật.

## 3. Danh mục quà và xác suất (chính thức)

| Mã | Tên hiển thị | Xác suất gốc | Tồn kho ban đầu |
|---|---|---:|---:|
| `bear` | Gấu bông | 1% | 3 |
| `puzzle` | Mảnh ghép | 10% | 20 |
| `sticker` | Sticker | 10% | 20 |
| `candy` | Kẹo | 29% | 60 |
| `nothing` | Không quà (thẻ kết quả: “Chúc bạn may mắn lần sau!”) | 50% | Không giới hạn |

Tổng quà vật lý: **103 phần**. Một lần trúng = **một đơn vị** tồn kho (1 Mảnh ghép là 1 phần, 1 Sticker là 1 phần).
Trong lịch sử, file CSV và thống kê BTC, lượt không trúng ghi là **“Không quà”**.

### Luật trao quà (thông tin nội bộ, không hiển thị cho người chơi)

Kết quả được chọn bằng **thuật toán trọng số**, không suy ra từ diện tích ô (5 ô bằng nhau chỉ để trình bày).

**Phiên được cấp tổng cộng đúng 1 lượt** (đúng 2–3 câu) — có bảo hiểm:
1. Bốc theo xác suất gốc (đã xử lý hết hàng, xem dưới).
2. Nếu ra “Không quà” → đổi thành **Kẹo** nếu còn Kẹo.
3. Nếu hết Kẹo → chọn một món **còn hàng** theo trọng số gốc chuẩn hóa trong nhóm còn hàng (ví dụ còn Gấu/Mảnh ghép/Sticker thì theo tỉ lệ 1 : 10 : 10).
4. Khi còn đủ hàng, tỉ lệ thực nhận: **Gấu 1% · Mảnh ghép 10% · Sticker 10% · Kẹo 79%**.

Bảo hiểm chỉ áp dụng khi **tổng lượt được cấp là 1** — không áp dụng cho lượt cuối của phiên nhiều lượt.

**Phiên được cấp 2–5 lượt** — giới hạn quà:
- Mỗi lượt bốc theo xác suất gốc (đã xử lý hết hàng).
- Mỗi phiên **tối đa 2 quà vật lý**. Đã trúng 2 quà thì các lượt còn lại đều là “Không quà”.
- Hai lần trúng cùng món tính là hai quà. **Không bảo đảm** người có nhiều lượt sẽ nhận đủ 2 quà; có thể nhận 0 quà.

### Xử lý hết hàng

- Khi một món hết hàng, **toàn bộ xác suất gốc của món đó chuyển sang “Không quà”**, không chia cho các món còn hàng.
  Ví dụ hết Gấu: Gấu 0%, Mảnh ghép 10%, Sticker 10%, Kẹo 29%, Không quà 51%.
- Với phiên 1 lượt, bảo hiểm áp dụng **sau** bước này (ví dụ hết Gấu: Kẹo nhận 29% + 51% = 80%).
- Trong cùng một phiên, món vừa trúng được trừ ngay, nên không bao giờ trúng vượt kho hay làm kho âm.
- **Hết toàn bộ quà**: màn chào hiện “Quà của sự kiện tạm thời đã hết…” và **khóa nút Bắt đầu** cho tới khi BTC cộng thêm quà. Nếu một phiên đang chơi dở (ví dụ BTC vừa trừ hết kho), kết quả đã có vẫn giữ nguyên; các lượt không còn quà để giữ chỗ là “Không quà” và thẻ kết quả ghi thêm “Quà của sự kiện đã được phát hết.”

## 4. Kết quả được chốt và giữ chỗ như thế nào

- Toàn bộ kết quả vòng quay của phiên được **chốt ngay khi phần hỏi kết thúc**. Quà trúng được **giữ chỗ** trong kho trong **cùng một lần ghi** dữ liệu với kết quả, nên không thể có kết quả mà không có quà, hoặc ngược lại.
- Bấm **Quay** chỉ **mở** kết quả đã chốt; không bốc mới, không trừ kho thêm. Tải lại hay đóng/mở trình duyệt: quà đã giữ chỗ vẫn thuộc phiên đó, lượt đã mở không được hoàn lại.
- BTC bấm **“Đã trao quà — Người chơi tiếp theo”**: quà của phiên chuyển từ *giữ chỗ* sang *đã trao* (không trừ kho thêm lần nữa; bấm nhiều lần cũng chỉ ghi một lần).

Mỗi loại quà có 3 con số, luôn được **tính lại** từ một nguồn dữ liệu duy nhất (không lưu bộ đếm riêng nên không thể lệch nhau):

| | Ý nghĩa |
|---|---|
| **Khả dụng** | Còn có thể bốc cho người chơi. = ban đầu + điều chỉnh − giữ chỗ − đã trao |
| **Giữ chỗ** | Đã trúng, thuộc về một phiên, chưa xác nhận trao |
| **Đã trao** | BTC đã xác nhận trao |

## 5. Vai trò của BTC

Các nút điều khiển nhanh (chuyển người chơi tiếp theo, mở bảng BTC, hủy phiên, tiếp quản tab) **không cần PIN**, để trải nghiệm nhanh. BTC giám sát trực tiếp; nếu người chơi tự ý bấm nút của BTC, BTC xử lý ngoài game.
Các công cụ **kho quà, sao lưu, nhập dữ liệu và khởi tạo sự kiện** cần **mã PIN** (mục 6).

## 6. Bảng BTC

Bấm nút **BTC** ở góc trên bên phải. Bảng có 3 thẻ:

### 6.1. Phiên & lịch sử (không cần PIN)
- Phiên hiện tại, số phiên đã kết thúc, quà đã trao, số lượt “Không quà”, số quà khả dụng còn lại.
- **Xuất lịch sử CSV** (mở bằng Excel, có BOM UTF-8) hoặc **JSON**. File được tải về thư mục *Downloads*.
- **Hủy phiên hiện tại & tạo phiên mới** (bấm hai lần để xác nhận), dùng khi người chơi bỏ dở. Phiên bị hủy ghi vào lịch sử là “BTC hủy phiên”; lượt quay chưa dùng bị bỏ.
  **Quà đã giữ chỗ của phiên bị hủy VẪN giữ chỗ** (không tự hoàn kho, kể cả khi đóng tab). BTC xử lý ở thẻ Kho quà.

### 6.2. Kho quà (cần PIN)
- Bảng theo từng loại: ban đầu, điều chỉnh, **khả dụng**, **giữ chỗ**, **đã trao**.
- **Điều chỉnh quà khả dụng**: chọn món, số lượng, **lý do (bắt buộc)** → *Cộng vào kho* hoặc *Trừ khỏi kho* (ví dụ chuyển quà sang hoạt động khác). Không trừ được quá số khả dụng, nên **không bao giờ lấy được quà đang giữ chỗ** cho người chơi.
- **Quà đang giữ chỗ của phiên đã đóng** (thường là phiên bị hủy): mỗi phiên có 2 nút, đều cần lý do và được ghi nhật ký:
  - **Đã trao** — người chơi thực tế đã nhận quà → chuyển sang *đã trao* (không trừ kho thêm).
  - **Hoàn kho** — chắc chắn người chơi không nhận → trả về *khả dụng*.
  Quà giữ chỗ của **phiên đang chơi** không thể hoàn kho hay chuyển đi.
- **Nhật ký kho**: thời gian, thao tác, món, số lượng thay đổi, số khả dụng sau, lý do. Nút **Xuất CSV**.

### 6.3. Sao lưu & sự kiện (cần PIN)
- **Tải bản sao lưu sự kiện (JSON)**: toàn bộ kho, giữ chỗ, lịch sử, nhật ký và phiên đang chơi.
- **Nhập bản sao lưu…**: game kiểm tra file **trước khi nhập** (đúng định dạng, đúng phiên bản, danh mục quà khớp cấu hình, kho không âm, quà giữ chỗ khớp kết quả…). File sai hoặc file của bản cũ bị từ chối và **dữ liệu hiện tại giữ nguyên**. File hợp lệ: game tự tải về bản sao lưu dữ liệu hiện tại, rồi yêu cầu gõ **NHẬP** để xác nhận.
- **Khởi tạo sự kiện mới…**: thao tác riêng, xóa toàn bộ kho/lịch sử/nhật ký của sự kiện hiện tại và đặt lại kho theo `config.js` (3/20/20/60). Game tự tải bản sao lưu trước, rồi yêu cầu gõ **KHỞI TẠO** (có dấu hay không dấu đều được).

### Mã PIN
Mặc định `3110`. Đổi ở dòng `BTC_PIN` trong `js/config.js`. PIN chỉ có hiệu lực cho tới khi đóng bảng BTC (mở lại phải nhập lại).
Lưu ý: đây là lớp chắn thao tác nhầm trên máy chung, không phải bảo mật thực sự (ai mở được file `config.js` đều đọc được PIN).

## 7. Dữ liệu của bản cũ và dữ liệu không tương thích

Bản trước dùng danh mục quà cũ (có Móc khóa) và chưa có tồn kho. Khi mở bản mới trên trình duyệt còn dữ liệu cũ:
- Game hiện màn **“Phát hiện dữ liệu của bản cũ”** và **chặn bắt đầu**.
- Dữ liệu cũ **không bị xóa, không bị đổi** sang quà mới và **không bị tính** vào 103 phần quà mới.
- **Bước 1**: bấm *Tải sao lưu dữ liệu cũ* (file JSON về *Downloads*). **Bước 2**: bấm *BTC khởi tạo sự kiện mới*, nhập PIN và gõ KHỞI TẠO. Sự kiện mới bắt đầu với kho 3/20/20/60.

Tương tự, nếu dữ liệu đã lưu **bị hỏng** hoặc **không khớp** danh mục quà trong `config.js` (ví dụ ai đó sửa mã quà), game **không tự reset**: màn hình báo lỗi, cho tải bản sao rồi mới cho BTC khởi tạo (cần PIN). Nếu vừa sửa nhầm `config.js`, chỉ cần sửa lại và tải lại trang.

## 8. Lưu dữ liệu và khôi phục

Toàn bộ sự kiện (phiên hiện tại, kho, giữ chỗ, lịch sử, nhật ký) nằm trong **một bản ghi có số phiên bản** trong `localStorage` (khóa `hq-halloween-v2:event`). Mỗi thao tác quan trọng ghi **một lần** rồi đọc lại để xác nhận, nên không có trạng thái “ghi dở”.

| Đang ở | Sau khi tải lại / mở lại |
|---|---|
| Màn chào | Vẫn bộ đề và thứ tự đáp án cũ |
| Đang trả lời | Quay về đúng câu hiện tại |
| Vừa trả lời sai | Ở màn kết quả; kết quả và quà giữ chỗ không đổi |
| Đang quay | Lượt vừa bấm được tính là đã mở; không tốn thêm lượt, không bốc lại, không trừ kho lại |
| Còn lượt quay | Còn đúng số lượt cũ |
| Đã quay hết | Màn tổng kết |
| Đã xác nhận trao quà | Phiên mới; phiên cũ không xác nhận lại được |

**Hai tab cùng lúc:** chỉ một tab được xử lý game; tab mở sau bị khóa. Nếu tab cũ đã đóng, tab mới tự mở khóa sau vài giây. BTC có thể bấm **“BTC: dùng tab này thay thế”**. Ngoài ra mỗi lần ghi đều kiểm tra dữ liệu chưa bị tab khác thay đổi; nếu đã bị đổi, thao tác bị từ chối (không cấp quà hai lần trên cùng kho) và game yêu cầu tải lại trang.

**Trình duyệt chặn lưu dữ liệu**: game báo cho BTC và **không cho bắt đầu**.

**Giới hạn:**
- Dữ liệu chỉ nằm trong trình duyệt trên máy này; mất nếu xóa dữ liệu duyệt web, dùng ẩn danh, đổi trình duyệt/hồ sơ hoặc đổi cách mở (mục 1). Hãy sao lưu định kỳ.
- Nếu trình duyệt tắt đột ngột khi đang quay, lượt đó vẫn được tính và hiện trong danh sách khi mở lại, nhưng hiệu ứng không chạy lại.
- Sau khi trình duyệt tắt đột ngột, lần mở lại đầu tiên có thể phải chờ vài giây để khóa tab cũ hết hạn.

## 9. Cấu hình (`js/config.js`)

| Mục | Ý nghĩa |
|---|---|
| `BTC_PIN` | Mã PIN công cụ kho/sao lưu. |
| `LEVEL_PLAN` | Phân bố câu hỏi mỗi phiên: level 1–2 câu dễ, 3–4 trung bình, 5 khó (mỗi level 2 câu). |
| `SPIN_TABLE` | Số lượt quay theo số câu đúng (phần tử thứ *n* ứng với *n* câu đúng). |
| `PRIZES` | Danh mục quà: mã, tên, biểu tượng, **xác suất gốc** (`weight`, số nguyên %, **tổng phải đúng 100**), **tồn kho ban đầu** (`stock`), thứ tự ô trên vòng quay. |
| `SINGLE_SPIN_SWAP` | Bảo hiểm phiên 1 lượt: “Không quà” → “Kẹo” (hết Kẹo thì chọn món còn hàng). |
| `MULTI_SPIN_MAX_PRIZES` | Phiên từ 2 lượt: tối đa bao nhiêu quà (mặc định 2). |
| `REVEAL_CORRECT_ON_WRONG` | Có tô xanh đáp án đúng khi trả lời sai hay không. |
| `TIMING` | Thời gian hồi hộp khi chốt đáp án, thời gian quay (2,6 giây; 0,7 giây khi máy bật giảm chuyển động). |

Game kiểm tra cấu hình khi mở; sai (ví dụ tổng xác suất khác 100%) thì báo lỗi thay vì chạy sai.
Xác suất mới áp dụng từ phiên sau. **Tồn kho ban đầu chỉ áp dụng khi khởi tạo sự kiện mới**; trong sự kiện hãy dùng công cụ điều chỉnh kho. Đổi/thêm/bớt **mã quà** sẽ khiến dữ liệu sự kiện đang lưu không khớp → phải sao lưu và khởi tạo sự kiện mới (mục 7).

## 10. Cập nhật câu hỏi (chỉ ở bước chuẩn bị)

Khi chơi, game chỉ đọc `js/questions-data.js`. Nếu sửa câu hỏi:
1. Sửa file Excel trong `data-source/` (giữ nguyên tên cột và tên sheet).
2. Trên máy có Python 3 và `openpyxl` (`py -m pip install openpyxl`), mở cửa sổ lệnh tại thư mục game rồi chạy: `py tools\convert_questions.py`.
3. Công cụ in ra số câu theo độ khó; gặp dòng không nhận dạng được thì dừng và báo lỗi.

Ghi chú rà soát nội dung câu hỏi: [GHI-CHU-CAU-HOI.md](GHI-CHU-CAU-HOI.md).

## 11. Giao diện, âm thanh, hiệu ứng

- Chủ đề Halloween: nền nhiều lớp (trời sao, trăng, mạng nhện, dơi, sương, cây ma), chuyển cảnh sương tím giữa các màn.
- Màn câu hỏi kiểu “Ai là triệu phú”: khung lục giác, vầng sáng trường quay xoay chậm, thang level sáng lên khi vượt level.
- Vòng quay kiểu “triệu hồi”: nền đêm trăng, vòng phép, vệt sáng trung tính khi bắt đầu quay (giống nhau cho mọi kết quả, không báo trước kết quả), sau khi dừng mới lóe sáng + hạt sáng theo màu của quà đã trúng và lật thẻ kết quả. Gấu bông có hiệu ứng vàng nổi bật hơn.
- Âm thanh tổng hợp bằng Web Audio, có nút tắt/bật 🔊 ở góc trên. Máy bật “giảm chuyển động” (Windows: Cài đặt → Trợ năng → Hiệu ứng hình ảnh → tắt Hiệu ứng hoạt ảnh) thì game bỏ vệt sáng/hạt sáng/chuyển cảnh và quay nhanh.
- Không dùng video; toàn bộ tài nguyên ~1 MB, chạy offline, font hệ thống (Segoe UI).

## 12. Cấu trúc thư mục

```
halloween-quiz/
├─ index.html              Khung các màn hình
├─ start-game.bat          Chạy máy chủ cục bộ + mở trình duyệt
├─ css/style.css           Giao diện
├─ js/config.js            CẤU HÌNH (PIN, phân bố câu, quà, xác suất, tồn kho…)
├─ js/questions-data.js    Ngân hàng 59 câu (tự tạo từ Excel)
├─ js/game-logic.js        Luật chơi, tạo đề, bốc quà theo kho (thuần, kiểm thử được)
├─ js/inventory.js         Kho quà: giữ chỗ, trao, điều chỉnh, hoàn kho, sao lưu, kiểm tra dữ liệu
├─ js/storage.js           Lưu/đọc một bản ghi có version, chống ghi đè giữa các tab, phát hiện dữ liệu cũ
├─ js/tab-lock.js          Khóa để chỉ một tab xử lý game
├─ js/wheel.js             Vẽ và quay vòng quay (SVG)
├─ js/fx.js                Hiệu ứng vệt sáng, hạt sáng, chuyển cảnh
├─ js/sound.js             Âm thanh tổng hợp (Web Audio)
├─ js/app.js               Điều khiển giao diện + bảng BTC
├─ assets/                 Logo chính, 2 ảnh bí ngô (giữ nguyên)
├─ assets/ui/              Ảnh giao diện đã chọn lọc + CREDITS.md
├─ data-source/            Bản sao file Excel gốc
├─ tools/                  convert_questions.py, prepare_assets.py, prepare_ui_assets.py, server.ps1
└─ tests/                  Kiểm thử logic, kho, tĩnh (Node) và đầu-cuối (Chrome)
```

## 13. Kiểm thử (dành cho người kỹ thuật)

- `node tests/logic.test.js` — luật và bốc quà với **nguồn ngẫu nhiên thay thế được**: bảng lượt 0–10, sai là dừng, chốt một lần; xác suất áp dụng 1/10/10/29/50; hết từng món chuyển đúng % sang “Không quà”; phân bố **chính xác** của phiên 1 lượt (1/10/10/79, hết Gấu → Kẹo 80%, hết Kẹo → chuẩn hóa 1:10:10); vét cạn mọi chuỗi bốc phiên 2–5 lượt (tối đa 2 quà, không bảo hiểm lượt cuối); 20.000 phiên ngẫu nhiên trên kho nhỏ không trúng vượt kho.
- `node tests/inventory.test.js` — giữ chỗ khi chốt, quay/tải lại không trừ lại, xác nhận trao 2 lần không trừ 2 lần, người chơi tiếp theo không reset kho, điều chỉnh không lấy quà giữ chỗ, hủy phiên + hoàn kho/đã trao, chơi tới khi hết đúng 103 phần, nhập dữ liệu sai/bản cũ bị từ chối, hai tab ghi cùng lúc bị chặn, phát hiện dữ liệu bản cũ.
- `node tests/static.test.js` — logo + 2 ảnh bí ngô giữ nguyên từng byte; mọi tài nguyên dùng đường dẫn tương đối và tồn tại; không có đường dẫn tuyệt đối hay URL ngoài; không có video.
- `node tests/e2e.test.js` — cần Node ≥ 22, Chrome/Edge và máy chủ đang chạy (`powershell -ExecutionPolicy Bypass -File tools\server.ps1 -NoBrowser`). Chạy toàn bộ luồng trên Chrome thật: tải lại ở từng giai đoạn, bấm nhanh nhiều lần, thời gian công bố 2–4 giây, kim dừng đúng ô và thẻ ghi đúng tên, PIN, điều chỉnh kho, hủy phiên + hoàn kho, hết quà khóa Bắt đầu, sao lưu/nhập/khởi tạo, dữ liệu bản cũ, dữ liệu hỏng, hai tab, bố cục 1366×768 / 1366×657 / 1920×1080 với câu hỏi dài nhất, `file://`, chặn lưu trữ, không có yêu cầu mạng ra ngoài.

## 14. Nguồn tài nguyên và ghi công

- Chủ dự án đã liên hệ và được các tác giả đồng ý cho dùng tài nguyên trong trò chơi nhỏ **phi thương mại** này. Chi tiết từng file: [assets/ui/CREDITS.md](assets/ui/CREDITS.md).
  - [sandra-selezen/halloween](https://github.com/sandra-selezen/halloween) — cây ma, dơi, ngôi sao, bí ngô, bóng ma, vạc phép.
  - [ngdathd/AiLaTrieuPhu](https://github.com/ngdathd/AiLaTrieuPhu) — vầng sáng trường quay; bố cục khung câu hỏi/đáp án/thang level được dựng lại bằng CSS.
  - [shadorki/genshin-impact-wish-simulator](https://github.com/shadorki/genshin-impact-wish-simulator) — ảnh nền đêm trăng (theo README dự án đó, hình lấy từ Genshin Impact, bản quyền miHoYo/HoYoverse); hiệu ứng triệu hồi chỉ lấy cảm hứng và được dựng lại bằng CSS/Canvas.
- Game **không phải** sản phẩm chính thức của Genshin Impact hay chương trình “Ai là triệu phú”. Không có banner, tiền tệ, nhân vật, lượt x10 hay cơ chế pity.
- `main-logo.jpg` và hai ảnh bí ngô do BTC cung cấp, giữ nguyên (ảnh bí ngô đã được tách nền từ trước bằng `tools/prepare_assets.py`).
- Biểu tượng quà là emoji của font hệ thống Windows (Segoe UI Emoji). Âm thanh tổng hợp bằng Web Audio. Không dùng CDN hay font từ xa.
