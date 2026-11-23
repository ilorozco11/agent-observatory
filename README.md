# Agent Observatory

**Mod Claude Code để theo dõi agents bằng pane trong terminal và dashboard web cục bộ.** Giao diện tiếng Việt, monochrome sáng/tối, không cần npm dependencies hoặc dịch vụ bên ngoài.

Bản `0.2.0` bổ sung **cửa sổ văn phòng ảo**: mỗi agent là một nhân vật đi giữa bàn làm việc, thư viện, terminal, bảng phối hợp, khu chờ và phòng nghỉ theo hoạt động được ghi nhận. Nó dùng cùng collector với cây agent, timeline, tools, tasks và usage của dashboard. Các HTML đi kèm là **dữ liệu mẫu được gắn nhãn** để xem giao diện.

Xem thiết kế, các repo tham khảo và cách phân biệt trạng thái quan sát/suy ra tại [docs/virtual-office.md](docs/virtual-office.md).

## 1. Chạy thử ngay

Yêu cầu **Node.js 22+** và quyền truy cập repo GitHub này. Clone vào một thư mục cố định:

```bash
git clone https://github.com/ilorozco11/agent-observatory.git
cd agent-observatory
node --version
npm run demo
```

Mở **http://127.0.0.1:47831/?demo=1**. Không cần `npm install`. Demo có hai dự án giả lập (`sample-app`, `sample-code-review`) và tám agents với tình huống chạy song song, chờ phản hồi, kết thúc và lỗi tool đã được xử lý.

Mở **http://127.0.0.1:47831/office?demo=1** để xem văn phòng ảo với **14 bước phát lại**: gọi model, đọc code, chỉnh sửa, chạy lệnh, gặp lỗi, chờ bạn và kết thúc. Có nút phát/dừng, chuyển bước và chọn nhân vật.

Nhấn `Ctrl+C` ở terminal để dừng demo trước khi dùng chế độ thật trên cùng cổng. Hoặc mở [bản xem trước văn phòng](previews/agent-observatory-office-preview.html) hoặc [bản xem trước dashboard](previews/agent-observatory-preview.html) sau khi clone repo hay giải nén ZIP. Hai file HTML có đầy đủ mã và dữ liệu mẫu, không kết nối collector.

## 2. Dùng dữ liệu thật trong Claude Code

Dùng bản Claude Code hiện hành có Mods/function hooks. **Khuyến nghị 2.1.299+** vì bản này dùng API `ui.close`. File types đi kèm bản Claude Code cài trên máy là nguồn xác nhận tương thích cuối cùng.

### Thử plugin từ thư mục local

Trong thư mục nguồn đã clone hoặc giải nén:

```bash
claude --plugin-dir ./plugin
```

Để theo dõi một repo khác, mở terminal tại repo đó và truyền đường dẫn tuyệt đối đến plugin, ví dụ `claude --plugin-dir /absolute/path/agent-observatory/plugin`.

Trong phiên Claude Code đó:

```text
/agents-board
/agents-board all
/agents-web
/agents-office
/agents-board close
```

| Lệnh | Kết quả |
| --- | --- |
| `/agents-board` | Mở pane theo dõi phiên hiện tại; có nút đổi phạm vi |
| `/agents-board all` | Xem mọi phiên đã được collector ghi nhận trên cùng máy |
| `/agents-web` | Khởi động server nếu cần và trả URL dashboard web |
| `/agents-office` | Khởi động server nếu cần và trả URL cửa sổ văn phòng ảo |
| `/agents-board close` | Đóng pane, dừng polling của pane |

Lệnh mở dashboard khởi động server nền nếu chưa chạy. Đóng pane không tắt collector hoặc server vì các phiên khác có thể đang sử dụng chúng. Muốn quản lý vòng đời server bằng terminal, chạy `npm start` trong một terminal riêng **trước** khi mở pane; dùng `Ctrl+C` ở terminal đó để dừng server.

Nếu nâng cấp từ 0.1.0, dừng server cũ rồi khởi động server từ thư mục 0.2.0 và reload plugin. Launcher sẽ báo rõ nếu cổng hiện vẫn do server phiên bản cũ sử dụng. Nhật ký cũ tương thích; trường hoạt động model mới sẽ xuất hiện từ lúc nạp bản mới.

### Cài từ GitHub

Với tài khoản có quyền truy cập repo private này:

```bash
claude plugin marketplace add ilorozco11/agent-observatory
claude plugin install agent-observatory@agent-observatory
```

Nếu Claude chưa xác thực GitHub để đọc repo private, đăng nhập GitHub trên máy hoặc dùng marketplace local bên dưới.

### Cài lâu dài qua marketplace local

Giữ thư mục nguồn ở vị trí ổn định. Thay đường dẫn ví dụ bằng đường dẫn tuyệt đối thật:

```bash
claude plugin marketplace add /absolute/path/agent-observatory
claude plugin install agent-observatory@agent-observatory
```

Mở phiên mới hoặc chạy `/reload-plugins` trong phiên hiện tại. Không nạp cùng plugin bằng cả marketplace và `--plugin-dir` trong một phiên. Có thể kiểm tra cấu trúc bằng `claude plugin validate ./plugin` từ thư mục nguồn trên máy có Claude Code.

### Xác nhận dữ liệu thật

1. Khởi động một phiên với plugin đã nạp, mở `/agents-board` hoặc `/agents-web`.
2. Yêu cầu Claude làm một việc đơn giản trong dự án, ví dụ đọc README. Phiên và tool Read sẽ xuất hiện.
3. Với công việc có subagents, chọn một agent trong bảng để xem trạng thái, tools, tệp và usage.
4. Dashboard thật không có banner “Dữ liệu mẫu”. Khi chưa nhận sự kiện, nó hiển thị trạng thái trống.

## 3. Bạn xem được gì?

| Phần | Công dụng |
| --- | --- |
| Cây agents | Thấy ai đang chạy, ai chờ bạn, quan hệ parent/child khi runtime báo được |
| Văn phòng ảo | Nhân vật ổn định, hoạt ảnh theo tool/model request, khu chờ nổi bật, chọn agent để xem bằng chứng |
| Bộ lọc | Lọc theo dự án, phiên, trạng thái hoặc từ khóa; số đếm và timeline theo cùng bộ lọc |
| Timeline | Các lần gọi tool đặt trên cùng trục thời gian, có thời lượng và dấu lỗi |
| Chi tiết agent | Model, thời gian, tool calls, lỗi đã ghi nhận, token/cache, danh sách tệp |
| Tasks | Subject, trạng thái, owner và dependency được ghi nhận từ TaskCreate/TaskUpdate thành công |
| Usage phiên | Context, chi phí ước tính và quota khi function hook `session.measure` báo dữ liệu |
| Luồng hoạt động | Sự kiện gần đây, phân biệt đang chạy, thành công, lỗi, từ chối quyền và bị ngắt |
| Trạng thái nguồn | Đang kết nối, mất kết nối, sự kiện đã cũ, dữ liệu mẫu; giữ snapshot cuối khi mất kết nối |
| Tạm dừng màn hình | Giữ nguyên dashboard để đọc; agents vẫn tiếp tục làm việc |

Web nhận cập nhật qua SSE mỗi 2 giây; pane poll mỗi 2 giây khi đang mở. Usage phiên được gộp tối đa một bản ghi mỗi 5 giây. Đây là nhịp cập nhật giao diện/collector, không phải cam kết độ trễ của runtime.

Văn phòng gần thời gian thực, không nhận từng token để làm hoạt ảnh. Tool rất nhanh có thể hoàn tất giữa hai snapshot; lịch sử tool vẫn ghi nhận nó. `Đang gọi model` dựa trên khoảng `turn.step` đang mở; `Đang xử lý` chỉ là suy ra từ lượt đang chạy khi chưa có tín hiệu chi tiết. Mod không thu thập nội dung suy nghĩ.

## 4. Cách đọc số liệu

- `—` nghĩa là chưa có dữ liệu. Không biến thời gian chạy thành token, chi phí hay phần trăm hoàn thành.
- `Đã kết thúc` là agent đã kết thúc vòng đời được quan sát; không có nghĩa toàn bộ bài kiểm tra đã pass.
- `Chờ bạn` dựa trên yêu cầu quyền, câu hỏi hoặc thông báo chờ từ runtime. Không có sự kiện mới chỉ tạo cảnh báo dữ liệu cũ.
- Một lỗi tool được giữ trong lịch sử ngay cả khi tool sau đã thành công. Tool bị người dùng ngắt không được tính là lỗi.
- Cây dùng parent ID do runtime cung cấp. Nếu không có, agent được giữ riêng; không đoán quan hệ.
- Token được đọc từ usage trong transcript local, cộng theo message ID riêng biệt, có input/output/cache read/cache write. Token của phiên và của từng agent là hai phạm vi; không cộng trùng.
- Chi phí là **ước tính do runtime báo**, không phải hóa đơn. Nếu runtime báo có giá model bị thay thế, chi phí hiện `—`. Không phân bổ tổng chi phí phiên cho từng subagent khi chưa có số liệu tương ứng.
- Quota và context là hai số liệu khác nhau. Mod hiển thị khi được báo; không tự đặt budget hoặc dừng agent theo ngưỡng.

## 5. Dữ liệu và cấu hình

Mặc định, collector lưu ở `~/.claude/agent-observatory`:

- `events/`: nhật ký JSONL gồm metadata sự kiện đã chuẩn hóa, một file cho mỗi session.
- `usage/`: offset, message ID đã băm và bộ đếm usage để đọc transcript tăng dần.
- `server.log`: log khởi động server nền.

Collector không ghi prompt, nội dung trả lời của assistant, đầy đủ input/output của tool, biến môi trường hoặc dòng lệnh shell. Nó giữ tên agent/task, đường dẫn tệp được rút gọn và tên chương trình shell đầu tiên. Các trường metadata vẫn có thể chứa tên dự án hoặc nội dung nội bộ; không đưa thư mục runtime vào Git.

Server chỉ lắng nghe `127.0.0.1`, kiểm tra Host/Origin, không có endpoint thay đổi agent, không gọi model và không gửi dữ liệu đến dịch vụ bên ngoài. Mỗi command hook có timeout 5 giây, không in quyết định lên stdout và luôn thoát thành công nếu collector gặp lỗi. Node process cho mỗi hook vẫn có một lượng overhead nhỏ.

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `AGENT_OBSERVATORY_HOME` | `~/.claude/agent-observatory` | Thư mục dữ liệu riêng của mod |
| `AGENT_OBSERVATORY_PORT` | `47831` | Cổng từ 1024 đến 65535; đặt giống nhau cho Claude và server |
| `AGENT_OBSERVATORY_TRANSCRIPTS` | Bật | Đặt `0` để không đọc usage từ transcript |
| `AGENT_OBSERVATORY_DEBUG` | Tắt | Đặt `1` để collector ghi lỗi tổng quát vào stderr |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Gốc cấu hình Claude; transcript chỉ được đọc dưới thư mục `projects` tương ứng |

Đặt các biến trên **trước khi khởi động Claude Code**. Chỉ các phiên đã nạp plugin và ghi vào cùng thư mục dữ liệu mới xuất hiện. Phiên ở máy/VM/container khác cần collector tại môi trường đó; bản này chưa có server tổng hợp nhiều máy.

## 6. Giới hạn của bản 0.2.0

- Thu thập kể từ lúc plugin được nạp; không tự dựng lại lịch sử hoạt động trước đó.
- Có thể thiếu agent ID ở một số hook/phiên bản. Metadata từ function hook `agent.spawn` bổ sung tên, model và parent khi có.
- Một số dữ liệu như quota/context/model cost phụ thuộc quyền/runtime. Không có dữ liệu thì UI giữ `—`.
- Chỉ đọc usage của transcript JSONL phù hợp schema hiện tại, nằm trong thư mục cấu hình Claude. Mỗi lần đọc thường tối đa 8 MiB; hook kết thúc tối đa 64 MiB. Transcript quá lớn hoặc schema khác có thể chưa có số liệu usage.
- Server đọc tối đa 100 nhật ký mới nhất, phần cuối tối đa 8 MiB mỗi nhật ký; snapshot trả tối đa 50 phiên. Nếu phải cắt bớt nhật ký, có cảnh báo và số liệu có thể chỉ phản ánh phần đã đọc.
- Snapshot giới hạn 240 sự kiện mỗi phạm vi và 120 tool gần đây mỗi agent. Tổng tool có thể lớn hơn số hàng lịch sử đang hiển thị.
- Chưa có chính sách xóa nhật ký tự động. Bạn quản lý/lưu trữ thư mục dữ liệu theo nhu cầu.
- Bản đồ văn phòng có tối đa 12 nhân vật để giữ độ rõ; agent cần chú ý/đang làm được ưu tiên. Roster cho biết và cho chọn những agent ngoài bản đồ.
- Không có nút kill/retry/approve agent, export dữ liệu sản xuất hoặc tích hợp Teams/GitLab. Đây là lớp quan sát độc lập.

## 7. Phát triển và xác minh

```bash
npm run check
npm test
npm run preview
```

`check` kiểm tra cú pháp, JSON, liên kết manifest/hook và cấu trúc HTML cơ bản. Tests gồm reducer, chuẩn hóa dữ liệu, đọc transcript, collector process, HTTP/SSE, office state mapping và native stream contract dùng mock của host. `preview` tạo cả dashboard và văn phòng dưới dạng HTML độc lập tại `artifacts/`.

**Đã kiểm tra đường dữ liệu từ hook process → nhật ký → API/SSE.** Môi trường xây dựng không cài Claude Code, nên chưa xác nhận cài và render pane trên runtime thật. Browser render cũng chưa được xác nhận do môi trường kiểm tra không mở được Chromium/local server. Xem `docs/verification.md` để biết phạm vi chính xác.

## Cấu trúc

```text
.claude-plugin/marketplace.json   Marketplace GitHub hoặc local
plugin/.claude-plugin/           Manifest plugin
plugin/hooks/                   Function hooks, classic hooks và native pane
plugin/lib/                     Normalize, journal, usage, reducer và demo
plugin/scripts/                 Collector, server, launcher
plugin/web/                     Dashboard web HTML/CSS/JS
scripts/                        Local consistency check và build preview
tests/                          Model, ingestion, HTTP/SSE integration
test-support/                   Native host contract tests
docs/                           Data contract, UI notes, verification
previews/                       Hai bản HTML demo độc lập
```

## Nguồn API và cảm hứng

Thiết kế mới, tham khảo nhóm mod theo dõi agents trên [ClaudeMod](https://www.claudemod.com/browse?category=mod), đặc biệt cách trình bày hierarchy/timeline. Không sao chép mã nguồn của các mod đó.

- [Tạo Claude Code mod](https://code.claude.com/docs/en/plugins/mods/create)
- [Function hooks reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Mod UI interface](https://code.claude.com/docs/en/plugins/mods/interface)
- [Mod API](https://code.claude.com/docs/en/plugins/mods/api)
- [Classic hooks reference](https://code.claude.com/docs/en/hooks)
- [Official types](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts), đối chiếu blob `4f87f5e4d649cd1da725c99d30019ae921a25f0c` khi xây dựng.

License: MIT.

## Public source and privacy

This repository contains application source and **synthetic, labelled demo data only**. No real agent transcripts, workspace exports, personal profiles, credentials or local runtime journals should be committed. The application writes live observations to `~/.claude/agent-observatory` on each user's own machine; this folder must remain private. Metadata collected at runtime may contain private project/task names and paths, even though the example files in this repository are fictitious.

Before submitting a PR, run `npm run privacy-check`, `npm run check` and `npm test`. The automated privacy check detects common secret formats and machine-specific paths but **cannot guarantee that sensitive information is absent**; review demo text, screenshots, logs, diffs and Git history manually before publishing. If a real credential was ever committed, revoke or rotate it, then remove it from repository history; simply deleting it from the latest commit is not sufficient.
