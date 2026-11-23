# Văn phòng ảo — Agent Observatory 0.2.0

## Mục tiêu

Một cửa sổ riêng để thấy agents đang làm gì trong khi bạn tiếp tục dùng Claude Code. Cùng collector và dữ liệu với dashboard phân tích; giao diện văn phòng trình bày trạng thái thành nhân vật, bàn và khu làm việc. Di chuyển là quy ước trực quan theo hoạt động, không phải vị trí thực của agent.

Mở bằng `/agents-office`, URL `http://127.0.0.1:47831/office`, hoặc nút **Văn phòng ảo** trên dashboard. Nút mở cửa sổ riêng khi trình duyệt cho phép; liên kết vẫn hoạt động nếu popup không được tạo.

## Các mẫu đã nghiên cứu

| Nguồn chính | Cách hoạt động được repo mô tả | Áp dụng vào bản này |
| --- | --- | --- |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | Nhân vật đại diện agent, hoạt ảnh theo tool, chỉ báo cần phản hồi. Hooks là đường nhận sự kiện mặc định, transcript là fallback. | Danh tính avatar ổn định; tool và chờ phản hồi có biểu hiện riêng; chọn nhân vật để xem bằng chứng. |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI/blob/master/README.en.md) | Trạng thái được đẩy vào qua script/API, sau đó gán tới từng khu văn phòng. | Khu làm việc, khu chờ, phòng nghỉ; giữ trạng thái đọc được bằng chữ. Code MIT nhưng artwork có điều kiện noncommercial, nên bản này tự vẽ toàn bộ. |
| [Agents Office](https://github.com/cernadasjuan/agents-office) | Văn phòng 3D, đọc session/transcript, ánh xạ tool tới bookshelf/desk/whiteboard và di chuyển giữa các trạm. | Hoạt động → khu vực. Chọn 2D cố định để nhìn nhanh, không cần điều khiển camera hay thêm Three.js. |

Ngày đối chiếu: 23/11/2026. Chỉ tham khảo cách tương tác, không sao chép source, sprites, âm thanh hoặc artwork của các dự án trên.

## Trạng thái và bằng chứng

| Trạng thái UI | Bằng chứng | Biểu hiện |
| --- | --- | --- |
| Đang gọi model | Function hook `turn.step` đang mở; có request ID và dấu bắt đầu/kết thúc | Tại bàn, nhịp xử lý nhẹ |
| Đang xử lý | Agent đang chạy nhưng không có tool/model request đang mở được quan sát | Tại bàn; nhãn suy ra, không tạo nội dung suy nghĩ |
| Đọc / tìm kiếm | Read, Glob, Grep hoặc tool tìm kiếm được ghi nhận | Tới thư viện, biểu tượng đọc |
| Chỉnh sửa | Edit, Write và tool sửa tệp được ghi nhận | Tại bàn, gõ máy |
| Chạy lệnh / dùng tool | Bash hoặc tool tương ứng đang mở | Tới khu terminal |
| Phối hợp | Agent/Task đang chạy | Tới bảng phối hợp |
| Chờ bạn | Permission/input wait được collector ghi nhận | Khu chờ, dấu chú ý |
| Tạm nghỉ / đã kết thúc | Turn/agent/session lifecycle | Phòng nghỉ, nhãn riêng cho idle và completed |
| Dữ liệu cũ / mất kết nối | Quá ngưỡng sự kiện hoặc mất nguồn cập nhật | Giữ thông tin cuối, dừng hoạt ảnh làm việc và cảnh báo |

`turn.step` là khoảng gửi yêu cầu và nhận phản hồi từ model, **không đồng nghĩa toàn bộ thời gian đó là suy nghĩ nội bộ**. Module chỉ lưu timestamp, request ID, session/agent ID và model khi có. Nó chuyển tiếp nguyên stream bằng `yield* next(e)`; không đọc hay lưu các chunk, prompt hoặc suy luận. Xem [Follow a turn — tài liệu chính thức](https://code.claude.com/docs/en/plugins/mods/events#follow-a-turn).

Collector chỉ giữ tên chương trình shell đầu tiên, nên không đoán một lệnh Bash là test, build hay deploy từ các tham số đã bị bỏ. Task và bong bóng hoạt động lấy từ metadata được ghi nhận; không tạo câu tự sự cho agent.

## Tương tác

- Chọn nhân vật hoặc tên trong roster để xem công việc, bằng chứng trạng thái, tool và usage.
- Lọc dự án, phiên hoặc tìm agent/task/tool.
- Hiển thị tối đa 12 nhân vật trên bản đồ, ưu tiên cần chú ý và đang làm; roster giữ các agent vượt giới hạn và thông báo rõ số lượng.
- Trạng thái cập nhật từ cùng API/SSE của dashboard, gần thời gian thực với nhịp 2 giây. Tool rất nhanh có thể chỉ xuất hiện trong lịch sử, không kịp có hoạt ảnh riêng.
- Tạm dừng màn hình không dừng Claude. Bản cập nhật mới được giữ lại và hiện khi tiếp tục.
- Hỗ trợ giao diện sáng/tối, bàn phím và `prefers-reduced-motion`.

## Demo

`/office?demo=1` sử dụng 14 bước mẫu, có nút phát/dừng, chuyển bước và thanh tiến trình. Các bước được tạo từ event prefixes qua cùng reducer, cộng thêm model request mẫu. Demo được gắn nhãn trong cả API và UI; không ghi vào nhật ký hoặc thay thế dữ liệu thật khi mất kết nối.

`npm run preview` tạo hai HTML độc lập trong `artifacts/`. Bản office chứa cả dữ liệu, code, CSS và vector artwork; không cần network khi xem. Liên kết qua lại giữa hai HTML hoạt động khi chúng ở cùng thư mục.

## Cấu trúc bổ sung

- `plugin/web/office.html`, `office.css`, `office.js`: cửa sổ và tương tác.
- `plugin/web/office-scene.svg`: artwork nguyên bản.
- `plugin/web/office-model.mjs`: ánh xạ snapshot → phase, bằng chứng, khu vực và danh tính nhân vật.
- `plugin/lib/office-demo.mjs`: replay mẫu tách khỏi dữ liệu thật.
- `agent.modelActivity`: phần bổ sung tùy chọn của snapshot v1; `null` nếu chưa quan sát được.
- `/api/office-demo`: chỉ trả replay mẫu; `/api/state` và `/api/events` tiếp tục phục vụ dữ liệu của dashboard.

## Phạm vi xác minh

Có kiểm tra state mapping, source staleness, danh tính, overflow, native stream pass-through, thứ tự model events, MIME và route assets, sample/live separation. Artwork SVG được render và kiểm tra trực quan riêng. Không coi kiểm tra asset này là xác nhận toàn bộ layout HTML hoặc tương thích Claude Code thật; xem `verification.md`.
