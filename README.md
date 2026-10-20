# 會議室預約看板

給 10～30 人小團隊使用的會議室預約看板。打開網頁就能看到某間會議室這一週的預約狀況，並完成新增、修改、刪除；系統會自動擋下時段衝突。

- **純前端**：HTML + CSS + 原生 JavaScript，無後端、無建置步驟、無相依套件
- **零安裝、零登入**：直接雙擊 `index.html` 即可使用
- **資料存在瀏覽器的 localStorage**：不同電腦或瀏覽器之間看不到彼此的預約，清除瀏覽器資料會讓預約遺失。本版定位為單機示範版。

完整需求與驗收標準（AC1–AC15）請見 [`spec.md`](spec.md)。

## 功能

**週視圖看板**
- 切換 A／B／C 三間會議室
- 顯示所選會議室一週（週一～週日）的預約，以 30 分鐘為一格，縱軸 00:00～24:00，預設捲動到 08:00 附近
- 上一週／下一週／回到本週
- 標示今天的欄位與目前時間線（每分鐘更新）
- 預約以色塊呈現，顯示主題與預約人；顏色依預約人姓名自動決定，同一人固定同色

**預約操作**
- 新增：點空白格子（自動帶入時段），或點「＋ 新增預約」
- 修改：點既有預約，可修改所有欄位，包含時段與會議室
- 刪除：在表單中刪除，需二次確認
- 衝突檢查：同一會議室、同一天的時段重疊時不允許儲存，並指出與哪一筆衝突；首尾相接（例如 09:00–10:00 與 10:00–11:00）不算重疊

**其他**
- 依預約人篩選：不符合的預約會淡化顯示而非隱藏，避免誤以為該時段是空的
- 預約明細：週視圖下方以表格列出本週預約，可收合，點選可開啟修改表單
- 匯出 CSV：下載指定日期所有會議室的預約（UTF-8 含 BOM，Excel 可直接開啟）

### 預約欄位

| 欄位 | 必填 | 規則 |
|---|---|---|
| 會議室 | ✅ | A／B／C 擇一 |
| 日期 | ✅ | — |
| 開始時間、結束時間 | ✅ | 30 分鐘為單位；結束須晚於開始；不可跨日 |
| 預約人姓名 | ✅ | 前後空白自動去除 |
| 會議主題 | ✅ | — |
| 與會人數 | ⬜ | 正整數 |
| 備註 | ⬜ | 多行文字 |

## 開啟使用

直接用瀏覽器開啟 `index.html` 即可（支援最新版 Chrome／Edge／Firefox）。

也可以用任何靜態伺服器提供此資料夾，例如：

```sh
npx serve .
# 或
python -m http.server
```

## 執行測試

### 驗收測試（AC1–AC15）

需求：

- Node.js 22 以上（使用內建的 `fetch` 與 `WebSocket`）
- 本機安裝 Chrome 或 Edge；找不到時以環境變數 `CHROME_PATH` 指定瀏覽器執行檔路徑

```sh
npm test
```

測試會啟動 headless Chrome，透過 Chrome DevTools Protocol 開啟 `index.html`，逐條操作並檢查 AC，每條輸出 `PASS` 或 `FAIL`。截圖輸出到 `tests/output/`（已 gitignore）。

注意：`tests/ac-test.mjs` 是依序執行的腳本，後面的檢查依賴前面建立的預約，無法單獨執行某一條。要除錯某條 AC 時，可暫時註解掉其後的區塊。

### 單元測試（`findConflict`）

直接用瀏覽器開啟 `test.html`，會測試衝突判斷的各種重疊情況。頁面標題會顯示 `PASS …` 或 `FAIL …`。

## 檔案結構

```
meeting-room-board/
├── index.html        頁面結構：工具列、週視圖、預約明細、預約表單對話框
├── style.css         樣式；--slot 為每格高度（須與 app.js 的 SLOT_PX 相同）
├── app.js            所有程式邏輯（單一 IIFE）
├── test.html         findConflict 的瀏覽器單元測試
├── tests/
│   └── ac-test.mjs   以 headless Chrome 執行的驗收測試
├── package.json      只定義 npm test 指令，無相依套件
├── spec.md           需求規格與驗收標準
└── CLAUDE.md         給 Claude Code 的開發說明
```

### `app.js` 的組成

由上而下依序為：

1. 設定常數（會議室清單、`SLOT_MIN`、`SLOT_PX` 等）
2. 日期／時間工具：`toMin`／`toTime`（當日分鐘數）、`toDateStr`／`parseDate`（本地時區的 `YYYY-MM-DD`）、`startOfWeek`（週一起算）
3. 資料存取：`loadBookings`／`saveBookings`／`findConflict`
4. `state` 物件
5. 繪製函式：狀態改變後呼叫 `render()` 整體重繪，沒有增量更新
6. 表單、事件綁定、啟動

`findConflict` 也掛在 `window` 上，供 `test.html` 呼叫。

### 資料格式

所有預約以 JSON 陣列存在 localStorage 的單一 key `meeting-room-board.bookings`：

```json
{
  "id": "uuid",
  "roomId": "A",
  "date": "2026-10-20",
  "start": "09:00",
  "end": "10:30",
  "booker": "王小明",
  "title": "週會",
  "attendees": 5,
  "note": ""
}
```

資料損毀（無效 JSON）時以空看板啟動，不合格的筆數會被濾掉。

## 開發注意事項

- **檔案限制**：前端限定 `index.html`、`style.css`、`app.js`、`test.html` 四檔，不可再拆分檔案或引入外部框架。`app.js` 以一般 `<script>` 載入，不要改成 ES module，否則雙擊開啟會失效。
- **日期**：一律用本地時區，不要用 `Date.toISOString()`，否則會有時區偏移。
- **格高**：`app.js` 的 `SLOT_PX` 與 `style.css` 的 `--slot` 必須一致（目前 24px），驗收測試中也寫死了這個值。
- **測試依賴的 DOM**：驗收測試依賴元素 id（如 `bookingForm`、`formError`、`fBooker`）、class（如 `.booking`、`.dimmed`、`.now-line`）與錯誤訊息關鍵字（「姓名」「主題」「結束時間」「衝突」「正整數」）。修改這些時要同步更新 `tests/ac-test.mjs`。
- **非目標**：登入、後端同步、重複預約、跨日預約等功能本版刻意不做，新增功能前請先對照 `spec.md` 的「非目標」一節。
- UI 文字、程式註解與測試訊息皆使用繁體中文。
