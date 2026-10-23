# Đặt Món Chung

Trang web đặt đồ ăn chung cho nhóm. Dán link quán trên ShopeeFood, máy chủ lấy toàn bộ món (ảnh, giá, nhóm món) và hiện ngay dưới ô **Tìm món**, giống trang quán trên ShopeeFood.

- Tìm món gõ có dấu hay không dấu đều được ("com tam" ra "Cơm tấm").
- Bấm **+** cạnh món là chọn, bấm **−** để bớt. Món có size/topping thì mở ô chọn tuỳ chọn.
- Ngay dưới mỗi món hiện tên + số lượng của từng người đã chọn (ví dụ "Lan ×2"), cập nhật tức thì cho mọi người đang mở trang.
- Bảng **Đơn chung hôm nay** gom theo người, tổng tiền, và danh sách gộp để copy đi đặt.
- Thêm bao nhiêu quán cũng được, mỗi quán một tab, quán nào cũng chạy như trên.

Không cần cài thư viện nào. Chỉ cần Node.js 18 trở lên.

## Chạy thử trên máy

```bash
node server.js
```

Mở http://localhost:3000. Người cùng mạng wifi vào bằng `http://<IP máy bạn>:3000` (xem IP bằng `ipconfig` trên Windows hoặc `ipconfig getifaddr en0` trên Mac).

Dữ liệu (quán, đơn) lưu ở `data/data.json`.

## Đưa lên mạng để ai cũng vào được

**Render (miễn phí, không cần thẻ):**

1. Vào https://render.com, bấm *Get Started* và đăng nhập bằng GitHub.
2. Bấm *New → Blueprint*, chọn repo `dat-mon-chung`. Render đọc file `render.yaml` và tự điền hết cấu hình (gói Free, máy chủ Singapore).
3. Bấm *Apply*, đợi khoảng 2 phút. Link web có dạng `https://dat-mon-chung-xxxx.onrender.com`, gửi link này cho mọi người.

Lưu ý gói miễn phí: web "ngủ" sau 15 phút không ai vào, lần mở đầu tiên sau đó mất khoảng 30 đến 60 giây. Mỗi lần thức dậy, máy chủ mất dữ liệu đã lưu: đơn cũ mất, còn các quán sẽ tự được trình duyệt của người từng mở trang gửi lại. Trong giờ mọi người đang đặt thì web vẫn thức nên đơn không mất.

**Muốn giữ dữ liệu lâu dài:** dùng gói trả phí có Disk của Render (gắn ở `/data`, đặt biến `DATA_DIR=/data`), hoặc Railway có Volume, hoặc chạy trên một VPS bằng `PORT=80 node server.js`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng chạy web |
| `DATA_DIR` | `./data` | Thư mục lưu `data.json` |
| `GAPP_BASE` | `https://gappapi.deliverynow.vn/api/` | Địa chỉ API của ShopeeFood |

## Nếu không lấy được menu tự động

Máy chủ gọi API công khai của ShopeeFood. Nếu ShopeeFood chặn máy chủ (ví dụ máy chủ đặt ở nước ngoài), trang sẽ hiện cách dự phòng: copy một đoạn mã, chạy trong Console trên trang quán, rồi dán kết quả vào. Chọn máy chủ đặt ở Singapore hoặc chạy trên máy tại Việt Nam sẽ ít bị chặn hơn.

## Lưu ý

- Không có đăng nhập. Ai có link cũng đặt món, thêm quán, xoá đơn được. Mỗi người chỉ xoá được dòng mình đặt (nhận theo trình duyệt).
- Giá tính theo menu đã lưu, chưa gồm phí ship và mã giảm giá. Bấm "Cập nhật menu" để lấy giá mới.
